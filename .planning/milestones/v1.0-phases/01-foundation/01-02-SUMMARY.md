---
phase: 01-foundation
plan: 02
subsystem: db
tags: [sqlite, better-sqlite3, wal, schema, tdd]

requires:
  - 01-foundation/01-01 (toolchain: package.json, tsconfig.json, vitest)
provides:
  - SQLite 4-table schema (sources, raw_items, extraction_cache, vacancies) with UNIQUE content_hash dedup
  - better-sqlite3 client opening in WAL mode with busy_timeout=10000
  - idempotent schema init via IF NOT EXISTS
  - synchronous runInTransaction helper preventing async-in-transaction bugs
affects:
  - 01-03 (hash utilities will write to these tables)
  - all later phases (adapters, extractor, commands read/write this DB)

tech-stack:
  added: []
  patterns:
    - schema.sql loaded via import.meta.url + readFileSync for portable file resolution
    - WAL + busy_timeout set on every connection (not in schema.sql) per PITFALL-9
    - runInTransaction is strictly synchronous — no async allowed inside (PITFALL-10)

key-files:
  created:
    - src/db/schema.sql
    - src/db/client.ts
    - src/db/client.test.ts
  modified: []

key-decisions:
  - "schema.sql contains no PRAGMA statements — pragmas set on connection in client.ts so they apply to every open, including :memory: in tests"
  - "import.meta.url used for schema.sql path resolution — works correctly with bundler moduleResolution and tsx runner"
  - "runInTransaction delegates directly to db.transaction(fn)() with no async wrapper — one-liner is clearest enforcement of PITFALL-10"

requirements-completed: [FNDN-01]

duration: 2min
completed: 2026-06-13
---

# Phase 1 Plan 02: SQLite Schema and DB Client Summary

**SQLite 4-table schema (sources, raw_items, extraction_cache, vacancies) with WAL mode, busy_timeout=10000, idempotent init, and a strictly-synchronous transaction helper**

## Performance

- **Duration:** ~2 min
- **Started:** 2026-06-13T01:23:35Z
- **Completed:** 2026-06-13T01:25:00Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments

- `src/db/schema.sql`: 4 tables with IF NOT EXISTS, UNIQUE(content_hash) on raw_items and vacancies, 4 indexes (status, source, posted_at, source)
- `src/db/client.ts`: opens better-sqlite3 with WAL + busy_timeout, runs schema idempotently, exports openDatabase and runInTransaction
- `src/db/client.test.ts`: 7 tests covering WAL mode, busy_timeout, all 4 tables, idempotent re-open, UNIQUE dedup, transaction commit, transaction rollback

## Task Commits

1. **Task 1: Write schema.sql** - `e0f36a7` (feat)
2. **Task 2 RED: Failing tests for openDatabase and runInTransaction** - `4a87aa6` (test)
3. **Task 2 GREEN: Implement client.ts** - `6883442` (feat)

## TDD Gate Compliance

- RED gate: `4a87aa6` — test commit exists, all tests failed (module not found)
- GREEN gate: `6883442` — feat commit exists, all 7 tests pass

## Files Created/Modified

- `src/db/schema.sql` — DDL for 4 tables with indexes and UNIQUE constraints
- `src/db/client.ts` — better-sqlite3 init, WAL, busy_timeout, schema runner, runInTransaction
- `src/db/client.test.ts` — 7 vitest cases covering all behavior spec points

## Decisions Made

- No PRAGMA statements in schema.sql — pragmas live in client.ts so they run on every connection type (file or :memory:)
- `import.meta.url` for schema path resolution — portable under tsx and node --require without extra config
- `runInTransaction` is a one-liner wrapping `db.transaction(fn)()` — simplest correct enforcement of PITFALL-10 (no async inside better-sqlite3 transaction)

## Deviations from Plan

None — plan executed exactly as written.

## Threat Model Compliance

| Threat | Mitigation | Status |
|--------|-----------|--------|
| T-01-04: SQLITE_BUSY on concurrent writers | WAL + busy_timeout=10000 set in openDatabase | Implemented + tested |
| T-01-05: Partial/corrupt writes from async-in-transaction | runInTransaction is strictly synchronous; tested for rollback on throw | Implemented + tested |
| T-01-06: DB file world-readable | Accepted (single-user CLI, data/ gitignored, no PII secrets) | Accepted |

## Self-Check: PASSED

All files verified present:
- src/db/schema.sql: FOUND
- src/db/client.ts: FOUND
- src/db/client.test.ts: FOUND

All commits verified:
- e0f36a7: FOUND (feat: schema.sql)
- 4a87aa6: FOUND (test: failing tests RED)
- 6883442: FOUND (feat: client.ts GREEN)
