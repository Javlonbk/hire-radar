# Milestones

## v1.0 MVP (Shipped: 2026-06-13)

**Phases completed:** 4 phases, 15 plans

**Delivered:** A working standalone CLI that ingests job vacancies from hh.uz, RSS feeds, and Telegram channels, extracts structured data with Claude Haiku, deduplicates, and persists to SQLite — with `ingest`, `list`, `export`, and `auth` commands.

**Key accomplishments:**

- **Foundation (Phase 1):** SQLite 4-table schema (sources, raw_items, extraction_cache, vacancies) with WAL mode and idempotent init; Zod 4 config loader merging env secrets with JSON non-secrets; SHA-256 content hashing with Cyrillic/Latin homoglyph folding.
- **Source adapters (Phase 2):** hh.uz (date cursor + pagination), RSS (conditional GET + windows-1251 transcode), and Telegram (gramjs, session gate, offsetId watermark, FloodWait retry) behind a uniform `SourceAdapter` interface, run by a fault-isolated orchestrator with raw-before-extract persistence.
- **AI extraction (Phase 3):** single-stage Claude Haiku extraction via forced tool-use with Zod validation and retry-once-skip; content-hash cache that makes re-runs zero-API-call; `is_job_post` gate + multi-job arrays; normalized-hash vacancy dedup.
- **CLI (Phase 4):** `commander`-based `ingest` (orchestrator→extractor with per-run stats), `list` (aligned columns, filters, default limit 20), `export` (pipeable JSON array), and one-time interactive Telegram `auth`; `dotenv` loaded at entry; auth decoupled from the Anthropic key.

**Stats:** ~1,300 src LOC + ~2,700 test LOC (TypeScript ESM); 175 tests; 120 commits; built in one day.

**Tech debt at close (non-blocking):** unused `APP_NAME` bootstrap export; `vacancies.posted_at` column declared but unpopulated (filtering uses `created_at`); fixed DB path `data/hire-radar.db`. See `milestones/v1.0-MILESTONE-AUDIT.md`.

---
