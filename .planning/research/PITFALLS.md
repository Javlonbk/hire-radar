# Pitfalls Research

**Domain:** Job-vacancy ingestion agent (Telegram user-bot + hh.uz API + RSS + LLM extraction)
**Researched:** 2026-06-13
**Confidence:** HIGH (core pitfalls verified across multiple sources)

---

## Critical Pitfalls

### Pitfall 1: gramjs Session Invalidation on Restart

**What goes wrong:**
The `TelegramClient` is instantiated fresh on every CLI invocation. If the session is loaded from an env variable or file without verifying `client.isUserAuthorized()`, the client silently operates as unauthenticated. Reads may return empty arrays rather than errors, making the bug invisible until you check the vacancy count.

**Why it happens:**
Developers treat session string persistence as write-once. gramjs StringSession can become stale after Telegram revokes it (server-side logout, IP change, inactivity). The library does not raise an explicit error on stale sessions for read-only channel access — it just returns nothing.

**How to avoid:**
On every startup, call `client.isUserAuthorized()` before any channel reads. If it returns `false`, abort the run with a clear message ("Session expired — re-authenticate and update SESSION_STRING") rather than silently producing zero results. Never embed the session string in source files; store it in an env variable loaded at runtime.

**Warning signs:**
- Telegram adapter returns zero messages for channels that previously returned data
- No error thrown, exit code 0, but vacancy count is 0
- `client.getMe()` returns null

**Phase to address:** Telegram adapter implementation (Phase 1 / source adapters phase)

---

### Pitfall 2: FloodWaitError Causing Silent Partial Runs

**What goes wrong:**
gramjs throws `FloodWaitError` with a `.seconds` attribute when Telegram's spam filter triggers. The default `floodSleepThreshold` only auto-waits for waits under 60 seconds. Longer waits (common when reading many channels in sequence) are re-thrown as exceptions. If not caught at the adapter level, the Telegram source aborts mid-run — hh.uz and RSS still run, but Telegram data is incomplete with no warning to the user.

**Why it happens:**
Reading channel history (especially via `getMessages` with large limits) fires multiple MTProto requests in rapid succession. Each `getMessages` call per channel counts. Processing 10 channels in a tight loop easily triggers a 300-second flood wait.

**How to avoid:**
Wrap every gramjs call in a `try/catch` that explicitly handles `FloodWaitError`: log the channel name, wait `error.seconds * 1.15` (add 15% buffer), then retry. Set `client.floodSleepThreshold = 300` as a minimum. Add a configurable inter-channel delay (default: 2–5s jitter) between `getMessages` calls. Never parallelize channel fetches.

**Warning signs:**
- Run completes but Telegram vacancy count is suspiciously low
- Logs show fewer channels processed than the whitelist contains
- Unhandled exception stack trace mentioning `FloodWaitError`

**Phase to address:** Telegram adapter implementation

---

### Pitfall 3: Telegram Account Permanent Ban from Aggressive Reads

**What goes wrong:**
Using a personal Telegram account as the user-bot on a development machine, hitting channels repeatedly during development (frequent restarts + re-reads), triggers Telegram's anti-abuse detection. Bans are permanent and affect the phone number, not just the session.

**Why it happens:**
Telegram's MTProto API is not designed for high-frequency programmatic access on personal accounts. Even read-only operations (no message sending) can trigger account review if patterns look non-human: same channels re-read within seconds, no delays, multiple sessions from different IPs.

**How to avoid:**
Dedicate a secondary Telegram account (not your personal number) for the bot during development. During development, re-read the same channel at most once per run using a `last_fetched_at` cursor stored in SQLite — never re-fetch messages already ingested. Add `min_id` to `getMessages` to fetch only new messages since last run. Never re-authenticate (create a new session) repeatedly.

**Warning signs:**
- `AUTH_KEY_UNREGISTERED` or `USER_DEACTIVATED` errors
- Login confirmation codes stop arriving
- Account shows "this phone number is banned" in Telegram app

**Phase to address:** Telegram adapter implementation — build watermark cursor from day one, do not do full re-reads

---

### Pitfall 4: LLM Hallucinating Fields on Non-Job Posts

**What goes wrong:**
Claude Haiku, instructed to extract a vacancy, invents plausible-looking vacancy data (title, company, salary) for posts that are not job listings at all — channel announcements, news posts, random ads. The schema is satisfied, the JSON is valid, but the vacancy is fabricated.

**Why it happens:**
LLMs are trained to fill structured schemas. When forced into a `{ title, company, salary }` schema on non-matching input, they hallucinate rather than return null. Using `tools` / `structured outputs` without a `is_job_post: boolean` gate means every post gets extracted as if it were a job.

**How to avoid:**
Always include an `is_job_post: boolean` field as the first field in the extraction schema. Instruct the model: "If this post is not a job vacancy, return `{ is_job_post: false }` and leave all other fields null — do not invent data." After extraction, filter rows where `is_job_post === false` before inserting into SQLite. Include 3–5 few-shot examples of non-job posts returning `{ is_job_post: false }` in the system prompt.

**Warning signs:**
- Vacancy titles that match the channel's topic but not typical job posts ("New channel update - Senior position open")
- Companies named after Telegram channel usernames
- Salary figures on obvious promotional posts

**Phase to address:** LLM extraction phase

---

### Pitfall 5: LLM Returning One Vacancy When Post Contains Many

**What goes wrong:**
Telegram job channels in Uzbekistan frequently post weekly digests with 5–15 jobs in a single message. If the extraction schema is `VacancySchema` (singular), the LLM silently picks the first vacancy and discards the rest. Row count looks plausible, but coverage is 10–20% of actual postings.

**Why it happens:**
Singular output schemas are the default. Developers test with single-job posts, the extraction looks correct, and multi-job posts are never noticed as a coverage gap.

**How to avoid:**
Always define the extraction return type as `{ is_job_post: boolean, vacancies: VacancySchema[] }` — an array, even when a single vacancy is expected. Test with at least one real multi-job digest post. Include a few-shot example of a digest post that returns 3+ vacancies.

**Warning signs:**
- Channels known to post digests producing only 1 vacancy per message
- Vacancy count per channel is much lower than manually scrolling suggests

**Phase to address:** LLM extraction phase — schema design must use array from the start; retrofitting is painful

---

### Pitfall 6: Cost Runaway from Re-Extracting Identical Content

**What goes wrong:**
Every `ingest` run re-sends all fetched posts to Claude Haiku for extraction. For a channel with 500 historical posts, each run costs 500 × (average post tokens) × Haiku price. Running `ingest` 10 times during development costs 10× unnecessarily.

**Why it happens:**
Extraction cache (content hash → structured result) is added "later." Developers start without it, intending to add it after correctness is proven. They forget, or add it only to the DB insertion step (dedup) rather than the API call step (extraction cache).

**How to avoid:**
Implement the extraction cache before writing the first extraction call. Store `content_hash → extraction_result` in a SQLite table. Before calling Claude, check cache. After receiving a response, write to cache. The cache must be checked at the HTTP client layer, not at the dedup layer — they are different concerns. Also: never re-fetch Telegram messages already in the `raw_posts` table (use `min_id` cursor).

**Warning signs:**
- API cost in development is unexpectedly high
- Anthropic dashboard shows many identical prompt prefixes
- Running `ingest` twice produces the same number of new API calls both times

**Phase to address:** LLM extraction phase — implement cache before any extraction logic

---

### Pitfall 7: Dedup False Negatives from Un-Normalized Input

**What goes wrong:**
SHA-256 hash of `title + company + description_prefix` is computed on raw LLM output. The same vacancy appears twice because one extraction returned "Senior Developer" and another returned "Senior Developer " (trailing space), or one used Cyrillic "о" (U+043E) and another used Latin "o" (U+006F) in the company name — visually identical, hash-different.

**Why it happens:**
Hash-based dedup is applied to LLM output without normalization. LLMs are non-deterministic: minor whitespace and Unicode variation is normal across runs. Mixed Cyrillic/Latin homoglyphs are extremely common in Uzbek/Russian text.

**How to avoid:**
Before computing the dedup hash: (1) trim and collapse all whitespace to single spaces, (2) apply Unicode NFC normalization (`text.normalize('NFC')`), (3) lowercase. Apply these transforms to each field individually before concatenating for the hash. This normalization is a ~10-line utility function — write it once, use it everywhere.

**Warning signs:**
- Same vacancy visible twice in `list` output with slightly different formatting
- Companies appear with identical names but different casing

**Phase to address:** Dedup implementation phase — normalization must be part of the initial dedup design, not a patch

---

### Pitfall 8: hh.uz API Pagination Truncation

**What goes wrong:**
The hh.ru/hh.uz API caps results at page 20 with per_page 100 = 2,000 results maximum per search query. If the query returns more than 2,000 matches (e.g., broad "IT" search across all of Uzbekistan), results beyond page 20 are silently inaccessible. The pagination loop exits normally at page 20 with `pages === 20`, giving no indication that more records exist.

**Why it happens:**
Developers read `found: 4521` in the first response, observe 20 pages × 100 = 2,000 fetched, and assume the API just has 2,000 results. The 2,000-result hard cap is not documented prominently.

**How to avoid:**
After pagination completes, compare `total_fetched` against `found` from the first response. If `total_fetched < found`, log a warning: "Query returned N results but API cap reached (2000). Narrow the query using specialization or area filters." Design the hh.uz adapter with query segmentation from the start — split broad queries by `specialization` or `area` parameters to stay under the cap per segment.

**Warning signs:**
- `found` in first page response >> 2,000
- Pagination loop exits at exactly page 20
- Missing vacancies that should be in the result set

**Phase to address:** hh.uz adapter implementation

---

### Pitfall 9: SQLite "Database Is Locked" Under Concurrent CLI Invocations

**What goes wrong:**
Two `hire-radar ingest` processes are started concurrently (e.g., cron fires while previous run still active). The second process fails with `SQLITE_BUSY` or `database is locked` because the first process holds a write transaction.

**Why it happens:**
SQLite allows only one writer at a time. The default journal mode (`DELETE`) blocks readers during writes too. Without WAL mode and a `busy_timeout`, the second writer immediately throws instead of waiting.

**How to avoid:**
Enable WAL mode on first connection: `PRAGMA journal_mode=WAL`. Set a busy timeout: `PRAGMA busy_timeout=10000` (10 seconds). Use better-sqlite3's synchronous API — never mix async database calls with transactions. Add a file-based lock (`ingest.lock`) at CLI startup that is removed on exit (including SIGINT/SIGTERM) to prevent overlapping runs entirely.

**Warning signs:**
- `SQLITE_BUSY` errors in logs
- Incomplete vacancies in DB after a failed run
- Lock file not cleaned up after crash (stale lock)

**Phase to address:** SQLite persistence phase

---

### Pitfall 10: better-sqlite3 Transactions Not Working with Async Code

**What goes wrong:**
A developer wraps batch inserts in a better-sqlite3 `.transaction()` call but uses `async/await` inside it. The transaction commits immediately after the first `await` (before async work completes), leaving partial data committed and subsequent failures unrolled without rolling back already-written rows.

**Why it happens:**
better-sqlite3 is a synchronous library by design. Its `.transaction()` wrapper executes synchronously — any `async` function passed to it returns a Promise on the first `await`, which better-sqlite3 sees as the function returning (successfully), and commits immediately.

**How to avoid:**
Keep all better-sqlite3 operations strictly synchronous. Perform all async work (API calls, LLM extraction) before opening the transaction. Inside the transaction function: only synchronous DB writes, no `await`, no Promises. Structure the pipeline as: `fetch (async)` → `extract (async)` → `write (sync transaction)`.

**Warning signs:**
- Partial data in DB after errors during a "transactional" insert batch
- Transaction completes but some rows are missing

**Phase to address:** SQLite persistence phase — enforce the sync/async boundary in the initial DB layer design

---

### Pitfall 11: RSS Feed Encoding Breakage on Non-UTF-8 Feeds

**What goes wrong:**
Some Uzbek/Russian job RSS feeds declare `charset=windows-1251` or `ISO-8859-5` in their XML header but are served with `Content-Type: application/rss+xml` without charset. Node.js RSS parsers default to UTF-8, producing mojibake that breaks LLM extraction and corrupts stored text.

**Why it happens:**
Developers test with well-behaved feeds. Legacy Central Asian sites running older CMS versions frequently use non-UTF-8 encodings.

**How to avoid:**
Before parsing, detect the XML declaration's `encoding` attribute with a regex on the raw buffer (`<?xml version="1.0" encoding="windows-1251"?>`). If non-UTF-8, transcode with `iconv-lite` before passing to the parser. Log the original encoding for observability. Validate parsed text is valid UTF-8 after conversion.

**Warning signs:**
- Vacancy titles contain `Ð` characters or sequences like `Ð²Ð°ÐºÐ°Ð½ÑÐ¸Ñ`
- LLM extraction quality drops sharply for one RSS source

**Phase to address:** RSS adapter implementation

---

### Pitfall 12: No High-Watermark Cursor on Telegram Reads

**What goes wrong:**
Every `ingest` run fetches the full channel history (or a large `limit`). This re-processes all historical messages, wastes API calls on extraction cache misses (first run), and risks FloodWait on large channels.

**Why it happens:**
Incremental ingestion feels like an optimization — "we'll add it later." Without it, the first working prototype is correct but not production-safe.

**How to avoid:**
From the first implementation, store `last_message_id` per channel in SQLite after a successful run. On subsequent runs, pass `min_id: last_message_id` to `getMessages`. This is not an optimization — it is the correct behavior. Only fetch from the beginning on explicit `--full-history` flag.

**Warning signs:**
- Run time grows linearly with channel history depth
- Extraction cache hit rate should be >95% on repeat runs; if it is 0%, watermark is not working

**Phase to address:** Telegram adapter implementation

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Skip extraction cache initially | Simpler first pass | API costs 10-100x higher on re-runs; dev bill accumulates fast | Never — build cache before first extraction call |
| Singular schema for LLM output | Simpler parsing | Silently misses multi-job posts; data coverage gap is invisible | Never for Telegram sources where digests are common |
| Skip `is_job_post` gate | Fewer prompt tokens | Fabricated vacancies pollute DB permanently; hard to identify later | Never |
| Fetch full channel history every run | No cursor state to manage | FloodWait risk + account ban risk on large channels | Only during initial backfill with explicit flag |
| No WAL mode / no busy_timeout | Zero config | Any concurrent CLI invocation crashes with SQLITE_BUSY | Never — 2-line fix, no downside |
| Personal Telegram account for dev | Convenient | Permanent phone ban if triggered | Never — use a dedicated dev account |

---

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| gramjs | Instantiate client without session validation | Call `isUserAuthorized()` on startup; abort with clear message if false |
| gramjs | Parallelize channel fetches to save time | Sequential only with jitter delays; parallelism guarantees FloodWait |
| gramjs | Use `getMessages` with no `min_id` | Always pass `min_id: lastMessageId` from stored watermark |
| hh.uz API | Assume all results are fetched when pages loop exits | Compare `total_fetched` vs `found`; warn if gap detected |
| hh.uz API | Use unauthenticated requests assuming they work indefinitely | hh.uz free API requires User-Agent header; anonymous abuse triggers 429 blocks |
| Claude Haiku | Send one post per API call | Batch multiple posts per call (up to model context limit) to reduce per-call overhead |
| Claude Haiku | Ignore Anthropic Batch API | For non-realtime ingestion, Batch API gives 50% cost reduction with same quality |
| better-sqlite3 | Use async callbacks inside `.transaction()` | All DB writes must be synchronous; async work must complete before opening transaction |
| RSS parser | Trust `Content-Type` header for encoding | Read XML declaration's `encoding` attribute; transcode with iconv-lite if non-UTF-8 |

---

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| One LLM call per post | Extraction takes minutes even for 50 posts | Batch 5–10 posts per call using array schema | Any run with >20 posts |
| No extraction cache | Re-run costs multiply linearly | SHA-256 content hash → cache table checked before every API call | First repeated `ingest` run |
| Full channel re-read without `min_id` | Run time grows with channel age | Store `last_message_id` watermark per channel in SQLite | Channels older than ~2 weeks |
| Synchronous DNS / HTTP in tight loops | RSS adapter blocks event loop | Use `Promise.all` with concurrency limit for RSS (unlike Telegram, parallel RSS is safe) | >5 RSS feeds |
| No index on `content_hash` in cache table | Cache lookup becomes a full scan | Create index on `content_hash` at table creation | Cache table exceeds ~10k rows |

---

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Store session string in `.env` committed to repo | Full Telegram account takeover by anyone with repo access | Add `.env` to `.gitignore` before first commit; use env-specific files only |
| Log session string in debug output | Session exposed in log files or CI outputs | Never log `process.env.TELEGRAM_SESSION`; log only first/last 4 chars if needed |
| Store Anthropic API key in config file | Cost runaway if key is leaked | Env variable only; never in config files that may be shared |
| No rate-limit respect on hh.uz | IP ban from hh.uz | Honor `Retry-After` headers; add 500ms minimum between paginated requests |

---

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Silent zero-result run | User assumes there are no new vacancies; actually an auth/config failure | Print source-by-source summary: "Telegram: 0 fetched (auth error), hh.uz: 45 fetched, RSS: 12 fetched" |
| No progress indication during LLM extraction | Appears frozen for 30+ seconds on first run | Print per-batch progress: "Extracting batch 3/12..." |
| Error exits with no actionable message | User doesn't know how to fix | Every error exit should say what went wrong AND what to do: "SESSION_STRING invalid — re-run `hire-radar auth` to reauthenticate" |
| `list` command returns thousands of rows | Terminal flood | Default to `--limit 20`; require `--limit all` for full dump |

---

## "Looks Done But Isn't" Checklist

- [ ] **Telegram adapter:** Uses `min_id` watermark — verify by running twice and checking that second run fetches 0 new messages from unchanged channels
- [ ] **Extraction cache:** Checked before API call, not just before DB insert — verify by running twice; second run should show 0 Anthropic API calls for unchanged posts
- [ ] **Multi-vacancy extraction:** Schema is `vacancies: VacancySchema[]` not `VacancySchema` — verify with a known digest post that contains 3+ jobs
- [ ] **Non-job filter:** `is_job_post: false` posts are discarded before DB insert — verify with a channel announcement post
- [ ] **Dedup normalization:** Applied before hash computation — verify by inserting a vacancy, then inserting the same post with a trailing space; should not create duplicate
- [ ] **SQLite WAL:** `PRAGMA journal_mode` returns `wal` — verify with `PRAGMA journal_mode;` query after connection
- [ ] **Session validation:** `isUserAuthorized()` is called and false triggers clear abort — verify by using an intentionally invalid session string
- [ ] **FloodWait handling:** Caught at adapter level with retry — verify exists in code; test with mock that throws `FloodWaitError` with 5 seconds

---

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Account banned (permanent) | HIGH | Register new Telegram account with different number; update SESSION_STRING and credentials |
| Hallucinated vacancies in DB | MEDIUM | Add `is_job_post` filter retroactively; run `DELETE FROM vacancies WHERE source = 'telegram' AND created_at > ?` for affected time window; re-extract from cached raw posts |
| Extraction cache missing (cost runaway) | LOW | Add cache table; mark all existing raw posts as cached with their stored extraction results; future runs are free |
| Dedup normalization missing (duplicates in DB) | MEDIUM | Write migration script: re-compute normalized hashes for all rows, remove rows where normalized hash matches an earlier row |
| Partial run due to unhandled FloodWait | LOW | Re-run `ingest`; watermark cursor ensures only missed messages are re-fetched |
| SQLite locked after crash | LOW | Delete stale `.ingest.lock` file; verify DB integrity with `PRAGMA integrity_check` |

---

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| Session invalidation on restart | Telegram adapter | Intentionally pass invalid session; verify clear error message |
| FloodWaitError partial run | Telegram adapter | Mock FloodWaitError in tests; verify retry logic and partial-run resume |
| Account ban from aggressive reads | Telegram adapter (watermark + delays) | Verify `min_id` used on second run; verify inter-channel delay exists |
| LLM hallucinating non-job posts | LLM extraction | Test with 5 non-job posts; verify all return `is_job_post: false` |
| Multi-job posts returning one vacancy | LLM extraction (schema design) | Test with known digest post; verify multiple vacancies returned |
| Cost runaway from re-extraction | LLM extraction (cache before first call) | Run twice; verify Anthropic call count = 0 on second run for unchanged posts |
| Dedup false negatives from normalization | Dedup implementation | Insert identical post with whitespace variant; verify single DB row |
| hh.uz pagination truncation | hh.uz adapter | Query broad term; verify warning logged if `found > 2000` |
| SQLite locked under concurrent runs | SQLite persistence (WAL + lock file) | Start two processes simultaneously; verify second fails cleanly with message |
| better-sqlite3 async in transactions | SQLite persistence | Code review gate: no `await` inside `.transaction()` callbacks |
| RSS encoding breakage | RSS adapter | Test against a windows-1251 encoded feed fixture |
| No watermark cursor | Telegram adapter | Run twice; verify second run fetches 0 messages from static channel |

---

## Sources

- gramjs handling errors documentation: https://painor.gitbook.io/gramjs/getting-started/handling-errors
- gramjs authentication: https://painor.gitbook.io/gramjs/getting-started/authorization
- gramjs account ban issue (real reports): https://github.com/gram-js/gramjs/issues/66
- gramjs session reconnect issue: https://github.com/gram-js/gramjs/issues/665
- Telegram FloodWait prevention guide: https://telmemeber.com/single/79/
- LLM structured data extraction failures: https://medium.com/@aman005mishra/why-llms-struggle-with-structured-data-extraction-from-unstructured-documents-7e2af6be60b0
- Constrained decoding vs semantic correctness: https://letsdatascience.com/blog/structured-outputs-making-llms-return-reliable-json
- hh.ru API vacancy search: https://github.com/hhru/api/blob/master/docs/vacancies.md
- SQLite WAL concurrency: https://www.sqliteforum.com/p/handling-concurrency-in-sqlite-best
- better-sqlite3 transaction API: https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md
- Uzbek Unicode/apostrophe tokenization issues: https://arxiv.org/pdf/2301.12711
- Deduplication normalization importance: https://buildai.substack.com/p/data-deduplication
- Job posting deduplication near-duplicates: https://www.textkernel.com/learn-support/blog/online-job-postings-have-many-duplicates-but-how-can-you-detect-them-if-they-are-not-exact-copies-of-each-other/
- Anthropic Batch API 50% cost reduction: https://www.codewords.ai/blog/anthropic-batch-api
- Idempotent pipeline design: https://www.prefect.io/blog/the-importance-of-idempotent-data-pipelines-for-resilience

---
*Pitfalls research for: job-vacancy ingestion agent (Telegram + hh.uz + RSS + LLM)*
*Researched: 2026-06-13*
