---
phase: 02-source-adapters
plan: "03"
subsystem: pipeline
tags: [orchestrator, registry, fault-isolation, tdd, cursor]
dependency_graph:
  requires: [02-01, 02-02]
  provides: [ingestSources, buildAdapters]
  affects: [02-04, phase-4-cli]
tech_stack:
  added: []
  patterns: [sequential adapter loop (no Promise.all), per-source try/catch isolation, persist-before-cursor-advance, injectable clock/log for testability, 7-day backfill default]
key_files:
  created:
    - src/pipeline/registry.ts
    - src/pipeline/registry.test.ts
    - src/pipeline/orchestrator.ts
    - src/pipeline/orchestrator.test.ts
  modified: []
decisions:
  - adapter.id.split(':')[0] used as the type column value (hh | rss | telegram) — avoids adding a separate type field to SourceAdapter
  - runStart captured once at entry, used as cursor value for all succeeding adapters in the run — all sources share a consistent high-water mark per run
metrics:
  duration: "~4 minutes"
  completed: "2026-06-13T07:04:00Z"
  tasks: 2
  files: 4
---

# Phase 2 Plan 3: Pipeline Orchestrator and Source Registry Summary

**One-liner:** Sequential, per-source fault-isolated ingest orchestrator with persist-before-cursor-advance guarantee, 7-day backfill default, and sinceOverride; config-driven registry wiring hh + rss adapters with stable source ids.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 (RED) | Failing tests for buildAdapters registry | 07c0dfa | src/pipeline/registry.test.ts |
| 1 (GREEN) | Implement source registry | 5f7659f | src/pipeline/registry.ts |
| 2 (RED) | Failing tests for ingestSources orchestrator | 1a9a95f | src/pipeline/orchestrator.test.ts |
| 2 (GREEN) | Implement orchestrator | 8e5a6d0 | src/pipeline/orchestrator.ts |

## TDD Gate Compliance

- RED commit (task 1): 07c0dfa — `test(02-03): add failing tests for source registry buildAdapters`
- GREEN commit (task 1): 5f7659f — `feat(02-03): implement buildAdapters — config to hh + rss SourceAdapter[]`
- RED commit (task 2): 1a9a95f — `test(02-03): add failing tests for ingestSources orchestrator`
- GREEN commit (task 2): 8e5a6d0 — `feat(02-03): implement ingestSources orchestrator with fault isolation and persist-before-cursor`

## Decisions Made

- `adapter.id.split(':')[0]` derives the `type` column value from the source id (hh, rss, telegram) — no extra field needed on SourceAdapter
- `runStart` captured once at orchestrator entry and used as the cursor `lastFetchedAt` for all successful adapters in the run — consistent high-water mark across sources per run
- Cursor advances after `persistRawItems` returns — enforces SRCE-05 atomically; a crash between persist and upsertCursor leaves raws intact and cursor un-advanced, so the next run re-fetches and INSERT OR IGNORE absorbs duplicates

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None.

## Threat Flags

None — T-02-07 (per-source try/catch), T-02-08 (persist-before-cursor), and T-02-09 (log only id+counts, no payload) all mitigated as planned.

## Self-Check: PASSED

- src/pipeline/registry.ts: FOUND
- src/pipeline/registry.test.ts: FOUND
- src/pipeline/orchestrator.ts: FOUND
- src/pipeline/orchestrator.test.ts: FOUND
- RED commit 07c0dfa: FOUND
- GREEN commit 5f7659f: FOUND
- RED commit 1a9a95f: FOUND
- GREEN commit 8e5a6d0: FOUND
- All 7 tests pass (2 registry + 5 orchestrator), tsc --noEmit exits 0
