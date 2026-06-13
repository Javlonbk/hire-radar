import { describe, it, expect, vi } from 'vitest';
import { runAuth, authCredsFromEnv } from './auth.js';

describe('runAuth', () => {
  it('prints session string and TELEGRAM_SESSION guidance on success', async () => {
    const lines: string[] = [];
    await runAuth({
      apiId: 12345,
      apiHash: 'abc',
      login: async () => 'SESSION_STR',
      out: (l) => lines.push(l),
    });
    const output = lines.join('\n');
    expect(output).toContain('SESSION_STR');
    expect(output).toContain('TELEGRAM_SESSION');
  });

  it('throws and never calls login when apiId is missing', async () => {
    const spy = vi.fn(async () => 'S');
    await expect(
      runAuth({
        apiId: undefined,
        apiHash: 'abc',
        login: spy,
        out: () => {},
      }),
    ).rejects.toThrow(/TELEGRAM_API_ID/);
    expect(spy).not.toHaveBeenCalled();
  });

  it('throws and never calls login when apiHash is missing', async () => {
    const spy = vi.fn(async () => 'S');
    await expect(
      runAuth({
        apiId: 12345,
        apiHash: undefined,
        login: spy,
        out: () => {},
      }),
    ).rejects.toThrow(/TELEGRAM_API_ID/);
    expect(spy).not.toHaveBeenCalled();
  });

  it('succeeds with only Telegram creds present (no ANTHROPIC_API_KEY)', async () => {
    const env = { TELEGRAM_API_ID: '12345', TELEGRAM_API_HASH: 'abc' } as NodeJS.ProcessEnv;
    const lines: string[] = [];
    const spy = vi.fn(async () => 'SESSION_STR');
    await runAuth({ ...authCredsFromEnv(env), login: spy, out: (l) => lines.push(l) });
    expect(spy).toHaveBeenCalledWith({ apiId: 12345, apiHash: 'abc' });
    expect(lines.join('\n')).toContain('SESSION_STR');
  });

  it('errors naming Telegram creds when they are absent', async () => {
    const spy = vi.fn(async () => 'S');
    await expect(
      runAuth({ ...authCredsFromEnv({} as NodeJS.ProcessEnv), login: spy, out: () => {} }),
    ).rejects.toThrow(/TELEGRAM_API_ID \/ TELEGRAM_API_HASH/);
    expect(spy).not.toHaveBeenCalled();
  });

  it('does not print api_id or api_hash in output', async () => {
    const lines: string[] = [];
    await runAuth({
      apiId: 12345,
      apiHash: 'deadbeef',
      login: async () => 'S',
      out: (l) => lines.push(l),
    });
    const output = lines.join('\n');
    expect(output).not.toContain('12345');
    expect(output).not.toContain('deadbeef');
  });
});
