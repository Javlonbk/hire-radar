# Phase 1: Foundation - Context

**Gathered:** 2026-06-13
**Status:** Ready for planning

<domain>
## Phase Boundary

The database, config, and hash utilities exist and are correct so every other layer can build on them. Delivers: 4-table SQLite schema (sources, raw_items, extraction_cache, vacancies) in WAL mode; config loading from file/env with Zod validation and actionable errors on missing values; text normalization (NFC, trim, lowercase) + SHA-256 hashing that treats Uzbek Cyrillic/Latin homoglyph variants identically. No adapters, no extraction, no CLI commands.

</domain>

<decisions>
## Implementation Decisions

### Claude's Discretion
All implementation choices are at Claude's discretion — pure infrastructure phase. Follow .planning/research/STACK.md (better-sqlite3, Zod 4, tsx, vitest) and ARCHITECTURE.md (schema design, sync/async boundary, WAL mode) recommendations.

</decisions>

<code_context>
## Existing Code Insights

Greenfield — no code exists yet. Research artifacts in .planning/research/ define the stack (STACK.md), schema and component boundaries (ARCHITECTURE.md), and foundation-phase pitfalls to avoid (PITFALLS.md: WAL mode + busy_timeout from the start, no `await` inside better-sqlite3 transactions, normalize-before-hash).

</code_context>

<specifics>
## Specific Ideas

No specific requirements — infrastructure phase.

</specifics>

<deferred>
## Deferred Ideas

None

</deferred>
