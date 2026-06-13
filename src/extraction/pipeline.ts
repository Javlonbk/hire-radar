import type Database from 'better-sqlite3';
import type { MessageCreate } from './client.js';
import { extractOne, EXTRACTION_SYSTEM_PROMPT } from './extractor.js';
import type { ExtractDeps } from './extractor.js';
import { getPendingRawItems, markExtractionStatus } from '../db/raw-items.js';
import { insertVacancies } from '../db/vacancies.js';

export interface PipelineDeps {
  db: Database.Database;
  messageCreate: MessageCreate;
  model: string;
  limit?: number;
  now?: () => Date;
  log?: (msg: string) => void;
}

export interface PipelineStats {
  processed: number;
  vacanciesInserted: number;
  deduped: number;
  nonJob: number;
  skipped: number;
  apiCalls: number;
  errors: number;
}

export async function extractPending(deps: PipelineDeps): Promise<PipelineStats> {
  const log = deps.log ?? console.log;
  const stats: PipelineStats = {
    processed: 0,
    vacanciesInserted: 0,
    deduped: 0,
    nonJob: 0,
    skipped: 0,
    apiCalls: 0,
    errors: 0,
  };

  const pending = getPendingRawItems(deps.db, deps.limit);

  const extractDeps: ExtractDeps = {
    db: deps.db,
    messageCreate: deps.messageCreate,
    model: deps.model,
    system: EXTRACTION_SYSTEM_PROMPT,
    now: deps.now,
    log,
  };

  for (const item of pending) {
    try {
      const outcome = await extractOne(extractDeps, item.rawText);
      stats.apiCalls += outcome.apiCalls;

      if (outcome.skipped) {
        markExtractionStatus(deps.db, item.id, 'failed', 'zod-validation-failed-x2');
        stats.skipped++;
      } else if (outcome.result && outcome.result.is_job_post) {
        const inserted = insertVacancies(
          deps.db,
          { rawItemId: item.id, sourceId: item.sourceId, externalId: item.externalId },
          outcome.result.vacancies,
        );
        markExtractionStatus(deps.db, item.id, 'done');
        stats.vacanciesInserted += inserted;
        stats.deduped += outcome.result.vacancies.length - inserted;
      } else {
        markExtractionStatus(deps.db, item.id, 'done');
        stats.nonJob++;
      }
      stats.processed++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log(`pipeline: ${item.id.slice(0, 8)} hard error, left pending: ${msg}`);
      stats.errors++;
    }
  }

  return stats;
}
