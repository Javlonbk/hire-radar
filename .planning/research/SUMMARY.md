# Project Research Summary

**Project:** hire-radar
**Domain:** Job-vacancy ingestion agent (Node/TypeScript CLI)
**Researched:** 2026-06-13
**Confidence:** HIGH

## Executive Summary

hire-radar is a single-user CLI data-ingestion pipeline that fetches job postings from three heterogeneous sources (Telegram channels via MTProto user-bot, hh.uz REST API, and RSS feeds), extracts structured vacancy data via Claude Haiku, deduplicates, and persists to a local SQLite database with a queryable CLI interface. Experts build this class of tool with a strict adapter pattern — raw data flows from source adapters into a persistence layer before any extraction occurs, enabling idempotent re-runs and cost-free re-extraction from cached raw payloads. The entire stack is intentionally minimal: Node.js 22 + TypeScript 5.x + gramjs + better-sqlite3 + Anthropic SDK, with no ORM, no framework, and no daemon.

The recommended approach is a sequential, source-isolated pipeline: each adapter fetches raw items incrementally via per-source cursor, every raw item is persisted before LLM extraction is attempted, a SHA-256 content-hash cache gates every Claude API call, and vacancy dedup runs on a normalized composite hash of structured output fields. This ordering is not optional — it is the architecture. Skipping any layer creates cost runaway, data loss on failure, or invisible coverage gaps from multi-job digest posts.

The two highest risks are Telegram account health and LLM extraction correctness. A Telegram account used aggressively during development (repeated full-history reads, frequent re-authentication) can be permanently banned at the phone number level. LLM extraction without an `is_job_post` gate and an array-typed output schema silently pollutes the database with fabricated vacancies and misses the majority of digest posts. Both risks must be addressed from the first line of Telegram and extraction code — they cannot be patched in later.

## Key Findings

### Stack (HIGH confidence — all versions verified on npm)

The stack is fully determined by three constraints: user-bot Telegram access (requires MTProto), structured LLM extraction (requires Anthropic SDK + Zod 4), and synchronous SQLite writes composing cleanly with CLI execution (requires better-sqlite3). Critical compatibility: `@anthropic-ai/sdk` 0.102.0+ requires Zod 4 — Zod 3 fails at runtime. `node:sqlite` is Stability 1.1 experimental in Node 22/23 — never use it. `ts-node` is dead for ESM — use `tsx`.

Core: Node.js 22 LTS, TypeScript 5.7+, gramjs 2.17.4, `@anthropic-ai/sdk` 0.102.0+, better-sqlite3 12.4.1, zod 4.4+, commander 15.0.0, tsx 4.22.4, rss-parser 3.13.0, vitest 4.1.8.

### Features (HIGH confidence for pipeline patterns, MEDIUM for Central Asia specifics)

Must-have v1: incremental fetch with per-source cursor (Telegram `min_id`, hh.uz `date_from`, RSS ETag), source error isolation, FloodWait back-off, two-stage LLM pipeline (classify then extract — ~60-70% cost reduction on noisy channels), content-hash extraction cache, composite hash dedup, SQLite schema with `raw_json` retention, `ingest`/`list`/`export` commands, config/env separation, per-run stats.

Defer: embedding semantic dedup, Playwright scrapers, web UI, LinkedIn (ToS — never), built-in cron (delegate to system cron).

### Architecture (HIGH confidence)

Five separated layers in strict linear order: adapters → raw store → LLM extractor + cache → dedup/persist → read-only commands. Orchestrator runs sources sequentially (never concurrently). Adapter interface `fetch(since: Date): Promise<RawItem[]>` is the core boundary — pipeline never imports concrete adapters.

Build order: DB schema → hash/config utils → adapter interface → hh.uz adapter → RSS adapter → orchestrator → extractor → Telegram adapter → CLI commands → bin entry.

### Pitfalls (HIGH confidence — verified across multiple sources)

Top 7:
1. gramjs session invalidation — call `isUserAuthorized()` on every startup; abort with actionable message if false
2. LLM hallucinating on non-job posts — `is_job_post: boolean` as first schema field; few-shot non-job examples; filter before DB insert
3. Multi-vacancy digests returning one vacancy — output schema always `{ is_job_post: boolean, vacancies: VacancySchema[] }`; retrofitting is painful
4. Cost runaway from re-extraction — extraction cache before first Claude call; gates the HTTP call, not just the DB insert
5. Telegram account permanent ban — use dedicated secondary account for dev; `min_id` watermark from day one; inter-channel jitter (2-5s)
6. better-sqlite3 async in transactions — all DB writes synchronous; no `await` inside `.transaction()` callbacks
7. Dedup false negatives from unnormalized input — `trim()` + `normalize('NFC')` + `toLowerCase()` before hash; Cyrillic/Latin homoglyphs are common in Uzbek text

## Roadmap Implications

**Suggested phases: 6**

**Phase 1: Foundation — DB Schema, Config, Utilities**
Rationale: Every other layer writes to SQLite and reads from config. Nothing is testable without this. Delivers: 4-table SQLite schema (sources, raw_items, extraction_cache, vacancies), WAL mode + busy_timeout, config.ts with Zod validation, hash.ts normalize + SHA-256. Avoids PITFALL-9 (SQLite locking) and PITFALL-10 (async/sync boundary) from the start.

**Phase 2: hh.uz Adapter + Orchestrator Skeleton**
Rationale: Simplest adapter — pure REST, no session management — validates the adapter interface pattern and delivers a working fetch→persist pipeline with no LLM or Telegram complexity. Delivers: SourceAdapter interface, RawItem type, hh.ts with pagination + `date_from` cursor, orchestrator with per-source error isolation, source cursor in `sources` table. Addresses PITFALL-8 (hh.uz pagination truncation — warn when `total_fetched < found`).

**Phase 3: RSS Adapter**
Rationale: Second-simplest adapter; validates multi-source orchestrator before introducing LLM complexity. Short phase. Delivers: rss.ts with ETag/If-Modified-Since cursor, XML encoding detection + iconv-lite transcoding. Addresses PITFALL-11 (RSS encoding breakage on windows-1251 feeds).

**Phase 4: LLM Extraction Pipeline**
Rationale: Must come after raw persistence is working. Extraction cache must precede first Claude call. Schema decisions (array output, `is_job_post` gate) are irreversible once data is in the DB. Delivers: extraction_cache queries, extractor.ts with cache-check-before-call, two-stage prompt, vacancies INSERT OR IGNORE with normalized dedup hash, per-run stats. Addresses PITFALLS 4, 5, 6, 7. **Research flag:** Prompt engineering for uz-Latn/uz-Cyrl/Russian mixed-language posts needs iteration on real channel data; Anthropic Batch API (50% cost reduction) should be evaluated during planning.

**Phase 5: Telegram Adapter**
Rationale: Most complex adapter — gramjs session management, FloodWait, watermark — added last so all upstream recovery paths exist before introducing Telegram's failure modes. Delivers: telegram.ts with `isUserAuthorized()` check, `min_id` watermark from first commit, FloodWaitError catch-retry with 15% buffer, inter-channel jitter, session from env only. Addresses PITFALLS 1, 2, 3, 12. **Research flag:** gramjs `getMessages` at pagination boundary for old/archived channels needs empirical validation; FloodWait thresholds vary by account age.

**Phase 6: CLI Commands + Distribution**
Rationale: `ingest`, `list`, `export` are thin handlers over proven pipeline. Completes the user-facing surface. Delivers: all three commands with flags, default `--limit 20` on list, esbuild distribution bundle. Standard patterns — no research needed.

## Research Flags

Needs research during planning:
- Phase 4 (LLM Extraction): multilingual prompt quality for Uzbek scripts, Anthropic Batch API viability
- Phase 5 (Telegram Adapter): gramjs behavior on old/archived channels, FloodWait threshold empirical validation

Standard patterns (skip research-phase):
- Phase 1 (Foundation): SQLite schema + Zod config — fully documented, no unknowns
- Phase 2 (hh.uz): publicly documented REST API, standard pagination
- Phase 3 (RSS): solved problem, rss-parser fully documented
- Phase 6 (CLI): commander 15 documented, thin handlers over proven pipeline

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All library versions npm-verified; compatibility matrix explicitly checked |
| Features | HIGH/MEDIUM | Pipeline patterns HIGH; hh.uz rate limits and Central Asia Telegram norms MEDIUM |
| Architecture | HIGH | Component boundaries from project constraints + kasbim reference architecture |
| Pitfalls | HIGH | Core pitfalls verified across multiple independent sources |

**Overall: HIGH**

**Gaps:**
- hh.uz rate limits in practice — use 500ms inter-request delay conservatively; instrument actual response times
- Telegram FloodWait thresholds by channel count — validate on ≤5-channel test set before expanding
- Multilingual prompt quality — budget for iteration on real channel data in Phase 4
- Anthropic Batch API viability — evaluate batch vs synchronous tradeoff during Phase 4 planning
