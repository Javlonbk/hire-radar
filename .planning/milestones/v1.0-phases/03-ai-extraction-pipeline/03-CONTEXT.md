# Phase 3: AI Extraction Pipeline - Context

**Gathered:** 2026-06-13
**Status:** Ready for planning

<domain>
## Phase Boundary

Raw posts are automatically converted to structured, deduplicated vacancies in SQLite using Claude Haiku, with API calls gated by a content-hash cache. Delivers: an extractor that pulls pending `raw_items`, calls Claude Haiku once per item with a structured-output contract, parses/validates the result, writes `vacancies` rows (one per job, multi-job posts → multiple rows), caches the raw model response by content hash so re-runs make zero API calls, and dedups vacancies by a normalized content hash. NO CLI surface (the `ingest` command that drives this end-to-end is wired in Phase 4 — this phase exposes an extraction function the orchestrator/CLI call). NO embedding-based dedup (v2). NO new sources.

</domain>

<decisions>
## Implementation Decisions

### Extraction Strategy & Model
- Single-stage extraction: one Haiku call per raw item returns `{ is_job_post, vacancies[] }`; the `is_job_post:false` + empty array is itself the cheap reject path (no separate classify call)
- Model: `claude-haiku-4-5`, read from config with that default (cost constraint per PROJECT.md)
- Structured output via the Anthropic SDK using a Zod-derived JSON schema; validate the response with Zod 4 on return; on validation failure retry once, then skip the item and log (do not crash the run)
- Synchronous API calls in v1 (simpler, immediate; the content-hash cache makes re-runs free). Anthropic Batch API (≈50% cost) is a deferred optimization, not built here

### Vacancy Schema & Extraction Contract
- Output schema is always `{ is_job_post: boolean, vacancies: Vacancy[] }` — an array even for a single job; non-job posts → `is_job_post:false, vacancies:[]` (array shape is locked from day one; retrofitting later is painful — PITFALL)
- Vacancy fields: title, company, description, location, remote_type (`onsite|remote|hybrid|null`), salary_min, salary_max, salary_currency, skills[] (string array), apply_contact, lang (`uz-Latn|uz-Cyrl|ru|en`). Absent fields → `null`, never fabricated
- Persist to the existing `vacancies` table from the Phase 1 schema; map nullable model fields to columns; keep the link to the source `raw_item`
- Extract in the post's original language (no translation); record `lang`; the prompt instructs Cyrillic-Uzbek vs Russian disambiguation

### Caching & Deduplication
- Extraction cache key = `contentHash(raw_text)` → `extraction_cache` table, checked BEFORE any API call; stores the raw JSON model response so a second run on identical content makes zero API calls (Success Criterion 3)
- Vacancy dedup key = `contentHash(normalize(title + company + description-prefix))` → `vacancies.content_hash UNIQUE` + `INSERT OR IGNORE` (Success Criterion 4; reuses the Phase 1 `contentHash`/`normalize`)
- Each run pulls `raw_items` with `extraction_status = 'pending'`; mark `done`/`failed` after processing so the pipeline is resumable and idempotent
- Non-job post → mark the raw item `done` with 0 vacancies (still cached, won't reprocess); hard API failure → leave the raw item `pending`, log, continue (retry next run)

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/db/schema.sql` — `extraction_cache` and `vacancies` tables already exist (Phase 1); `raw_items.extraction_status` column defaults to `'pending'` (Phase 2 writes raws with this default)
- `src/hash.ts` — `normalize(text)` + `contentHash(text)`; reuse for both the extraction cache key (raw text) and the vacancy dedup key (normalized title+company+desc)
- `src/db/client.ts` — `openDatabase`, `runInTransaction` (synchronous; no `await` inside transactions — PITFALL-10)
- `src/db/raw-items.ts` — Phase 2 persistence; raw items land here with `extraction_status='pending'`
- `src/config.ts` — `loadConfig({ env })`; `ANTHROPIC_API_KEY` is an env-only secret already in the schema; add the model id as a non-secret config field with default `claude-haiku-4-5`
- `src/adapters/types.ts` — `RawItem` shape (the extractor consumes raw_items rows)

### Established Patterns
- ESM, Node 22, strict TS; tsx dev/run; vitest tests; better-sqlite3 synchronous
- Anthropic SDK ≥ 0.102 with Zod 4 (STACK.md compatibility constraint — Zod 3 fails); pin together
- Tests inject the Claude client / a fake so the suite never hits the live API (mirror the adapter fetchFn injection pattern from Phase 2)

### Integration Points
- Reads `raw_items` (pending) written by the Phase 2 orchestrator; writes `vacancies` + `extraction_cache`; updates `raw_items.extraction_status`
- Phase 4 CLI `ingest` will call: orchestrator (fetch raws) → extractor (this phase) in sequence

</code_context>

<specifics>
## Specific Ideas

- The `is_job_post` boolean gate must be the structural guard against hallucinated vacancies on non-job posts (PITFALL): filter before insert; never write rows when `is_job_post` is false.
- Uzbek digest posts routinely contain 5–15 jobs in one message — the array path is the common case, not an edge case.
- The cache must gate the HTTP call itself (check cache → if hit, skip the API entirely), not just the DB insert — this is a correctness/cost requirement, not an optimization.
- Multi-vacancy mapping to cache: one `extraction_cache` row per raw-text hash holds the whole `{is_job_post, vacancies[]}` response; replaying the cache re-derives all vacancy rows without an API call.

</specifics>

<deferred>
## Deferred Ideas

- Anthropic Batch API (≈50% cost reduction) — deferred optimization; v1 is synchronous
- Embedding/semantic dedup (cosine > 0.95) — project Out of Scope / v2
- The user-facing `ingest` CLI command, flags, per-run extraction stats output — Phase 4
- Two-stage classify→extract cost optimization — not needed at Haiku pricing; revisit only if cost becomes a problem

</deferred>
