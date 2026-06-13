---
phase: 01-foundation
reviewed: 2026-06-13T01:36:52Z
depth: standard
files_reviewed: 13
files_reviewed_list:
  - .gitignore
  - config.example.json
  - package.json
  - src/config.test.ts
  - src/config.ts
  - src/db/client.test.ts
  - src/db/client.ts
  - src/db/schema.sql
  - src/hash.test.ts
  - src/hash.ts
  - src/index.ts
  - tsconfig.json
  - vitest.config.ts
findings:
  critical: 0
  warning: 0
  info: 3
fixed:
  - CR-01
  - WR-01
  - WR-02
  - WR-03
  - WR-04
  - IN-02
fixed_at: 2026-06-13T06:45:00Z
status: issues_found
---

# Phase 1: Code Review Report

**Reviewed:** 2026-06-13T01:36:52Z
**Depth:** standard
**Files Reviewed:** 13
**Status:** issues_found

## Summary

Reviewed the foundation phase: config loading (Zod-validated env + file merge), SQLite client with WAL/transactions, schema, content-hash normalization with Cyrillic homoglyph folding, and project scaffolding. Typecheck passes and all 21 tests pass. No injection, secret-leak, or auth issues found; secrets are correctly env-only and the config file cannot override `anthropicApiKey` (verified by test).

The standout defect is the production build pipeline: the esbuild bundle as configured cannot ever run the database layer — verified empirically by bundling `src/db/client.ts` and executing it (crashes). Several config error paths produce misleading or raw errors, and the default DB path fails on a fresh clone because `.gitignore` swallows `data/.gitkeep`.

All findings below were reproduced by execution, not just read.

## Critical Issues

### CR-01: Production bundle crashes on any database use — three compounding build defects

**File:** `package.json:9`, `src/db/client.ts:8-13`
**Status:** fixed — `--format=esm --external:better-sqlite3` + copy `schema.sql` to `dist/` (86641c5)
**Issue:** The build script `esbuild src/index.ts --bundle --platform=node --target=node22 --outfile=dist/hire-radar.js` produces a bundle in which `openDatabase` cannot work, for three independent reasons:

1. **Native module bundled.** `better-sqlite3` is a native addon; esbuild inlines its JS loader, which then resolves `better_sqlite3.node` relative to the bundle's location and fails. Verified: bundling `client.ts` and calling `openDatabase(':memory:')` crashes with `Could not locate the bindings file`.
2. **`import.meta.url` is empty in CJS output.** esbuild defaults to CJS for `--platform=node` and emits the warning `"import.meta" is not available with the "cjs" output format and will be empty`. `client.ts:11` then evaluates `new URL('./schema.sql', undefined)`, which throws.
3. **`schema.sql` is not shipped.** Even with ESM output, the runtime `readFileSync` of `./schema.sql` resolves next to `dist/hire-radar.js`, where no schema file exists.

It only goes unnoticed because `src/index.ts` is currently a stub that imports nothing. The moment the CLI wires in the DB (next phase), `npm run build` produces a broken artifact.

**Fix:**
```jsonc
// package.json — externalize the native module and emit ESM
"build": "esbuild src/index.ts --bundle --platform=node --format=esm --target=node22 --external:better-sqlite3 --loader:.sql=text --outfile=dist/hire-radar.js"
```
```ts
// src/db/client.ts — import the schema so it is embedded in the bundle
import schemaSql from './schema.sql';
// ...
db.exec(schemaSql);
```
(With `--loader:.sql=text` the schema is inlined as a string; add a `declare module '*.sql'` ambient type. Alternative: move the schema into a TS string constant and delete the file read entirely.) Note `--external:better-sqlite3` means `dist/` is not standalone — `node_modules/better-sqlite3` must be present at runtime; document or switch to an install-based distribution.

## Warnings

### WR-01: `openDatabase` with the default path crashes on a fresh clone — `.gitignore` swallows `data/.gitkeep`

**File:** `src/db/client.ts:5-8`, `.gitignore:3`
**Status:** fixed — `openDatabase` now creates parent directories (9fe5075)
**Issue:** `DEFAULT_DB_PATH = 'data/hire-radar.db'` requires `data/` to exist; better-sqlite3 does not create parent directories. Verified: `openDatabase('/tmp/no-such-dir/x.db')` throws `Cannot open database because the directory does not exist`. The repo contains `data/.gitkeep`, but `.gitignore` line 3 ignores the entire `data/` directory, so `.gitkeep` will never be tracked once the repo is initialized — every fresh clone lacks `data/` and the default-path open crashes.
**Fix:**
```ts
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export function openDatabase(path: string = DEFAULT_DB_PATH): Database.Database {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  ...
```
This also makes the `.gitkeep` workaround unnecessary. (If keeping `.gitkeep` instead, change `.gitignore` to `data/*` + `!data/.gitkeep`.)

### WR-02: Misleading error message directs users to `.env` for config-file fields

**File:** `src/config.ts:53`
**Status:** fixed — `.env` hint only for env-sourced fields, config-file fields point at the config path (09e898e)
**Issue:** The single error template appends `— set it in your .env file` to every validation failure, including fields that live in `config.json`. Verified: invalid `hh.perPage` produces `Missing or invalid config: hh.perPage — set it in your .env file`, sending the user to the wrong file.
**Fix:** Only append the `.env` hint when the failing field is in `ENV_VAR_NAMES`:
```ts
const envVar = ENV_VAR_NAMES[fieldKey];
const displayName = envVar ?? first.path.join('.');
const hint = envVar ? ' — set it in your .env file' : ` — check ${configPath}`;
throw new Error(`Missing or invalid config: ${displayName}${hint}`);
```

### WR-03: Unhandled config-file edge cases produce raw crashes instead of actionable errors

**File:** `src/config.ts:28-29, 36-38`
**Status:** fixed — missing/malformed/non-object config file now throws actionable errors (6f29097)
**Issue:** Two verified failure modes bypass the careful Zod error handling:
- Missing `config.json` → raw `ENOENT: no such file or directory, open 'config.json'` (no hint to copy `config.example.json`).
- `config.json` containing a non-object (e.g. `null`, a string, an array) → `TypeError: Cannot read properties of null (reading 'telegram')` at line 36, before validation runs. `JSON.parse` is also uncaught, so malformed JSON yields a bare `SyntaxError`.
**Fix:**
```ts
let fileData: unknown;
try {
  fileData = JSON.parse(readFileSync(configPath, 'utf8'));
} catch (err) {
  throw new Error(`Cannot read config file ${configPath} (copy config.example.json to get started): ${err instanceof Error ? err.message : err}`);
}
if (typeof fileData !== 'object' || fileData === null) {
  throw new Error(`Config file ${configPath} must contain a JSON object`);
}
const file = fileData as Record<string, unknown>;
```

### WR-04: Empty-string `TELEGRAM_API_ID` silently coerces to `0`

**File:** `src/config.ts:6, 33`
**Status:** fixed — schema tightened to `.int().positive()`; `''` now fails with an error naming TELEGRAM_API_ID instead of coercing to 0 (3a3cbbc)
**Issue:** `z.coerce.number().optional()` turns `TELEGRAM_API_ID=''` (a common state in `.env` templates) into `0` instead of rejecting or treating it as absent. Verified: `loadConfig` with `TELEGRAM_API_ID: ''` returns `telegramApiId: 0`. A `0` API id passes validation here and fails later inside the Telegram client with an unrelated error, defeating the fail-fast purpose of this module.
**Fix:** Normalize empty strings to `undefined` before parsing, and require a positive integer:
```ts
telegramApiId: z.coerce.number().int().positive().optional(),
// ...
telegramApiId: env['TELEGRAM_API_ID'] || undefined,
```

## Info

### IN-01: No foreign-key constraints and `foreign_keys` pragma not enabled

**File:** `src/db/schema.sql:11, 33-34`; `src/db/client.ts:9-10`
**Issue:** `raw_items.source_id`, `vacancies.source_id`, and `vacancies.raw_item_id` reference other tables but declare no `FOREIGN KEY` constraints, and `openDatabase` never sets `PRAGMA foreign_keys = ON` (off by default in SQLite). Orphaned rows are possible with no integrity backstop.
**Fix:** If referential integrity is intended, add `REFERENCES sources(id)` / `REFERENCES raw_items(id)` and `db.pragma('foreign_keys = ON')`. If sources are config-defined rather than DB rows, leave as is — but decide explicitly.

### IN-02: Homoglyph fold map misses uppercase-only Cyrillic confusables

**File:** `src/hash.ts:5-13`
**Status:** fixed — К М Т Н В added to fold map with regression test (59f414d)
**Issue:** The map covers the seven both-case homoglyph pairs but lowercasing happens after folding, so uppercase-only confusables — Cyrillic К, М, Т, Н, В (visually identical to Latin K, M, T, H, B) — are missed: `КОТ` and `KOT` hash differently despite being indistinguishable on screen. This weakens dedup for shouted/uppercase post titles, common in Telegram job channels.
**Fix:** Add `'К': 'K', 'М': 'M', 'Т': 'T', 'Н': 'H', 'В': 'B'` (and optionally Ukrainian `і`/`І` → `i`/`I`) to `CYRILLIC_TO_LATIN`.

### IN-03: Validation error reports only the first issue

**File:** `src/config.ts:50-53`
**Issue:** `result.error.issues[0]` discards all but one issue, so a user with three missing settings fixes them one run at a time.
**Fix:** Map all issues into the message, e.g. `result.error.issues.map(...).join('; ')`.

### IN-04: `.gitignore` whitelists a `.env.example` that does not exist

**File:** `.gitignore:9`
**Issue:** Line 9 (`!.env.example`) exempts a file that is absent from the repo, while error messages (config.ts:53) direct users to "your .env file" with no template documenting `ANTHROPIC_API_KEY`, `TELEGRAM_API_ID`, `TELEGRAM_API_HASH`, `TELEGRAM_SESSION`.
**Fix:** Add a `.env.example` listing the four variables with placeholder values, or drop the dead negation.

---

_Reviewed: 2026-06-13T01:36:52Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
