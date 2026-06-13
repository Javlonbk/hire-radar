---
phase: 04-cli-commands
reviewed: 2026-06-13T00:00:00Z
depth: standard
files_reviewed: 8
files_reviewed_list:
  - src/cli/index.ts
  - src/cli/ingest.ts
  - src/cli/list.ts
  - src/cli/export.ts
  - src/cli/auth.ts
  - src/db/vacancies.ts
  - bin/hire-radar
  - package.json
findings:
  critical: 1
  warning: 5
  info: 2
  total: 8
fixed:
  critical: 1
  warning: 5
  info: 0
  total: 6
open:
  info: 2
  total: 2
status: fixed
---

# Phase 04: Code Review Report

**Reviewed:** 2026-06-13T00:00:00Z
**Depth:** standard
**Files Reviewed:** 8
**Status:** fixed (CR-01 + WR-01..WR-05 resolved; IN-01, IN-02 left open by design)

## Summary

The user-facing CLI layer is structurally sound: commands are thin wrappers that delegate to the lib layer, dependency seams are injectable and well-tested, and the SQL access path is correctly parameterized (the explicit SQL-injection concern is clean — see note below). However, the review surfaced one crashing input-handling bug and several robustness/correctness gaps around flag parsing, process-level error handling, database lifecycle, and a derived statistic that is computed incorrectly.

Verified clean on the priority checklist:
- **SQL injection (concern 1):** `queryVacancies` uses bound parameters exclusively. The keyword `LIKE` value (`'%' + keyword + '%'`) is pushed into the `params` array and bound via `.all(...params)`, never concatenated into the SQL string. No interpolation of any filter value anywhere. (One non-injection LIKE quirk noted in IN-01.)
- **Export hygiene (concern 2):** `runExport` writes only `JSON.stringify(rows)` to `out`; the `VacancyRow` projection contains no credential fields. No logs are mixed into the export stream.
- **Auth secrets (concern 3):** `api_id`/`api_hash` are never echoed; the session string is printed once with a warning; the interactive gramjs login is isolated behind the `LoginFn` seam and prompts go to stderr.

## Critical Issues

### CR-01: `list --limit <non-numeric>` crashes the command with an unhandled SQLite error — FIXED

**File:** `src/cli/list.ts:45`, `src/db/vacancies.ts:54,62`
**Issue:** `runList` coerces the limit with `Number(opts.limit)`. For any non-numeric value (`--limit abc`, `--limit 1px`, etc.) this yields `NaN`. In `queryVacancies`, `Math.max(0, Math.trunc(NaN))` is `NaN` (not `0` — `Math.max` propagates `NaN`), and `lim !== undefined` is `true`, so the query appends `LIMIT ?` and binds `NaN`. better-sqlite3 rejects `NaN` with `TypeError: SQLite3 can only bind ... [datatype mismatch]`, which propagates out of the async action as an unhandled rejection and crashes the process with a raw stack trace instead of a usable error.

Verified empirically: `Math.max(0, Math.trunc(NaN)) === NaN`, and `db.prepare('... LIMIT ?').all(NaN)` throws `datatype mismatch`.

**Fix:** Validate/clamp the parsed limit before it reaches the query, and reject bad input with a clean message + non-zero exit:
```ts
const n = Number(opts.limit);
if (opts.limit !== undefined && !Number.isFinite(n)) {
  deps.err(`Invalid --limit value: ${opts.limit}`);
  process.exitCode = 1;
  return;
}
const filters: VacancyFilters = { /* ... */ limit: opts.limit !== undefined ? n : 20 };
```
Apply the same guard in `src/cli/export.ts:26`. Alternatively, harden `queryVacancies` to treat a non-finite `limit` as "no limit".

**Resolution:** Added `parseLimit` in `src/cli/options.ts` (rejects non-integer/negative with a clean `Invalid --limit value` error); wired into both `runList` and `runExport`. Defense-in-depth: `queryVacancies` now treats a non-finite `limit` as "no limit" via `Number.isFinite`. Regression tests in `list.test.ts` / `export.test.ts`.

## Warnings

### WR-01: Unhandled config/fatal errors surface as raw unhandled-rejection stack traces — FIXED

**File:** `bin/hire-radar:3`, `src/cli/ingest.ts:50-51`, `src/cli/auth.ts:48`
**Issue:** `buildProgram().parseAsync(process.argv)` has no `.catch()`. Every command action is `async`, so when `loadConfig` throws (missing `ANTHROPIC_API_KEY`, unreadable `config.json`) or `extractPending` fails fatally, commander rejects the `parseAsync` promise. With no handler this becomes an unhandled promise rejection: the process does exit non-zero (so the exit-code contract is technically met), but the user sees a full stack trace rather than the clean, actionable message that `loadConfig` carefully constructs. Given the brief explicitly calls out exit-code/error handling, this is a robustness gap.
**Fix:**
```ts
buildProgram().parseAsync(process.argv).catch((err) => {
  process.stderr.write((err instanceof Error ? err.message : String(err)) + '\n');
  process.exit(1);
});
```

**Resolution:** Added the `.catch()` handler to `bin/hire-radar`. Regression test `src/bin.test.ts` spawns the bin with a missing `config.json` and asserts a clean stderr message (no stack frames) plus a non-zero exit.

### WR-02: `deduped` statistic is derived incorrectly (mixes item counts with vacancy counts) — FIXED

**File:** `src/cli/ingest.ts:31`
**Issue:** `deduped = Math.max(0, ex.processed - ex.vacanciesInserted - ex.nonJob)`. `processed` counts raw *items* (one per extracted item; see `extractPending`), while `vacanciesInserted` counts *vacancies* (a single item can yield many). These are different units, so the subtraction is not a meaningful dedup count. Example: one job item producing 3 vacancies of which 1 is a duplicate gives `processed=1`, `vacanciesInserted=2`, `nonJob=0` → `deduped = max(0, 1-2-0) = 0`, despite 1 actual dedup. The `Math.max(0, ...)` clamp masks the underflow but produces a wrong figure whenever items map to multiple vacancies. Additionally `skipped` items are excluded from `processed`, further skewing the relationship.
**Fix:** Surface a real dedup count from the lib layer. `insertVacancies` already knows `inserted` vs. attempted; have `extractPending` accumulate `vacanciesAttempted` (or `deduped = attempted - inserted`) into `PipelineStats` and report that directly instead of reconstructing it in the CLI.

**Resolution:** Added a `deduped` field to `PipelineStats`; `extractPending` accumulates `vacancies.length - inserted` per job item (vacancies that hit `INSERT OR IGNORE` without inserting). `ingest.ts` now reports `ex.deduped` directly instead of the unit-mismatched reconstruction. Regression test in `pipeline.test.ts` (one item, two identical vacancies → `vacanciesInserted=1`, `deduped=1`).

### WR-03: Database handle is never closed in any command — FIXED

**File:** `src/cli/ingest.ts:52`, `src/cli/list.ts:65`, `src/cli/export.ts:43`
**Issue:** Each action calls `openDatabase()` but never `db.close()`. `openDatabase` enables WAL (`journal_mode = WAL`), so a clean `close()` is what triggers WAL checkpointing and releases the `-wal`/`-shm` files cleanly. Relying on process exit to reap the handle skips the graceful checkpoint and leaves the lock/handle open across the lifetime of any long-running invocation (notably `ingest`). This is also inconsistent with the brief's "commands open the DB and close it (no leaks)" requirement.
**Fix:** Wrap the body in `try { ... } finally { db.close(); }` in each register* action (or have the `run*` helpers receive an already-open db — as they do in tests — and close it in the action's `finally`).

**Resolution:** Wrapped the `runIngest`/`runList`/`runExport` calls in their register* actions with `try { ... } finally { db.close(); }`. The injectable `run*` seams still receive an open db (tests unaffected). `auth` opens no DB, so no change there.

### WR-04: `ingest --since` accepts invalid dates and silently propagates `Invalid Date` — FIXED

**File:** `src/cli/ingest.ts:24`
**Issue:** `opts.since ? new Date(opts.since) : undefined` does no validation. `--since garbage` produces an `Invalid Date` (`valueOf() === NaN`) that is passed as `sinceOverride` into `ingestSources` and on to `adapter.fetch(since)`. Depending on the adapter, this silently fetches the wrong window or sends a `NaN`-derived value upstream with no error.
**Fix:** Parse and validate:
```ts
let sinceOverride: Date | undefined;
if (opts.since) {
  sinceOverride = new Date(opts.since);
  if (Number.isNaN(sinceOverride.valueOf())) throw new Error(`Invalid --since date: ${opts.since}`);
}
```

**Resolution:** Added `parseDateValue` in `src/cli/options.ts` (validates `YYYY-MM-DD` and a non-`NaN` Date, then returns a `Date`); `runIngest` uses it for `--since`. A malformed value throws before adapters run. Regression test in `ingest.test.ts` asserts the throw and that no adapter `fetch` was reached.

### WR-05: `list`/`export` `--since`/`--until` values are passed to SQL without date validation — FIXED

**File:** `src/db/vacancies.ts:45-52`, `src/cli/list.ts:43-44`, `src/cli/export.ts:24-25`
**Issue:** `since`/`until` are bound directly into `created_at >= ?` / `created_at <= ? + ' 23:59:59'`. They are safely parameterized (no injection), but there is no check that the value is a valid `YYYY-MM-DD`. `created_at` is stored as `datetime('now')` text, so comparisons are lexical; a malformed value (e.g. `--until 2026-6-1`, or arbitrary text) silently produces a wrong or empty result set with no feedback. The `until` path also assumes day-granularity input — passing a full timestamp yields a nonsensical `'<ts> 23:59:59'` bound.
**Fix:** Validate the `--since`/`--until` arguments against a `YYYY-MM-DD` pattern in the CLI layer and reject non-conforming input with a clear message before querying.

**Resolution:** Added `parseDate` in `src/cli/options.ts` (enforces `^\d{4}-\d{2}-\d{2}$` plus a non-`NaN` Date); `runList` and `runExport` validate both `--since` and `--until` before building filters. Regression tests assert a clean throw on a malformed value (`2026-6-1` for list, `garbage` for export).

## Info

### IN-01: Keyword `LIKE` does not escape `%` / `_` wildcards — OPEN (out of scope)

**File:** `src/db/vacancies.ts:42`
**Issue:** `const kw = '%' + filters.keyword + '%'`. A user keyword containing `%` or `_` is interpreted as a SQL `LIKE` wildcard, so `--keyword 100%` or `--keyword a_b` matches more broadly than the literal text implies. Not a security issue (value is bound, not interpolated), but a correctness surprise for literal searches.
**Fix:** Escape wildcards and add `ESCAPE`: `const kw = '%' + filters.keyword.replace(/[%_\\]/g, '\\$&') + '%';` with `... LIKE ? ESCAPE '\\' ...`. Acceptable to leave as-is if loose matching is intended.

### IN-02: Empty `--keyword ""` matches all rows instead of being treated as "no filter" — OPEN (out of scope)

**File:** `src/cli/list.ts:43`, `src/cli/export.ts:23`, `src/db/vacancies.ts:40`
**Issue:** Filters are gated on `!== undefined`, so `--keyword ""` becomes a `LIKE '%%'` clause that matches everything — equivalent to no keyword, but it still adds a redundant 4-column OR clause. Harmless but a minor inconsistency in intent.
**Fix:** Treat empty-string filter values as absent: gate on `filters.keyword` (truthy) rather than `!== undefined`, or trim/skip empty strings in the CLI layer.

---

_Reviewed: 2026-06-13T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
