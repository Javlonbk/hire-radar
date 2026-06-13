---
phase: 01-foundation
verified: 2026-06-13T06:49:30Z
status: passed
score: 10/10
overrides_applied: 0
re_verification: null
gaps: []
deferred: []
human_verification: []
---

# Phase 1: Foundation — Verification Report

**Phase Goal:** The database, config, and hash utilities exist and are correct so every other layer can build on them
**Verified:** 2026-06-13T06:49:30Z
**Status:** passed
**Re-verification:** No — initial verification (post-review HEAD state)

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Running the project initializes a SQLite file with the correct 4-table schema (sources, raw_items, extraction_cache, vacancies) in WAL mode | VERIFIED | schema.sql has exactly 4 `CREATE TABLE IF NOT EXISTS` tables; client.ts sets `journal_mode = WAL`; `client.test.ts` tests WAL mode and all 4 tables — 8 tests pass |
| 2 | User can supply Telegram credentials, channel whitelist, hh.uz filters, RSS URLs, and Anthropic API key via config file or env vars without touching source code; missing required values produce an actionable error | VERIFIED | `loadConfig()` merges file (non-secrets) + env (secrets); Zod 4 safeParse validates; error message names the missing env var and points to `.env file` or `config.json` appropriately — 11 config tests pass |
| 3 | Identical Uzbek text variants (uz-Latn vs uz-Cyrl homoglyphs, mixed case) produce the same SHA-256 content hash | VERIFIED | `normalize()` applies NFC then folds 12 Cyrillic confusables (including uppercase-only К М Т Н В) to Latin before lowercase; `contentHash('cope') === contentHash('соре')` test passes — 10 hash tests pass |
| 4 | Running `npm install` installs the verified stack without errors | VERIFIED | `package.json` has `"type": "module"`, all STACK.md pinned deps present; node_modules installed |
| 5 | Running `npx tsc --noEmit` type-checks with strict mode and zero errors | VERIFIED | `tsc --noEmit` exits 0; tsconfig.json has `"strict": true`, `"moduleResolution": "bundler"`, no paths aliases |
| 6 | Running `npx vitest run` discovers and runs tests (zero tests = pass) | VERIFIED | `vitest run` exits 0, 29 tests across 3 test files all pass |
| 7 | data/ directory and .env are git-ignored so the DB file and secrets are never committed | VERIFIED | `.gitignore` has `data/` (exact line), `.env`, `.env.*`, `*.db`, `*.db-shm`, `*.db-wal` |
| 8 | Opening the database creates missing parent directories and runs schema idempotently | VERIFIED | `openDatabase()` calls `mkdirSync(dirname(path), { recursive: true })` before opening; re-open test passes |
| 9 | A missing required secret (ANTHROPIC_API_KEY) produces an actionable error naming the missing variable | VERIFIED | `loadConfig()` throws `Missing or invalid config: ANTHROPIC_API_KEY — set it in your .env file`; tested by `config.test.ts` |
| 10 | Secrets come from env only — config file cannot override env-sourced values | VERIFIED | `merged` object always reads secrets from `opts.env`, ignoring any matching fields in the JSON file; config.test.ts test "ignores anthropicApiKey field in config file" passes |

**Score:** 10/10 truths verified

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `package.json` | ESM project manifest with pinned dependencies and scripts | VERIFIED | `"type": "module"`, all STACK.md deps present, correct npm scripts |
| `tsconfig.json` | Strict TypeScript config for Node 22 ESM | VERIFIED | `"strict": true`, `"moduleResolution": "bundler"`, no path aliases |
| `vitest.config.ts` | Node-environment vitest config | VERIFIED | `environment: 'node'`, `include: ['src/**/*.test.ts']` |
| `.gitignore` | Ignores secrets, DB, build artifacts | VERIFIED | `data/`, `.env`, `*.db`, `*.db-shm`, `*.db-wal`, `dist/`, `node_modules/` all present |
| `config.example.json` | Non-secret config template | VERIFIED | Contains `channels`, `hh`, `rss.feeds`; no `ANTHROPIC` or `TELEGRAM` keys |
| `src/db/schema.sql` | DDL for 4-table schema with indexes and UNIQUE constraints | VERIFIED | 52 lines; 4 `CREATE TABLE IF NOT EXISTS`; 2 `UNIQUE(content_hash)`; 4 `CREATE INDEX IF NOT EXISTS`; no PRAGMA |
| `src/db/client.ts` | better-sqlite3 init with WAL + busy_timeout + schema runner + tx helper | VERIFIED | Exports `openDatabase`, `DEFAULT_DB_PATH`, `runInTransaction`; sets WAL + busy_timeout; loads schema.sql via import.meta.url |
| `src/db/client.test.ts` | Verifies WAL mode, 4 tables, UNIQUE dedup, tx rollback | VERIFIED | 8 tests: WAL, busy_timeout, all 4 tables, dir creation, idempotent reopen, UNIQUE dedup, tx commit, tx rollback |
| `src/hash.ts` | normalize() + contentHash() utilities | VERIFIED | Exports `normalize` and `contentHash`; applies NFC + Cyrillic fold (12 entries) + trim/collapse + lowercase + SHA-256 |
| `src/hash.test.ts` | Tests proving homoglyph/case/whitespace variants hash identically | VERIFIED | 10 tests; includes explicit Cyrillic-vs-Latin equality test (`'cope' === 'соре'`) and uppercase-only test (`'КОТ' === 'KOT'`) |
| `src/config.ts` | Zod-validated config loader merging env secrets + JSON non-secrets | VERIFIED | Exports `loadConfig` and `Config` type; Zod 4 safeParse; actionable error with env var name; no dotenv inside |
| `src/config.test.ts` | Tests for valid load, missing-secret error, file+env merge | VERIFIED | 11 tests covering all five plan behavior cases plus post-review additions (TELEGRAM_API_ID validation, missing file, malformed JSON, non-object JSON) |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `src/db/client.ts` | `src/db/schema.sql` | `fileURLToPath(new URL('./schema.sql', import.meta.url))` + `readFileSync` + `db.exec` | WIRED | Line 13-15: schema path resolved relative to module, read, and executed on init |
| `src/db/client.ts` | SQLite PRAGMA (WAL + busy_timeout) | `db.pragma('journal_mode = WAL')` + `db.pragma('busy_timeout = 10000')` | WIRED | Lines 11-12: both pragmas set before schema exec |
| `src/config.ts` | `process.env` + config file | Zod `safeParse` on merged object; `ENV_VAR_NAMES` for actionable errors | WIRED | `merged` object built from both sources; parsed; error path translates camelCase keys to env var names |
| `src/hash.ts` | `node:crypto` | `createHash('sha256').update(normalize(text), 'utf8').digest('hex')` | WIRED | Line 1 imports `createHash`; line 25 uses it over `normalize(text)` |

---

### Data-Flow Trace (Level 4)

Not applicable — this phase produces pure utility functions and database infrastructure, not components rendering dynamic data. No data-flow trace required.

---

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| All 29 tests pass (hash, config, DB client) | `npx vitest run` | 3 files, 29 tests, 0 failures | PASS |
| TypeScript strict mode compiles with zero errors | `npx tsc --noEmit` | exits 0, no output | PASS |
| schema.sql has exactly 4 tables | `grep -c 'CREATE TABLE IF NOT EXISTS' src/db/schema.sql` | 4 | PASS |
| schema.sql has 2 UNIQUE content_hash constraints | `grep -c 'UNIQUE(content_hash)' src/db/schema.sql` | 2 | PASS |
| schema.sql has 4 indexes | `grep -c 'CREATE INDEX IF NOT EXISTS' src/db/schema.sql` | 4 | PASS |
| No PRAGMA in schema.sql | `grep -q 'PRAGMA' src/db/schema.sql` | not found | PASS |
| No secrets in config.example.json | `grep -q 'ANTHROPIC\|TELEGRAM' config.example.json` | not found | PASS |

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|---------|
| FNDN-01 | 01-02-PLAN.md | SQLite DB (WAL mode) with 4-table schema and raw payload retention | SATISFIED | `schema.sql` has all 4 tables with `raw_json` column; `client.ts` sets WAL; 8 tests pass |
| FNDN-02 | 01-03-PLAN.md | User configures credentials via config file/env; missing values produce actionable errors | SATISFIED | `loadConfig()` merges file+env; Zod validates; error names the missing var with fix hint; 11 tests pass |
| FNDN-03 | 01-03-PLAN.md | Content hashing normalizes NFC + trim + lowercase; Cyrillic/Latin homoglyph variants hash identically | SATISFIED | `normalize()` folds 12 Cyrillic confusables; `contentHash('cope') === contentHash('соре')`; 10 tests pass |

All 3 requirement IDs claimed by Phase 1 plans are fully satisfied. No orphaned requirements found.

---

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `.gitignore` | 9 | `!.env.example` exempts a file that does not exist in the repo | Info | No functional impact; dead negation; creates expectation for a file that is absent |
| `src/config.ts` | 60 | Validation error reports only the first Zod issue | Info | User with multiple missing settings fixes one per run; does not block goal |

Note: Both anti-patterns were flagged as INFO (not blockers) in 01-REVIEW.md (IN-03, IN-04) and were explicitly not fixed. Neither affects Phase 1 goal achievement.

---

### Human Verification Required

None. All success criteria are verifiable programmatically. The test suite covers all behavioral requirements including edge cases (missing secrets, file-sourced secret ignored, invalid field types, WAL mode, UNIQUE dedup, transaction rollback, homoglyph hashing).

---

## Gaps Summary

No gaps. All 10 observable truths verified, all artifacts substantive and wired, all 3 requirement IDs satisfied, 29 tests passing, `tsc --noEmit` exits 0.

The post-review fix cycle (01-REVIEW.md) addressed all critical and warning findings before this verification:
- CR-01: build script now uses `--format=esm --external:better-sqlite3` and copies schema.sql to dist/
- WR-01: `openDatabase()` creates parent directories with `mkdirSync`
- WR-02: error hint correctly differentiates `.env file` vs `config file` by field origin
- WR-03: missing/malformed/non-object config file produces actionable errors
- WR-04: `TELEGRAM_API_ID` rejects empty string and non-positive integers

Two INFO-level items remain by explicit design decision (IN-03 single-issue error, IN-04 missing .env.example) and do not block phase goal achievement.

---

_Verified: 2026-06-13T06:49:30Z_
_Verifier: Claude (gsd-verifier)_
