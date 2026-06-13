import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase, runInTransaction } from './client.js';

let tmpDir: string | null = null;

function makeTmpDb(): string {
  tmpDir = mkdtempSync(join(tmpdir(), 'hire-radar-test-'));
  return join(tmpDir, 'test.db');
}

afterEach(() => {
  if (tmpDir && existsSync(tmpDir)) {
    rmSync(tmpDir, { recursive: true, force: true });
    tmpDir = null;
  }
});

describe('openDatabase', () => {
  it('opens a file DB in WAL journal mode', () => {
    const db = openDatabase(makeTmpDb());
    const row = db.prepare('PRAGMA journal_mode').get() as { journal_mode: string };
    db.close();
    expect(row.journal_mode).toBe('wal');
  });

  it('sets busy_timeout to 10000', () => {
    const db = openDatabase(makeTmpDb());
    const row = db.prepare('PRAGMA busy_timeout').get() as { timeout: number };
    db.close();
    expect(row.timeout).toBe(10000);
  });

  it('creates all 4 tables on first open', () => {
    const db = openDatabase(makeTmpDb());
    const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as { name: string }[]).map(r => r.name);
    db.close();
    expect(tables).toContain('sources');
    expect(tables).toContain('raw_items');
    expect(tables).toContain('extraction_cache');
    expect(tables).toContain('vacancies');
  });

  it('creates missing parent directories for the db path', () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'hire-radar-test-'));
    const path = join(tmpDir, 'nested', 'deep', 'test.db');
    const db = openDatabase(path);
    db.close();
    expect(existsSync(path)).toBe(true);
  });

  it('is idempotent — re-opening the same file does not error', () => {
    const path = makeTmpDb();
    const db1 = openDatabase(path);
    db1.close();
    const db2 = openDatabase(path);
    db2.close();
  });

  it('UNIQUE(content_hash) on raw_items deduplicates via INSERT OR IGNORE', () => {
    const db = openDatabase(':memory:');
    const insert = db.prepare(
      "INSERT OR IGNORE INTO raw_items (source_id, raw_text, content_hash, fetched_at) VALUES (?, ?, ?, ?)"
    );
    insert.run('src1', 'hello', 'abc123', new Date().toISOString());
    insert.run('src2', 'hello again', 'abc123', new Date().toISOString());
    const count = (db.prepare('SELECT COUNT(*) as c FROM raw_items').get() as { c: number }).c;
    db.close();
    expect(count).toBe(1);
  });
});

describe('runInTransaction', () => {
  it('commits all writes when callback returns normally', () => {
    const db = openDatabase(':memory:');
    runInTransaction(db, () => {
      db.prepare("INSERT OR IGNORE INTO raw_items (source_id, raw_text, content_hash, fetched_at) VALUES (?, ?, ?, ?)").run('s', 't', 'h1', new Date().toISOString());
      db.prepare("INSERT OR IGNORE INTO raw_items (source_id, raw_text, content_hash, fetched_at) VALUES (?, ?, ?, ?)").run('s', 't2', 'h2', new Date().toISOString());
    });
    const count = (db.prepare('SELECT COUNT(*) as c FROM raw_items').get() as { c: number }).c;
    db.close();
    expect(count).toBe(2);
  });

  it('rolls back all writes when callback throws', () => {
    const db = openDatabase(':memory:');
    try {
      runInTransaction(db, () => {
        db.prepare("INSERT OR IGNORE INTO raw_items (source_id, raw_text, content_hash, fetched_at) VALUES (?, ?, ?, ?)").run('s', 't', 'h1', new Date().toISOString());
        throw new Error('intentional rollback');
      });
    } catch {
      // expected
    }
    const count = (db.prepare('SELECT COUNT(*) as c FROM raw_items').get() as { c: number }).c;
    db.close();
    expect(count).toBe(0);
  });
});
