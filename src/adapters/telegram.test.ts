import { describe, expect, it, vi } from 'vitest';
import { createTelegramAdapter } from './telegram.js';
import type { TelegramLike } from './telegram.js';
import { FloodWaitError } from 'telegram/errors/index.js';

const CHANNEL = 'test_channel';
const NOW = new Date('2024-01-10T12:00:00Z');
const SINCE = new Date('2024-01-10T00:00:00Z');

function makeStub(overrides?: Partial<TelegramLike>): TelegramLike {
  return {
    connect: vi.fn().mockResolvedValue(undefined),
    isUserAuthorized: vi.fn().mockResolvedValue(true),
    getMessages: vi.fn().mockResolvedValue([
      { id: 200, message: 'New job post', date: Math.floor(NOW.getTime() / 1000) },
      { id: 100, message: 'Old job post', date: Math.floor(new Date('2024-01-09T00:00:00Z').getTime() / 1000) },
    ]),
    ...overrides,
  };
}

describe('createTelegramAdapter', () => {
  it('(a) filters messages by since date and returns RawItems with correct shape', async () => {
    const stub = makeStub();
    const sleepFn = vi.fn().mockResolvedValue(undefined);
    const adapter = createTelegramAdapter({
      channel: CHANNEL,
      apiId: 12345,
      apiHash: 'abc',
      session: 'sess',
      clientFactory: () => stub,
      sleep: sleepFn,
      jitterMs: () => 0,
    });

    expect(adapter.id).toBe('telegram:test_channel');

    const items = await adapter.fetch(SINCE);

    expect(items).toHaveLength(1);
    expect(items[0].sourceId).toBe('telegram:test_channel');
    expect(items[0].nativeId).toBe('200');
    expect(items[0].rawText).toBe('New job post');
    expect(items[0].rawJson).toEqual({ id: 200, date: Math.floor(NOW.getTime() / 1000) });
    expect(items[0].fetchedAt).toBeInstanceOf(Date);
    expect(typeof items[0].contentHash).toBe('string');
    expect(items[0].contentHash).toHaveLength(64);
  });

  it('(b) rejects with actionable error when isUserAuthorized returns false, without leaking session', async () => {
    const stub = makeStub({ isUserAuthorized: vi.fn().mockResolvedValue(false) });
    const adapter = createTelegramAdapter({
      channel: CHANNEL,
      apiId: 12345,
      apiHash: 'abc',
      session: 'MY_SECRET_SESSION_VALUE',
      clientFactory: () => stub,
      sleep: vi.fn().mockResolvedValue(undefined),
      jitterMs: () => 0,
    });

    await expect(adapter.fetch(SINCE)).rejects.toThrow('hire-radar auth');

    try {
      await adapter.fetch(SINCE);
    } catch (err) {
      const msg = (err as Error).message;
      expect(msg).not.toContain('MY_SECRET_SESSION_VALUE');
    }
  });

  it('(c) rejects with missing-session actionable error when session is absent', async () => {
    const adapter = createTelegramAdapter({
      channel: CHANNEL,
      apiId: 12345,
      apiHash: 'abc',
    });

    await expect(adapter.fetch(SINCE)).rejects.toThrow('hire-radar auth');
  });

  it('(e) paginates beyond 100 messages via offsetId until reaching since', async () => {
    const nowSec = Math.floor(NOW.getTime() / 1000);
    // 150 messages all newer than SINCE, ids 150..1 newest-first
    const all = Array.from({ length: 150 }, (_, i) => ({
      id: 150 - i,
      message: `post ${150 - i}`,
      date: nowSec,
    }));

    const getMessages = vi.fn(async (_channel: string, o: { limit: number; offsetId?: number }) => {
      const start = o.offsetId ? all.findIndex(m => m.id < o.offsetId!) : 0;
      return all.slice(start, start + o.limit);
    });

    const stub = makeStub({ getMessages });
    const adapter = createTelegramAdapter({
      channel: CHANNEL,
      apiId: 12345,
      apiHash: 'abc',
      session: 'sess',
      clientFactory: () => stub,
      sleep: vi.fn().mockResolvedValue(undefined),
      jitterMs: () => 0,
    });

    const items = await adapter.fetch(SINCE);

    expect(items).toHaveLength(150);
    expect(getMessages.mock.calls.length).toBeGreaterThan(1);
    expect(getMessages.mock.calls[1][1].offsetId).toBe(51);
  });

  it('(d) retries after FloodWaitError and returns messages, calling sleep with correct duration', async () => {
    const sleepFn = vi.fn().mockResolvedValue(undefined);
    let callCount = 0;
    const stub = makeStub({
      getMessages: vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) throw new FloodWaitError({ capture: 3 });
        return Promise.resolve([
          { id: 300, message: 'Post after flood', date: Math.floor(NOW.getTime() / 1000) },
        ]);
      }),
    });

    const adapter = createTelegramAdapter({
      channel: CHANNEL,
      apiId: 12345,
      apiHash: 'abc',
      session: 'sess',
      clientFactory: () => stub,
      sleep: sleepFn,
      jitterMs: () => 0,
    });

    const items = await adapter.fetch(SINCE);

    expect(items).toHaveLength(1);
    expect(items[0].nativeId).toBe('300');
    const sleepCalls = sleepFn.mock.calls.map(c => c[0]);
    expect(sleepCalls).toContain(3 * 1150);
  });
});
