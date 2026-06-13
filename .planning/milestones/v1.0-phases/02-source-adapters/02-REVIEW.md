---
phase: 02-source-adapters
reviewed: 2026-06-13T00:00:00Z
depth: standard
files_reviewed: 8
files_reviewed_list:
  - src/adapters/types.ts
  - src/adapters/hh.ts
  - src/adapters/rss.ts
  - src/adapters/telegram.ts
  - src/db/raw-items.ts
  - src/db/sources.ts
  - src/pipeline/orchestrator.ts
  - src/pipeline/registry.ts
findings:
  critical: 1
  warning: 7
  info: 3
  total: 11
fixed:
  critical: 1
  warning: 7
  info: 0
open:
  critical: 0
  warning: 0
  info: 3
status: fixed
---

# Phase 02: Code Review Report

**Reviewed:** 2026-06-13T00:00:00Z
**Depth:** standard
**Files Reviewed:** 8
**Status:** fixed (CR-01 + WR-01..07 resolved; IN-01..03 deferred)

## Summary

Reviewed the source-adapter ingest pipeline: HH, RSS, and Telegram adapters; the
`raw_items` / `sources` persistence layer; and the orchestrator + registry.

The core control-flow requirements hold up: persist-before-cursor ordering is
correct, fault isolation continues on per-adapter failure, and the cursor only
advances inside the `try` after a successful fetch+persist. Secret handling in
the Telegram adapter is sound — session, apiId, and apiHash never appear in any
thrown error message or log line.

The defects below cluster around **silent data loss on partial/error HTTP
responses and unpaginated sources**, plus a **weakened SSRF guard**. One BLOCKER:
neither the HH nor RSS adapter checks `response.ok`/HTTP status before treating
the body as a valid feed, and the RSS adapter additionally corrupts its
conditional-GET state on any error response.

## Critical Issues

### CR-01: RSS adapter overwrites conditional-GET state and parses body on any non-304 status (incl. 4xx/5xx)

**Status:** Fixed (commit 0e0068f) — adapter now throws on `!res.ok` before touching validators/body.
**File:** `src/adapters/rss.ts:31-47`
**Issue:** After the `304` check, the code unconditionally (a) overwrites the
cached `etag`/`lastModified` from the new response headers and (b) reads and
parses the body — for *any* status that is not exactly `304`. On a `500`, `429`,
or `403` the server typically returns an HTML/JSON error page with no
`etag`/`last-modified` headers. The result:

1. `etag` and `lastModified` are reset to `null`, **destroying the
   conditional-GET state** that was working before. The next request re-downloads
   the full feed, defeating the bandwidth/rate-limit purpose of the
   conditional-GET feature.
2. `parseString` is handed an error page and throws a confusing parse error
   instead of a meaningful HTTP-status error.

`fetch()` does not reject on 4xx/5xx, so this path is reached on every server
error. HH has the same missing-`ok` problem (see WR-01), but RSS is elevated to
BLOCKER because it additionally corrupts persistent adapter state across runs.

**Fix:**
```ts
const res = await fetchFn(opts.url, { headers });
if (res.status === 304) return [];
if (!res.ok) {
  throw new Error(`RSS feed ${opts.url} returned HTTP ${res.status}`);
}
// only now is it safe to capture validators and read the body
etag = res.headers.get('etag');
lastModified = res.headers.get('last-modified');
```

## Warnings

### WR-01: HH adapter never checks `response.ok` before reading the body

**Status:** Fixed (commit fe28fd2) — throws on `!response.ok`; orchestrator leaves cursor unmoved.
**File:** `src/adapters/hh.ts:34-50`
**Issue:** `response.json()` is called and `body.pages` / `body.items` are used
with no HTTP-status check. On a 4xx/5xx (e.g. hh.ru rate-limiting with `403`),
the body is an error object. `body.pages` is then `undefined`, so
`page < totalPages` (`0 < undefined`) is `false` and the loop exits returning an
empty list — the run is silently treated as "0 items fetched, 0 new" and the
**cursor advances past the window**, permanently skipping any vacancies posted in
that interval. A transient API error becomes silent data loss.

**Fix:**
```ts
const response = await fetchFn(url.toString(), { headers: { 'User-Agent': '...' } });
if (!response.ok) {
  throw new Error(`hh.uz returned HTTP ${response.status} (page ${page})`);
}
const body = await response.json() as { ... };
```
Throwing here routes through the orchestrator's catch and leaves the cursor
where it was, so the window is retried next run.

### WR-02: Telegram adapter does not paginate — drops messages beyond the latest 100

**Status:** Fixed (commit c7b972d) — pages backwards via `offsetId` until a message older than `since`.
**File:** `src/adapters/telegram.ts:10, 63, 67`
**Issue:** `getMessages` is always called with `{ limit: 100 }` and the `minId`
field declared in `TelegramLike` is never passed. The adapter fetches only the
most recent 100 messages and filters by `since`. If a channel posts more than 100
messages between runs, the older ones (still newer than `since`) are silently
dropped, and because the cursor advances to `runStart` they are never revisited —
silent data loss for busy channels.

**Fix:** Page backwards using `offsetId`/`minId` until a message older than
`since` (or the cursor) is reached, accumulating across pages. At minimum, compute
`minId` from the stored cursor and loop while a full page of 100 is returned.

### WR-03: RSS SSRF guard only checks scheme — internal/metadata hosts not blocked

**Status:** Fixed (commit b9397cf) — rejects loopback/link-local/RFC-1918 literal hosts (no DNS resolution, per scope).
**File:** `src/adapters/rss.ts:12-15`
**Issue:** The guard rejects non-`http(s)` schemes but performs no host
validation, so `http://169.254.169.254/latest/meta-data/` (cloud metadata),
`http://localhost:6379/`, and RFC-1918 addresses pass. Feed URLs come from
operator-controlled `config.json` rather than untrusted end-user input, which
limits exposure, but the task brief explicitly scopes this as the "SSRF guard"
and a scheme-only check does not meet that bar — a malicious or mistyped feed
entry can pivot to internal services, and redirects are not re-validated.

**Fix:** After the scheme check, reject loopback / link-local / private-range /
unspecified hosts (resolve and validate, or block by literal/hostname), and
disable or re-validate redirects on the `fetch` call.

### WR-04: Cursor advances to `runStart`, opening a miss-window for items posted during the run

**Status:** Fixed (commit d5cabeb) — cursor now stored from a per-adapter `fetchedAt` captured immediately before `fetch`.
**File:** `src/pipeline/orchestrator.ts:24, 36`
**Issue:** `runStart` is captured before any adapter runs, and the cursor for a
successful adapter is set to `runStart.toISOString()`. Any item that becomes
available between `runStart` and the moment the adapter actually queried the API
falls in `[runStart, fetchTime]` but is excluded next run because the cursor is
already at `runStart`... — wait, the opposite: items published *after* `runStart`
but *before* the fetch completes are fetched this run, yet the next run's `since`
= `runStart`, so they may be re-evaluated (harmless, dedup handles it). The real
gap is the inverse for sources keyed on server-side `date_from` (HH): using
`runStart` as the next `date_from` is correct only if the fetch happened at
`runStart`. Given multi-adapter sequential execution, a slow/late adapter's
window can be off by the full run duration. Prefer advancing the cursor to the
time the fetch was issued for that adapter, or to the max observed item timestamp.

**Fix:** Capture a per-adapter `fetchedAt = now()` immediately before
`adapter.fetch(...)` and store that as the cursor, rather than the shared
`runStart`.

### WR-05: RSS `nativeId` falls back to the string `"undefined"` when both guid and link are absent

**Status:** Fixed (commit 51e4de5) — falls back to `contentHash(title+pubDate+content)` so distinct items get distinct ids.
**File:** `src/adapters/rss.ts:54`
**Issue:** `String(item.guid ?? item.link)` yields `"undefined"` when an item has
neither a guid nor a link. Every such item then hashes to the same
`contentHash(id + ':undefined')`, so only the first survives the
`UNIQUE(content_hash)` constraint and the rest are silently discarded as
"duplicates." Distinct real jobs are lost.

**Fix:** Skip items lacking a stable identifier, or derive a fallback from
content (e.g., hash of title+pubDate) so distinct items get distinct ids:
```ts
const rawId = item.guid ?? item.link;
if (!rawId) continue; // or build a content-based id
const nativeId = String(rawId);
```

### WR-06: RSS encoding sniff reads only the first 200 bytes as latin1

**Status:** Fixed (commit 9aae3b6) — sniff window widened to 1024 bytes with HTTP `Content-Type` charset fallback.
**File:** `src/adapters/rss.ts:38-39`
**Issue:** The encoding declaration is searched only within `buf[0..200]`
interpreted as `latin1`. A feed that emits a long XML declaration, a BOM, or
leading whitespace/comments before `<?xml ... encoding=...?>` past byte 200 will
miss the declaration and fall through to `utf8`, producing mojibake for
windows-1251/koi8-r feeds — exactly the case this adapter exists to handle.

**Fix:** Widen the sniff window (e.g. first 1024 bytes) and/or honor a charset
from the HTTP `Content-Type` header as a fallback before defaulting to utf8.

### WR-07: HH/RSS/Telegram `rawJson` retains the entire upstream payload unfiltered

**Status:** Fixed (commit b8a9771) — HH and RSS now persist a whitelist of consumed fields (Telegram already did).
**File:** `src/adapters/hh.ts:69`, `src/adapters/rss.ts:63`
**Issue:** The full upstream `item` object is stored verbatim in `raw_json`. For
RSS this is the entire `rss-parser` item (can include arbitrary feed-defined
fields); for HH the whole vacancy object. This is not a secret-leak in itself
(no credentials flow through these objects), but storing unbounded
attacker-influenced JSON blobs from third-party feeds is a quality/robustness
concern: payload size is unbounded and downstream consumers may trust fields that
were never validated. Telegram correctly stores only `{ id, date }`.

**Fix:** Persist a whitelist of the fields actually consumed downstream rather
than the raw object, mirroring the Telegram adapter's approach.

## Info

_IN-01..03 are out of scope for this fix pass and remain open._

### IN-01: Orchestrator overwrites `config_json` with `{}` on every run

**File:** `src/pipeline/orchestrator.ts:36`
**Issue:** `upsertCursor(..., JSON.stringify({}), ...)` writes an empty config
object on every successful run via the `ON CONFLICT ... DO UPDATE SET ...
config_json = excluded.config_json` clause in `upsertCursor`. If anything ever
stores meaningful per-source config in `sources.config_json`, it is clobbered
each ingest. Today nothing reads it, so this is latent.

**Fix:** Either stop writing `config_json` on cursor updates (drop it from the
`DO UPDATE SET`) or pass the real source config.

### IN-02: Orchestrator logs full adapter error messages

**File:** `src/pipeline/orchestrator.ts:42`
**Issue:** `log(\`${adapter.id}: ERROR ${errMessage}\`)` prints whatever an
adapter throws. The phase-2 adapters never embed secrets in their messages (good
— verified), but this is the single funnel where a future adapter's careless
error could surface credentials. Worth a guard rail.

**Fix:** Consider scrubbing known secret patterns, or document that adapter
errors must never include credentials.

### IN-03: HH `contentHash` keyed on native id only — edits to a vacancy are never re-ingested

**File:** `src/adapters/hh.ts:71` (also `rss.ts:65`, `telegram.ts:86`)
**Issue:** `contentHash('hh:uz:' + nativeId)` derives the dedup key from the id,
not the content. `INSERT OR IGNORE` against `UNIQUE(content_hash)` therefore skips
any later version of the same vacancy even if its title/description changed. If
the intent is pure id-based dedup this is correct; flagging so the
edit-tracking behavior is a conscious decision rather than an accident.

**Fix:** If edits should be captured, fold the normalized `rawText` into the
hash; otherwise leave as-is and document the id-only dedup contract.

---

_Reviewed: 2026-06-13T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
