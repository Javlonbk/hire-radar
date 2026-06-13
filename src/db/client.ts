import Database from 'better-sqlite3';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEFAULT_DB_PATH = 'data/hire-radar.db';

export function openDatabase(path: string = DEFAULT_DB_PATH): Database.Database {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 10000');
  const schemaPath = fileURLToPath(new URL('./schema.sql', import.meta.url));
  const schemaSql = readFileSync(schemaPath, 'utf-8');
  db.exec(schemaSql);
  return db;
}

// better-sqlite3 commits on the first await inside a transaction callback,
// so fn must be synchronous — no await may appear inside.
export function runInTransaction<T>(db: Database.Database, fn: () => T): T {
  return db.transaction(fn)();
}
