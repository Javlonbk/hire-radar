import { describe, it, expect, beforeEach } from 'vitest';
import { openDatabase } from './client.js';
import { getCursor, upsertCursor } from './sources.js';
import Database from 'better-sqlite3';

describe('getCursor / upsertCursor', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = openDatabase(':memory:');
  });

  it('getCursor returns null for unknown source id', () => {
    expect(getCursor(db, 'hh:uz')).toBeNull();
  });

  it('upsertCursor then getCursor returns the stored ISO string', () => {
    upsertCursor(db, 'hh:uz', 'hh', '{}', '2026-01-01T00:00:00.000Z');
    expect(getCursor(db, 'hh:uz')).toBe('2026-01-01T00:00:00.000Z');
  });

  it('upsertCursor twice updates last_fetched_at, no duplicate row', () => {
    upsertCursor(db, 'hh:uz', 'hh', '{}', '2026-01-01T00:00:00.000Z');
    upsertCursor(db, 'hh:uz', 'hh', '{}', '2026-06-01T00:00:00.000Z');
    expect(getCursor(db, 'hh:uz')).toBe('2026-06-01T00:00:00.000Z');
    const count = (db.prepare('SELECT COUNT(*) as c FROM sources WHERE id = ?').get('hh:uz') as { c: number }).c;
    expect(count).toBe(1);
  });
});
