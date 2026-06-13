---
phase: 03-ai-extraction-pipeline
plan: "03"
subsystem: extraction-pipeline
tags: [sqlite, dedup, tdd, pipeline, lang, content-hash, insert-or-ignore]
dependency_graph:
  requires: [extractOne-cache-gated-extractor, raw-items-pending-status, vacancies-schema]
  provides: [extractPending, insertVacancies, getPendingRawItems, markExtractionStatus, vacancies.lang-column]
  affects:
    - src/db/schema.sql
    - src/db/raw-items.ts
    - src/db/vacancies.ts
    - src/extraction/pipeline.ts
tech_stack:
  added: []
  patterns: [insert-or-ignore-dedup, normalize-before-hash, async-before-sync-db, tdd-red-green]
key_files:
  created:
    - src/db/vacancies.ts
    - src/db/vacancies.test.ts
    - src/extraction/pipeline.ts
    - src/extraction/pipeline.test.ts
  modified:
    - src/db/schema.sql
    - src/db/raw-items.ts
    - src/db/raw-items.test.ts
decisions:
  - "dedupKey = contentHash(normalize(title) + '|' + normalize(company) + '|' + normalize(description.slice(0,200))) — 200-char prefix makes boundary deterministic; normalize handles Cyrillic homoglyphs and whitespace"
  - "pipeline.ts calls await extractOne first (async), then synchronous DB writes outside any transaction — enforces PITFALL-10 no-await-in-transaction rule"
  - "extractPending stats.processed counts only items that reached a terminal status (done or failed); hard-error items increment errors and are not counted in processed"
  - "lang column added directly to vacancies CREATE TABLE — pre-release, no migration system, fresh :memory: DBs pick it up automatically"
metrics:
  duration: 4min
  completed_date: "2026-06-13"
  tasks: 2
  files: 7
---

# Phase 3 Plan 03: Pipeline Wiring — extractPending + insertVacancies + lang column Summary

**One-liner:** vacancies.lang column persisted via INSERT OR IGNORE with normalize+contentHash dedup key; getPendingRawItems/markExtractionStatus appended to raw-items; extractPending loops pending items through extractOne and transitions status (done/failed/pending-on-error), verified end-to-end with fake messageCreate.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 (RED) | raw-items.test.ts + vacancies.test.ts failing | 2fb3005 | src/db/raw-items.test.ts, src/db/vacancies.test.ts |
| 1 (GREEN) | schema.sql lang column + raw-items helpers + insertVacancies | 2fb3005 | src/db/schema.sql, src/db/raw-items.ts, src/db/vacancies.ts |
| 2 (RED+GREEN) | extractPending pipeline + tests | 6396f7a | src/extraction/pipeline.ts, src/extraction/pipeline.test.ts |

## What Was Built

**src/db/schema.sql** — Added `lang TEXT` column to the vacancies CREATE TABLE after `apply_contact`.

**src/db/raw-items.ts** — Appended `PendingRawItem` interface, `getPendingRawItems(db, limit?)` (SELECT WHERE extraction_status='pending' ORDER BY fetched_at ASC, optional LIMIT), and `markExtractionStatus(db, id, status, error?)` (UPDATE raw_items SET extraction_status/extraction_error).

**src/db/vacancies.ts** — `insertVacancies(db, link, vacancies[])`: single INSERT OR IGNORE prepared statement binding all fields including `lang` (from `v.lang`) and `content_hash` (dedupKey). dedupKey = `contentHash(normalize(title) + '|' + normalize(company) + '|' + normalize(description.slice(0, 200)))`. skills stored as `JSON.stringify(v.skills)`. Full description stored; only 200-char prefix used in the dedup hash. Wrapped in `runInTransaction`. Returns total `result.changes`.

**src/extraction/pipeline.ts** — `extractPending(deps: PipelineDeps): Promise<PipelineStats>`: pulls pending raws via `getPendingRawItems`; per item: `await extractOne` (async boundary respected — no await inside any transaction); branches on outcome (is_job_post=true → insertVacancies+markDone, is_job_post=false → markDone+nonJob++, skipped → markFailed, hard-throw → log+errors++, leave pending). Returns stats: `{ processed, vacanciesInserted, nonJob, skipped, apiCalls, errors }`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Cyrillic homoglyph test used п (U+043F) instead of о (U+043E)**
- **Found during:** Task 1 GREEN phase test run
- **Issue:** Test used `'Acme Cпrp'` (Cyrillic п, not in CYRILLIC_TO_LATIN map) — would never normalize to match Latin variant
- **Fix:** Changed to `'Acme Cоrp'` (Cyrillic о, U+043E, which maps to Latin 'o' via the normalize fold map)
- **Files modified:** src/db/vacancies.test.ts
- **Commit:** 2fb3005

## Verification Results

- `npx vitest run src/db/raw-items.test.ts src/db/vacancies.test.ts` — 18 tests passed
- `npx vitest run src/extraction/pipeline.test.ts` — 6 tests passed
- `npx vitest run` (full suite) — 120 tests passed across 16 test files (no regressions)
- `npx tsc --noEmit` — exits 0
- `grep -E "lang[[:space:]]+TEXT" src/db/schema.sql` — matches
- `grep -E "\blang\b" src/db/vacancies.ts` — matches (in INSERT column list and v.lang binding)
- `grep -c "INSERT OR IGNORE INTO vacancies" src/db/vacancies.ts` — 1
- `grep -E "normalize\(" src/db/vacancies.ts` — matches
- `grep -E "WHERE extraction_status = 'pending'" src/db/raw-items.ts` — matches
- No `runInTransaction` in pipeline.ts — async/sync boundary correct (PITFALL 10)
- No `log(item.rawText)` in pipeline.ts — only item.id prefix logged (T-03-08)

## Threat Mitigations Applied

| Threat | Mitigation Applied |
|--------|-------------------|
| T-03-07 (fabricated rows) | is_job_post=true gate before insertVacancies; non-job → 0 rows + status done; asserted by non-job test |
| T-03-08 (info disclosure) | pipeline.ts logs only `item.id.slice(0,8)` + error message; never rawText or model result body |
| T-03-09 (re-extraction / dup pollution) | Cache gate (Wave 2 extractOne) + content_hash UNIQUE + INSERT OR IGNORE; twice-run asserts 0 new API calls + 0 new vacancy rows |

## Known Stubs

None.

## Self-Check: PASSED

- src/db/schema.sql: FOUND (lang TEXT column present)
- src/db/raw-items.ts: FOUND (getPendingRawItems + markExtractionStatus exported)
- src/db/vacancies.ts: FOUND (insertVacancies exported)
- src/extraction/pipeline.ts: FOUND (extractPending exported)
- src/db/raw-items.test.ts: FOUND (18 tests)
- src/db/vacancies.test.ts: FOUND (7 tests)
- src/extraction/pipeline.test.ts: FOUND (6 tests)
- Commit 2fb3005: FOUND
- Commit 6396f7a: FOUND
