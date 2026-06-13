import { Command } from 'commander';
import { openDatabase } from '../db/client.js';
import { queryVacancies } from '../db/vacancies.js';
import type { VacancyFilters, VacancyRow } from '../db/vacancies.js';
import { parseLimit, parseDate } from './options.js';
import type Database from 'better-sqlite3';

export interface ListDeps {
  db: Database.Database;
  out: (line: string) => void;
  err: (line: string) => void;
}

interface ListOptions {
  source?: string;
  keyword?: string;
  since?: string;
  until?: string;
  limit?: string;
}

function trunc(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + '…';
}

function formatRow(r: VacancyRow): string {
  const title = trunc(r.title, 30).padEnd(30);
  const company = trunc(r.company, 20).padEnd(20);
  const loc = trunc(r.location ?? '', 16).padEnd(16);
  const remote = r.remote_type ? `(${r.remote_type})` : '';
  const salary =
    r.salary_min !== null || r.salary_max !== null
      ? `${r.salary_min ?? '?'}-${r.salary_max ?? '?'} ${r.salary_currency ?? ''}`
      : '—';
  const source = trunc(r.source_id, 14).padEnd(14);
  const date = r.date.slice(0, 10);
  return [title, company, loc, remote, salary, source, date].join('  ').trimEnd();
}

export function runList(deps: ListDeps, opts: ListOptions): void {
  const filters: VacancyFilters = {
    source: opts.source,
    keyword: opts.keyword,
    since: parseDate(opts.since, '--since'),
    until: parseDate(opts.until, '--until'),
    limit: parseLimit(opts.limit, 20),
  };
  const rows = queryVacancies(deps.db, filters);
  if (rows.length === 0) {
    deps.err('No vacancies match');
    return;
  }
  for (const r of rows) deps.out(formatRow(r));
}

export function registerList(program: Command): void {
  program
    .command('list')
    .description('List matching vacancies in readable terminal output')
    .option('--source <id>', 'filter by source id')
    .option('--keyword <kw>', 'match title, company, skills, or description')
    .option('--since <date>', 'lower bound on date (YYYY-MM-DD)')
    .option('--until <date>', 'upper bound on date (YYYY-MM-DD)')
    .option('--limit <n>', 'max rows (default 20)', '20')
    .action((opts: ListOptions) => {
      const db = openDatabase();
      try {
        runList({ db, out: (l) => process.stdout.write(l + '\n'), err: (l) => process.stderr.write(l + '\n') }, opts);
      } finally {
        db.close();
      }
    });
}
