# Phase 4: CLI Commands - Context

**Gathered:** 2026-06-13
**Status:** Ready for planning

<domain>
## Phase Boundary

Users can invoke `hire-radar ingest`, `list`, `export`, and `auth` from the terminal and receive clean output. This phase is the user-facing surface: thin `commander`-based command wrappers over the existing orchestrator (Phase 2), extractor (Phase 3), and DB functions (Phase 1–3). Delivers: the `bin` entry, `src/cli/` command layer, per-run ingest stats, vacancy querying/filtering for list + export, and the one-time interactive Telegram `auth` flow that produces a persistent session string. NO new sources, NO new extraction logic, NO business logic in the CLI layer — commands orchestrate existing functions.

</domain>

<decisions>
## Implementation Decisions

### CLI Framework & `ingest` Command
- CLI built with `commander` (already in STACK.md); a `bin/hire-radar` shim runs the CLI via tsx; `package.json` `bin` maps `hire-radar`
- `ingest` runs the full pipeline: Phase 2 `ingestSources` (fetch raws) → Phase 3 `extractPending` (extract+persist), in one command; supports `--source <id>` to limit to one source and `--since <date>` to override the cursor
- Per-run stats printed as a summary block: fetched, extracted, deduped (ignored), skipped, Claude API calls, and per-source errors (Success Criterion 1)
- Exit 0 if the run completed even with per-source errors (errors summarized in output); exit non-zero only on a fatal/config error

### `list` & `export` Commands
- Shared filter set on both: `--source`, `--keyword` (matches title/company/skills/description), `--since`/`--until` (date range), `--limit` (default 20 for list)
- `list` output: readable aligned columns / compact blocks — title — company — location — salary — source — date; truncate long fields; surface remote_type
- `export` output: a valid JSON array of full vacancy objects (all columns incl. lang) to stdout; same filters; `--limit` optional with NO default for export (export everything matching)
- Empty results: `list` prints a friendly "No vacancies match" to stderr and exits 0; `export` emits `[]` to stdout and exits 0 (pipeable)

### Telegram `auth` Command & Wiring
- `hire-radar auth` runs the interactive gramjs login (phone → code → optional 2FA) using `api_id`/`api_hash` from env, then prints the resulting **session string** for the user to store in env as `TELEGRAM_SESSION`
- The Telegram adapter reads `TELEGRAM_SESSION` from env (the existing Phase 2 pattern); if absent/invalid, `ingest` skips Telegram with the actionable "run hire-radar auth" message and continues other sources
- CLI code lives in `src/cli/` (an index + one file per command); commands are thin wrappers over existing orchestrator/extractor/db functions
- Each command calls `loadConfig({ env: process.env })` at startup; a missing required secret prints the actionable Zod error (reused from Phase 1) and exits non-zero

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/pipeline/orchestrator.ts` — `ingestSources(opts)` (fetch raws, fault-isolated, `sinceOverride`); returns per-source results the `ingest` stats block summarizes
- `src/pipeline/registry.ts` — `buildAdapters(config)`; the `--source` filter narrows this
- `src/extraction/pipeline.ts` — `extractPending(deps)` returns extraction outcomes (extracted/deduped/skipped/api-calls) the stats block summarizes
- `src/db/vacancies.ts` — vacancy persistence; needs a query/list helper added for list+export (filters: source, keyword, date range, limit)
- `src/db/client.ts` — `openDatabase`
- `src/config.ts` — `loadConfig({ env })`; `TELEGRAM_API_ID/HASH/SESSION` + `ANTHROPIC_API_KEY` env secrets; actionable errors
- `src/adapters/telegram.ts` — reads `TELEGRAM_SESSION`; `auth` produces what this consumes
- gramjs (`telegram` package) — `TelegramClient` + `StringSession` for the interactive `.start()` login that yields the session string

### Established Patterns
- ESM, Node 22, strict TS; tsx for the bin shim; vitest; better-sqlite3 synchronous
- Injected-dependency pattern from Phases 2–3 (fetchFn / Claude client) — apply so command logic is testable without live network/API; the interactive `auth` login is the one inherently manual path

### Integration Points
- `ingest` is the first place orchestrator + extractor run together end-to-end (they were built as separate functions in Phases 2 and 3)
- A new read-side query helper on the vacancies table powers both `list` and `export` (single source of truth for filtering)

</code_context>

<specifics>
## Specific Ideas

- The `ingest` stats block is the proof of the whole project's core value ("run ingest → clean structured vacancies in SQLite") — it must show Claude API calls so cache effectiveness is visible (0 on a no-new-content re-run).
- `export` must be cleanly pipeable: only the JSON array on stdout, all human-readable/log output on stderr, so `hire-radar export | jq ...` works.
- Keep CLI commands thin: a command parses flags, calls one or two existing functions, formats output. If a command needs real logic, that logic belongs in the lib layer, not the CLI.

</specifics>

<deferred>
## Deferred Ideas

- A `--json` flag on `list` (export already covers machine-readable output)
- Config-file path override flag / multiple profiles
- Daemon/scheduler, web UI, notifications — project Out of Scope
- Embedding/semantic dedup, Playwright sources — v2 / Out of Scope

</deferred>
