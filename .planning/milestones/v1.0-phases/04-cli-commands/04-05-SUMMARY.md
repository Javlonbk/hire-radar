---
phase: 04-cli-commands
plan: "05"
subsystem: auth
tags: [cli, auth, gramjs, telegram, session, credential, seam, tdd]

requires:
  - phase: 04-cli-commands/04-02
    provides: [registerAuth stub in src/cli/auth.ts, commander program wiring]
  - phase: 02-source-adapters
    provides: [TelegramClient + StringSession gramjs usage pattern in src/adapters/telegram.ts]

provides:
  - runAuth(deps) — injectable-deps auth function: validates creds, calls login seam, prints session with TELEGRAM_SESSION guidance
  - LoginFn type and AuthDeps interface — seam types for test injection
  - gramjsLogin — real TelegramClient.start() interactive login behind the seam
  - registerAuth fully wired: loadConfig + runAuth + gramjsLogin

affects: []

tech-stack:
  added: []
  patterns:
    - "Injectable login seam (LoginFn) isolates interactive gramjs login from testable config-load + session-print logic"
    - "prompts on stderr, session string to stdout — keeps stdout clean and pipeable"
    - "runAuth throws before calling login when creds missing — T-04-13 spoofing mitigation"

key-files:
  created:
    - src/cli/auth.test.ts
  modified:
    - src/cli/auth.ts

key-decisions:
  - "LoginFn seam injected into AuthDeps so the 4 testable behaviors (session print, missing creds error, no-secrets, login-not-called) are covered without a live Telegram login"
  - "readline prompts use process.stderr output stream — keeps stdout exclusively for the session string, which is the machine-readable output users redirect"
  - "runAuth throws Error (not process.exit) on missing creds — commander's action handler propagates it, exiting non-zero via standard commander error handling"
  - "session string printed exactly once between out('') blank lines with a WARNING: never commit line — T-04-11 mitigation"

patterns-established:
  - "Auth seam pattern: real network login isolated behind LoginFn for unit-testability of surrounding logic"

requirements-completed: [CLI-04]

duration: 5min
completed: 2026-06-13
---

# Phase 4 Plan 05: Auth Command Summary

**gramjs interactive Telegram login isolated behind a LoginFn seam — runAuth validates creds, calls seam, prints session string once with TELEGRAM_SESSION store-as warning; never auto-persists; 4/4 unit tests without a live login.**

## Performance

- **Duration:** 5 min
- **Started:** 2026-06-13T13:47:00Z
- **Completed:** 2026-06-13T13:48:00Z
- **Tasks:** 1 (TDD: RED + GREEN commits)
- **Files modified:** 2

## Accomplishments

- `runAuth(deps)` with `AuthDeps` / `LoginFn` seam: throws on missing creds before touching login, prints session exactly once surrounded by TELEGRAM_SESSION guidance and WARNING never-commit line
- `gramjsLogin` real implementation: `TelegramClient.start()` with readline on stderr + `client.session.save()` string returned
- `registerAuth` action wired: `loadConfig({ env: process.env })` → `runAuth` + `gramjsLogin`
- 4 unit tests: session+guidance printed, missing-apiId rejects with /TELEGRAM_API_ID/, missing-apiHash rejects, no api_id/api_hash in output

## Task Commits

1. **Task 1 RED: failing tests for runAuth** — `8856776` (test)
2. **Task 1 GREEN: implement runAuth + gramjsLogin + registerAuth** — `986211c` (feat)

**Plan metadata:** (docs commit follows)

## Files Created/Modified

- `src/cli/auth.ts` — Full implementation: LoginFn/AuthDeps types, runAuth, gramjsLogin, registerAuth
- `src/cli/auth.test.ts` — 4 unit tests covering the non-interactive testable surface

## Decisions Made

- `LoginFn` injected via `AuthDeps` (not a module-level mock) — clean seam, no monkey-patching needed in tests
- `readline` output goes to `process.stderr` to keep stdout exclusively for the session string — matches the export pattern established in plan 04-03
- `runAuth` throws rather than calling `process.exit` — commander action handler handles the error consistently with other commands

## Deviations from Plan

None — plan executed exactly as written.

## Issues Encountered

None.

## Known Stubs

None — all functionality fully implemented.

## Threat Flags

No new security surface beyond the plan's threat model. All three threat mitigations applied:
- T-04-11: Session printed once with WARNING never-commit guidance; no writeFileSync/db calls (grep gate confirmed)
- T-04-12: api_id/api_hash never reach out() stream; prompts on stderr (grep gate + test confirmed)
- T-04-13: runAuth throws before calling login when creds missing; test asserts login spy never called

## Self-Check: PASSED

- `grep -n "export async function runAuth" src/cli/auth.ts` — line 16: matches
- `grep -n "export type LoginFn" src/cli/auth.ts` — line 7: matches
- `grep -n "TELEGRAM_SESSION" src/cli/auth.ts` — lines 22, 26, 47: matches
- `grep -niE "WARNING|never commit" src/cli/auth.ts` — line 26: matches
- `grep -nE "writeFileSync|openDatabase|insert" src/cli/auth.ts` — no matches (GOOD)
- `grep -nE "out\(.*apiId|out\(.*apiHash" src/cli/auth.ts` — no matches (GOOD)
- `npx vitest run src/cli/auth.test.ts` — 4/4 pass
- `npx tsc --noEmit` — exits 0
- Commit `8856776` (RED test) present
- Commit `986211c` (GREEN impl) present

---
*Phase: 04-cli-commands*
*Completed: 2026-06-13*
