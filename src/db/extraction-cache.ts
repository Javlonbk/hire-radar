import Database from 'better-sqlite3';
import { runInTransaction } from './client.js';

export function getCachedExtraction(db: Database.Database, contentHash: string): unknown | null {
  const row = db
    .prepare('SELECT result_json FROM extraction_cache WHERE content_hash = ?')
    .get(contentHash) as { result_json: string } | undefined;
  if (!row) return null;
  try {
    return JSON.parse(row.result_json);
  } catch {
    return null;
  }
}

export function putCachedExtraction(
  db: Database.Database,
  args: { contentHash: string; resultJson: unknown; model: string; extractedAt: string },
): void {
  const stmt = db.prepare(
    'INSERT OR REPLACE INTO extraction_cache (content_hash, result_json, extracted_at, model) VALUES (?,?,?,?)',
  );
  runInTransaction(db, () => {
    stmt.run(args.contentHash, JSON.stringify(args.resultJson), args.extractedAt, args.model);
  });
}
