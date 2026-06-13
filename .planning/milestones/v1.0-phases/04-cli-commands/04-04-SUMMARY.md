---
phase: 04-cli-commands
plan: "04"
subsystem: cli-ingest
tags: [cli, ingest, orchestrator, extractor, stats, exit-code, tdd]
dependency_graph:
  requires: [ingestSources, extractPending, buildAdapters, loadConfig, openDatabase, realMessageCreate]
  provides: [runIngest, registerIngest, IngestDeps]
  affects:
    - src/cli/ingest.ts
tech_stack:
  added: []
  patterns: [injectable-deps-seam, tdd-red-green, pipeline-wiring, per-source-fault-isolation]
key_files:
  created:
    - src/cli/ingest.ts
    - src/cli/ingest.test.ts
  modified: []
decisions:
  - "runIngest(deps, opts) injectable-deps pattern mirrors Phase 2/3 pattern — tests inject fake adapters + fake messageCreate, no live network/API/DB"
  - "deduped = max(0, processed - vacanciesInserted - nonJob) — items processed but not inserted and not classified as nonJob were dedup-suppressed"
  - "registerIngest wires real deps; commander propagates action throws as non-zero exit — fatal/config errors handled without extra try/catch"
metrics:
  duration: "~2 minutes"
  completed_date: "2026-06-13"
  tasks: 1
  files: 2
---

# Phase 4 Plan 04: ingest Command — Pipeline Wiring + Stats Block Summary

**One-liner:** runIngest wires ingestSources→extractPending end-to-end with --source narrowing, --since sinceOverride, full stats block (fetched/extracted/deduped/skipped/Claude API calls/per-source errors), and exit-0-on-source-errors; tested via injected fakes.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 (RED) | Failing tests for runIngest pipeline wiring | 2111a35 | src/cli/ingest.test.ts |
| 1 (GREEN) | Implement runIngest + registerIngest | 9496de5 | src/cli/ingest.ts |

## TDD Gate Compliance

- RED commit: 2111a35 — `test(04-04): add failing tests for runIngest pipeline wiring`
- GREEN commit: 9496de5 — `feat(04-04): implement runIngest — orchestrator+extractor pipeline with stats block`

## What Was Built

**src/cli/ingest.ts** — `runIngest(deps: IngestDeps, opts)`: filters adapters by `opts.source` if provided, builds `sinceOverride` from `opts.since`, calls `ingestSources` then `extractPending`, computes aggregated stats (fetched = sum of SourceStat.fetched, newRaws = sum of SourceStat.inserted, deduped = max(0, processed - vacanciesInserted - nonJob), skipped and apiCalls from PipelineStats), prints the summary block, and lists per-source errors — never throws on source errors. `registerIngest(program)` wires real deps preserving Plan 02 `--source`/`--since` flags.

**src/cli/ingest.test.ts** — 6 tests covering: fetched aggregation across adapters, --source narrowing (only matching adapter raws), --since sinceOverride passthrough, per-source error surfaced in output + resolves (exit 0), stats block contains all labels, no --since leaves sinceOverride undefined.

## Deviations from Plan

None — plan executed exactly as written.

## Verification Results

- `npx vitest run src/cli/ingest.test.ts` — 6 tests passed
- `npx vitest run` (full suite) — 161 tests passed across 20 test files (no regressions)
- `npx tsc --noEmit` — exits 0
- All grep acceptance criteria matched

## Known Stubs

None.

## Threat Flags

None — T-04-08 (no secrets echoed), T-04-09 (per-source errors exit 0), T-04-10 (Telegram session error surfaces as per-source error) all mitigated as planned.

## Self-Check: PASSED

- src/cli/ingest.ts: FOUND
- src/cli/ingest.test.ts: FOUND
- RED commit 2111a35: FOUND
- GREEN commit 9496de5: FOUND
- 6 ingest tests pass, 161 total tests pass, tsc --noEmit exits 0
