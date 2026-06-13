---
phase: 02-source-adapters
plan: "01"
subsystem: adapters
tags: [adapter, hh, sqlite, tdd]
dependency_graph:
  requires: [01-foundation]
  provides: [SourceAdapter interface, RawItem type, persistRawItems, getCursor, upsertCursor, createHhAdapter]
  affects: [02-02, 02-03, 02-04]
tech_stack:
  added: []
  patterns: [INSERT OR IGNORE dedup, synchronous runInTransaction, injectable fetchFn/sleep/log for testability]
key_files:
  created:
    - src/adapters/types.ts
    - src/adapters/hh.ts
    - src/adapters/hh.test.ts
    - src/db/raw-items.ts
    - src/db/raw-items.test.ts
    - src/db/sources.ts
    - src/db/sources.test.ts
  modified: []
decisions:
  - contentHash key for hh items is "hh:uz:" + vacancy.id (not sourceId+nativeId without colon separator)
  - upsertCursor updates type and config_json in addition to last_fetched_at on conflict
metrics:
  duration: "~4 minutes"
  completed: "2026-06-13T06:54:00Z"
  tasks: 2
  files: 7
---

# Phase 2 Plan 1: Source Adapter Contract and hh.uz Adapter Summary

**One-liner:** RawItem/SourceAdapter interface contract, SQLite dedup persistence (INSERT OR IGNORE), per-source cursor read/write, and hh.uz REST adapter with date cursor, pagination cap, User-Agent pacing, and injectable test seams.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | SourceAdapter/RawItem contract + DB helpers | 8e4dfd0 | src/adapters/types.ts, src/db/raw-items.ts, src/db/sources.ts |
| 2 | hh.uz REST adapter with date cursor + pagination | 8833090 | src/adapters/hh.ts |

## TDD Gate Compliance

- RED commit (task 1): c9a5cfc — `test(02-01): add failing tests for persistRawItems and cursor helpers`
- GREEN commit (task 1): 8e4dfd0 — `feat(02-01): SourceAdapter/RawItem contract, persistRawItems, and cursor helpers`
- RED commit (task 2): 4598de3 — `test(02-01): add failing tests for hh.uz adapter`
- GREEN commit (task 2): 8833090 — `feat(02-01): implement hh.uz REST adapter with date cursor and pagination`

## Decisions Made

- contentHash key for hh adapter uses `"hh:uz:" + nativeId` (colon-separated, matching the pattern `contentHash(sourceId + ":" + nativeId)` from the plan spec)
- upsertCursor updates `type` and `config_json` on conflict in addition to `last_fetched_at` — keeps the row fully current if source config changes between runs

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None.

## Threat Flags

None — no new network endpoints or trust boundaries beyond what the plan's threat model covers (T-02-01, T-02-02, T-02-03 all mitigated: String(item.id) coercion, 20-page cap + 500ms pacing, parameterized INSERT).
