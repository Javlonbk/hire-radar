---
phase: 04-cli-commands
verified: 2026-06-13T14:08:00Z
status: passed
score: 4/4
overrides_applied: 0
re_verification: null
gaps: []
deferred: []
human_verification: []
---

# Phase 4: CLI Commands Verification Report

**Phase Goal:** Users can invoke hire-radar ingest, list, and export from the terminal and receive clean output
**Verified:** 2026-06-13T14:08:00Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (ROADMAP Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | `hire-radar ingest` fetches, extracts, and persists from all sources and prints per-run stats (fetched, extracted, deduped, skipped, Claude API calls) | VERIFIED | `runIngest` calls `ingestSources` + `extractPending`, prints all five stat labels; `ex.deduped` is a real count from `PipelineStats.deduped` (set in `extractPending` as `vacancies.length - inserted`); 7 passing tests in `ingest.test.ts` |
| 2 | `hire-radar list` with filters (source, keyword/skill, date range, limit) displays matching vacancies in readable terminal output; default limit 20 | VERIFIED | `runList` calls `queryVacancies` with parsed filters, formats aligned columns with truncation and remote_type; default limit 20 via `parseLimit(opts.limit, 20)`; empty result writes to stderr; 10 passing tests in `list.test.ts` |
| 3 | `hire-radar export` with the same filters dumps a valid JSON array of structured vacancies to stdout | VERIFIED | `runExport` calls `queryVacancies`, emits `JSON.stringify(rows, null, 2)` to stdout only; no default limit (`parseLimit(opts.limit)` with no fallback); empty result emits `[]`; 8 passing tests in `export.test.ts` |
| 4 | A one-time auth command produces a persistent Telegram session string subsequent ingest runs use without re-authenticating | VERIFIED | `runAuth` prints session string + `TELEGRAM_SESSION` warning; session flows through `TELEGRAM_SESSION` env var → `config.telegramSession` → `buildAdapters` → telegram adapter `session` field; interactive gramjs login isolated behind injectable `LoginFn` seam; 4 passing tests in `auth.test.ts` |

**Score:** 4/4 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/db/vacancies.ts` | queryVacancies filter helper | VERIFIED | Exports `queryVacancies`, `VacancyRow`, `VacancyFilters`; all filters parameterized via `?` bindings; `insertVacancies` unchanged |
| `src/db/vacancies.test.ts` | Filter coverage tests | VERIFIED | Exists; all tests pass |
| `bin/hire-radar` | tsx hashbang shim | VERIFIED | Executable bit set; hashbang `#!/usr/bin/env -S npx tsx`; imports `buildProgram`; `.catch()` handler for clean error messages |
| `src/cli/index.ts` | Commander program wiring all four register* functions | VERIFIED | Exports `buildProgram`; calls all four `register*` functions |
| `src/cli/list.ts` | registerList action with queryVacancies | VERIFIED | Exports `runList` + `registerList`; calls `queryVacancies`; default limit 20; "No vacancies match" to stderr; DB closed in `finally` |
| `src/cli/export.ts` | registerExport action with queryVacancies | VERIFIED | Exports `runExport` + `registerExport`; JSON.stringify to stdout only; no default limit; DB closed in `finally` |
| `src/cli/ingest.ts` | registerIngest action with orchestrator + extractor + stats | VERIFIED | Exports `runIngest` + `registerIngest`; calls `ingestSources` + `extractPending`; all stat labels present; `--source` filter; `--since` via `parseDateValue`; per-source errors surfaced, exit 0; DB closed in `finally` |
| `src/cli/auth.ts` | registerAuth action with injectable login seam | VERIFIED | Exports `runAuth`, `LoginFn`, `gramjsLogin`; prints session + TELEGRAM_SESSION warning; no auto-persist; no api_id/api_hash echoed |
| `src/cli/options.ts` | Shared limit + date validation helpers | VERIFIED | `parseLimit` (rejects non-integer/negative), `parseDate` (YYYY-MM-DD regex + NaN guard), `parseDateValue`; used by all commands |
| `src/cli/list.test.ts` | Seeded-DB tests for list | VERIFIED | 10 tests covering rows, truncation, remote_type, default limit, source filter, empty→stderr, salary formatting, invalid input clean errors |
| `src/cli/export.test.ts` | Seeded-DB tests for export | VERIFIED | 8 tests covering JSON array, full fields, no secrets, invalid input, empty→`[]`, no default limit, stdout-only |
| `src/cli/ingest.test.ts` | Injected-deps tests for ingest | VERIFIED | 7 tests covering stats aggregation, --source narrowing, --since passthrough, per-source error exit 0, all labels, malformed --since clean error |
| `src/cli/auth.test.ts` | Non-interactive auth tests | VERIFIED | 4 tests covering success output, missing apiId/apiHash rejections, no-secrets assertion |
| `src/bin.test.ts` | Bin shim clean error test | VERIFIED | Spawns bin with missing config; asserts clean stderr message + non-zero exit + no stack trace |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `package.json bin` | `bin/hire-radar` | `"bin": { "hire-radar": "bin/hire-radar" }` | WIRED | Line 8 of package.json |
| `bin/hire-radar` | `src/cli/index.ts buildProgram` | `import { buildProgram } from '../src/cli/index.js'` | WIRED | Line 2 of bin shim |
| `src/cli/index.ts` | register* functions | Calls `registerIngest`, `registerList`, `registerExport`, `registerAuth` | WIRED | All four calls confirmed in index.ts |
| `src/cli/list.ts` | `queryVacancies` | `import { queryVacancies }` + `queryVacancies(deps.db, filters)` | WIRED | Lines 3 and 48 |
| `src/cli/export.ts` | `queryVacancies` | `import { queryVacancies }` + `queryVacancies(deps.db, filters)` | WIRED | Lines 3 and 29 |
| `src/cli/ingest.ts` | `ingestSources` + `extractPending` | Direct calls with deps | WIRED | Lines 27–28 |
| `src/cli/auth.ts` | gramjs StringSession login | `gramjsLogin` behind injectable `LoginFn` seam; `registerAuth` wires real login | WIRED | Lines 29–42, 44–57 |
| `auth` session output | Telegram adapter | `TELEGRAM_SESSION` env → `config.telegramSession` → `buildAdapters` → adapter `session` field | WIRED | `config.ts:46`, `registry.ts:19` |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|--------------|--------|--------------------|--------|
| `src/cli/list.ts runList` | `rows` | `queryVacancies` → `db.prepare(sql).all(...params)` on `vacancies` table | Yes — live SQLite query with parameterized filters | FLOWING |
| `src/cli/export.ts runExport` | `rows` | `queryVacancies` → same DB query | Yes | FLOWING |
| `src/cli/ingest.ts runIngest` | `sourceStats`, `ex` | `ingestSources` (real adapters) + `extractPending` (Claude API) | Yes — real pipeline execution | FLOWING |
| `src/extraction/pipeline.ts extractPending` | `stats.deduped` | `outcome.result.vacancies.length - insertVacancies(...)` return value | Yes — real INSERT OR IGNORE count delta | FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| All 52 phase tests pass | `npx vitest run src/db/vacancies.test.ts src/cli/index.test.ts src/cli/list.test.ts src/cli/export.test.ts src/cli/ingest.test.ts src/cli/auth.test.ts src/bin.test.ts` | 52 tests pass, 7 test files | PASS |
| TypeScript compiles cleanly | `npx tsc --noEmit` | Exit 0, no output | PASS |
| bin is executable | `test -x bin/hire-radar` | Exit 0 | PASS |
| package.json bin field present | `grep '"hire-radar": "bin/hire-radar"' package.json` | Line 8 matches | PASS |
| No SQL string interpolation of filter values | `grep -E '\$\{filters\.' src/db/vacancies.ts` | Only `kw` prefix/suffix construction (value bound via `?`, not concatenated into SQL) | PASS |
| No secrets in export path | `grep -niE "anthropicApiKey|telegramSession|apiKey|apiHash" src/cli/export.ts` | No matches | PASS |
| No auto-persist in auth | `grep -nE "writeFileSync|openDatabase|insert" src/cli/auth.ts` | No matches | PASS |

### Requirements Coverage

| Requirement | Source Plan(s) | Description | Status | Evidence |
|------------|---------------|-------------|--------|---------|
| CLI-01 | 04-02, 04-04 | `hire-radar ingest` fetches, extracts, persists with per-run stats | SATISFIED | `runIngest` wires `ingestSources` + `extractPending`; prints fetched/extracted/deduped/skipped/API calls; `ingest.test.ts` passes |
| CLI-02 | 04-01, 04-02, 04-03 | `hire-radar list` with filters (source, keyword, date range, limit) | SATISFIED | `runList` + `queryVacancies` with all filters; default limit 20; `list.test.ts` passes |
| CLI-03 | 04-01, 04-02, 04-03 | `hire-radar export` JSON array with same filters | SATISFIED | `runExport` + `queryVacancies`; stdout-only JSON; `export.test.ts` passes |
| CLI-04 | 04-02, 04-05 | One-time auth command produces persistent Telegram session | SATISFIED | `runAuth` prints session string with TELEGRAM_SESSION guidance; session consumed from env by adapter; `auth.test.ts` passes |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `src/db/vacancies.ts` | 42 | `'%' + filters.keyword + '%'` | Info | Not a SQL injection — value is bound via `?`. This is the `LIKE` wildcard wrapper; `kw` goes into `params`, not SQL string. Review explicitly confirmed clean (see 04-REVIEW.md). |

No blockers. The one Info item (`%` wildcard escaping for literal keyword searches) was intentionally left open (IN-01 in REVIEW.md) as out-of-scope for v1.

### Human Verification Required

None. All must-haves are verifiable programmatically and confirmed by test suite.

### Gaps Summary

No gaps. All four ROADMAP success criteria are satisfied:

1. `ingest` — full pipeline wired (orchestrator + extractor), real `deduped` count from `PipelineStats.deduped` (fixed in review), all stat labels present, per-source errors surface with exit 0, DB closed.
2. `list` — aligned column output, default limit 20, filters (source/keyword/date range) via shared `queryVacancies`, empty→stderr, invalid input exits cleanly.
3. `export` — valid JSON array to stdout only, no default limit, `[]` on empty, no secrets, pipeable.
4. `auth` — prints session string + TELEGRAM_SESSION guidance, interactive gramjs login isolated behind seam, session flows through env → config → adapter for subsequent ingest runs.

The bin shim catches errors and prints clean messages (WR-01 fix); DB is closed in every command (WR-03 fix); `--limit`/`--since`/`--until` validated with clean errors (CR-01, WR-04, WR-05 fixes from review).

---

_Verified: 2026-06-13T14:08:00Z_
_Verifier: Claude (gsd-verifier)_
