---
phase: 02-source-adapters
verified: 2026-06-13T12:25:00Z
status: passed
score: 13/13 must-haves verified
overrides_applied: 0
re_verification: false
---

# Phase 2: Source Adapters Verification Report

**Phase Goal:** Users can ingest raw job posts from hh.uz, RSS feeds, and Telegram channels into SQLite, with each source failing independently
**Verified:** 2026-06-13T12:25:00Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Running ingest fetches new hh.uz postings since the last run using a date cursor; subsequent runs fetch only new items | ✓ VERIFIED | `hh.ts`: `date_from=since.toISOString()` in URL params; `persistRawItems` uses `INSERT OR IGNORE` on `content_hash`; orchestrator reads/writes cursor via `getCursor`/`upsertCursor` |
| 2 | Running ingest fetches RSS items with conditional GET (ETag/If-Modified-Since); non-UTF-8 feeds (windows-1251) are decoded correctly | ✓ VERIFIED | `rss.ts` lines 46-47: `If-None-Match`/`If-Modified-Since` headers sent; line 50: `304` returns `[]`; lines 58-65: `iconv.decode(buf, encoding)` for non-UTF-8; sniff window is 1024 bytes with Content-Type charset fallback |
| 3 | Running ingest fetches new Telegram posts from whitelisted channels since the last message-id watermark, with FloodWait retry and per-channel jitter | ✓ VERIFIED (accepted divergence) | `telegram.ts`: paginates via `offsetId` loop until `msg.date * 1000 < sinceMs`; `FloodWaitError` caught with `e.seconds * 1150` retry; jitter `2000 + Math.floor(Math.random() * 3000)` applied before each channel read; `isUserAuthorized` gate |
| 4 | A network failure or API error on one source prints that source's error and continues fetching from the remaining sources | ✓ VERIFIED | `orchestrator.ts` lines 33-44: `try/catch` per adapter; caught errors push `{ error: errMessage }` stat and log, then loop continues; failing adapter's cursor stays `null` (confirmed by test) |
| 5 | Raw items are written to SQLite before extraction is attempted; a crash mid-run leaves already-fetched raws intact for the next run | ✓ VERIFIED | `orchestrator.ts` line 36 `persistRawItems` precedes line 37 `upsertCursor`; `runInTransaction` in `raw-items.ts` is synchronous; `extraction_status DEFAULT 'pending'` in schema; `INSERT OR IGNORE` absorbs re-fetch overlap |
| 6 | hh.uz adapter returns RawItems only for postings on/after `since` (SRCE-01 must-have) | ✓ VERIFIED | `date_from` param passed to hh.ru API; API filters server-side; pagination stops at `page >= 19` cap with warning at found > 2000 |
| 7 | Same RawItem inserted twice yields one row (INSERT OR IGNORE on content_hash) | ✓ VERIFIED | `raw-items.ts`: `INSERT OR IGNORE INTO raw_items ... content_hash`; `UNIQUE(content_hash)` in schema; dedup test passes |
| 8 | getCursor returns null for unknown source; returns ISO date after upsertCursor | ✓ VERIFIED | `sources.ts`: `SELECT last_fetched_at WHERE id=?` returns null on miss; `ON CONFLICT(id) DO UPDATE SET last_fetched_at` stores value |
| 9 | RSS 304 returns [] without re-parsing, second fetch sends If-None-Match | ✓ VERIFIED | `rss.ts` line 50: `if (res.status === 304) return []`; `etag`/`lastModified` only written after `res.ok` check; test (c) confirms second call sends `If-None-Match` |
| 10 | RSS non-http(s) URL rejected at construction; internal hosts blocked | ✓ VERIFIED | `rss.ts` line 28-29: scheme guard; lines 11-24: `isBlockedHost()` blocks loopback, RFC-1918, link-local (169.254.x.x) |
| 11 | Telegram missing/expired session throws actionable error without session value; orchestrator catches and continues | ✓ VERIFIED | `telegram.ts` lines 42-46: throws `"run hire-radar auth to authenticate"` without `opts.session` in message; `isUserAuthorized() === false` throws too; orchestrator `catch` converts to skip stat |
| 12 | Orchestrator uses 7-day backfill when no cursor exists; sinceOverride overrides per-source cursor | ✓ VERIFIED | `orchestrator.ts` line 31: `new Date(runStart.getTime() - 7 * 24 * 60 * 60 * 1000)`; line 29: `sinceOverride ??`; tests for both pass |
| 13 | Registry builds hh + rss + telegram adapters from config with stable source ids | ✓ VERIFIED | `registry.ts`: `createHhAdapter` (id: `hh:uz`), `createRssAdapter` (id: `rss:<8hex>`), `createTelegramAdapter` (id: `telegram:<channel>`); all three in `buildAdapters`; registry tests with 4 adapters pass |

**Score:** 13/13 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/adapters/types.ts` | SourceAdapter interface + RawItem type | ✓ VERIFIED | `interface SourceAdapter` + `interface RawItem` both present; 13 lines, no stubs |
| `src/adapters/hh.ts` | hh.uz REST adapter with date cursor + pagination | ✓ VERIFIED | `createHhAdapter` exported; `date_from`, `User-Agent`, 20-page cap, `sleep(500)`, HTTP error throw; 96 lines |
| `src/db/raw-items.ts` | persistRawItems with INSERT OR IGNORE dedup | ✓ VERIFIED | `persistRawItems` exported; synchronous `runInTransaction`; no `await` inside transaction |
| `src/db/sources.ts` | cursor read/write keyed by source id | ✓ VERIFIED | `getCursor` + `upsertCursor` exported; `ON CONFLICT(id) DO UPDATE` |
| `src/adapters/rss.ts` | RSS adapter with conditional GET + encoding transcode + SSRF guard | ✓ VERIFIED | All three behaviors present and tested; 105 lines; `isBlockedHost` guard extended beyond scheme |
| `src/adapters/telegram.ts` | gramjs user-bot adapter with auth gate, watermark, FloodWait retry, jitter | ✓ VERIFIED | All behaviors present; pagination loop via `offsetId`; session never logged |
| `src/pipeline/orchestrator.ts` | sequential, fault-isolated ingest loop with persist-before-cursor-advance | ✓ VERIFIED | `ingestSources` exported; no `Promise.all`; `persistRawItems` before `upsertCursor` |
| `src/pipeline/registry.ts` | config to enabled SourceAdapter[] (hh + rss + telegram) | ✓ VERIFIED | `buildAdapters` returns all three adapter types |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `src/adapters/hh.ts` | `src/adapters/types.ts` | returns `RawItem[]` | ✓ WIRED | `import type { RawItem, SourceAdapter } from './types.js'`; return type matches |
| `src/db/raw-items.ts` | raw_items table | `INSERT OR IGNORE` on content_hash | ✓ WIRED | SQL statement present; `runInTransaction` wraps loop |
| `src/adapters/hh.ts` | `src/hash.ts` | `contentHash('hh:uz:' + nativeId)` | ✓ WIRED | `import { contentHash } from '../hash.js'`; called at line 83 |
| `src/adapters/rss.ts` | `src/adapters/types.ts` | returns `RawItem[]` | ✓ WIRED | `import type { RawItem, SourceAdapter } from './types.js'` |
| `src/adapters/rss.ts` | `src/hash.ts` | `contentHash(id + ':' + nativeId)` | ✓ WIRED | imported and called at line 98 |
| `src/adapters/telegram.ts` | `src/adapters/types.ts` | returns `RawItem[]` | ✓ WIRED | `import type { RawItem, SourceAdapter } from './types.js'` |
| `src/pipeline/orchestrator.ts` | `src/db/raw-items.ts` | `persistRawItems(db, items)` before `upsertCursor` | ✓ WIRED | imported; call at line 36 precedes `upsertCursor` at line 37 |
| `src/pipeline/orchestrator.ts` | `src/db/sources.ts` | `getCursor` before fetch, `upsertCursor` after success | ✓ WIRED | both imported and used in correct order |
| `src/pipeline/registry.ts` | `src/adapters/hh.ts` | `createHhAdapter(config.hh)` | ✓ WIRED | imported and invoked |
| `src/pipeline/registry.ts` | `src/adapters/telegram.ts` | `createTelegramAdapter` per channel | ✓ WIRED | imported; loop over `config.telegram.channels` |

### Data-Flow Trace (Level 4)

Not applicable — this phase produces storage adapters and a persistence layer, not UI components or dashboard renderers. All data flows are I/O: external HTTP → `RawItem[]` → `raw_items` table. The flow is verified by the test suite (39 tests, all passing) rather than by rendering checks.

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| All 39 phase-2 tests pass | `npx vitest run ...7 test files...` | `7 passed (7), 39 passed (39)` | ✓ PASS |
| TypeScript type check | `npx tsc --noEmit` | Exit 0, no output | ✓ PASS |
| persistRawItems dedup: same item twice → 1 row | Covered by `raw-items.test.ts` | Test passes | ✓ PASS |
| Fault isolation: failed adapter does not stop run | Covered by `orchestrator.test.ts` | Test passes | ✓ PASS |
| Telegram paginates beyond 100 via offsetId | Test `(e)` in `telegram.test.ts` — 150 messages, `getMessages.mock.calls.length > 1` | Test passes | ✓ PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| SRCE-01 | 02-01 | hh.uz REST API with pagination and incremental fetch | ✓ SATISFIED | `createHhAdapter` with `date_from` cursor + 20-page pagination |
| SRCE-02 | 02-02 | RSS with conditional GET and non-UTF-8 encoding support | ✓ SATISFIED | `createRssAdapter` with ETag/If-Modified-Since + `iconv.decode` |
| SRCE-03 | 02-04 | Telegram user-bot with session, watermark, FloodWait retry | ✓ SATISFIED | `createTelegramAdapter` with `offsetId` pagination, `FloodWaitError` retry, `isUserAuthorized` gate |
| SRCE-04 | 02-03, 02-04 | Failure in one source does not abort others | ✓ SATISFIED | `ingestSources` per-adapter `try/catch`; Telegram missing-session throws handled by same catch |
| SRCE-05 | 02-01, 02-03 | Raw items persisted before extraction | ✓ SATISFIED | `persistRawItems` before `upsertCursor`; `extraction_status DEFAULT 'pending'` |

All 5 requirement IDs from PLAN frontmatter claimed and satisfied. No orphaned requirements (REQUIREMENTS.md traceability table maps exactly SRCE-01..05 to Phase 2).

### Anti-Patterns Found

| File | Pattern | Severity | Impact |
|------|---------|----------|--------|
| `src/pipeline/orchestrator.ts` | `upsertCursor` writes `config_json = '{}'` on every run (IN-01 from REVIEW) | Info | No current reader of `config_json`; latent clobber risk. Accepted in code review as deferred. |
| `src/adapters/hh.ts` | `contentHash` keyed on native id only — vacancies that are edited are not re-ingested (IN-03 from REVIEW) | Info | Intentional id-based dedup design. Documented in REVIEW.md. |

No BLOCKER or WARNING anti-patterns. The three INFO items were identified in the code review (02-REVIEW.md) and explicitly accepted as out of scope for this phase (IN-01..03 remain open but are non-blocking).

### Human Verification Required

None. All behaviors are verifiable programmatically via the test suite and static code analysis. The Telegram adapter requires live credentials for end-to-end testing, but the `TelegramLike` injectable interface and comprehensive stub tests cover all code paths including auth gate, FloodWait retry, and pagination.

### Gaps Summary

No gaps. All 13 must-haves are verified. All 5 requirement IDs are satisfied. The 39-test suite passes with `tsc --noEmit` clean. The code review findings (8 fixed, 3 info-deferred) are consistent with the current HEAD state.

**Accepted divergence (per verification instructions):** The Telegram cursor is an ISO date stored uniformly across all sources (not a literal gramjs `min_id` integer). The adapter correctly implements equivalent behavior by paginating backwards via `offsetId` until a message older than `since` is reached (`msg.date * 1000 < sinceMs`), satisfying success criterion 3.

---

_Verified: 2026-06-13T12:25:00Z_
_Verifier: Claude (gsd-verifier)_
