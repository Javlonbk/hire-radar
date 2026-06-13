import { Command } from 'commander';
import { loadConfig } from '../config.js';
import { openDatabase } from '../db/client.js';
import { buildAdapters } from '../pipeline/registry.js';
import { ingestSources } from '../pipeline/orchestrator.js';
import { extractPending } from '../extraction/pipeline.js';
import { realMessageCreate } from '../extraction/client.js';
import { parseDateValue } from './options.js';
import type { MessageCreate } from '../extraction/client.js';
import type { SourceAdapter } from '../adapters/types.js';
import type Database from 'better-sqlite3';

export interface IngestDeps {
  db: Database.Database;
  adapters: SourceAdapter[];
  messageCreate: MessageCreate;
  model: string;
  out: (line: string) => void;
}

interface IngestOptions { source?: string; since?: string; }

export async function runIngest(deps: IngestDeps, opts: IngestOptions): Promise<void> {
  const adapters = opts.source ? deps.adapters.filter(a => a.id === opts.source) : deps.adapters;
  const sinceOverride = parseDateValue(opts.since, '--since');

  const sourceStats = await ingestSources({ db: deps.db, adapters, sinceOverride, log: (m) => deps.out(m) });
  const ex = await extractPending({ db: deps.db, messageCreate: deps.messageCreate, model: deps.model, log: (m) => deps.out(m) });

  const fetched = sourceStats.reduce((s, r) => s + r.fetched, 0);
  const newRaws = sourceStats.reduce((s, r) => s + r.inserted, 0);
  const errors = sourceStats.filter(r => r.error);

  deps.out('--- ingest summary ---');
  deps.out(`fetched: ${fetched}  new raws: ${newRaws}`);
  deps.out(`extracted: ${ex.vacanciesInserted}  deduped: ${ex.deduped}  skipped: ${ex.skipped}`);
  deps.out(`Claude API calls: ${ex.apiCalls}`);
  if (errors.length) {
    deps.out(`per-source errors (${errors.length}):`);
    for (const e of errors) deps.out(`  ${e.sourceId}: ${e.error}`);
  }
}

export function registerIngest(program: Command): void {
  program
    .command('ingest')
    .description('Fetch, extract, and persist vacancies from all (or selected) sources')
    .option('--source <id>', 'limit ingestion to one source id (e.g. hh:uz)')
    .option('--since <date>', 'override the date cursor (YYYY-MM-DD)')
    .action(async (opts: IngestOptions) => {
      const config = loadConfig({ env: process.env });
      const db = openDatabase();
      const adapters = buildAdapters(config);
      try {
        await runIngest({
          db, adapters,
          messageCreate: realMessageCreate(config.anthropicApiKey),
          model: config.anthropicModel,
          out: (l) => process.stdout.write(l + '\n'),
        }, opts);
      } finally {
        db.close();
      }
    });
}
