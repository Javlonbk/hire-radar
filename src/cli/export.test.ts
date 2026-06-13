import { describe, it, expect, beforeEach } from 'vitest';
import { openDatabase } from '../db/client.js';
import { persistRawItems } from '../db/raw-items.js';
import { insertVacancies } from '../db/vacancies.js';
import { contentHash } from '../hash.js';
import { runExport } from './export.js';
import type { Vacancy } from '../extraction/schema.js';
import Database from 'better-sqlite3';

const SECRET_KEYS = ['anthropicApiKey', 'telegramSession', 'apiKey', 'apiHash', 'api_key', 'api_hash'];

function seedRawItem(db: Database.Database): string {
  persistRawItems(db, [
    {
      sourceId: 'test:src',
      nativeId: 'ext-1',
      rawText: 'raw post',
      rawJson: null,
      fetchedAt: new Date('2026-01-01T00:00:00Z'),
      contentHash: contentHash('seed-raw'),
    },
  ]);
  const row = db.prepare('SELECT id FROM raw_items').get() as { id: string };
  return row.id;
}

function makeVacancy(overrides: Partial<Vacancy> = {}): Vacancy {
  return {
    title: 'Frontend Developer',
    company: 'Acme Corp',
    description: 'Build great UIs',
    location: 'Tashkent',
    remote_type: 'hybrid',
    salary_min: 1000,
    salary_max: 2000,
    salary_currency: 'USD',
    skills: ['TypeScript', 'React'],
    apply_contact: '@acme_hr',
    lang: 'en',
    ...overrides,
  };
}

describe('runExport', () => {
  let db: Database.Database;
  let rawItemId: string;

  beforeEach(() => {
    db = openDatabase(':memory:');
    rawItemId = seedRawItem(db);
  });

  it('2 seeded vacancies → stdout parses as JSON array of length 2', () => {
    const link = { rawItemId, sourceId: 'hh:uz', externalId: 'x' };
    insertVacancies(db, link, [makeVacancy({ title: 'Job A' }), makeVacancy({ title: 'Job B' })]);
    let captured = '';
    runExport({ db, out: (t) => { captured = t; } }, {});
    const parsed = JSON.parse(captured);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(2);
  });

  it('each exported object includes full structured fields', () => {
    const link = { rawItemId, sourceId: 'hh:uz', externalId: 'x' };
    insertVacancies(db, link, [makeVacancy({
      title: 'Dev',
      company: 'Co',
      description: 'Nice job',
      skills: ['Go'],
      salary_min: 500,
      salary_max: 1000,
      salary_currency: 'USD',
      location: 'Tashkent',
      remote_type: 'remote',
      apply_contact: '@hr',
      lang: 'en',
    })]);
    let captured = '';
    runExport({ db, out: (t) => { captured = t; } }, {});
    const [obj] = JSON.parse(captured);
    expect(obj.title).toBe('Dev');
    expect(obj.company).toBe('Co');
    expect(obj.description).toBe('Nice job');
    expect(obj.skills).toEqual(['Go']);
    expect(obj.salary_min).toBe(500);
    expect(obj.salary_max).toBe(1000);
    expect(obj.salary_currency).toBe('USD');
    expect(obj.location).toBe('Tashkent');
    expect(obj.remote_type).toBe('remote');
    expect(obj.apply_contact).toBe('@hr');
    expect(obj.lang).toBe('en');
    expect(obj.source_id).toBe('hh:uz');
    expect(obj.date).toBeDefined();
  });

  it('exported objects contain no secret keys', () => {
    const link = { rawItemId, sourceId: 'hh:uz', externalId: 'x' };
    insertVacancies(db, link, [makeVacancy()]);
    let captured = '';
    runExport({ db, out: (t) => { captured = t; } }, {});
    const [obj] = JSON.parse(captured);
    for (const key of SECRET_KEYS) {
      expect(Object.prototype.hasOwnProperty.call(obj, key)).toBe(false);
    }
  });

  it('non-numeric --limit throws a clean error instead of crashing the query', () => {
    expect(() =>
      runExport({ db, out: () => {} }, { limit: 'abc' }),
    ).toThrow(/Invalid --limit value: abc/);
  });

  it('malformed --until throws a clean error', () => {
    expect(() =>
      runExport({ db, out: () => {} }, { until: 'garbage' }),
    ).toThrow(/Invalid --until date/);
  });

  it('no matches → stdout is exactly []', () => {
    let captured = '';
    runExport({ db, out: (t) => { captured = t; } }, { source: 'nonexistent:src' });
    expect(captured.trim()).toBe('[]');
  });

  it('no --limit → all matching rows returned (no default limit)', () => {
    const link = { rawItemId, sourceId: 'hh:uz', externalId: 'x' };
    for (let i = 0; i < 25; i++) {
      insertVacancies(db, { rawItemId, sourceId: 'hh:uz', externalId: `x${i}` }, [
        makeVacancy({ title: `Job ${i}` }),
      ]);
    }
    let captured = '';
    runExport({ db, out: (t) => { captured = t; } }, {});
    const parsed = JSON.parse(captured);
    expect(parsed).toHaveLength(25);
  });

  it('stdout carries only JSON — no human-readable log lines mixed in', () => {
    const link = { rawItemId, sourceId: 'hh:uz', externalId: 'x' };
    insertVacancies(db, link, [makeVacancy()]);
    let captured = '';
    runExport({ db, out: (t) => { captured = t; } }, {});
    expect(() => JSON.parse(captured)).not.toThrow();
  });
});
