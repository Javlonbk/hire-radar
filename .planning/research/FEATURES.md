# Feature Research

**Domain:** Job-vacancy ingestion / aggregation CLI (ingest → extract → dedup → persist → query)
**Researched:** 2026-06-13
**Confidence:** HIGH (pipeline patterns) / MEDIUM (hh.uz-specific rate limits, Central Asia Telegram norms)

---

## Feature Landscape

### Table Stakes (Users Expect These)

Features that any ingest pipeline must have. Missing these produces data loss, duplicate noise, or unusable output.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Incremental fetch with per-source cursor | Without it every run re-fetches everything; sources rate-limit or ban | MEDIUM | Telegram: `offsetId` (last seen message_id). hh.uz: `date_from` / `page` pagination up to 100/page. RSS: HTTP `ETag`/`If-None-Match` + `Last-Modified`/`If-Modified-Since` conditional GET returning 304. Persist cursor per source in SQLite `source_state` table. |
| Source-level error isolation | One failing source must not abort the whole run | LOW | Wrap each adapter call in try/catch; log error with source name; mark source `last_error` in state; continue to next source. |
| FloodWait / rate-limit back-off | Telegram returns `FLOOD_WAIT_X`; ignoring it burns sessions | MEDIUM | GramJS exposes `FloodWaitError.seconds`; auto-sleeps under `floodSleepThreshold` (default 60 s, configurable up to 300 s). Must also cap channels-per-run to avoid `contacts.ResolveUsername` FloodWait. hh.uz: respect `Retry-After` header or implement fixed jitter backoff. |
| Content-hash extraction cache | Identical post text reposted across channels; re-extracting costs money | LOW | SHA-256 of raw text → lookup in `extraction_cache(hash, result_json)`; only call Claude when miss. Cache hit rate 60–80% on repeated reposts is realistic. |
| Deduplication by composite hash | Same vacancy posted multiple times on different channels/dates | LOW | SHA-256 of `normalize(title + company + description_prefix_200_chars)`. Upsert semantics: insert-or-ignore on the composite hash. Separate from extraction cache. |
| SQLite persistence with structured vacancy schema | Output is useless without queryable storage | MEDIUM | Minimum fields: `id`, `source`, `source_id`, `title`, `company`, `description`, `location`, `remote_type` (onsite/remote/hybrid), `salary_min`, `salary_max`, `salary_currency`, `skills` (JSON array), `apply_contact`, `url`, `lang`, `posted_at`, `ingested_at`, `content_hash`, `dedup_hash`, `raw_json` (original payload). |
| Raw payload retention | Debug extraction failures; reprocess without re-fetching | LOW | Store `raw_json` (full source response) and `raw_text` (message body) on every row. Enables offline reprocessing. |
| Config-driven source list | Telegram channel list, hh.uz filters, RSS URLs must be externalizable | LOW | TOML/JSON config file + env overrides for secrets (api_id, api_hash, anthropic_key). No hardcoded channel names. |
| `ingest` CLI command | Entry point for the entire pipeline | LOW | Accepts `--source telegram|hh|rss|all`, `--dry-run` (fetch + extract, no write), `--limit N` (cap messages per source per run for testing). |
| `list` CLI command | Browse results without opening SQLite directly | MEDIUM | Flags: `--title`, `--company`, `--skills`, `--remote`, `--since YYYY-MM-DD`, `--limit N`. Table output to terminal (columnar). SQLite FTS5 virtual table on `title + description` enables keyword search. |
| `export` CLI command | Downstream consumption (kasbim integration, analysis) | LOW | Outputs newline-delimited JSON (ndjson) or JSON array to stdout or file. Accepts same filters as `list`. |
| Multilingual extraction prompt | Posts in uz-Latn, uz-Cyrl, Russian, English, mixed | MEDIUM | Claude Haiku prompt must explicitly instruct: detect language, extract regardless of script. Skills and remote_type should be normalized to English enum values in output schema. Return `null` for fields absent in the post — not guessed. |
| Multi-vacancy-per-post splitting | Telegram channels routinely bundle 3–5 jobs per message | MEDIUM | LLM extraction must return an array of vacancy objects, not a single object. Downstream inserts each element with the same `source_id`. |
| Non-job post filtering | Channels mix job posts with news, memes, announcements | LOW | First step in extraction: classify `is_vacancy: boolean`. If false, skip LLM extraction entirely. Can be a lightweight Haiku call or a regex pre-filter. |

### Differentiators (Competitive Advantage)

Features that are not assumed but materially improve reliability or cost profile.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Two-stage LLM pipeline (classify then extract) | Skip extraction for non-vacancy posts; reduces cost ~60–70% on noisy Telegram channels | LOW | Stage 1: classify post as vacancy/non-vacancy (cheap, short prompt). Stage 2: full structured extraction only on vacancies. DEV community benchmark shows ~$0.35/month for 50–100 jobs/run with this pattern. |
| Dry-run mode with extraction preview | Safe to test against real channels without persisting junk | LOW | `--dry-run` flag: runs full pipeline, prints structured output, rolls back all writes (or writes to in-memory SQLite). |
| Per-source run stats in CLI output | Know what each source contributed without querying DB | LOW | After each run: `Telegram: 12 new, 4 skipped (dedup), 1 error. hh.uz: 30 new. RSS: 5 new.` |
| Idempotent re-run | Running ingest twice produces same DB state as running once | LOW | Upsert semantics on `dedup_hash`. No duplicate rows. Pure at-least-once delivery model. |
| `--since` override for backfill | Ingest historical data when adding a new channel | MEDIUM | Override cursor to a specific date or message ID. Useful for onboarding a new Telegram channel: backfill its history once, then run incrementally. |
| Graceful session persistence for Telegram | gramjs sessions expire; must not crash on re-auth silently | MEDIUM | Store stringSession to file. Detect `AuthKeyUnregisteredError` / `SessionPasswordNeededError`; exit with actionable error message and re-auth instructions rather than silently failing. |
| Structured error log per run | Distinguish transient errors (network, FloodWait) from permanent ones (bad session, invalid channel) | LOW | Write per-run error log to SQLite `run_log` table: `run_id`, `source`, `error_type`, `message`, `ts`. Enables `hire-radar logs` subcommand. |

### Anti-Features (Commonly Requested, Often Problematic)

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Always-on daemon / cron built-in | "Automate it" | Process management, PID files, log rotation, restart logic — all overhead for a CLI; hides failures silently | Delegate to system cron (`crontab -e`) or systemd timer. CLI exit code surfaces errors to the scheduler. |
| Embedding-based semantic dedup | Catch near-duplicate rephrased posts | Requires pgvector or in-process vector store; adds latency and cost per vacancy; false positives on legitimate re-posts from multiple channels | Hash dedup catches exact reposts (the dominant case on Telegram). Defer semantic dedup to v2 if hash dedup proves insufficient. |
| Web UI / REST API | Browsability | Full stack complexity, auth, deployment — defeats the "zero infra" value prop | `list` and `export` CLI commands cover all browsing and integration needs. |
| Playwright scrapers (OLX, career pages) | More sources = more jobs | Most fragile adapters; break on DOM changes; require headless browser runtime; TLS fingerprinting issues | Defer; add only after the three primary sources (Telegram, hh.uz, RSS) are stable. |
| LinkedIn integration | LinkedIn has the jobs | LinkedIn ToS explicitly prohibits scraping; legal risk | Not in scope. Ever. |
| User matching / scoring | "Rate these vacancies for me" | Belongs to the kasbim matching layer, not ingest; adds model complexity and breaks the single-responsibility boundary | Structured output from this tool feeds kasbim's matcher as the downstream consumer. |
| Real-time / streaming ingest | Fresh data | Telegram event subscriptions require long-lived connection management (reconnects, session keep-alive), which implies daemon complexity | Batch ingest on demand (or via cron) is sufficient for job-search cadence. |
| Multi-user / credential management | Share with teammates | Requires auth layer, secrets management, multi-tenancy in SQLite or a migration to Postgres | Single-user local tool. If multi-user is needed, the whole stack migrates to kasbim. |

---

## Feature Dependencies

```
Source State (cursor persistence)
    └──required by──> Incremental Fetch (Telegram offsetId, hh.uz date_from, RSS ETag)

Raw Payload Retention
    └──required by──> Extraction Cache (hash of raw text)
    └──required by──> Offline Reprocessing / Debug

Non-job Classifier (Stage 1)
    └──gates──> Structured Extraction (Stage 2)
                    └──required by──> Multi-vacancy Splitting
                                          └──required by──> Dedup (composite hash per vacancy)
                                                                └──required by──> Persist

Persist
    └──required by──> list command
    └──required by──> export command

SQLite FTS5 virtual table
    └──enhances──> list --title keyword search (optional, add after schema is stable)

Session Persistence (Telegram)
    └──required by──> Incremental Fetch (Telegram)
    └──blocks if missing──> All Telegram functionality
```

### Dependency Notes

- **Source state requires a stable source identity key:** Each source needs a deterministic string key (e.g., `telegram:channel_username`, `hh:area_123`, `rss:https://...`) to store cursor rows independently.
- **Extraction cache depends on raw text being stored before the LLM call:** Hash the raw text first, check cache, only then call Claude. Cache the response before writing the vacancy rows so a crash between extraction and write doesn't re-bill.
- **Multi-vacancy splitting must happen before dedup:** A single message producing 3 vacancies needs 3 separate `dedup_hash` evaluations. Dedup runs per extracted vacancy object, not per source message.
- **FTS5 is optional at launch:** Plain `WHERE title LIKE ?` is sufficient for v1. FTS5 adds relevance ranking; worth adding when the vacancy table grows past ~10k rows.

---

## MVP Definition

### Launch With (v1)

- [ ] Incremental fetch with cursor for all three sources (Telegram offsetId, hh.uz date_from + page, RSS ETag/Last-Modified)
- [ ] Source-level error isolation (one failing source does not abort run)
- [ ] FloodWait back-off for Telegram (respect `FloodWaitError.seconds`)
- [ ] Two-stage LLM pipeline: classify → extract (array of vacancies per post)
- [ ] Content-hash extraction cache (SHA-256 of raw text, stored in SQLite)
- [ ] Deduplication by composite hash (title + company + description prefix)
- [ ] SQLite persistence with full vacancy schema + raw_json column
- [ ] `ingest [--source] [--dry-run] [--limit]` command
- [ ] `list [--title] [--company] [--remote] [--since] [--limit]` command
- [ ] `export [--format json] [filter flags]` command
- [ ] Config file + env var overrides for all credentials and source lists
- [ ] Per-run stats output and structured `run_log` table

### Add After Validation (v1.x)

- [ ] `--since` backfill override — add when onboarding a second batch of channels
- [ ] SQLite FTS5 virtual table — add when list queries become slow (~10k+ rows)
- [ ] `logs` subcommand to query `run_log` — add when debugging multi-source runs becomes painful
- [ ] Graceful Telegram re-auth flow — add when session expiry first occurs in practice

### Future Consideration (v2+)

- [ ] Embedding-based semantic dedup — defer until hash dedup proves insufficient
- [ ] Playwright adapter (OLX/jobs.uz) — defer; most fragile, low ROI vs Telegram volume
- [ ] Integration test harness with fixture messages — defer until the schema is stable

---

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Incremental fetch (cursor per source) | HIGH | MEDIUM | P1 |
| Source error isolation | HIGH | LOW | P1 |
| FloodWait back-off (Telegram) | HIGH | LOW | P1 |
| Two-stage classify → extract | HIGH | MEDIUM | P1 |
| Extraction cache (content hash) | HIGH | LOW | P1 |
| Dedup by composite hash | HIGH | LOW | P1 |
| SQLite schema + raw payload | HIGH | MEDIUM | P1 |
| `ingest` command | HIGH | LOW | P1 |
| `list` + `export` commands | HIGH | MEDIUM | P1 |
| Config / env-driven sources | HIGH | LOW | P1 |
| Per-run stats + run_log table | MEDIUM | LOW | P2 |
| `--since` backfill override | MEDIUM | LOW | P2 |
| Session persistence / re-auth | MEDIUM | MEDIUM | P2 |
| SQLite FTS5 virtual table | LOW | LOW | P3 |
| Embedding-based dedup | LOW | HIGH | P3 |

**Priority key:**
- P1: Must have for launch
- P2: Should have, add when possible
- P3: Nice to have, future consideration

---

## Competitor Feature Analysis

| Feature | Open-source aggregators (Go-Get-Jobs, Geezap, Jobseek) | ETL platforms (Airbyte, Hevo) | This tool |
|---------|------------------------------------------------------|-------------------------------|-----------|
| Incremental fetch | Cursor-based per source (some); many do full re-fetch | First-class, configurable watermark | Per-source `source_state` cursor in SQLite |
| Dedup | Hash-based (Go-Get-Jobs uses MongoDB upserts); some fuzzy | Staging-merge pattern; composite key upsert | SHA-256 composite hash; insert-or-ignore |
| LLM extraction | Not standard; most rely on structured API fields | Not applicable | Claude Haiku two-stage pipeline |
| Raw payload retention | Varies; Go-Get-Jobs skips it | Raw zone is the standard pattern | `raw_json` column always written |
| CLI query interface | Rare; most expose web UI | Not applicable | `list` + `export` with filter flags |
| Telegram as a source | None of the above tools support it | Not applicable | gramjs user-bot with FloodWait handling |
| Multilingual extraction | None (all English-market tools) | Not applicable | uz/ru/en prompt with script normalization |

---

## Sources

- [Job Posting Data Aggregation: Multi-Source Guide](https://www.promptcloud.com/blog/job-posting-data-aggregation/)
- [Incremental Load in ETL — Airbyte](https://airbyte.com/data-engineering-resources/etl-incremental-loading)
- [GramJS Handling Errors — painor.gitbook.io](https://painor.gitbook.io/gramjs/getting-started/handling-errors)
- [messages.GetHistory parameters — gram.js.org](https://gram.js.org/tl/messages/GetHistory)
- [GramJS FloodWait issue tracker](https://github.com/gram-js/gramjs/issues/220)
- [HH.ru API vacancies docs — github.com/hhru/api](https://github.com/hhru/api/blob/master/docs/vacancies.md)
- [RSS conditional GET — HTTP ETag/If-Modified-Since](https://fishbowl.pastiche.org/2002/10/21/http_conditional_get_for_rss_hackers)
- [LLM caching strategies — Medium](https://medium.com/@TomasZezula/llm-caching-strategies-from-na%C3%AFve-to-semantic-and-batched-6b5816e7488a)
- [I Benchmarked 6 LLMs to Automate My Job Board for $0.35/Month — DEV Community](https://dev.to/dalleyne/i-benchmarked-6-llms-to-automate-my-job-board-for-035month-3j3a)
- [Ensuring Idempotency in Data Ingestion Pipelines — sparkplayground.com](https://www.sparkplayground.com/blog/idempotency-in-data-ingestion-pipelines)
- [SQLite FTS5 Extension — sqlite.org](https://sqlite.org/fts5.html)
- [Schema.org JobPosting — Google Search Central](https://developers.google.com/search/docs/appearance/structured-data/job-posting)

---
*Feature research for: job-vacancy ingestion CLI (hire-radar)*
*Researched: 2026-06-13*
