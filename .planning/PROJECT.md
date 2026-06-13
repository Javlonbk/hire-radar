# Hire Radar

## What This Is

A standalone job-vacancy ingestion agent for the Uzbekistan / Central Asia market, run as a CLI. It pulls raw job postings from Telegram channels, the hh.uz API, and RSS feeds; uses Claude (Haiku) to extract structured vacancies from messy multilingual posts; deduplicates; and persists everything to SQLite with list/export commands for browsing the results. Its purpose is derived from the kasbim repo's vacancy ingestion agent design (`technical-architecture.md` §9) — built here as an independent, lightweight implementation rather than inside the kasbim NestJS monorepo.

## Core Value

Run `hire-radar ingest` and reliably end up with clean, structured, deduplicated vacancies in SQLite — no matter how messy the source posts are.

## Requirements

### Validated

- ✓ Persistence to SQLite (4-table schema, WAL mode) — Phase 1
- ✓ Configuration: Telegram credentials, channel whitelist, hh.uz filters, RSS feed URLs from config/env — Phase 1
- ✓ Content hashing with Cyrillic/Latin homoglyph folding — Phase 1
- ✓ Source adapters: Telegram (gramjs), hh.uz REST API, RSS feeds — with per-source fault isolation, cursors, and raw-before-extract persistence — Phase 2
- ✓ AI extraction: Claude Haiku → structured vacancies (single-stage tool-use, is_job_post gate, multi-job arrays) — Phase 3
- ✓ Extraction caching by content hash (zero API calls on re-run) — Phase 3
- ✓ Deduplication: SHA-256 of normalized title + company + description prefix — Phase 3
- ✓ CLI: `ingest`, `list`, `export`, and one-time Telegram `auth` — Phase 4

### Active

(None — v1.0 milestone complete; all Active requirements validated)

### Out of Scope

- User matching, match scores, notifications — kasbim Phase 1 features; this project is ingestion only
- Always-on daemon / internal scheduler — CLI on demand (system cron if needed); simpler, no process management
- Embedding-based dedup (cosine similarity) — v2; hash dedup catches exact reposts at zero API cost
- Playwright scrapers (OLX/jobs.uz, career pages) — deferred; most fragile adapters, not in v1 sources
- LinkedIn scraping — prohibited (ToS/legal), same rule as kasbim
- Web UI / API server — DB + CLI is the interface

## Current State

**v1.0 MVP shipped 2026-06-13** (tagged `v1.0`). A working CLI: `ingest` (hh.uz + RSS + Telegram → Claude Haiku extraction → SQLite), `list`, `export`, `auth`. ~1,300 src LOC + ~2,700 test LOC TypeScript ESM; 175 tests; better-sqlite3 + gramjs + Anthropic SDK 0.102 + Zod 4 + commander. All 16 v1 requirements validated. Next milestone: start with `/gsd-new-milestone` (candidates: embedding dedup, Playwright sources, Batch API cost optimization — all currently Out of Scope).

## Context

- Sibling repo `~/projects/kasbim` contains the architecture this derives from (`technical-architecture.md` §9: source registry → adapter → AI extractor → dedup → persist).
- Market specifics: Telegram is the #1 job-sourcing channel in Central Asia. Posts are messy — emojis, broken formatting, multiple jobs per post, mixed uz-Latn/uz-Cyrl/ru/en.
- User already has Telegram API credentials (api_id/api_hash) and a channel whitelist ready.
- hh.uz exposes a free official REST API with generous rate limits — most reliable source.
- AI cost is a design constraint (inherited from kasbim): Haiku for bulk extraction, cache by content hash, batch where possible.

## Constraints

- **Tech stack**: Plain Node.js/TypeScript CLI — deliberately NOT the kasbim NestJS/BullMQ/monorepo stack; keep it light
- **Storage**: SQLite — zero infra, single file, fits a standalone CLI
- **AI**: Claude Haiku for extraction via Anthropic API — cost control
- **Scraping ethics**: public Telegram channels only, respect hh.uz rate limits, no LinkedIn — legal/ToS risk
- **Runtime**: CLI on demand, no daemon — simplicity

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Standalone repo, not inside kasbim | Independent lightweight experiment; kasbim's apps/agent is an empty scaffold | ✓ Good — shipped v1.0 |
| Plain Node/TS over NestJS+BullMQ | No queue/DI overhead needed for a CLI | ✓ Good — kept it light |
| SQLite over Postgres+pgvector | Zero infra for standalone use; revisit if merging into kasbim | ✓ Good — zero infra, WAL works well |
| Hash-only dedup in v1 | Catches exact reposts free; embedding similarity deferred to v2 | ✓ Good — title+company+desc hash; embedding is v2 |
| CLI on demand over daemon | No process management; system cron covers scheduling | ✓ Good |
| v1 sources: Telegram + hh.uz + RSS | Highest-value sources; Playwright scrapers most fragile, deferred | ✓ Good — all three wired E2E |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-06-13 after v1.0 milestone*
