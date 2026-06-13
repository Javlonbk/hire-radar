import Database from 'better-sqlite3';

export function getCursor(db: Database.Database, sourceId: string): string | null {
  const row = db.prepare('SELECT last_fetched_at FROM sources WHERE id = ?').get(sourceId) as
    | { last_fetched_at: string | null }
    | undefined;
  return row?.last_fetched_at ?? null;
}

export function upsertCursor(
  db: Database.Database,
  sourceId: string,
  type: string,
  configJson: string,
  lastFetchedAt: string,
): void {
  db.prepare(
    'INSERT INTO sources (id, type, config_json, last_fetched_at) VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET last_fetched_at = excluded.last_fetched_at, type = excluded.type, config_json = excluded.config_json',
  ).run(sourceId, type, configJson, lastFetchedAt);
}
