import { describe, it, expect, vi, beforeEach } from 'vitest';
import { openDatabase } from '../db/client.js';
import type { ExtractDeps, ExtractOutcome } from './extractor.js';
import { extractOne } from './extractor.js';
import type { MessageCreate } from './client.js';
import { EXTRACTION_TOOL } from './schema.js';
import type Database from 'better-sqlite3';

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
        caller: { type: 'direct' as const },
      },
    ],
    model: 'claude-haiku-4-5',
    stop_reason: 'tool_use' as const,
    stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 20, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
  });
}

const VALID_JOB_INPUT = {
  is_job_post: true,
  vacancies: [
    {
      title: 'Backend Developer',
      company: 'Acme Inc',
      description: 'We need a Node.js dev',
      location: 'Tashkent',
      remote_type: 'hybrid',
      salary_min: 1000,
      salary_max: 2000,
      salary_currency: 'USD',
      skills: ['Node.js', 'TypeScript'],
      apply_contact: '@acmehr',
      lang: 'en',
    },
  ],
};

const NON_JOB_INPUT = {
  is_job_post: false,
  vacancies: [],
};

const INVALID_INPUT = {
  is_job_post: 'not_a_boolean',
  vacancies: 'not_an_array',
};

function makeDeps(
  db: Database.Database,
  messageCreate: MessageCreate,
): ExtractDeps {
  return {
    db,
    messageCreate,
    model: 'claude-haiku-4-5',
    system: 'Extract vacancies.',
    log: () => {},
  };
}

describe('extractOne', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = openDatabase(':memory:');
  });

  it('calls Claude once on cache miss, returns valid result', async () => {
    const fake: MessageCreate = vi.fn().mockImplementation(() => makeToolUseResponse(VALID_JOB_INPUT));
    const deps = makeDeps(db, fake);

    const outcome = await extractOne(deps, 'We are hiring a backend developer.');

    expect(outcome.fromCache).toBe(false);
    expect(outcome.apiCalls).toBe(1);
    expect(outcome.skipped).toBe(false);
    expect(outcome.result).not.toBeNull();
    expect(outcome.result!.is_job_post).toBe(true);
    expect(outcome.result!.vacancies).toHaveLength(1);
    expect(vi.mocked(fake).mock.calls.length).toBe(1);
  });

  it('makes zero API calls on cache hit (same rawText)', async () => {
    const rawText = 'We are hiring a backend developer.';
    const fake: MessageCreate = vi.fn().mockImplementation(() => makeToolUseResponse(VALID_JOB_INPUT));
    const deps = makeDeps(db, fake);

    await extractOne(deps, rawText);
    expect(vi.mocked(fake).mock.calls.length).toBe(1);

    const secondOutcome = await extractOne(deps, rawText);

    expect(vi.mocked(fake).mock.calls.length).toBe(1);
    expect(secondOutcome.fromCache).toBe(true);
    expect(secondOutcome.apiCalls).toBe(0);
    expect(secondOutcome.result).not.toBeNull();
    expect(secondOutcome.result!.is_job_post).toBe(true);
  });

  it('returns is_job_post=false and empty vacancies for non-job post, and caches it', async () => {
    const fake: MessageCreate = vi.fn().mockImplementation(() => makeToolUseResponse(NON_JOB_INPUT));
    const deps = makeDeps(db, fake);

    const outcome = await extractOne(deps, 'Channel announcement: maintenance tonight.');

    expect(outcome.result!.is_job_post).toBe(false);
    expect(outcome.result!.vacancies.length).toBe(0);
    expect(outcome.apiCalls).toBe(1);
    expect(outcome.skipped).toBe(false);

    const secondOutcome = await extractOne(deps, 'Channel announcement: maintenance tonight.');
    expect(vi.mocked(fake).mock.calls.length).toBe(1);
    expect(secondOutcome.fromCache).toBe(true);
  });

  it('retries once on validation failure, returns result on second valid response', async () => {
    const fake: MessageCreate = vi.fn()
      .mockImplementationOnce(() => makeToolUseResponse(INVALID_INPUT))
      .mockImplementationOnce(() => makeToolUseResponse(VALID_JOB_INPUT));
    const deps = makeDeps(db, fake);

    const outcome = await extractOne(deps, 'Hiring backend dev now!');

    expect(outcome.apiCalls).toBe(2);
    expect(outcome.skipped).toBe(false);
    expect(outcome.result!.is_job_post).toBe(true);
    expect(vi.mocked(fake).mock.calls.length).toBe(2);
  });

  it('returns skipped=true and null result after two validation failures, does not cache', async () => {
    const fake: MessageCreate = vi.fn()
      .mockImplementation(() => makeToolUseResponse(INVALID_INPUT));
    const deps = makeDeps(db, fake);
    const rawText = 'Some post with garbage response.';

    const outcome = await extractOne(deps, rawText);

    expect(outcome.skipped).toBe(true);
    expect(outcome.result).toBeNull();
    expect(outcome.apiCalls).toBe(2);
    expect(vi.mocked(fake).mock.calls.length).toBe(2);

    const cacheCount = (db
      .prepare('SELECT COUNT(*) as cnt FROM extraction_cache')
      .get() as { cnt: number }).cnt;
    expect(cacheCount).toBe(0);
  });

  it('propagates hard API errors without wrapping them as skips', async () => {
    const fake: MessageCreate = vi.fn().mockRejectedValue(new Error('Network error'));
    const deps = makeDeps(db, fake);

    await expect(extractOne(deps, 'We are hiring.')).rejects.toThrow('Network error');
  });
});
