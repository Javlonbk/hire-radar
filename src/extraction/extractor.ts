import type Database from 'better-sqlite3';
import { contentHash } from '../hash.js';
import { getCachedExtraction, putCachedExtraction } from '../db/extraction-cache.js';
import { callClaude } from './client.js';
import type { MessageCreate } from './client.js';
import { ExtractionResultSchema } from './schema.js';
import type { ExtractionResult } from './schema.js';

export interface ExtractDeps {
  db: Database.Database;
  messageCreate: MessageCreate;
  model: string;
  system: string;
  now?: () => Date;
  log?: (msg: string) => void;
}

export interface ExtractOutcome {
  result: ExtractionResult | null;
  fromCache: boolean;
  apiCalls: number;
  skipped: boolean;
}

export const EXTRACTION_SYSTEM_PROMPT =
  'Extract job vacancies from the post in its original language — do not translate. ' +
  'Uzbek posts may use Cyrillic (uz-Cyrl) or Latin (uz-Latn) script; distinguish from Russian (ru) by script and vocabulary. ' +
  'Set is_job_post=false and return an empty vacancies array for non-job posts (announcements, news, ads). ' +
  'For job posts emit one vacancy object per distinct job opening — digest posts commonly contain 5–15 jobs. ' +
  'Never fabricate fields: use null for any value not present in the post. ' +
  'Return the result using the extract_vacancies tool.';

export async function extractOne(deps: ExtractDeps, rawText: string): Promise<ExtractOutcome> {
  const key = contentHash(rawText);
  const log = deps.log ?? console.warn;

  const cached = getCachedExtraction(deps.db, key);
  if (cached !== null) {
    const parsed = ExtractionResultSchema.safeParse(cached);
    if (parsed.success) {
      return { result: parsed.data, fromCache: true, apiCalls: 0, skipped: false };
    }
  }

  const attempt = async () => {
    const raw = await callClaude(deps.messageCreate, {
      model: deps.model,
      system: deps.system,
      userText: rawText,
    });
    return ExtractionResultSchema.safeParse(raw);
  };

  const first = await attempt();
  if (first.success) {
    putCachedExtraction(deps.db, {
      contentHash: key,
      resultJson: first.data,
      model: deps.model,
      extractedAt: (deps.now?.() ?? new Date()).toISOString(),
    });
    return { result: first.data, fromCache: false, apiCalls: 1, skipped: false };
  }

  const second = await attempt();
  if (second.success) {
    putCachedExtraction(deps.db, {
      contentHash: key,
      resultJson: second.data,
      model: deps.model,
      extractedAt: (deps.now?.() ?? new Date()).toISOString(),
    });
    return { result: second.data, fromCache: false, apiCalls: 2, skipped: false };
  }

  log(`extractOne: validation failed twice, skipping item (hash ${key.slice(0, 8)})`);
  return { result: null, fromCache: false, apiCalls: 2, skipped: true };
}
