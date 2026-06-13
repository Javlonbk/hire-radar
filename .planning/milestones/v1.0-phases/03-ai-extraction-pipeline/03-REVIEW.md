---
phase: 03-ai-extraction-pipeline
reviewed: 2026-06-13T00:00:00Z
depth: standard
files_reviewed: 9
files_reviewed_list:
  - src/extraction/schema.ts
  - src/extraction/client.ts
  - src/extraction/extractor.ts
  - src/extraction/pipeline.ts
  - src/db/extraction-cache.ts
  - src/db/vacancies.ts
  - src/db/raw-items.ts
  - src/config.ts
  - src/db/schema.sql
findings:
  critical: 1
  warning: 6
  info: 3
  total: 10
resolution:
  fixed: 5
  accepted: 2
  deferred: 3
status: resolved
fix_iteration: 1
---

# Phase 3: Code Review Report

**Reviewed:** 2026-06-13T00:00:00Z
**Depth:** standard
**Files Reviewed:** 9
**Status:** issues_found

## Summary

The extraction pipeline is well-structured and the seven focus areas largely hold up under tracing:

- **Cache-before-API (Criterion 3):** Correct. `extractOne` checks `getCachedExtraction` before any `callClaude`, and writes the cache only on a successful Zod parse. The second-run path returns `apiCalls: 0`. Verified against `extractor.test.ts` and `pipeline.test.ts`.
- **`is_job_post` gate (Criterion 2):** Correct. Pipeline only calls `insertVacancies` when `outcome.result.is_job_post` is true; non-job and `is_job_post=false` paths insert 0 rows and mark `done`. Multi-job inserts N rows.
- **Dedup (Criterion 4):** Correct. `content_hash` over normalized `title|company|description[:200]` plus `INSERT OR IGNORE` + `UNIQUE(content_hash)` makes re-runs idempotent.
- **Error handling:** Hard API failure propagates out of `extractOne` (no swallowing), is caught in the pipeline loop, and the raw item is left `pending` (no `markExtractionStatus` call). Validation-twice marks `failed` and logs.
- **Secret/PII handling:** Clean. Logging only ever emits an 8-char hash prefix or an 8-char id prefix — no raw bodies, no model responses, no API key.
- **sync transaction boundary:** Clean. All `runInTransaction` callbacks are synchronous; the async `callClaude` completes before any DB write.

The original review flagged CR-01 (global dedup ignoring `source_id`) as a BLOCKER, but on review against 03-CONTEXT.md this is the **intended, locked** cross-source dedup behavior — it has been reclassified to **accepted (by design)**; see CR-01 below. The warnings WR-01/02/03/05/06 have been fixed; WR-04 is accepted as intentionally-terminal `failed`. Fix iteration 1 is complete; tsc and the full test suite pass.

## Critical Issues

### CR-01: Global vacancy dedup drops distinct vacancies that share title+company+description-prefix

**Resolution:** Accepted (by design). The `contentHash(normalize(title + company + description-prefix))` dedup key is a LOCKED decision in 03-CONTEXT.md and is the intended cross-source dedup behavior (the same job cross-posted to Telegram and hh.uz collapses to one canonical vacancy). `title` is part of the key, so genuinely distinct roles do not collapse; only same-title posts that share a boilerplate intro can. Fuzzy/semantic dedup of such posts is deferred to the v2 embedding dedup (project Out of Scope). No change to `vacancies.ts` dedup logic, the schema `UNIQUE(content_hash)` constraint, or the dedup key.

**File:** `src/db/vacancies.ts:18-20`, `src/db/schema.sql:48-50`
**Issue:** The dedup key is `contentHash(normalize(title) + '|' + normalize(company) + '|' + normalize(description.slice(0,200)))` enforced by a **global** `UNIQUE(content_hash)` on `vacancies`. Two consequences:

1. The key ignores `source_id`. A vacancy cross-posted to a Telegram channel and an RSS feed (extremely common in this market) collapses to one row, and the second source's `raw_item_id`/`external_id`/`apply_contact` are discarded via `INSERT OR IGNORE`. The pipeline counts this as `inserted: 0` with no signal that a real distinct posting was dropped.
2. The 200-char description prefix is load-bearing for uniqueness. Two genuinely different openings from the same company whose first 200 chars match a shared boilerplate intro (e.g. "We are a fast-growing fintech in Tashkent looking for talented engineers...") hash identically and the second is silently dropped. `vacancies.test.ts:111-120` actually asserts this collapse as *intended*, but it is a correctness hazard for real digest posts where multiple roles share a header.

This is a data-loss path: legitimate vacancies disappear with no error and no retry.

**Fix:** Decide the intended dedup scope and make it explicit. If dedup is meant to be per-source-posting (recommended), include `source_id` in the hash and/or the full description rather than a 200-char prefix:
```ts
const dedupKey = contentHash(
  link.sourceId + '|' +
  normalize(v.title) + '|' +
  normalize(v.company) + '|' +
  normalize(v.description),
);
```
If global cross-source dedup is genuinely intended, document that decision and confirm that losing the second source's linkage is acceptable. Either way, do not rely on a description prefix — distinct roles with shared intros will be eaten.

## Warnings

### WR-01: Corrupt/invalid cache row causes the raw item to retry forever

**Resolution:** Fixed (652d419). `putCachedExtraction` now uses `INSERT OR REPLACE` so a re-validated result overwrites a stale row, and `getCachedExtraction` wraps `JSON.parse` in a try/catch returning `null` (corrupt row treated as a miss, then overwritten). Regression tests added for overwrite, corrupt-row-as-miss, and corrupt-row-overwrite.

**File:** `src/extraction/extractor.ts:37-43`, `src/db/extraction-cache.ts:9`
**Issue:** On a cache hit where `safeParse(cached)` fails (e.g. a row written by an older schema, or `JSON.parse` succeeding on malformed-but-parseable content), `extractOne` falls through and calls the API again, then `putCachedExtraction` uses `INSERT OR IGNORE` — which is a no-op because the row already exists. The bad cache row is never overwritten, so every subsequent run re-hits the API for that item and never advances. This silently defeats Criterion 3 (zero API calls on re-run) for any item with a poisoned cache entry.
Separately, `JSON.parse(row.result_json)` at `extraction-cache.ts:9` is unguarded; a corrupt row throws, which surfaces as a "hard error" in the pipeline and leaves the item `pending` forever.
**Fix:** Use `INSERT OR REPLACE` (or `ON CONFLICT ... DO UPDATE`) in `putCachedExtraction` so a re-validated result overwrites a stale row, and wrap `JSON.parse` in `extraction-cache.ts` in a try/catch that returns `null` (treat corrupt cache as a miss) rather than throwing.

### WR-02: `limit` is not constrained to a non-negative integer before binding to `LIMIT ?`

**Resolution:** Fixed (8642755). `getPendingRawItems` now coerces `limit` via `Math.max(0, Math.trunc(limit))` before binding, so a float no longer crashes better-sqlite3 and a negative value yields 0 rows. Regression tests added for fractional and negative limits.

**File:** `src/db/raw-items.ts:34-42`, `src/extraction/pipeline.ts:11`
**Issue:** `limit?: number` flows directly into `db.prepare(sql).all(limit)`. better-sqlite3 throws `TypeError: SQLite3 can only bind numbers ...` style errors for a non-integer float, and a negative limit produces surprising SQL semantics. There is no validation; a caller passing `2.5` or `-1` either crashes the whole run or returns unexpected rows.
**Fix:** Coerce/validate at the boundary, e.g. `const lim = limit !== undefined ? Math.max(0, Math.trunc(limit)) : undefined;` and bind `lim`, or assert `Number.isInteger(limit) && limit >= 0`.

### WR-03: `salary_min`/`salary_max` accept floats but the column is INTEGER

**Resolution:** Fixed (77b8ddd). Salary fields are now `z.number().int().nullable()`, so a fractional salary fails validation (and hits the retry path) rather than persisting a REAL into the INTEGER columns. Regression tests added for fractional salary_min/salary_max.

**File:** `src/extraction/schema.ts:12-13`, `src/db/schema.sql:40-41`
**Issue:** The Zod schema uses `z.number().nullable()`, which accepts fractional values (e.g. the model emits `1500.5`). The `vacancies` columns are `INTEGER`. SQLite has flexible typing so it stores the REAL without error, but downstream consumers querying an INTEGER column may get a float back unexpectedly, and any numeric comparison/sorting assumptions break.
**Fix:** Use `z.number().int().nullable()` for the salary fields, or explicitly round before insert. Given the model can return non-integers, prefer `.int()` so validation (and the retry path) catches it rather than silently persisting bad data.

### WR-04: `markExtractionStatus` cannot set `pending`, making the type too narrow for recovery flows

**Resolution:** Accepted (failed is intentionally terminal). Hard/transient API failures leave the item `pending` by skipping the status update entirely (verified in the pipeline catch path), so they retry next run. Only validation-twice — a model-quality issue, not transient — reaches `failed`. A requeue path for `failed` items is not in scope for this phase; widening the type now would be a speculative abstraction. Re-queue of `failed` items can be added if a real recovery flow is needed.

**File:** `src/db/raw-items.ts:51-62`
**Issue:** The status param is typed `'done' | 'failed'`. There is no path to reset an item to `'pending'`. This is fine for the current happy/hard-error flow (hard errors simply skip the update), but it means a `failed` item — including one that failed only because of a transient/poisoned cache (see WR-01) — can never be re-queued without raw SQL. The 'failed' terminal state is permanent by construction, which conflicts with the prompt's intent that transient problems retry next run.
**Fix:** Either widen the type to include `'pending'` and add a requeue path for `failed` items, or document that `failed` is intentionally terminal and that retries are out of scope. At minimum, confirm validation-twice (a model-quality issue, not transient) is the only thing that reaches `failed`.

### WR-05: Pipeline marks validation-skips as `failed` with a generic message, losing the distinction from hard failures

**Resolution:** Fixed (3fc9b83). Validation-twice skips are now recorded with the specific tag `'zod-validation-failed-x2'` instead of the generic `'extraction validation failed'`, so this failure mode is distinguishable in the DB. Pipeline test now asserts the tag.

**File:** `src/extraction/pipeline.ts:53-55`
**Issue:** A `skipped` outcome (model returned schema-invalid output twice) is recorded as `extraction_status = 'failed'` with `'extraction validation failed'`. A genuinely non-job post that the model mishandles, and a transient API problem, can both end up indistinguishable from a permanent extraction failure in the DB. There is no record of how many API calls were burned or what the invalid shape was (only an 8-char hash is logged in the extractor). Operationally this makes it hard to tell "model can't parse this post" from "this post is junk."
**Fix:** Keep marking `failed` but include a more specific error tag (e.g. `'zod-validation-failed-x2'`) and ensure the extractor log line carries enough signal (it currently logs only the hash prefix). Consider a distinct status value if you later want to retry validation failures.

### WR-06: `getPendingRawItems` builds two prepared statements for the same query depending on `limit`

**Resolution:** Fixed (8642755, alongside WR-02). The SQL string is built once and prepared once, with `limit` passed via spread args (`db.prepare(sql).all(...args)`), removing the duplicated prepare/cast branches.

**File:** `src/db/raw-items.ts:35-42`
**Issue:** The SQL string is conditionally suffixed with `LIMIT ?` and then prepared in two branches. This is correct but duplicates the prepare/cast logic and is easy to desync if the column list changes. It also re-prepares on every call rather than reusing a cached statement. Not a bug, but a maintainability smell in a function that runs every pipeline invocation.
**Fix:** Build the SQL once, prepare once, and pass `limit` as `[]`-spread args: `const args = limit !== undefined ? [limit] : []; db.prepare(sql).all(...args)`. Keeps a single statement string and single cast.

## Info

### IN-01: `client.ts` casts `EXTRACTION_TOOL` through `unknown` to `Anthropic.Tool`

**Resolution:** Deferred (out of fix scope; not a correctness bug). The hand-written JSON Schema is already exercised by schema tests.

**File:** `src/extraction/client.ts:16`
**Issue:** `EXTRACTION_TOOL as unknown as Anthropic.Tool` defeats type checking on the tool schema. If the hand-written JSON Schema in `schema.ts` drifts from what the SDK expects, the compiler won't catch it. The double-cast is a known escape hatch but worth a note.
**Fix:** Type `EXTRACTION_TOOL` against `Anthropic.Tool` at its definition site (or a narrower structural type) so schema edits are checked, removing the need for the `unknown` cast at the call site.

### IN-02: `tool_use` parsing assumes a single tool block; multiple/empty inputs unguarded

**Resolution:** Deferred (out of fix scope; low priority). Zod already backstops a malformed `block.input` via validation + retry, as the finding notes.

**File:** `src/extraction/client.ts:19-23`
**Issue:** `res.content.find((b) => b.type === 'tool_use')` takes the first `tool_use` block and returns `block.input` with no check that `input` is a non-null object. With forced `tool_choice` the SDK should return exactly one well-formed block, so this is robust enough in practice and the "no tool_use block" case is handled with a clear throw. But `block.input` could be `undefined`/`{}`/a primitive in an oddly-shaped response, which then flows into Zod (and would correctly fail validation → retry). Acceptable, noting it relies on Zod as the backstop.
**Fix:** Optionally assert `block.input != null && typeof block.input === 'object'` before returning, for a clearer error than a downstream Zod failure. Low priority — Zod already catches it.

### IN-03: `extractOne` second-attempt `putCachedExtraction` duplicates the first-attempt block

**Resolution:** Deferred (out of fix scope; cosmetic). Current code is correct; the duplication is minor and a refactor is not warranted now.

**File:** `src/extraction/extractor.ts:54-74`
**Issue:** The success-then-cache-then-return block is copy-pasted for the first and second attempts, differing only in `apiCalls: 1` vs `2`. Minor duplication; a small refactor (loop over attempts tracking a counter) would remove it.
**Fix:** Extract a helper, e.g. iterate up to 2 attempts and cache+return on first success with `apiCalls = i`. Cosmetic only — current code is correct.

---

_Reviewed: 2026-06-13T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
