import Database from 'better-sqlite3';
import type { RawItem } from '../adapters/types.js';
import { runInTransaction } from './client.js';

export function persistRawItems(db: Database.Database, items: RawItem[]): number {
  if (items.length === 0) return 0;
  const stmt = db.prepare(
    'INSERT OR IGNORE INTO raw_items (source_id, external_id, raw_text, raw_json, content_hash, fetched_at) VALUES (?,?,?,?,?,?)',
  );
  let total = 0;
  runInTransaction(db, () => {
    for (const item of items) {
      const result = stmt.run(
        item.sourceId,
        item.nativeId,
        item.rawText,
        item.rawJson !== null ? JSON.stringify(item.rawJson) : null,
        item.contentHash,
        item.fetchedAt.toISOString(),
      );
      total += result.changes;
    }
  });
  return total;
}

export interface PendingRawItem {
  id: string;
  sourceId: string;
  externalId: string | null;
  rawText: string;
}

export function getPendingRawItems(db: Database.Database, limit?: number): PendingRawItem[] {
  const lim = limit !== undefined ? Math.max(0, Math.trunc(limit)) : undefined;
  const sql =
    "SELECT id, source_id, external_id, raw_text FROM raw_items WHERE extraction_status = 'pending' ORDER BY fetched_at ASC" +
    (lim !== undefined ? ' LIMIT ?' : '');
  const args = lim !== undefined ? [lim] : [];
  const rows = db.prepare(sql).all(...args) as {
    id: string;
    source_id: string;
    external_id: string | null;
    raw_text: string;
  }[];
  return rows.map(r => ({
    id: r.id,
    sourceId: r.source_id,
    externalId: r.external_id,
    rawText: r.raw_text,
  }));
}

export function markExtractionStatus(
  db: Database.Database,
  id: string,
  status: 'done' | 'failed',
  error?: string,
): void {
  db.prepare('UPDATE raw_items SET extraction_status = ?, extraction_error = ? WHERE id = ?').run(
    status,
    error ?? null,
    id,
  );
}
