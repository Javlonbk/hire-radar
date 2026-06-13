---
phase: 01-foundation
plan: 03
subsystem: utilities
tags: [hash, config, zod, sha256, normalization, homoglyph, tdd]

requires:
  - 01-01 (toolchain bootstrap — package.json, tsconfig, vitest)
provides:
  - normalize() + contentHash() with Cyrillic/Latin homoglyph folding (src/hash.ts)
  - Zod-validated loadConfig() merging env secrets + JSON non-secrets (src/config.ts)
affects:
  - src/db/raw-items.ts (uses contentHash for dedup)
  - src/db/extraction-cache.ts (cache key is contentHash)
  - src/db/vacancies.ts (vacancy-level dedup uses normalize + contentHash)
  - bin/hire-radar.ts (calls loadConfig at startup)

tech-stack:
  added:
    - node:crypto (createHash sha256 — stdlib, no new dep)
  patterns:
    - Cyrillic confusable fold map applied before NFC + trim + lowercase
    - loadConfig env injection for pure/testable config loading
    - Zod 4 safeParse with actionable error mapping (env var name in message)

key-files:
  created:
    - src/hash.ts
    - src/hash.test.ts
    - src/config.ts
    - src/config.test.ts
  modified: []

key-decisions:
  - "Cyrillic fold map: р→p (not r) — р is the confusable for Latin p; test pairs must match actual map entries"
  - "ENV_VAR_NAMES lookup in loadConfig error path: Zod reports camelCase field names; error message must show original env var (ANTHROPIC_API_KEY, not anthropicApiKey)"
  - "loadConfig has no dotenv call — env is injected by caller; keeps function pure and testable"

metrics:
  duration: 3min
  completed: "2026-06-13T01:30:53Z"
  started: "2026-06-13T01:27:52Z"
  tasks: 2
  files: 4
---

# Phase 1 Plan 03: hash.ts + config.ts Utilities Summary

**SHA-256 content hashing with Cyrillic/Latin homoglyph folding and Zod 4 config loader merging env secrets with JSON non-secrets**

## Performance

- **Duration:** 3 min
- **Started:** 2026-06-13T01:27:52Z
- **Completed:** 2026-06-13T01:30:53Z
- **Tasks:** 2
- **Files created:** 4

## Accomplishments

- `normalize()`: applies NFC → Cyrillic confusable fold (а/е/о/р/с/у/х → a/e/o/p/c/y/x and uppercase) → trim/collapse whitespace → lowercase
- `contentHash()`: SHA-256 hex digest of `normalize(text)` via `node:crypto`
- `loadConfig()`: reads JSON config file for non-secrets, reads ANTHROPIC_API_KEY + TELEGRAM_* from injected env, validates with Zod 4 `safeParse`, throws actionable error naming the missing env var
- 14 tests pass across both files: 9 hash tests + 5 config tests

## Task Commits

1. **Task 1 RED: failing tests for normalize() + contentHash()** — `8fb5873`
2. **Task 1 GREEN: implement hash.ts** — `ca737da`
3. **Task 2 RED: failing tests for loadConfig()** — `82fdc68`
4. **Task 2 GREEN: implement config.ts** — `e008dd2`

## Files Created

- `src/hash.ts` — normalize() + contentHash() exports
- `src/hash.test.ts` — 9 tests covering whitespace, NFC, homoglyph fold, 64-char hex, case/whitespace insensitivity, two-strings differ
- `src/config.ts` — loadConfig() + Config type export, Zod 4 schema, no dotenv
- `src/config.test.ts` — 5 tests: valid load, missing secret error, file-secret ignored, optional session, invalid perPage type

## TDD Gate Compliance

| Gate | Commit | Status |
|------|--------|--------|
| Task 1 RED | 8fb5873 | test(01-03) — failing before hash.ts existed |
| Task 1 GREEN | ca737da | feat(01-03) — all 9 tests pass |
| Task 2 RED | 82fdc68 | test(01-03) — failing before config.ts existed |
| Task 2 GREEN | e008dd2 | feat(01-03) — all 5 tests pass |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Corrected Cyrillic fold test pair: 'рос' != 'roc' (р→p, not r)**
- **Found during:** Task 1 GREEN first run
- **Issue:** Initial test used `cyrillicRos === 'roc'` but the fold map maps р→p, not р→r; test was wrong
- **Fix:** Changed assertion to `cyrillicRos === 'poc'` — matches the actual confusable mapping
- **Files modified:** src/hash.test.ts
- **Commit:** ca737da

**2. [Rule 1 - Bug] Error message used camelCase field name, not env var name**
- **Found during:** Task 2 GREEN first run
- **Issue:** Zod reports `anthropicApiKey` as the failing path; tests assert the message contains `ANTHROPIC_API_KEY`
- **Fix:** Added `ENV_VAR_NAMES` lookup map in the error path to translate camelCase schema keys back to original env var names
- **Files modified:** src/config.ts
- **Commit:** e008dd2 (included in GREEN commit after iterating)

## Known Stubs

None — both utilities are fully implemented with no hardcoded placeholders.

## Threat Flags

None — no new network endpoints, auth paths, or trust boundaries introduced. Config loader reads from env and local filesystem only; secrets stay env-only per T-01-07 mitigation.

## Self-Check: PASSED

- `src/hash.ts` exists: FOUND
- `src/hash.test.ts` exists: FOUND
- `src/config.ts` exists: FOUND
- `src/config.test.ts` exists: FOUND
- Commit 8fb5873 (RED hash): FOUND
- Commit ca737da (GREEN hash): FOUND
- Commit 82fdc68 (RED config): FOUND
- Commit e008dd2 (GREEN config): FOUND
- `npx vitest run src/hash.test.ts src/config.test.ts`: 14/14 passed
- `npx tsc --noEmit`: exits 0
