---
phase: 03-ai-extraction-pipeline
verified: 2026-06-13T13:15:00Z
status: passed
score: 4/4 must-haves verified
overrides_applied: 0
---

# Phase 3: AI Extraction Pipeline Verification Report

**Phase Goal:** Raw posts are automatically converted to structured, deduplicated vacancies in SQLite using Claude Haiku, with API calls gated by a content-hash cache
**Verified:** 2026-06-13T13:15:00Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (from ROADMAP Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Extraction produces structured vacancies (title, company, skills, salary, location, remote_type, apply_contact, lang) correctly populated for uz-Latn, uz-Cyrl, ru, en posts | VERIFIED | `VacancySchema` in `schema.ts:6-18` defines all 8 fields; `Lang = z.enum(['uz-Latn','uz-Cyrl','ru','en'])`; `insertVacancies` binds `v.lang` at column position 14; `vacancies.test.ts` round-trip test asserts `row.lang === 'uz-Latn'`; `schema.test.ts` covers all four lang values |
| 2 | A multi-job post produces multiple vacancy rows; a non-job post produces zero rows without fabricating fields | VERIFIED | `pipeline.ts:56-66` gates `insertVacancies` behind `is_job_post === true`; `pipeline.test.ts` multi-job test asserts `vacanciesInserted === 2` and `COUNT(*) === 2`; non-job test asserts `vacanciesInserted === 0`, `nonJob === 1`, `extraction_status === 'done'` |
| 3 | Running ingest twice on the same raw content makes exactly ONE Claude API call total; second run reads the extraction cache | VERIFIED | `extractor.ts:37` calls `getCachedExtraction` before any `callClaude` invocation at `extractor.ts:46`; `extractor.test.ts` cache-hit test asserts `fake.mock.calls.length === 1` before and after second `extractOne` call with same `rawText`; `pipeline.test.ts` twice-run test asserts `fake.mock.calls.length` is unchanged after second `extractPending` run |
| 4 | Running ingest twice produces exactly one vacancy row; the dedup hash prevents double-insertion | VERIFIED | `vacancies.ts:13` uses `INSERT OR IGNORE INTO vacancies`; dedup key is `contentHash(normalize(title) + '\|' + normalize(company) + '\|' + normalize(description.slice(0,200)))` at `vacancies.ts:18-20`; `schema.sql:50` has `UNIQUE(content_hash)`; `pipeline.test.ts` twice-run test asserts `COUNT(*) === countAfterFirst` after second run; `vacancies.test.ts` dedup test asserts `COUNT(*) === 1` and second call returns `0` |

**Score:** 4/4 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/extraction/schema.ts` | VacancySchema, ExtractionResultSchema, EXTRACTION_TOOL with input_schema | VERIFIED | All three exported; `is_job_post` appears in both Zod schema and JSON Schema; `lang` enum with four values present |
| `src/db/extraction-cache.ts` | getCachedExtraction / putCachedExtraction by content hash | VERIFIED | Both functions exported; SELECT by `content_hash` PK; `INSERT OR REPLACE` (post-review fix WR-01); guarded `JSON.parse` returns `null` on corrupt row |
| `src/config.ts` | anthropicModel config field defaulting to claude-haiku-4-5 | VERIFIED | `anthropicModel: z.string().min(1).default('claude-haiku-4-5')` at line 20; sourced from `file.anthropicModel` (non-secret) in merged object |
| `src/extraction/client.ts` | callClaude(messageCreate, args) with MessageCreate injection seam | VERIFIED | `MessageCreate` type exported; `callClaude` uses `tool_choice: { type: 'tool', name: EXTRACTION_TOOL.name }`; `realMessageCreate` factory isolates `new Anthropic` |
| `src/extraction/extractor.ts` | extractOne(deps, rawText) — cache-gate → call → validate → retry-once-skip | VERIFIED | Full algorithm implemented; `getCachedExtraction` called before `callClaude`; `ExtractionResultSchema.safeParse` on result; retry once then skip+log; `EXTRACTION_SYSTEM_PROMPT` exported |
| `src/db/schema.sql` | vacancies.lang column in CREATE TABLE | VERIFIED | `lang TEXT` at line 46, between `apply_contact` and `posted_at` |
| `src/db/raw-items.ts` | getPendingRawItems + markExtractionStatus added to existing file | VERIFIED | Both exported; `WHERE extraction_status = 'pending' ORDER BY fetched_at ASC`; limit coerced via `Math.max(0, Math.trunc(limit))` (post-review fix WR-02) |
| `src/db/vacancies.ts` | insertVacancies with dedup content_hash + INSERT OR IGNORE, binds lang | VERIFIED | Exactly 1 `INSERT OR IGNORE INTO vacancies`; lang bound at position 14 from `v.lang`; `normalize()` used in dedup key |
| `src/extraction/pipeline.ts` | extractPending(deps) — the phase-level function | VERIFIED | Exported; loops `getPendingRawItems`; branches on `is_job_post`, `skipped`, hard-throw; leaves pending on hard error; returns `PipelineStats` |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `extractor.ts` | `extraction-cache.ts` | `getCachedExtraction` before `callClaude` | VERIFIED | `getCachedExtraction` at line 37; `callClaude` inside `attempt()` called at line 54+ — cache check is structurally prior |
| `extractor.ts` | `schema.ts` | `ExtractionResultSchema.safeParse` on model output | VERIFIED | `ExtractionResultSchema.safeParse(raw)` at line 51; also re-validated on cache hit at line 39 |
| `client.ts` | Anthropic messages.create | forced `tool_choice { type:'tool', name:'extract_vacancies' }` | VERIFIED | Line 17: `tool_choice: { type: 'tool', name: EXTRACTION_TOOL.name }` |
| `pipeline.ts` | `extractor.ts` | `extractOne` per pending raw item | VERIFIED | Line 50: `const outcome = await extractOne(extractDeps, item.rawText)` |
| `vacancies.ts` | `vacancies.content_hash UNIQUE` | `contentHash(normalize(...)) + INSERT OR IGNORE` | VERIFIED | `INSERT OR IGNORE INTO vacancies` line 13; dedup key lines 18-20; `UNIQUE(content_hash)` in schema.sql |
| `vacancies.ts` | `vacancies.lang` | lang in INSERT column list, bound from `v.lang` | VERIFIED | Column 14 in INSERT list is `lang`; value bound is `v.lang` |
| `pipeline.ts` | `raw_items.extraction_status` | `markExtractionStatus done\|failed`; pending left on hard error | VERIFIED | Lines 54, 62, 65 call `markExtractionStatus`; catch block at line 69 does NOT call it (item stays pending) |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|-------------------|--------|
| `pipeline.ts` → `vacancies` table | `outcome.result.vacancies[]` | `extractOne` → `ExtractionResultSchema.safeParse(callClaude(...).block.input)` | Real — injected `messageCreate` in production, fake in tests; DB writes use actual parsed `Vacancy[]` | FLOWING |
| `insertVacancies` → `vacancies` row | `v.lang` | `Vacancy.lang` from model tool output, validated by Zod enum | Real — `v.lang` bound directly; `vacancies.test.ts` round-trip reads it back correctly | FLOWING |
| `extractPending` → `raw_items.extraction_status` | `outcome.skipped`, `outcome.result.is_job_post` | real `ExtractOutcome` from `extractOne` | Real — pipeline branches drive `markExtractionStatus`; pipeline tests verify all branches | FLOWING |

### Behavioral Spot-Checks

| Behavior | Verification Method | Result | Status |
|----------|--------------------|---------| ------ |
| 74 phase-3 tests pass (all 8 test files) | `npx vitest run` on all phase-3 test files | 8 files, 74 tests — 0 failures | PASS |
| TypeScript compiles cleanly | `npx tsc --noEmit` | Exit 0, no output | PASS |
| Cache-hit makes 0 API calls | `extractor.test.ts` "makes zero API calls on cache hit" — asserts `fake.mock.calls.length === 1` after both calls | Assertion verified in test code | PASS |
| Twice-run inserts 0 new vacancy rows | `pipeline.test.ts` "twice-run" — asserts `COUNT(*) === countAfterFirst` | Assertion verified in test code | PASS |
| `lang` persists round-trip | `vacancies.test.ts` "persists lang on the vacancy row" — reads back `row.lang === 'uz-Latn'` | Assertion verified in test code | PASS |
| Corrupt cache row treated as miss | `extraction-cache.test.ts` "treats a corrupt result_json as a miss" — manually inserts `{not valid json`, expects `null` | Assertion verified in test code | PASS |
| Hard API error leaves item pending | `pipeline.test.ts` "hard error" — asserts `extraction_status === 'pending'` for throwing raw | Assertion verified in test code | PASS |

### Requirements Coverage

| Requirement | Source Plans | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| EXTR-01 | 03-01, 03-02 | Claude Haiku extracts structured vacancies (title, company, skills, salary, location, remote_type, apply_contact, lang) from posts in uz-Latn, uz-Cyrl, ru, en | SATISFIED | `VacancySchema` with all 9 fields + `lang` enum; `ExtractionResultSchema`; `EXTRACTION_TOOL` JSON Schema; tests cover all four lang values |
| EXTR-02 | 03-02, 03-03 | Multi-job array output and `is_job_post` gate for non-job posts | SATISFIED | `ExtractionResultSchema` enforces `vacancies[]` array; pipeline gates on `is_job_post`; multi-job and non-job pipeline tests pass |
| EXTR-03 | 03-01, 03-02 | Extraction results cached by content hash — identical text never sent twice | SATISFIED | `extraction_cache` table; `getCachedExtraction` called before `callClaude`; cache-hit assertions at 0 API calls in both extractor and pipeline tests |
| EXTR-04 | 03-03 | Duplicate vacancies detected by hash and not inserted twice | SATISFIED | `contentHash(normalize(title+company+desc[:200]))` dedup key; `INSERT OR IGNORE`; `UNIQUE(content_hash)` constraint; dedup and twice-run tests verified |

### Anti-Patterns Found

| File | Pattern | Severity | Impact |
|------|---------|----------|--------|
| `src/extraction/extractor.ts:54-74` | First-attempt and second-attempt success-path blocks are copy-pasted (identified as IN-03 in REVIEW.md) | Info | None — logic is correct; cosmetic duplication only |

No TODOs, FIXMEs, placeholder returns, hardcoded empty data flowing to real output, or stub implementations were found in any phase-3 source file.

**Review findings resolved:** All critical and warning findings from 03-REVIEW.md have been addressed. `putCachedExtraction` now uses `INSERT OR REPLACE` (WR-01), `limit` is coerced to a non-negative integer (WR-02/WR-06), `salary_min`/`salary_max` use `z.number().int()` (WR-03), validation-twice is tagged `'zod-validation-failed-x2'` (WR-05). CR-01 (global dedup key excludes `source_id`) is accepted by design per 03-CONTEXT.md — cross-source dedup is the locked intent.

### Human Verification Required

None. All success criteria are verifiable programmatically via the test suite and source inspection. There is no UI, real-time behavior, or external service integration in this phase.

### Gaps Summary

No gaps. All four ROADMAP success criteria are fully implemented and tested. All four requirement IDs (EXTR-01 through EXTR-04) are covered by source code and passing tests. The full test suite (74 tests across 8 files) passes and `npx tsc --noEmit` exits clean.

---

_Verified: 2026-06-13T13:15:00Z_
_Verifier: Claude (gsd-verifier)_
