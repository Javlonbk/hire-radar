import { describe, it, expect, beforeEach } from 'vitest';
import { openDatabase } from './client.js';
import { persistRawItems, getPendingRawItems, markExtractionStatus } from './raw-items.js';
import type { RawItem } from '../adapters/types.js';
import { contentHash } from '../hash.js';
import Database from 'better-sqlite3';

function makeItem(nativeId: string): RawItem {
  return {
    sourceId: 'test:src',
    nativeId,
    rawText: `job ${nativeId}`,
    rawJson: { id: nativeId },
    fetchedAt: new Date('2026-01-01T00:00:00Z'),
    contentHash: contentHash('test:src' + ':' + nativeId),
  };
}

describe('persistRawItems', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = openDatabase(':memory:');
  });

  it('inserts N distinct items and returns N', () => {
    const items = [makeItem('1'), makeItem('2'), makeItem('3')];
    const inserted = persistRawItems(db, items);
    expect(inserted).toBe(3);
    const rows = db.prepare('SELECT * FROM raw_items').all();
    expect(rows).toHaveLength(3);
  });

  it('re-inserting the same content_hash inserts 0 rows', () => {
    const item = makeItem('42');
    persistRawItems(db, [item]);
    const second = persistRawItems(db, [item]);
    expect(second).toBe(0);
    const rows = db.prepare('SELECT * FROM raw_items').all();
    expect(rows).toHaveLength(1);
  });

  it('sets extraction_status to pending by default', () => {
    persistRawItems(db, [makeItem('5')]);
    const row = db.prepare('SELECT extraction_status FROM raw_items').get() as { extraction_status: string };
    expect(row.extraction_status).toBe('pending');
  });

  it('returns 0 for empty array', () => {
    expect(persistRawItems(db, [])).toBe(0);
  });
});

describe('getPendingRawItems', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = openDatabase(':memory:');
  });

  it('returns only pending rows', () => {
    persistRawItems(db, [makeItem('a'), makeItem('b'), makeItem('c')]);
    db.prepare("UPDATE raw_items SET extraction_status = 'done' WHERE external_id = 'b'").run();
    const pending = getPendingRawItems(db);
    expect(pending).toHaveLength(2);
    expect(pending.every(r => r.rawText !== 'job b')).toBe(true);
  });

  it('maps columns to camelCase', () => {
    persistRawItems(db, [makeItem('x')]);
    const [row] = getPendingRawItems(db);
    expect(row).toMatchObject({
      sourceId: 'test:src',
      externalId: 'x',
      rawText: 'job x',
    });
    expect(typeof row.id).toBe('string');
  });

  it('respects optional limit', () => {
    persistRawItems(db, [makeItem('1'), makeItem('2'), makeItem('3')]);
    const limited = getPendingRawItems(db, 2);
    expect(limited).toHaveLength(2);
  });

  it('returns empty array when nothing pending', () => {
    expect(getPendingRawItems(db)).toHaveLength(0);
  });

  it('floors a fractional limit instead of crashing', () => {
    persistRawItems(db, [makeItem('1'), makeItem('2'), makeItem('3')]);
    expect(() => getPendingRawItems(db, 2.9)).not.toThrow();
    expect(getPendingRawItems(db, 2.9)).toHaveLength(2);
  });

  it('treats a negative limit as 0', () => {
    persistRawItems(db, [makeItem('1'), makeItem('2')]);
    expect(() => getPendingRawItems(db, -1)).not.toThrow();
    expect(getPendingRawItems(db, -1)).toHaveLength(0);
  });
});

describe('markExtractionStatus', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = openDatabase(':memory:');
    persistRawItems(db, [makeItem('m')]);
  });

  it('marks status done — row no longer pending', () => {
    const [row] = getPendingRawItems(db);
    markExtractionStatus(db, row.id, 'done');
    expect(getPendingRawItems(db)).toHaveLength(0);
    const updated = db
      .prepare('SELECT extraction_status FROM raw_items WHERE id = ?')
      .get(row.id) as { extraction_status: string };
    expect(updated.extraction_status).toBe('done');
  });

  it('marks status failed and stores error', () => {
    const [row] = getPendingRawItems(db);
    markExtractionStatus(db, row.id, 'failed', 'extraction validation failed');
    const updated = db
      .prepare('SELECT extraction_status, extraction_error FROM raw_items WHERE id = ?')
      .get(row.id) as { extraction_status: string; extraction_error: string };
    expect(updated.extraction_status).toBe('failed');
    expect(updated.extraction_error).toBe('extraction validation failed');
  });

  it('sets extraction_error to null when no error given', () => {
    const [row] = getPendingRawItems(db);
    markExtractionStatus(db, row.id, 'done');
    const updated = db
      .prepare('SELECT extraction_error FROM raw_items WHERE id = ?')
      .get(row.id) as { extraction_error: string | null };
    expect(updated.extraction_error).toBeNull();
  });
});
