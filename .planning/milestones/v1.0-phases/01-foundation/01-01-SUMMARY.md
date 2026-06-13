---
phase: 01-foundation
plan: 01
subsystem: infra
tags: [node, typescript, vitest, esbuild, esm, better-sqlite3, zod, gramjs]

requires: []
provides:
  - ESM Node 22 TypeScript project with strict mode and bundler moduleResolution
  - vitest 4.1.8 wired for node-environment unit testing
  - directory skeleton matching ARCHITECTURE.md (bin/, src/adapters/, src/pipeline/, src/extraction/, src/db/, src/commands/, data/)
  - .gitignore excluding secrets (.env, *.db*) and build artifacts
  - config.example.json non-secret template (channels, hh filters, RSS feeds)
affects: [01-02, 01-03]

tech-stack:
  added:
    - typescript 5.7+
    - vitest 4.1.8
    - esbuild 0.24+
    - better-sqlite3 12.4.1
    - zod 4.4+
    - @anthropic-ai/sdk 0.102+
    - telegram (gramjs) 2.17.4
    - commander 15.0+
    - tsx 4.22.4
    - dotenv 16.4+
    - rss-parser 3.13+
  patterns:
    - ESM-first project (type: module, moduleResolution: bundler)
    - No tsconfig path aliases (tsx does not honor them)
    - Secrets in env vars only; non-secret config in config.example.json

key-files:
  created:
    - package.json
    - tsconfig.json
    - vitest.config.ts
    - .gitignore
    - config.example.json
    - src/index.ts
  modified: []

key-decisions:
  - "No tsconfig paths aliases: tsx 4.22.4 does not respect them without additional config"
  - "moduleResolution: bundler chosen over node16 per STACK.md constraint"
  - "data/.gitkeep not force-added: data/ is gitignored by design; directory exists on disk"

patterns-established:
  - "Secrets from env only; config.example.json holds only non-secret config (ARCHITECTURE.md Anti-Pattern 4)"

requirements-completed: [FNDN-01, FNDN-02, FNDN-03]

duration: 2min
completed: 2026-06-13
---

# Phase 1 Plan 01: Toolchain Bootstrap Summary

**Node 22 ESM TypeScript project with strict mode, vitest, esbuild, pinned STACK.md deps, and a .gitignore that keeps secrets and SQLite out of version control**

## Performance

- **Duration:** 2 min
- **Started:** 2026-06-13T01:16:44Z
- **Completed:** 2026-06-13T01:19:00Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments
- package.json with ESM type, Node >=22 engine constraint, and all pinned STACK.md dependency versions
- tsconfig.json with strict mode, bundler moduleResolution, no path aliases
- vitest.config.ts wired for node environment, zero-config ESM+TS test runs
- .gitignore preventing data/, .env, *.db* and build artifacts from being committed
- config.example.json with only non-secret keys (channels, hh filters, RSS feeds)
- Directory skeleton from ARCHITECTURE.md scaffolded on disk

## Task Commits

1. **Task 1: Create package.json, tsconfig.json, vitest.config.ts** - `ecea4db` (chore)
2. **Task 2: Create .gitignore, config.example.json, directory skeleton** - `047a59f` (feat)

## Files Created/Modified
- `package.json` - ESM project manifest with pinned deps and npm scripts
- `tsconfig.json` - Strict TypeScript for Node 22 ESM
- `vitest.config.ts` - Node-environment vitest config
- `package-lock.json` - Lockfile from npm install
- `.gitignore` - Excludes data/, .env, *.db*, dist/, node_modules/
- `config.example.json` - Non-secret config template
- `src/index.ts` - Minimal placeholder exporting APP_NAME

## Decisions Made
- No tsconfig `paths` aliases — tsx 4.22.4 does not honor them without extra config
- `moduleResolution: bundler` as specified in STACK.md constraints
- `data/.gitkeep` not force-added to git — directory exists on disk; its contents stay ignored as intended

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Created src/index.ts in Task 1 to unblock tsc verification**
- **Found during:** Task 1 verification
- **Issue:** `npx tsc --noEmit` fails with TS18003 "No inputs found" when src/ is empty; Task 1 verify step requires tsc to exit 0
- **Fix:** Created `src/index.ts` placeholder (content from Task 2 spec) early so tsc has a valid input file
- **Files modified:** src/index.ts
- **Verification:** `npx tsc --noEmit` exits 0
- **Committed in:** ecea4db (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Necessary to satisfy Task 1 verify step. src/index.ts content matches Task 2 spec exactly — no scope added.

## Issues Encountered
- `data/.gitkeep` cannot be staged because `data/` is in .gitignore — this is correct behavior per the plan note ("force-add is NOT needed"). Directory exists on disk for downstream plans.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Toolchain fully operational: npm install, tsc --noEmit, vitest run all exit 0
- Directory skeleton matches ARCHITECTURE.md for downstream DB, hash, config, and adapter plans
- All blockers from plan are resolved
