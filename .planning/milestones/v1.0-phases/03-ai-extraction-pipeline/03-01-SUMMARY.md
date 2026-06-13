---
phase: 03-ai-extraction-pipeline
plan: "01"
subsystem: extraction
tags: [zod, schema, cache, config, tdd]
dependency_graph:
  requires: []
  provides: [extraction-schema-contract, extraction-cache-helpers, anthropicModel-config]
  affects: [src/extraction/schema.ts, src/db/extraction-cache.ts, src/config.ts]
tech_stack:
  added: []
  patterns: [zod-schema-validation, insert-or-ignore-cache, file-config-default]
key_files:
  created:
    - src/extraction/schema.ts
    - src/extraction/schema.test.ts
    - src/db/extraction-cache.ts
    - src/db/extraction-cache.test.ts
  modified:
    - src/config.ts
    - src/config.test.ts
    - src/pipeline/registry.test.ts
decisions:
  - "EXTRACTION_TOOL.input_schema is hand-written JSON Schema (not auto-derived from Zod) — Anthropic SDK tool API requires a plain JSON Schema object in input_schema"
  - "getCachedExtraction returns raw unknown (no Zod validation) — cache is a pure byte store; validation is the extractor's responsibility"
  - "anthropicModel is a file-config field with Zod default (not env) — only ANTHROPIC_API_KEY is env-only per Anti-Pattern 4"
metrics:
  duration: 3min
  completed_date: "2026-06-13"
  tasks: 2
  files: 7
---

# Phase 3 Plan 01: Extraction Schema, Cache Helpers, and Model Config Summary

**One-liner:** Locked `{ is_job_post, vacancies[] }` Zod contract + hand-written JSON Schema tool, content-hash cache get/put helpers, and `anthropicModel` config field defaulting to `claude-haiku-4-5`.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 (RED) | Extraction schema tests | 8d30357 | src/extraction/schema.test.ts |
| 1 (GREEN) | Extraction Zod schema + tool JSON Schema | e49475b | src/extraction/schema.ts |
| 2 (RED) | Cache helpers + config tests | 863f13c | src/db/extraction-cache.test.ts, src/config.test.ts |
| 2 (GREEN) | Cache helpers + config field | 743ba2d | src/db/extraction-cache.ts, src/config.ts |
| 2 (FIX) | Fix Config mock in registry.test.ts | 488d25a | src/pipeline/registry.test.ts |

## What Was Built

**src/extraction/schema.ts** — `VacancySchema` (Zod 4), `ExtractionResultSchema`, `EXTRACTION_TOOL` with hand-written `input_schema` JSON Schema for Anthropic tool-use API. Exports `Vacancy` and `ExtractionResult` inferred types.

**src/db/extraction-cache.ts** — `getCachedExtraction(db, contentHash)` returns parsed `result_json` or `null`; `putCachedExtraction(db, args)` uses `INSERT OR IGNORE` wrapped in `runInTransaction` (synchronous). Mirrors raw-items.ts prepared-statement style.

**src/config.ts** — Added `anthropicModel: z.string().min(1).default('claude-haiku-4-5')` to configSchema and `anthropicModel: file.anthropicModel` to the merged object.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed TypeScript error in registry.test.ts**
- **Found during:** Task 2 `npx tsc --noEmit` verification
- **Issue:** `makeConfig()` helper returned a `Config` object missing the newly required `anthropicModel` field, causing TS2741 type error
- **Fix:** Added `anthropicModel: 'claude-haiku-4-5'` to the mock Config in `src/pipeline/registry.test.ts`
- **Files modified:** src/pipeline/registry.test.ts
- **Commit:** 488d25a

## Verification Results

- `npx vitest run src/extraction/schema.test.ts src/db/extraction-cache.test.ts src/config.test.ts` — 34 tests passed
- `npx vitest run` (full suite) — 91 tests passed across 12 test files
- `npx tsc --noEmit` — exits 0
- `src/db/schema.sql` — byte-identical to before this plan (no migrations)

## Self-Check: PASSED

- src/extraction/schema.ts: FOUND
- src/extraction/schema.test.ts: FOUND
- src/db/extraction-cache.ts: FOUND
- src/db/extraction-cache.test.ts: FOUND
- Commit 8d30357: FOUND
- Commit e49475b: FOUND
- Commit 863f13c: FOUND
- Commit 743ba2d: FOUND
- Commit 488d25a: FOUND
