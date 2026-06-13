# Phase 2: Source Adapters - Context

**Gathered:** 2026-06-13
**Status:** Ready for planning

<domain>
## Phase Boundary

Users can ingest raw job posts from hh.uz, RSS feeds, and Telegram channels into SQLite, with each source failing independently. Delivers: the `SourceAdapter` interface and `RawItem` type; three adapters (hh.uz REST with date cursor, RSS with conditional GET, Telegram via gramjs with message-id watermark + FloodWait retry); an orchestrator that runs sources sequentially with per-source error isolation; per-source cursors persisted in the `sources` table; raw items written to SQLite before any extraction. NO Claude extraction, NO dedup-by-content beyond fetch-time native-id dedup, NO CLI command surface (the `ingest` command UX and Telegram `auth` command land in Phase 4 — this phase exposes an orchestrator function the CLI will later call).

</domain>

<decisions>
## Implementation Decisions

### Ingest Run Behavior
- First run with no cursor fetches a bounded backfill window of the last 7 days (not all history) per source
- A network/API failure on one source prints that source's error and continues fetching from the remaining sources (continue-on-failure)
- A `--since <date>` override is supported to force a backfill window (plumbed through the orchestrator; CLI wiring is Phase 4)
- Sources run sequentially in a deterministic order (not Promise.all) — gramjs is single-session and hh.uz is rate-limited

### Source Configuration & Adapter Boundaries
- Sources come from a config-driven registry: a `sources[]` array in config (type + per-source settings); each enabled entry runs
- Per-source cursors live in the `sources` table (DB), keyed by a stable source id (`telegram:<channel>`, `hh:uz`, `rss:<url-hash>`)
- `SourceAdapter.fetch(since)` returns `RawItem[]` only — it never calls Claude; extraction is a downstream phase (ARCHITECTURE.md "raw in, raw out" boundary)
- hh.uz region/query filters come from config (`hh.areas`, `hh.text`, `hh.perPage` — already in the Phase 1 config schema); default area = Tashkent if unset

### Raw Item Schema & Persistence
- Fetch-time dedup key: `content_hash = SHA-256(source_id + native_id)` where native_id is the hh vacancy id / telegram message id / rss guid; exact reposts skipped via `INSERT OR IGNORE` on `raw_items.content_hash`
- Cursor advances after a source's fetch fully succeeds (to the newest item seen); partial failure leaves the cursor unmoved so the next run re-fetches and dedup absorbs the overlap
- If Telegram auth is missing/unauthorized at run time, skip the Telegram source with an actionable error (points at the future `hire-radar auth` command) and continue other sources — the interactive auth flow itself is built in Phase 4
- Per-source pacing: hh.uz 500ms between paged requests; Telegram 2–5s jitter between channels plus FloodWaitError catch-and-retry (sleep seconds + buffer); RSS none (conditional GET via ETag/If-Modified-Since)

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets (from Phase 1)
- `src/db/client.ts` — `openDatabase(path)` (WAL + busy_timeout, idempotent schema load), `runInTransaction(db, fn)` synchronous helper
- `src/db/schema.sql` — `sources`, `raw_items` (with `UNIQUE(content_hash)`), `extraction_cache`, `vacancies` tables already exist; cursor columns live on `sources`
- `src/hash.ts` — `normalize(text)` + `contentHash(text)` (NFC + Cyrillic/Latin confusable fold + lowercase); reuse `contentHash` for the `source_id + native_id` fetch key
- `src/config.ts` — `loadConfig({ env })` Zod-validated; secrets from env only (`TELEGRAM_API_ID`, `TELEGRAM_API_HASH`, Telegram session string, `ANTHROPIC_API_KEY`), non-secrets (`hh.*`, RSS URLs, channel whitelist) from config.json

### Established Patterns
- ESM, Node 22, strict TypeScript; tsx for dev/run, vitest for tests; better-sqlite3 synchronous DB access (no async inside transactions — PITFALL-10)
- Per ARCHITECTURE.md build order: adapter interface → simple adapters (hh, RSS) → orchestrator → complex adapter (Telegram) last

### Integration Points
- Orchestrator reads enabled sources from config, reads/writes cursors on the `sources` table, writes `raw_items` rows; downstream Phase 3 extractor reads unprocessed `raw_items`

</code_context>

<specifics>
## Specific Ideas

- Raw items must be persisted before extraction is attempted so a crash mid-run leaves already-fetched raws intact for the next run (PITFALLS: raw persistence before extraction).
- gramjs reliability essentials carried from research: call `isUserAuthorized()` on startup (silent stale-session reads otherwise); `min_id` watermark from the first commit; FloodWaitError `.seconds` + buffer.

</specifics>

<deferred>
## Deferred Ideas

- Interactive Telegram auth flow (`hire-radar auth`) → Phase 4 (CLI Commands)
- The user-facing `ingest` CLI command, flags, and per-run stats output → Phase 4
- Playwright scrapers (OLX/jobs.uz), career-page watcher → project Out of Scope / v2

</deferred>
