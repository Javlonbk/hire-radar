import { describe, it, expect, beforeEach } from 'vitest';
import { openDatabase } from '../db/client.js';
import { persistRawItems } from '../db/raw-items.js';
import { insertVacancies } from '../db/vacancies.js';
import { contentHash } from '../hash.js';
import { runList } from './list.js';
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

describe('runList', () => {
  let db: Database.Database;
  let rawItemId: string;

  beforeEach(() => {
    db = openDatabase(':memory:');
    rawItemId = seedRawItem(db);
  });

  it('prints 3 data lines for 3 seeded vacancies with title, company, location, source, date', () => {
    const link = { rawItemId, sourceId: 'hh:uz', externalId: 'x' };
    insertVacancies(db, link, [
      makeVacancy({ title: 'Job A', company: 'Alpha', location: 'Tashkent' }),
      makeVacancy({ title: 'Job B', company: 'Beta', location: 'Samarkand' }),
      makeVacancy({ title: 'Job C', company: 'Gamma', location: 'Bukhara' }),
    ]);
    const out: string[] = [];
    const err: string[] = [];
    runList({ db, out: (l) => out.push(l), err: (l) => err.push(l) }, {});
    expect(out).toHaveLength(3);
    expect(out[0]).toContain('Job A');
    expect(out[0]).toContain('Alpha');
    expect(out[0]).toContain('Tashkent');
    expect(out[0]).toContain('hh:uz');
    expect(err).toHaveLength(0);
  });

  it('surfaces remote_type in row output', () => {
    const link = { rawItemId, sourceId: 'hh:uz', externalId: 'x' };
    insertVacancies(db, link, [makeVacancy({ remote_type: 'remote' })]);
    const out: string[] = [];
    runList({ db, out: (l) => out.push(l), err: () => {} }, {});
    expect(out[0]).toContain('remote');
  });

  it('truncates a title longer than column width', () => {
    const longTitle = 'A'.repeat(60);
    const link = { rawItemId, sourceId: 'hh:uz', externalId: 'x' };
    insertVacancies(db, link, [makeVacancy({ title: longTitle })]);
    const out: string[] = [];
    runList({ db, out: (l) => out.push(l), err: () => {} }, {});
    expect(out[0]).not.toContain(longTitle);
  });

  it('default limit 20 when --limit not provided (queryVacancies called with limit 20)', () => {
    const link = { rawItemId, sourceId: 'hh:uz', externalId: 'x' };
    for (let i = 0; i < 25; i++) {
      insertVacancies(db, { rawItemId, sourceId: 'hh:uz', externalId: `x${i}` }, [
        makeVacancy({ title: `Job ${i}` }),
      ]);
    }
    const out: string[] = [];
    runList({ db, out: (l) => out.push(l), err: () => {} }, {});
    expect(out).toHaveLength(20);
  });

  it('non-numeric --limit throws a clean error instead of crashing the query', () => {
    expect(() =>
      runList({ db, out: () => {}, err: () => {} }, { limit: 'abc' }),
    ).toThrow(/Invalid --limit value: abc/);
  });

  it('negative --limit throws a clean error', () => {
    expect(() =>
      runList({ db, out: () => {}, err: () => {} }, { limit: '-5' }),
    ).toThrow(/Invalid --limit value/);
  });

  it('malformed --since throws a clean error', () => {
    expect(() =>
      runList({ db, out: () => {}, err: () => {} }, { since: '2026-6-1' }),
    ).toThrow(/Invalid --since date/);
  });

  it('--source filter: only hh row printed when filtering by hh:uz', () => {
    insertVacancies(db, { rawItemId, sourceId: 'hh:uz', externalId: 'hh1' }, [
      makeVacancy({ title: 'HH Job' }),
    ]);
    insertVacancies(db, { rawItemId, sourceId: 'rss:jobs', externalId: 'rss1' }, [
      makeVacancy({ title: 'RSS Job' }),
    ]);
    const out: string[] = [];
    runList({ db, out: (l) => out.push(l), err: () => {} }, { source: 'hh:uz' });
    expect(out).toHaveLength(1);
    expect(out[0]).toContain('HH Job');
  });

  it('no matches writes "No vacancies match" to stderr and nothing to stdout; exits 0', () => {
    const out: string[] = [];
    const err: string[] = [];
    runList({ db, out: (l) => out.push(l), err: (l) => err.push(l) }, { source: 'nonexistent:src' });
    expect(out).toHaveLength(0);
    expect(err).toHaveLength(1);
    expect(err[0]).toBe('No vacancies match');
  });

  it('salary cell shows min-max currency when present', () => {
    const link = { rawItemId, sourceId: 'hh:uz', externalId: 'x' };
    insertVacancies(db, link, [makeVacancy({ salary_min: 500, salary_max: 1500, salary_currency: 'USD' })]);
    const out: string[] = [];
    runList({ db, out: (l) => out.push(l), err: () => {} }, {});
    expect(out[0]).toContain('500');
    expect(out[0]).toContain('1500');
    expect(out[0]).toContain('USD');
  });

  it('salary cell shows em-dash when salary absent', () => {
    const link = { rawItemId, sourceId: 'hh:uz', externalId: 'x' };
    insertVacancies(db, link, [makeVacancy({ salary_min: null, salary_max: null, salary_currency: null })]);
    const out: string[] = [];
    runList({ db, out: (l) => out.push(l), err: () => {} }, {});
    expect(out[0]).toContain('—');
  });
});
