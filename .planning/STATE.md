---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
status: completed
stopped_at: "Completed 04-cli-commands/04-01: queryVacancies filter helper"
last_updated: "2026-06-13T09:21:07.262Z"
last_activity: 2026-06-13
progress:
  total_phases: 4
  completed_phases: 4
  total_plans: 15
  completed_plans: 15
  percent: 100
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-06-13)

**Core value:** Run `hire-radar ingest` and reliably end up with clean, structured, deduplicated vacancies in SQLite — no matter how messy the source posts are.
**Current focus:** Phase 4 — CLI Commands

## Current Position

Phase: 4
Plan: Not started
Status: Milestone complete
Last activity: 2026-06-13

Progress: [██████████] 100%

## Performance Metrics

**Velocity:**

- Total plans completed: 15
- Average duration: -
- Total execution time: 0 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 1 | 3 | - | - |
| 2 | 4 | - | - |
| 3 | 3 | - | - |
| 4 | 5 | - | - |

**Recent Trend:**

- Last 5 plans: -
- Trend: -

*Updated after each plan completion*
| Phase 01-foundation P01 | 2min | 2 tasks | 6 files |
| Phase 01-foundation P02 | 2min | 2 tasks | 3 files |
| Phase 01-foundation P03 | 3min | 2 tasks | 4 files |
| Phase 02-source-adapters P01 | 4min | 2 tasks | 7 files |
| Phase 02-source-adapters P02 | 3min | 1 tasks | 4 files |
| Phase 02-source-adapters P03 | 4min | 2 tasks | 4 files |
| Phase 02-source-adapters P04 | 8min | 2 tasks | 4 files |
| Phase 03-ai-extraction-pipeline P01 | 3min | 2 tasks | 7 files |
| Phase 03-ai-extraction-pipeline P02 | 8min | 2 tasks | 4 files |
| Phase 03-ai-extraction-pipeline P03 | 4min | 2 tasks | 7 files |
| Phase 04-cli-commands P01 | 2min | - tasks | - files |
| Phase 04-cli-commands P04 | 2min | 1 tasks | 2 files |
| Phase 04-cli-commands P05 | 5min | 1 tasks | 2 files |

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- Init: Standalone Node/TS CLI (not NestJS); SQLite; hash-only dedup in v1; CLI on demand
- Stack: gramjs 2.17.4, @anthropic-ai/sdk 0.102.0+, better-sqlite3 12.4.1, zod 4.4+, tsx 4.22.4
- [Phase ?]: No tsconfig paths aliases — tsx 4.22.4 does not respect them without extra config; moduleResolution: bundler per STACK.md; secrets in env only per ARCHITECTURE.md Anti-Pattern 4
- [01-02]: WAL + busy_timeout=10000 set in client.ts (not schema.sql) — every connection type (file + :memory:) gets PITFALL-9 protection automatically
- [01-02]: runInTransaction is strictly synchronous (no async wrapper) — enforces PITFALL-10 at the API boundary
- [Phase ?]: normalize() fold map: р→p not r — Cyrillic р is confusable for Latin p
- [Phase ?]: loadConfig error path: ENV_VAR_NAMES lookup translates Zod camelCase to env var names
- [Phase ?]: loadConfig is pure — no dotenv; env injected by caller for testability
- [Phase ?]: RSS adapter
- [Phase ?]: RSS adapter
- [Phase 02-03]: adapter.id.split(':')[0] derives sources.type column value — no extra field needed on SourceAdapter
- [Phase 02-03]: runStart captured once at orchestrator entry used as cursor lastFetchedAt for all succeeding adapters — consistent high-water mark per run
- [Phase ?]: 02-04
- [Phase ?]: EXTRACTION_TOOL.input_schema is hand-written JSON Schema (not auto-derived from Zod) — Anthropic SDK tool API requires a plain JSON Schema object
- [Phase ?]: getCachedExtraction returns raw unknown — cache is a pure byte store; Zod validation is the extractor's responsibility
- [Phase ?]: anthropicModel is a file-config field with Zod default claude-haiku-4-5 (not env) — only ANTHROPIC_API_KEY is env-only
- [Phase ?]: MessageCreate injection seam mirrors HhOptions.fetchFn — callClaude never instantiates Anthropic directly
- [Phase ?]: getCachedExtraction strictly before callClaude — cache gates the HTTP call, not just the DB insert
- [Phase ?]: created_at used as date column for filtering (posted_at always NULL in v1)
- [Phase ?]: queryVacancies centralizes list+export filter logic using single parameterized SQL builder
- [Phase ?]: runIngest injectable-deps + deduped=max(0,processed-vacanciesInserted-nonJob) — dedup-suppressed formula

### Pending Todos

None yet.

### Blockers/Concerns

- Telegram: use a dedicated secondary account for dev; aggressive full-history reads can permanently ban the phone number
- LLM prompt quality for uz-Latn/uz-Cyrl/Russian mixed posts needs iteration on real channel data (Phase 3)
- Anthropic Batch API viability (50% cost reduction) should be evaluated during Phase 3 planning

## Deferred Items

| Category | Item | Status | Deferred At |
|----------|------|--------|-------------|
| Dedup | Embedding-based similarity dedup (DDUP-01) | v2 | Init |
| Sources | Playwright adapter OLX/jobs.uz (SRCE-06) | v2 | Init |
| Sources | Company career page watcher (SRCE-07) | v2 | Init |

## Session Continuity

Last session: 2026-06-13T08:49:36.473Z
Stopped at: Completed 04-cli-commands/04-01: queryVacancies filter helper
Resume file: None
