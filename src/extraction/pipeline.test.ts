import { describe, it, expect, vi, beforeEach } from 'vitest';
import { openDatabase } from '../db/client.js';
import { persistRawItems } from '../db/raw-items.js';
import { contentHash } from '../hash.js';
import { extractPending } from './pipeline.js';
import type { MessageCreate } from './client.js';
import { EXTRACTION_TOOL } from './schema.js';
import Database from 'better-sqlite3';

// Helpers

function makeToolUseResponse(input: unknown) {
  return Promise.resolve({
    id: 'msg_test',
    type: 'message' as const,
    role: 'assistant' as const,
    content: [
      {
        type: 'tool_use' as const,
        id: 'tool_test',
        name: EXTRACTION_TOOL.name,
        input,
      },
    ],
    model: 'claude-haiku-4-5',
    stop_reason: 'tool_use' as const,
    stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 20, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
  });
}

const MULTI_JOB_INPUT = {
  is_job_post: true,
  vacancies: [
    {
      title: 'Job One',
      company: 'Acme',
      description: 'First job description here for the role',
      location: null,
      remote_type: null,
      salary_min: null,
      salary_max: null,
      salary_currency: null,
      skills: [],
      apply_contact: null,
      lang: 'en',
    },
    {
      title: 'Job Two',
      company: 'Acme',
      description: 'Second job description here for the role',
      location: null,
      remote_type: null,
      salary_min: null,
      salary_max: null,
      salary_currency: null,
      skills: [],
      apply_contact: null,
      lang: 'en',
    },
  ],
};

const NON_JOB_INPUT = { is_job_post: false, vacancies: [] };

const GENERIC_INPUT = {
  is_job_post: true,
  vacancies: [
    {
      title: 'Generic Job',
      company: 'Corp',
      description: 'Generic description for the role',
      location: null,
      remote_type: null,
      salary_min: null,
      salary_max: null,
      salary_currency: null,
      skills: [],
      apply_contact: null,
      lang: 'ru',
    },
  ],
};

const INVALID_INPUT = { is_job_post: 'not-a-boolean', vacancies: 'wrong' };

function seedRaw(db: Database.Database, nativeId: string, rawText: string): void {
  persistRawItems(db, [
    {
      sourceId: 'test:src',
      nativeId,
      rawText,
      rawJson: null,
      fetchedAt: new Date('2026-01-01T00:00:00Z'),
      contentHash: contentHash(nativeId + rawText),
    },
  ]);
}

function makeDeps(db: Database.Database, messageCreate: MessageCreate) {
  return {
    db,
    messageCreate,
    model: 'claude-haiku-4-5',
    log: () => {},
  };
}

describe('extractPending', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = openDatabase(':memory:');
  });

  it('multi-job: inserts N vacancies, marks raw done, status no longer pending', async () => {
    seedRaw(db, 'multi', 'multi-job post content');
    const fake = vi.fn().mockResolvedValue(
      (await makeToolUseResponse(MULTI_JOB_INPUT)),
    ) as unknown as MessageCreate;
    const stats = await extractPending(makeDeps(db, fake));

    expect(stats.vacanciesInserted).toBe(2);
    expect(stats.processed).toBe(1);
    expect(stats.nonJob).toBe(0);
    const rows = db.prepare('SELECT COUNT(*) as c FROM vacancies').get() as { c: number };
    expect(rows.c).toBe(2);
    const status = db
      .prepare('SELECT extraction_status FROM raw_items')
      .get() as { extraction_status: string };
    expect(status.extraction_status).toBe('done');
  });

  it('non-job: 0 vacancies inserted, marks raw done, nonJob==1', async () => {
    seedRaw(db, 'nj', 'non-job announcement');
    const fake = vi.fn().mockResolvedValue(
      (await makeToolUseResponse(NON_JOB_INPUT)),
    ) as unknown as MessageCreate;
    const stats = await extractPending(makeDeps(db, fake));

    expect(stats.vacanciesInserted).toBe(0);
    expect(stats.nonJob).toBe(1);
    const rows = db.prepare('SELECT COUNT(*) as c FROM vacancies').get() as { c: number };
    expect(rows.c).toBe(0);
    const status = db
      .prepare('SELECT extraction_status FROM raw_items')
      .get() as { extraction_status: string };
    expect(status.extraction_status).toBe('done');
  });

  it('hard error: throwing raw stays pending, errors==1, other raw still processed', async () => {
    seedRaw(db, 'ok', 'generic job post ok');
    seedRaw(db, 'err', 'hard error post err');
    const fake = vi.fn((params: Parameters<MessageCreate>[0]) => {
      const userMsg = params.messages[0].content as string;
      if (userMsg.includes('hard error')) return Promise.reject(new Error('network timeout'));
      return makeToolUseResponse(GENERIC_INPUT);
    }) as unknown as MessageCreate;
    const stats = await extractPending(makeDeps(db, fake));

    expect(stats.errors).toBe(1);
    expect(stats.vacanciesInserted).toBe(1);
    const pendingRow = db
      .prepare("SELECT extraction_status FROM raw_items WHERE external_id = 'err'")
      .get() as { extraction_status: string };
    expect(pendingRow.extraction_status).toBe('pending');
    const doneRow = db
      .prepare("SELECT extraction_status FROM raw_items WHERE external_id = 'ok'")
      .get() as { extraction_status: string };
    expect(doneRow.extraction_status).toBe('done');
  });

  it('invalid twice: marks raw failed, skipped==1', async () => {
    seedRaw(db, 'inv', 'invalid content that fails validation');
    const fake = vi.fn().mockResolvedValue(
      (await makeToolUseResponse(INVALID_INPUT)),
    ) as unknown as MessageCreate;
    const stats = await extractPending(makeDeps(db, fake));

    expect(stats.skipped).toBe(1);
    const status = db
      .prepare('SELECT extraction_status, extraction_error FROM raw_items')
      .get() as { extraction_status: string; extraction_error: string };
    expect(status.extraction_status).toBe('failed');
    expect(status.extraction_error).toBe('zod-validation-failed-x2');
  });

  it('twice-run: second run makes 0 new API calls and inserts 0 new rows (cache + dedup)', async () => {
    seedRaw(db, 'rep', 'generic job post repeated');
    const fake = vi.fn().mockResolvedValue(
      (await makeToolUseResponse(GENERIC_INPUT)),
    ) as unknown as MessageCreate;
    const deps = makeDeps(db, fake);

    await extractPending(deps);
    const callsAfterFirst = (fake as ReturnType<typeof vi.fn>).mock.calls.length;
    const countAfterFirst = (
      db.prepare('SELECT COUNT(*) as c FROM vacancies').get() as { c: number }
    ).c;

    await extractPending(deps);
    expect((fake as ReturnType<typeof vi.fn>).mock.calls.length).toBe(callsAfterFirst);
    const countAfterSecond = (
      db.prepare('SELECT COUNT(*) as c FROM vacancies').get() as { c: number }
    ).c;
    expect(countAfterSecond).toBe(countAfterFirst);
  });

  it('deduped counts intra-item duplicate vacancies (attempted minus inserted)', async () => {
    const vacancy = {
      title: 'Same Job',
      company: 'Same Co',
      description: 'Identical description for the duplicate role',
      location: null,
      remote_type: null,
      salary_min: null,
      salary_max: null,
      salary_currency: null,
      skills: [],
      apply_contact: null,
      lang: 'en',
    };
    seedRaw(db, 'dup', 'one item with two identical vacancies');
    const fake = vi.fn().mockResolvedValue(
      (await makeToolUseResponse({ is_job_post: true, vacancies: [vacancy, { ...vacancy }] })),
    ) as unknown as MessageCreate;
    const stats = await extractPending(makeDeps(db, fake));

    expect(stats.processed).toBe(1);
    expect(stats.vacanciesInserted).toBe(1);
    expect(stats.deduped).toBe(1);
  });

  it('respects limit option', async () => {
    seedRaw(db, 'r1', 'generic job post 1');
    seedRaw(db, 'r2', 'generic job post 2');
    seedRaw(db, 'r3', 'generic job post 3');
    const fake = vi.fn().mockResolvedValue(
      (await makeToolUseResponse(GENERIC_INPUT)),
    ) as unknown as MessageCreate;
    const stats = await extractPending({ ...makeDeps(db, fake), limit: 2 });
    expect(stats.processed).toBe(2);
  });
});
