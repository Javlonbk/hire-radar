import { describe, it, expect, beforeEach } from 'vitest';
import { openDatabase } from './client.js';
import { getCachedExtraction, putCachedExtraction } from './extraction-cache.js';
import type Database from 'better-sqlite3';

let db: Database.Database;

beforeEach(() => {
  db = openDatabase(':memory:');
});

describe('getCachedExtraction', () => {
  it('returns null for an unknown content hash', () => {
    const result = getCachedExtraction(db, 'nonexistent-hash');
    expect(result).toBeNull();
  });

  it('returns the stored object after a put', () => {
    const payload = { is_job_post: true, vacancies: [{ title: 'Dev', company: 'Corp' }] };
    putCachedExtraction(db, {
      contentHash: 'abc123',
      resultJson: payload,
      model: 'claude-haiku-4-5',
      extractedAt: '2026-06-13T00:00:00Z',
    });
    const result = getCachedExtraction(db, 'abc123');
    expect(result).toEqual(payload);
  });
});

describe('putCachedExtraction', () => {
  it('round-trip: get returns deep-equal object to what was stored', () => {
    const payload = { is_job_post: false, vacancies: [] };
    putCachedExtraction(db, {
      contentHash: 'hash-roundtrip',
      resultJson: payload,
      model: 'claude-haiku-4-5',
      extractedAt: '2026-06-13T12:00:00Z',
    });
    expect(getCachedExtraction(db, 'hash-roundtrip')).toEqual(payload);
  });

  it('double put with same content_hash does not throw and leaves exactly one row', () => {
    const args = {
      contentHash: 'dup-hash',
      resultJson: { is_job_post: true, vacancies: [] },
      model: 'claude-haiku-4-5',
      extractedAt: '2026-06-13T10:00:00Z',
    };
    expect(() => {
      putCachedExtraction(db, args);
      putCachedExtraction(db, args);
    }).not.toThrow();
    const count = db.prepare('SELECT COUNT(*) as n FROM extraction_cache WHERE content_hash = ?').get('dup-hash') as { n: number };
    expect(count.n).toBe(1);
  });

  it('stores the model field correctly', () => {
    putCachedExtraction(db, {
      contentHash: 'model-check',
      resultJson: {},
      model: 'claude-haiku-4-5',
      extractedAt: '2026-06-13T00:00:00Z',
    });
    const row = db.prepare('SELECT model FROM extraction_cache WHERE content_hash = ?').get('model-check') as { model: string };
    expect(row.model).toBe('claude-haiku-4-5');
  });

  it('overwrites a stale row for the same content_hash', () => {
    putCachedExtraction(db, {
      contentHash: 'overwrite-hash',
      resultJson: { is_job_post: false, vacancies: [] },
      model: 'old-model',
      extractedAt: '2026-06-13T00:00:00Z',
    });
    putCachedExtraction(db, {
      contentHash: 'overwrite-hash',
      resultJson: { is_job_post: true, vacancies: [{ title: 'Dev' }] },
      model: 'new-model',
      extractedAt: '2026-06-13T01:00:00Z',
    });
    expect(getCachedExtraction(db, 'overwrite-hash')).toEqual({
      is_job_post: true,
      vacancies: [{ title: 'Dev' }],
    });
    const count = db.prepare('SELECT COUNT(*) as n FROM extraction_cache WHERE content_hash = ?').get('overwrite-hash') as { n: number };
    expect(count.n).toBe(1);
  });
});

describe('getCachedExtraction with corrupt rows', () => {
  it('treats a corrupt result_json as a miss (returns null)', () => {
    db.prepare(
      'INSERT INTO extraction_cache (content_hash, result_json, extracted_at, model) VALUES (?,?,?,?)',
    ).run('corrupt-hash', '{not valid json', '2026-06-13T00:00:00Z', 'claude-haiku-4-5');
    expect(getCachedExtraction(db, 'corrupt-hash')).toBeNull();
  });

  it('a corrupt row can be overwritten by a subsequent put', () => {
    db.prepare(
      'INSERT INTO extraction_cache (content_hash, result_json, extracted_at, model) VALUES (?,?,?,?)',
    ).run('poison-hash', 'not-json', '2026-06-13T00:00:00Z', 'claude-haiku-4-5');
    putCachedExtraction(db, {
      contentHash: 'poison-hash',
      resultJson: { is_job_post: false, vacancies: [] },
      model: 'claude-haiku-4-5',
      extractedAt: '2026-06-13T02:00:00Z',
    });
    expect(getCachedExtraction(db, 'poison-hash')).toEqual({ is_job_post: false, vacancies: [] });
  });
});
