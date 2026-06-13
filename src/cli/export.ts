import { Command } from 'commander';
import { openDatabase } from '../db/client.js';
import { queryVacancies } from '../db/vacancies.js';
import type { VacancyFilters } from '../db/vacancies.js';
import { parseLimit, parseDate } from './options.js';
import type Database from 'better-sqlite3';

export interface ExportDeps {
  db: Database.Database;
  out: (text: string) => void;
}

interface ExportOptions {
  source?: string;
  keyword?: string;
  since?: string;
  until?: string;
  limit?: string;
}

export function runExport(deps: ExportDeps, opts: ExportOptions): void {
  const filters: VacancyFilters = {
    source: opts.source,
    keyword: opts.keyword,
    since: parseDate(opts.since, '--since'),
    until: parseDate(opts.until, '--until'),
    limit: parseLimit(opts.limit),
  };
  const rows = queryVacancies(deps.db, filters);
  deps.out(JSON.stringify(rows, null, 2));
}

export function registerExport(program: Command): void {
  program
    .command('export')
    .description('Dump matching vacancies as a JSON array to stdout')
    .option('--source <id>', 'filter by source id')
    .option('--keyword <kw>', 'match title, company, skills, or description')
    .option('--since <date>', 'lower bound on date (YYYY-MM-DD)')
    .option('--until <date>', 'upper bound on date (YYYY-MM-DD)')
    .option('--limit <n>', 'max rows (no default — export everything)')
    .action((opts: ExportOptions) => {
      const db = openDatabase();
      try {
        runExport({ db, out: (t) => process.stdout.write(t + '\n') }, opts);
      } finally {
        db.close();
      }
    });
}
