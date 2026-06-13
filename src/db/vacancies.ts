import Database from 'better-sqlite3';
import { normalize, contentHash } from '../hash.js';
import type { Vacancy } from '../extraction/schema.js';
import { runInTransaction } from './client.js';

export interface VacancyFilters {
  source?: string;
  keyword?: string;
  since?: string;
  until?: string;
  limit?: number;
}

export interface VacancyRow {
  id: string;
  source_id: string;
  external_id: string | null;
  title: string;
  company: string;
  description: string;
  skills: string[];
  salary_min: number | null;
  salary_max: number | null;
  salary_currency: string | null;
  location: string | null;
  remote_type: string | null;
  apply_contact: string | null;
  lang: string | null;
  date: string;
}

export function queryVacancies(db: Database.Database, filters: VacancyFilters): VacancyRow[] {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filters.source !== undefined) {
    conditions.push('source_id = ?');
    params.push(filters.source);
  }
  if (filters.keyword !== undefined) {
    conditions.push('(title LIKE ? OR company LIKE ? OR skills LIKE ? OR description LIKE ?)');
    const kw = '%' + filters.keyword + '%';
    params.push(kw, kw, kw, kw);
  }
  if (filters.since !== undefined) {
    conditions.push('created_at >= ?');
    params.push(filters.since);
  }
  if (filters.until !== undefined) {
    conditions.push('created_at <= ?');
    params.push(filters.until + ' 23:59:59');
  }

  const lim =
    filters.limit !== undefined && Number.isFinite(filters.limit)
      ? Math.max(0, Math.trunc(filters.limit))
      : undefined;

  const sql =
    'SELECT id, source_id, external_id, title, company, description, skills, salary_min, salary_max, salary_currency, location, remote_type, apply_contact, lang, created_at FROM vacancies' +
    (conditions.length ? ' WHERE ' + conditions.join(' AND ') : '') +
    ' ORDER BY created_at DESC' +
    (lim !== undefined ? ' LIMIT ?' : '');

  if (lim !== undefined) params.push(lim);

  const raw = db.prepare(sql).all(...params) as Array<{
    id: string;
    source_id: string;
    external_id: string | null;
    title: string;
    company: string;
    description: string;
    skills: string | null;
    salary_min: number | null;
    salary_max: number | null;
    salary_currency: string | null;
    location: string | null;
    remote_type: string | null;
    apply_contact: string | null;
    lang: string | null;
    created_at: string;
  }>;

  return raw.map(r => ({
    id: r.id,
    source_id: r.source_id,
    external_id: r.external_id,
    title: r.title,
    company: r.company,
    description: r.description,
    skills: JSON.parse(r.skills ?? '[]') as string[],
    salary_min: r.salary_min,
    salary_max: r.salary_max,
    salary_currency: r.salary_currency,
    location: r.location,
    remote_type: r.remote_type,
    apply_contact: r.apply_contact,
    lang: r.lang,
    date: r.created_at,
  }));
}

export function insertVacancies(
  db: Database.Database,
  link: { rawItemId: string; sourceId: string; externalId: string | null },
  vacancies: Vacancy[],
): number {
  if (vacancies.length === 0) return 0;
  const stmt = db.prepare(
    'INSERT OR IGNORE INTO vacancies (source_id, raw_item_id, external_id, title, company, description, skills, salary_min, salary_max, salary_currency, location, remote_type, apply_contact, lang, content_hash) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
  );
  let total = 0;
  runInTransaction(db, () => {
    for (const v of vacancies) {
      const dedupKey = contentHash(
        normalize(v.title) + '|' + normalize(v.company) + '|' + normalize(v.description.slice(0, 200)),
      );
      const result = stmt.run(
        link.sourceId,
        link.rawItemId,
        link.externalId,
        v.title,
        v.company,
        v.description,
        JSON.stringify(v.skills),
        v.salary_min,
        v.salary_max,
        v.salary_currency,
        v.location,
        v.remote_type,
        v.apply_contact,
        v.lang,
        dedupKey,
      );
      total += result.changes;
    }
  });
  return total;
}
