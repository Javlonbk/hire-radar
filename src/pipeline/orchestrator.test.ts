import { describe, expect, it } from 'vitest';
import { openDatabase } from '../db/client.js';
import { getCursor } from '../db/sources.js';
import { ingestSources } from './orchestrator.js';
import type { RawItem, SourceAdapter } from '../adapters/types.js';

function makeItem(sourceId: string, n: number): RawItem {
  return {
    sourceId,
    nativeId: `native-${n}`,
    rawText: `text ${n}`,
    rawJson: null,
    fetchedAt: new Date('2026-01-01T00:00:00Z'),
    contentHash: `hash-${sourceId}-${n}`,
  };
}

function makeAdapter(id: string, items: RawItem[] | Error): SourceAdapter {
  return {
    id,
    fetch: async () => {
      if (items instanceof Error) throw items;
      return items;
    },
  };
}

describe('ingestSources', () => {
  it('runs both adapters sequentially even when first one fails', async () => {
    const db = openDatabase(':memory:');
    const now = new Date('2026-06-01T12:00:00Z');
    const good = makeAdapter('hh:uz', [makeItem('hh:uz', 1), makeItem('hh:uz', 2)]);
    const bad = makeAdapter('rss:abc', new Error('network error'));

    const stats = await ingestSources({
      db,
      adapters: [bad, good],
      now: () => now,
    });

    expect(stats).toHaveLength(2);
    const failStat = stats.find(s => s.sourceId === 'rss:abc')!;
    const goodStat = stats.find(s => s.sourceId === 'hh:uz')!;

    expect(failStat.error).toMatch(/network error/);
    expect(failStat.fetched).toBe(0);
    expect(failStat.inserted).toBe(0);

    expect(goodStat.error).toBeUndefined();
    expect(goodStat.fetched).toBe(2);
    expect(goodStat.inserted).toBe(2);
  });

  it('failed adapter cursor stays null, succeeded adapter cursor advances to runStart', async () => {
    const db = openDatabase(':memory:');
    const now = new Date('2026-06-01T12:00:00Z');
    const good = makeAdapter('hh:uz', [makeItem('hh:uz', 1)]);
    const bad = makeAdapter('rss:abc', new Error('boom'));

    await ingestSources({ db, adapters: [bad, good], now: () => now });

    expect(getCursor(db, 'rss:abc')).toBeNull();
    expect(getCursor(db, 'hh:uz')).toBe(now.toISOString());
  });

  it('persist-before-cursor: raw_items inserted before cursor advances', async () => {
    const db = openDatabase(':memory:');
    const now = new Date('2026-06-01T12:00:00Z');
    const adapter = makeAdapter('hh:uz', [makeItem('hh:uz', 1), makeItem('hh:uz', 2)]);

    const stats = await ingestSources({ db, adapters: [adapter], now: () => now });

    const rowCount = (db.prepare('SELECT COUNT(*) as c FROM raw_items').get() as { c: number }).c;
    expect(rowCount).toBe(stats[0].inserted);
    expect(stats[0].inserted).toBe(2);
    expect(getCursor(db, 'hh:uz')).toBe(now.toISOString());
  });

  it('sinceOverride overrides cursor for all adapters', async () => {
    const db = openDatabase(':memory:');
    const now = new Date('2026-06-01T12:00:00Z');
    const sinceOverride = new Date('2026-05-01T00:00:00Z');
    const seenSince: Date[] = [];
    const adapter: SourceAdapter = {
      id: 'hh:uz',
      fetch: async (since) => { seenSince.push(since); return []; },
    };

    await ingestSources({ db, adapters: [adapter], now: () => now, sinceOverride });

    expect(seenSince[0]).toEqual(sinceOverride);
  });

  it('first-run (no cursor) uses 7-day backfill as since', async () => {
    const db = openDatabase(':memory:');
    const now = new Date('2026-06-01T12:00:00Z');
    const seenSince: Date[] = [];
    const adapter: SourceAdapter = {
      id: 'hh:uz',
      fetch: async (since) => { seenSince.push(since); return []; },
    };

    await ingestSources({ db, adapters: [adapter], now: () => now });

    const expectedSince = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    expect(seenSince[0].getTime()).toBeCloseTo(expectedSince.getTime(), -3);
  });
});
