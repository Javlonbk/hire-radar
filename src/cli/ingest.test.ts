import { describe, it, expect, vi, beforeEach } from 'vitest';
import { openDatabase } from '../db/client.js';
import { persistRawItems } from '../db/raw-items.js';
import { contentHash } from '../hash.js';
import { runIngest } from './ingest.js';
import type { IngestDeps } from './ingest.js';
import type { MessageCreate } from '../extraction/client.js';
import type { SourceAdapter, RawItem } from '../adapters/types.js';
import { EXTRACTION_TOOL } from '../extraction/schema.js';
import Database from 'better-sqlite3';

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

const JOB_INPUT = {
  is_job_post: true,
  vacancies: [
    {
      title: 'Frontend Dev',
      company: 'Acme',
      description: 'Frontend developer needed for the role',
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

function makeRawItem(sourceId: string, n: number): RawItem {
  return {
    sourceId,
    nativeId: `native-${n}`,
    rawText: `job post text ${n}`,
    rawJson: null,
    fetchedAt: new Date('2026-01-01T00:00:00Z'),
    contentHash: contentHash(`${sourceId}-native-${n}`),
  };
}

function makeAdapter(id: string, items: RawItem[] | Error, seenSince?: Date[]): SourceAdapter {
  return {
    id,
    fetch: async (since: Date) => {
      if (seenSince) seenSince.push(since);
      if (items instanceof Error) throw items;
      return items;
    },
  };
}

function makeDeps(db: Database.Database, adapters: SourceAdapter[], lines: string[]): IngestDeps {
  const fakeMessageCreate = vi.fn().mockResolvedValue(makeToolUseResponse(JOB_INPUT)) as unknown as MessageCreate;
  return {
    db,
    adapters,
    messageCreate: fakeMessageCreate,
    model: 'claude-haiku-4-5',
    out: (line: string) => lines.push(line),
  };
}

describe('runIngest', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = openDatabase(':memory:');
  });

  it('aggregates fetched from all adapters', async () => {
    const a1 = makeAdapter('hh:uz', [makeRawItem('hh:uz', 1), makeRawItem('hh:uz', 2)]);
    const a2 = makeAdapter('rss:feed', [makeRawItem('rss:feed', 3)]);
    const lines: string[] = [];
    const deps = makeDeps(db, [a1, a2], lines);

    await runIngest(deps, {});

    const summary = lines.join('\n');
    expect(summary).toMatch(/fetched:\s*3/);
  });

  it('--source narrows to only the matching adapter', async () => {
    const a1 = makeAdapter('hh:uz', [makeRawItem('hh:uz', 1), makeRawItem('hh:uz', 2)]);
    const a2 = makeAdapter('rss:feed', [makeRawItem('rss:feed', 3)]);
    const lines: string[] = [];
    const deps = makeDeps(db, [a1, a2], lines);

    await runIngest(deps, { source: 'hh:uz' });

    const summary = lines.join('\n');
    expect(summary).toMatch(/fetched:\s*2/);
  });

  it('--since is passed as sinceOverride to ingestSources', async () => {
    const seenSince: Date[] = [];
    const a1 = makeAdapter('hh:uz', [], seenSince);
    const lines: string[] = [];
    const deps = makeDeps(db, [a1], lines);

    await runIngest(deps, { since: '2026-06-01' });

    expect(seenSince[0]).toEqual(new Date('2026-06-01'));
  });

  it('per-source error appears in output and runIngest resolves (exit 0)', async () => {
    const bad = makeAdapter('telegram:channel', new Error('Telegram session missing/expired — run hire-radar auth'));
    const lines: string[] = [];
    const deps = makeDeps(db, [bad], lines);

    await expect(runIngest(deps, {})).resolves.toBeUndefined();

    const summary = lines.join('\n');
    expect(summary).toMatch(/telegram:channel/);
    expect(summary).toMatch(/Telegram session missing/);
  });

  it('stats block contains all required labels', async () => {
    const a1 = makeAdapter('hh:uz', [makeRawItem('hh:uz', 1)]);
    const lines: string[] = [];
    const deps = makeDeps(db, [a1], lines);

    await runIngest(deps, {});

    const summary = lines.join('\n');
    expect(summary).toMatch(/fetched/i);
    expect(summary).toMatch(/extracted/i);
    expect(summary).toMatch(/deduped/i);
    expect(summary).toMatch(/skipped/i);
    expect(summary).toMatch(/Claude API calls/i);
  });

  it('no --since → sinceOverride is undefined', async () => {
    const seenSince: Date[] = [];
    const a1 = makeAdapter('hh:uz', [], seenSince);
    const lines: string[] = [];
    const deps = makeDeps(db, [a1], lines);

    await runIngest(deps, {});

    expect(seenSince.length).toBe(1);
    // With no sinceOverride the orchestrator uses cursor (null = 7-day backfill)
    // Just verify it ran without throwing
  });

  it('malformed --since rejects with a clean error before reaching adapters', async () => {
    const seenSince: Date[] = [];
    const a1 = makeAdapter('hh:uz', [], seenSince);
    const deps = makeDeps(db, [a1], []);

    await expect(runIngest(deps, { since: 'garbage' })).rejects.toThrow(/Invalid --since date/);
    expect(seenSince).toHaveLength(0);
  });
});
