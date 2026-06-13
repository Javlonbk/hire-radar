---
phase: 04-cli-commands
plan: "02"
subsystem: cli
tags: [commander, bin, cli-scaffold, contract, tsx]

requires:
  - phase: 04-cli-commands/04-01
    provides: [queryVacancies — powers list+export commands in later plans]
provides:
  - bin/hire-radar tsx shim (executable, maps to hire-radar CLI)
  - package.json bin field mapping hire-radar command
  - buildProgram() in src/cli/index.ts wiring all four register* functions
  - registerIngest/registerList/registerExport/registerAuth contract stubs
affects: [04-03-list-export, 04-04-ingest, 04-05-auth]

tech-stack:
  added: []
  patterns: [register*(program) contract — each command file owns one function that mounts its subcommand onto the shared commander program]

key-files:
  created:
    - bin/hire-radar
    - src/cli/index.ts
    - src/cli/ingest.ts
    - src/cli/list.ts
    - src/cli/export.ts
    - src/cli/auth.ts
    - src/cli/index.test.ts
  modified:
    - package.json

key-decisions:
  - "bin shim uses '#!/usr/bin/env -S npx tsx' hashbang — runs TS source directly, no build step needed for npm link"
  - "register*(program) contract: each command file exports exactly one function that attaches its subcommand to the commander program — downstream plans replace only the action body"
  - "stubs throw 'not yet implemented' rather than silently no-op — satisfies T-04-04 threat mitigation"

patterns-established:
  - "register*(program): Command pattern — one file per command, one exported function, commander program threaded through"
  - "ESM .js import extensions in src/cli/*.ts for tsx + moduleResolution: bundler compatibility"

requirements-completed: [CLI-01, CLI-02, CLI-03, CLI-04]

duration: 5min
completed: 2026-06-13
---

# Phase 4 Plan 02: CLI Scaffold Summary

**Commander program (buildProgram) wiring four register* contract stubs (ingest/list/export/auth) behind a tsx bin shim — `hire-radar --help` lists all four subcommands.**

## Performance

- **Duration:** 5 min
- **Started:** 2026-06-13T08:33:00Z
- **Completed:** 2026-06-13T08:35:29Z
- **Tasks:** 2
- **Files modified:** 8

## Accomplishments

- `bin/hire-radar` tsx shim with hashbang; `package.json` bin field mapping `hire-radar` to the shim
- `src/cli/index.ts` `buildProgram()` that wires all four register* functions onto a commander program named `hire-radar`
- Four contract stub files (`ingest/list/export/auth`) each exporting their `register*` function with correct flags and `throw new Error('... not yet implemented')` action bodies
- `src/cli/index.test.ts` vitest suite asserting program name and all four subcommand names — 2/2 pass

## Task Commits

1. **Task 1: bin shim + package.json bin mapping** - `acfbcd2` (feat)
2. **Task 2: commander program + four register* contract stubs** - `4c2dff1` (feat)

**Plan metadata:** (docs commit follows)

## Files Created/Modified

- `bin/hire-radar` - Executable tsx hashbang shim that calls `buildProgram().parseAsync(process.argv)`
- `package.json` - Added `bin` field mapping `hire-radar` to `bin/hire-radar`
- `src/cli/index.ts` - `buildProgram()` assembling the four commands via register* imports
- `src/cli/ingest.ts` - `registerIngest` stub with `--source` and `--since` flags
- `src/cli/list.ts` - `registerList` stub with filter flags; `--limit` default `'20'`
- `src/cli/export.ts` - `registerExport` stub with filter flags; no limit default (export everything)
- `src/cli/auth.ts` - `registerAuth` stub for one-time Telegram login
- `src/cli/index.test.ts` - Vitest assertions on program name and subcommand registration

## Decisions Made

- `#!/usr/bin/env -S npx tsx` hashbang: runs TS source directly via tsx with no compile step, matching the plan spec.
- Stubs throw `'not yet implemented'` to satisfy T-04-04 (no silent no-op on unfilled commands).
- ESM `.js` import extensions in all `src/cli/*.ts` imports per project convention.

## Deviations from Plan

None — plan executed exactly as written.

## Issues Encountered

None.

## Known Stubs

| File | Line | Stub | Reason |
|------|------|------|--------|
| src/cli/ingest.ts | action | throws "ingest not yet implemented" | intentional — Plan 04-04 replaces action body |
| src/cli/list.ts | action | throws "list not yet implemented" | intentional — Plan 04-03 replaces action body |
| src/cli/export.ts | action | throws "export not yet implemented" | intentional — Plan 04-03 replaces action body |
| src/cli/auth.ts | action | throws "auth not yet implemented" | intentional — Plan 04-05 replaces action body |

These stubs are the explicit goal of this plan; downstream plans replace them.

## Threat Flags

No new security surface beyond the plan's threat model. T-04-04 mitigation applied: all four command stubs throw rather than silently succeed.

## Next Phase Readiness

- `hire-radar --help` lists all four subcommands
- register* contract is fixed; Plans 04-03/04-04/04-05 can implement against it without touching `src/cli/index.ts`
- `npx tsc --noEmit` exits 0
- All vitest tests pass (2/2 in `src/cli/index.test.ts`)

## Self-Check: PASSED

- `bin/hire-radar` exists and is executable
- `package.json` bin field maps `hire-radar` to `bin/hire-radar`
- `src/cli/index.ts` exports `buildProgram`
- All four register* stubs exist with correct exports
- Commit `acfbcd2` present (Task 1)
- Commit `4c2dff1` present (Task 2)
- `npx vitest run src/cli/index.test.ts` — 2/2 pass
- `npx tsx bin/hire-radar --help` — lists ingest, list, export, auth
- `npx tsc --noEmit` — exits 0

---
*Phase: 04-cli-commands*
*Completed: 2026-06-13*
