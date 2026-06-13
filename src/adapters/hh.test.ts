import { describe, it, expect } from 'vitest';
import { createHhAdapter } from './hh.js';
import { contentHash } from '../hash.js';

function makePage(page: number, pages: number, found: number, items: unknown[]) {
  return { found, pages, items, page };
}

function fakeVacancy(id: string) {
  return {
    id,
    name: `Job ${id}`,
    employer: { name: `Company ${id}` },
    snippet: { requirement: `req ${id}`, responsibility: `resp ${id}` },
  };
}

function makeFetchFn(pages: Array<{ found: number; pages: number; items: unknown[] }>) {
  let call = 0;
  return async (_url: string | URL | Request, _init?: RequestInit) => {
    const body = { ...pages[call], page: call };
    call++;
    return {
      ok: true,
      json: async () => body,
    } as Response;
  };
}

describe('createHhAdapter', () => {
  const noSleep = async (_ms: number) => {};

  it('returns adapter with id "hh:uz"', () => {
    const adapter = createHhAdapter({ area: '97', text: 'developer', perPage: 10, sleep: noSleep });
    expect(adapter.id).toBe('hh:uz');
  });

  it('collects items across two pages', async () => {
    const p1items = [fakeVacancy('1'), fakeVacancy('2')];
    const p2items = [fakeVacancy('3')];
    const fetchFn = makeFetchFn([
      { found: 3, pages: 2, items: p1items },
      { found: 3, pages: 2, items: p2items },
    ]);
    const adapter = createHhAdapter({ area: '97', text: 'dev', perPage: 2, fetchFn, sleep: noSleep });
    const since = new Date('2026-01-01T00:00:00Z');
    const items = await adapter.fetch(since);
    expect(items).toHaveLength(3);
    expect(items.map(i => i.nativeId)).toEqual(['1', '2', '3']);
  });

  it('sets contentHash as contentHash("hh:uz:" + vacancy.id)', async () => {
    const fetchFn = makeFetchFn([{ found: 1, pages: 1, items: [fakeVacancy('abc')] }]);
    const adapter = createHhAdapter({ area: '97', text: 'dev', perPage: 1, fetchFn, sleep: noSleep });
    const items = await adapter.fetch(new Date());
    expect(items[0].contentHash).toBe(contentHash('hh:uz:abc'));
  });

  it('stores a whitelisted rawJson, not the full vacancy object', async () => {
    const vacancy = { ...fakeVacancy('z'), area: { name: 'Tashkent' }, salary: { from: 100 } };
    const fetchFn = makeFetchFn([{ found: 1, pages: 1, items: [vacancy] }]);
    const adapter = createHhAdapter({ area: '97', text: 'dev', perPage: 1, fetchFn, sleep: noSleep });
    const items = await adapter.fetch(new Date());
    expect(items[0].rawJson).toEqual({
      id: 'z',
      name: 'Job z',
      employer: { name: 'Company z' },
      snippet: { requirement: 'req z', responsibility: 'resp z' },
    });
  });

  it('includes date_from in the request URL', async () => {
    const urls: string[] = [];
    const fetchFn = async (url: string | URL | Request, _init?: RequestInit) => {
      urls.push(String(url));
      return { ok: true, json: async () => ({ found: 0, pages: 0, items: [], page: 0 }) } as Response;
    };
    const adapter = createHhAdapter({ area: '97', text: 'dev', perPage: 10, fetchFn, sleep: noSleep });
    const since = new Date('2026-03-15T00:00:00Z');
    await adapter.fetch(since);
    expect(urls[0]).toContain('date_from=');
    expect(urls[0]).toContain('2026-03-15');
  });

  it('logs warning when found > 2000', async () => {
    const fetchFn = makeFetchFn([{ found: 4521, pages: 1, items: [fakeVacancy('x')] }]);
    const logs: string[] = [];
    const adapter = createHhAdapter({
      area: '97',
      text: 'dev',
      perPage: 10,
      fetchFn,
      sleep: noSleep,
      log: (msg) => logs.push(msg),
    });
    await adapter.fetch(new Date());
    expect(logs.length).toBe(1);
    expect(logs[0]).toContain('4521');
    expect(logs[0]).toContain('2000');
  });

  it('throws on non-OK HTTP status instead of returning an empty result', async () => {
    const fetchFn = async (_url: string | URL | Request, _init?: RequestInit) =>
      ({ ok: false, status: 403, json: async () => ({}) }) as Response;
    const adapter = createHhAdapter({ area: '97', text: 'dev', perPage: 10, fetchFn, sleep: noSleep });
    await expect(adapter.fetch(new Date())).rejects.toThrow(/HTTP 403/);
  });

  it('does not log warning when found <= 2000', async () => {
    const fetchFn = makeFetchFn([{ found: 100, pages: 1, items: [fakeVacancy('y')] }]);
    const logs: string[] = [];
    const adapter = createHhAdapter({
      area: '97',
      text: 'dev',
      perPage: 10,
      fetchFn,
      sleep: noSleep,
      log: (msg) => logs.push(msg),
    });
    await adapter.fetch(new Date());
    expect(logs).toHaveLength(0);
  });
});
