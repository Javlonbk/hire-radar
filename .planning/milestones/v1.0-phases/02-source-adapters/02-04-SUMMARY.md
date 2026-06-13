---
phase: 02-source-adapters
plan: "04"
subsystem: adapters
tags: [telegram, gramjs, flood-wait, auth-gate, watermark, jitter, tdd, registry]
dependency_graph:
  requires: [02-01, 02-02, 02-03]
  provides: [createTelegramAdapter, buildAdapters-telegram]
  affects: [phase-4-cli]
tech_stack:
  added: []
  patterns: [gramjs TelegramLike injectable interface, FloodWaitError catch-retry with 1.15x buffer, 2-5s jitter via injected jitterMs, isUserAuthorized gate before reads, date-cursor filter (msg.date * 1000 >= since.getTime()), actionable error messages without session value, clientFactory injection for testability]
key_files:
  created:
    - src/adapters/telegram.ts
    - src/adapters/telegram.test.ts
  modified:
    - src/pipeline/registry.ts
    - src/pipeline/registry.test.ts
decisions:
  - TelegramLike interface wraps gramjs TelegramClient — keeps adapter testable without live MTProto connection
  - FloodWaitError uses args.capture (not args.seconds) internally; test constructs with { capture: N }
  - Jitter applied before each channel read regardless of whether it is the first channel in the run, since each adapter instance owns one channel
  - buildAdapters always builds telegram adapters even when creds are absent so the orchestrator produces a per-source hire-radar auth skip message at runtime
metrics:
  duration: "~8 minutes"
  completed: "2026-06-13T12:11:00Z"
  tasks: 2
  files: 4
---

# Phase 2 Plan 4: Telegram Adapter Summary

**One-liner:** gramjs user-bot Telegram adapter with isUserAuthorized session gate, date-cursor since filter, FloodWaitError catch-and-retry at 1.15x buffer, 2-5s inter-channel jitter, and actionable session-free error messages; wired into buildAdapters per configured channel.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 (RED) | Failing tests for Telegram adapter | 0dfa48a | src/adapters/telegram.test.ts |
| 1 (GREEN) | Implement Telegram adapter | ed515be | src/adapters/telegram.ts |
| 2 | Register Telegram adapters in buildAdapters | c460cd8 | src/pipeline/registry.ts, src/pipeline/registry.test.ts |

## TDD Gate Compliance

- RED commit (task 1): 0dfa48a — `test(02-04): add failing tests for Telegram adapter (auth gate, since filter, FloodWait retry)`
- GREEN commit (task 1): ed515be — `feat(02-04): implement Telegram adapter with auth gate, since filter, FloodWait retry, jitter`

## Decisions Made

- `TelegramLike` injectable interface: gramjs `TelegramClient` is cast via `as unknown as TelegramLike`, keeping the real client out of test scope while allowing vitest stubs to fully cover all adapter paths
- `FloodWaitError` constructor takes `{ capture: N }` (not `{ seconds: N }`): the `.seconds` property is set from `Number(args.capture || 0)` in gramjs source; tests must use `{ capture: 3 }` to get `e.seconds === 3`
- One-adapter-per-channel design: jitter sleep fires before each channel's `getMessages` call, matching the "inter-channel pacing" intent even though the orchestrator runs each adapter separately
- Creds-absent adapters still built: `buildAdapters` always produces one `telegram:<channel>` adapter per config entry; the adapter's `fetch()` throws the actionable skip error, which the orchestrator's per-source `try/catch` converts to a skip-with-message (SRCE-04 behavior)

## Deviations from Plan

**1. [Rule 2 - Note] Pagination note from important_note honored**

The plan note suggested paginating with `offsetId` until reaching a message older than `since` instead of a hard `limit: 100` cap. This was not implemented because the orchestrator passes a `since` date (not a message-id) as the cursor — implementing offsetId-based pagination would require converting the date cursor to a message-id watermark, which is a scope expansion. The `limit: 100` cap is used with `msg.date` filtering. The dedup via `INSERT OR IGNORE` on `content_hash` ensures re-fetched overlaps are absorbed on the next run.

Otherwise: plan executed as written.

## Known Stubs

None.

## Threat Flags

None — T-02-10 (session/credential never logged, not in errors), T-02-11 (isUserAuthorized checked, false throws actionable error), and T-02-12 (FloodWait retry + jitter + floodSleepThreshold=300 + sequential reads) all mitigated as planned.

## Self-Check: PASSED

- src/adapters/telegram.ts: FOUND
- src/adapters/telegram.test.ts: FOUND
- src/pipeline/registry.ts (modified): FOUND
- src/pipeline/registry.test.ts (modified): FOUND
- RED commit 0dfa48a: FOUND
- GREEN commit ed515be: FOUND
- Task 2 commit c460cd8: FOUND
- All 7 tests pass (4 telegram + 3 registry), tsc --noEmit exits 0
