import Database from 'better-sqlite3';
import type { SourceAdapter } from '../adapters/types.js';
import { persistRawItems } from '../db/raw-items.js';
import { getCursor, upsertCursor } from '../db/sources.js';

export interface IngestOptions {
  db: Database.Database;
  adapters: SourceAdapter[];
  sinceOverride?: Date;
  now?: () => Date;
  log?: (msg: string) => void;
}

export interface SourceStat {
  sourceId: string;
  fetched: number;
  inserted: number;
  error?: string;
}

export async function ingestSources(opts: IngestOptions): Promise<SourceStat[]> {
  const now = opts.now ?? (() => new Date());
  const log = opts.log ?? console.log;
  const runStart = now();
  const stats: SourceStat[] = [];

  for (const adapter of opts.adapters) {
    const cursor = getCursor(opts.db, adapter.id);
    const since =
      opts.sinceOverride ??
      (cursor ? new Date(cursor) : new Date(runStart.getTime() - 7 * 24 * 60 * 60 * 1000));

    try {
      const fetchedAt = now();
      const items = await adapter.fetch(since);
      const inserted = persistRawItems(opts.db, items);
      upsertCursor(opts.db, adapter.id, adapter.id.split(':')[0], JSON.stringify({}), fetchedAt.toISOString());
      stats.push({ sourceId: adapter.id, fetched: items.length, inserted });
      log(`${adapter.id}: ${items.length} fetched, ${inserted} new`);
    } catch (err) {
      const errMessage = err instanceof Error ? err.message : String(err);
      stats.push({ sourceId: adapter.id, fetched: 0, inserted: 0, error: errMessage });
      log(`${adapter.id}: ERROR ${errMessage}`);
    }
  }

  return stats;
}
