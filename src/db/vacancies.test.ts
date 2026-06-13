import { describe, it, expect, beforeEach } from 'vitest';
import { openDatabase } from './client.js';
import { persistRawItems } from './raw-items.js';
import { insertVacancies, queryVacancies } from './vacancies.js';
import { contentHash, normalize } from '../hash.js';
import type { Vacancy } from '../extraction/schema.js';
import Database from 'better-sqlite3';

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
    description: 'Build great UIs for our platform. Remote friendly.',
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

const LINK = { rawItemId: '', sourceId: 'test:src', externalId: 'ext-1' };

describe('insertVacancies', () => {
  let db: Database.Database;
  let rawItemId: string;

  beforeEach(() => {
    db = openDatabase(':memory:');
    rawItemId = seedRawItem(db);
  });

  it('inserts a 3-vacancy array and returns 3 — all linked to the same raw_item_id', () => {
    const link = { ...LINK, rawItemId };
    const count = insertVacancies(db, link, [
      makeVacancy({ title: 'Job A' }),
      makeVacancy({ title: 'Job B' }),
      makeVacancy({ title: 'Job C' }),
    ]);
    expect(count).toBe(3);
    const rows = db.prepare('SELECT raw_item_id FROM vacancies').all() as { raw_item_id: string }[];
    expect(rows).toHaveLength(3);
    expect(rows.every(r => r.raw_item_id === rawItemId)).toBe(true);
  });

  it('dedup: inserting the same vacancy twice returns 0 on the second call and COUNT==1', () => {
    const link = { ...LINK, rawItemId };
    const v = makeVacancy();
    insertVacancies(db, link, [v]);
    const second = insertVacancies(db, link, [v]);
    expect(second).toBe(0);
    const { count } = db.prepare('SELECT COUNT(*) as count FROM vacancies').get() as { count: number };
    expect(count).toBe(1);
  });

  it('dedup: homoglyph/whitespace variant of title+company+desc hashes identically → still one row', () => {
    const link = { ...LINK, rawItemId };
    const v1 = makeVacancy({ title: 'Frontend Developer', company: 'Acme Corp' });
    // Cyrillic 'о' (U+043E) substituted for Latin 'o' in Corp, extra space in title — normalize collapses both
    const v2 = makeVacancy({ title: 'Frontend  Developer', company: 'Acme Cоrp' });
    insertVacancies(db, link, [v1]);
    const second = insertVacancies(db, link, [v2]);
    expect(second).toBe(0);
    const { count } = db.prepare('SELECT COUNT(*) as count FROM vacancies').get() as { count: number };
    expect(count).toBe(1);
  });

  it('persists lang on the vacancy row (round-trip)', () => {
    const link = { ...LINK, rawItemId };
    insertVacancies(db, link, [makeVacancy({ lang: 'uz-Latn' })]);
    const row = db.prepare('SELECT lang FROM vacancies').get() as { lang: string };
    expect(row.lang).toBe('uz-Latn');
  });

  it('stores skills as JSON string and full description', () => {
    const link = { ...LINK, rawItemId };
    const v = makeVacancy({ skills: ['Go', 'Docker'], description: 'A'.repeat(500) });
    insertVacancies(db, link, [v]);
    const row = db.prepare('SELECT skills, description FROM vacancies').get() as {
      skills: string;
      description: string;
    };
    expect(JSON.parse(row.skills)).toEqual(['Go', 'Docker']);
    expect(row.description).toHaveLength(500);
  });

  it('returns 0 for empty array', () => {
    const link = { ...LINK, rawItemId };
    expect(insertVacancies(db, link, [])).toBe(0);
  });

  it('dedup key uses only 200-char prefix of description', () => {
    const link = { ...LINK, rawItemId };
    const base = makeVacancy({ description: 'X'.repeat(300) });
    const variant = makeVacancy({ description: 'X'.repeat(300) + ' extra suffix' });
    insertVacancies(db, link, [base]);
    const second = insertVacancies(db, link, [variant]);
    expect(second).toBe(0);
    const { count } = db.prepare('SELECT COUNT(*) as count FROM vacancies').get() as { count: number };
    expect(count).toBe(1);
  });
});

describe('queryVacancies', () => {
  let db: Database.Database;
  let rawItemId: string;

  beforeEach(() => {
    db = openDatabase(':memory:');
    rawItemId = seedRawItem(db);
  });

  it('no filters returns all rows', () => {
    const link = { rawItemId, sourceId: 'hh:uz', externalId: 'x' };
    insertVacancies(db, link, [makeVacancy({ title: 'Go Dev' }), makeVacancy({ title: 'JS Dev' })]);
    const rows = queryVacancies(db, {});
    expect(rows).toHaveLength(2);
  });

  it('no matches returns []', () => {
    const link = { rawItemId, sourceId: 'hh:uz', externalId: 'x' };
    insertVacancies(db, link, [makeVacancy({ title: 'Go Dev' })]);
    const rows = queryVacancies(db, { source: 'rss:jobs' });
    expect(rows).toEqual([]);
  });

  it('source filter returns only matching source_id rows', () => {
    const link1 = { rawItemId, sourceId: 'hh:uz', externalId: 'x' };
    insertVacancies(db, link1, [makeVacancy({ title: 'HH Job' })]);
    const link2 = { rawItemId, sourceId: 'rss:jobs', externalId: 'y' };
    insertVacancies(db, link2, [makeVacancy({ title: 'RSS Job' })]);
    const rows = queryVacancies(db, { source: 'hh:uz' });
    expect(rows).toHaveLength(1);
    expect(rows[0].source_id).toBe('hh:uz');
    expect(rows[0].title).toBe('HH Job');
  });

  it('keyword matches title (case-insensitive)', () => {
    const link = { rawItemId, sourceId: 'hh:uz', externalId: 'x' };
    insertVacancies(db, link, [makeVacancy({ title: 'Senior Go Developer' }), makeVacancy({ title: 'JS Engineer' })]);
    const rows = queryVacancies(db, { keyword: 'go' });
    expect(rows).toHaveLength(1);
    expect(rows[0].title).toBe('Senior Go Developer');
  });

  it('keyword matches company (case-insensitive)', () => {
    const link = { rawItemId, sourceId: 'hh:uz', externalId: 'x' };
    insertVacancies(db, link, [makeVacancy({ title: 'Dev', company: 'Golang Inc' }), makeVacancy({ title: 'Other' })]);
    const rows = queryVacancies(db, { keyword: 'golang' });
    expect(rows).toHaveLength(1);
    expect(rows[0].company).toBe('Golang Inc');
  });

  it('keyword matches skills JSON (case-insensitive)', () => {
    const link = { rawItemId, sourceId: 'hh:uz', externalId: 'x' };
    insertVacancies(db, link, [
      makeVacancy({ title: 'Backend Dev', skills: ['Go', 'Docker'] }),
      makeVacancy({ title: 'Frontend Dev', skills: ['React'] }),
    ]);
    const rows = queryVacancies(db, { keyword: 'docker' });
    expect(rows).toHaveLength(1);
    expect(rows[0].title).toBe('Backend Dev');
  });

  it('keyword matches description (case-insensitive)', () => {
    const link = { rawItemId, sourceId: 'hh:uz', externalId: 'x' };
    insertVacancies(db, link, [
      makeVacancy({ title: 'Dev', description: 'We use microservices architecture' }),
      makeVacancy({ title: 'Other', description: 'Nothing special here' }),
    ]);
    const rows = queryVacancies(db, { keyword: 'microservices' });
    expect(rows).toHaveLength(1);
    expect(rows[0].title).toBe('Dev');
  });

  it('date range: since/until filters on created_at', () => {
    const link = { rawItemId, sourceId: 'hh:uz', externalId: 'x' };
    insertVacancies(db, link, [makeVacancy({ title: 'Job A' })]);
    const all = queryVacancies(db, {});
    expect(all).toHaveLength(1);
    const rows = queryVacancies(db, { since: '2026-01-01', until: '2026-12-31' });
    expect(rows).toHaveLength(1);
  });

  it('date range since after now returns no results', () => {
    const link = { rawItemId, sourceId: 'hh:uz', externalId: 'x' };
    insertVacancies(db, link, [makeVacancy({ title: 'Job A' })]);
    const rows = queryVacancies(db, { since: '2030-01-01' });
    expect(rows).toEqual([]);
  });

  it('limit returns at most N rows ordered created_at DESC', () => {
    const link = { rawItemId, sourceId: 'hh:uz', externalId: 'x' };
    insertVacancies(db, link, [
      makeVacancy({ title: 'Job 1' }),
      makeVacancy({ title: 'Job 2' }),
      makeVacancy({ title: 'Job 3' }),
    ]);
    const rows = queryVacancies(db, { limit: 2 });
    expect(rows).toHaveLength(2);
  });

  it('no limit returns all matching rows', () => {
    const link = { rawItemId, sourceId: 'hh:uz', externalId: 'x' };
    insertVacancies(db, link, [
      makeVacancy({ title: 'Job 1' }),
      makeVacancy({ title: 'Job 2' }),
      makeVacancy({ title: 'Job 3' }),
      makeVacancy({ title: 'Job 4' }),
      makeVacancy({ title: 'Job 5' }),
    ]);
    const rows = queryVacancies(db, {});
    expect(rows).toHaveLength(5);
  });

  it('VacancyRow includes expected fields with parsed skills array and date field', () => {
    const link = { rawItemId, sourceId: 'hh:uz', externalId: 'x' };
    insertVacancies(db, link, [makeVacancy({ title: 'Go Dev', skills: ['Go', 'Docker'], lang: 'en' })]);
    const rows = queryVacancies(db, {});
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.id).toBeDefined();
    expect(row.source_id).toBe('hh:uz');
    expect(row.title).toBe('Go Dev');
    expect(row.skills).toEqual(['Go', 'Docker']);
    expect(row.lang).toBe('en');
    expect(row.date).toBeDefined();
    expect(typeof row.date).toBe('string');
  });
});
