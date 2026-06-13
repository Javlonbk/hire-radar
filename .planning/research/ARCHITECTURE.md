# Architecture Research

**Domain:** Data-ingestion pipeline CLI (job vacancy agent)
**Researched:** 2026-06-13
**Confidence:** HIGH

## Standard Architecture

### System Overview

```
┌─────────────────────────────────────────────────────────────┐
│                        CLI Entry Point                       │
│              bin/hire-radar.ts  (commander)                  │
│   ingest [--source X]     list [--filter]     export [--fmt] │
└──────────────────────────────┬──────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────┐
│                     Pipeline Orchestrator                    │
│            src/pipeline/orchestrator.ts                      │
│  - loads enabled sources from registry                       │
│  - runs each source through the pipeline sequentially        │
│  - isolates failures per source (try/catch per adapter)      │
│  - writes run stats (inserted, skipped, errors) to stdout    │
└──────┬──────────────────────────────────────────────────────┘
       │ for each source
       ▼
┌──────────────────────────────────────────────────────────────┐
│                     Source Registry                          │
│            src/sources/registry.ts                           │
│  - static list of SourceConfig objects (id, type, config)    │
│  - loads per-type secrets from env/config file               │
│  - returns only enabled sources                              │
│  - tracks lastFetchedAt per source in SQLite                 │
└──────┬───────────────────────────────────────────────────────┘
       │ SourceConfig
       ▼
┌──────────────────────────────────────────────────────────────┐
│                     Source Adapters                          │
│     src/adapters/telegram.ts   hh.ts   rss.ts               │
│                                                              │
│  interface SourceAdapter {                                   │
│    id: string                                                │
│    fetch(since: Date): Promise<RawItem[]>                    │
│  }                                                           │
│                                                              │
│  RawItem: { sourceId, externalId?, rawText, rawJson?,        │
│             fetchedAt, contentHash }                         │
└──────┬───────────────────────────────────────────────────────┘
       │ RawItem[]
       ▼
┌──────────────────────────────────────────────────────────────┐
│                     Raw Item Store                           │
│   src/db/raw_items table                                     │
│  - persist every RawItem before extraction                   │
│  - write contentHash; skip insert on conflict (idempotency)  │
│  - extraction_status: pending | done | failed | skipped      │
└──────┬───────────────────────────────────────────────────────┘
       │ unextracted RawItems
       ▼
┌──────────────────────────────────────────────────────────────┐
│                     LLM Extractor                            │
│   src/extraction/extractor.ts                                │
│  - checks extraction_cache by contentHash first              │
│  - on cache hit: use cached JSON, skip API call              │
│  - on cache miss: call Claude Haiku, store result in cache   │
│  - handles one-post → many vacancies (array response)        │
│  - handles non-job posts (returns [])                        │
│  - marks raw_item.extraction_status = done | failed          │
└──────┬───────────────────────────────────────────────────────┘
       │ ExtractedVacancy[]
       ▼
┌──────────────────────────────────────────────────────────────┐
│                     Dedup + Persist                          │
│   src/db/vacancies.ts                                        │
│  - compute vacancy-level contentHash                         │
│    (SHA-256 of normalize(title + company + desc[0:500]))     │
│  - INSERT OR IGNORE on vacancies.content_hash                │
│  - increment run stats: inserted vs skipped                  │
└──────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────┐
│                     SQLite Database                          │
│   data/hire-radar.db                                         │
│   tables: sources, raw_items, extraction_cache, vacancies    │
└──────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component | Responsibility | Key Constraint |
|-----------|----------------|----------------|
| CLI entry (`bin/`) | Parse commands, set up config, call orchestrator | No business logic here |
| Orchestrator | Sequence the pipeline; isolate per-source errors | Sequential, not concurrent (avoids rate-limit races) |
| Source registry | Map source IDs to adapter instances + configs | Single source of truth for what sources exist |
| Adapters | Fetch raw data from external APIs/Telegram/RSS | Each adapter fails independently |
| Raw item store | Persist pre-extraction payloads | Enables re-runs, debugging, audit trail |
| LLM extractor | Turn raw text → structured vacancy JSON | Cache by contentHash to prevent re-extraction |
| Extraction cache | Hash → JSON result store | Never call Claude twice for the same content |
| Dedup + persist | Insert vacancies, skip duplicates | Hash dedup prevents exact-reposts from inflating count |
| Query / export | Read vacancies from SQLite, filter, format | Read-only path; no write logic here |

## Recommended Project Structure

```
hire-radar/
├── bin/
│   └── hire-radar.ts          # CLI entry, commander setup
├── src/
│   ├── adapters/
│   │   ├── types.ts            # SourceAdapter interface, RawItem type
│   │   ├── telegram.ts         # gramjs user-bot adapter
│   │   ├── hh.ts               # hh.uz REST API adapter
│   │   └── rss.ts              # Generic RSS adapter
│   ├── pipeline/
│   │   └── orchestrator.ts     # Runs all sources through the pipeline
│   ├── extraction/
│   │   ├── extractor.ts        # Cache-check → Claude call → store result
│   │   ├── prompt.ts           # System + user prompt templates
│   │   └── types.ts            # ExtractedVacancy schema (zod)
│   ├── db/
│   │   ├── client.ts           # better-sqlite3 init, migrations runner
│   │   ├── schema.sql          # DDL for all tables
│   │   ├── raw-items.ts        # insert / query raw_items
│   │   ├── extraction-cache.ts # get / set by contentHash
│   │   ├── vacancies.ts        # upsert (INSERT OR IGNORE) / query
│   │   └── sources.ts          # read source registry, update lastFetchedAt
│   ├── commands/
│   │   ├── ingest.ts           # `hire-radar ingest` handler
│   │   ├── list.ts             # `hire-radar list` handler
│   │   └── export.ts           # `hire-radar export` handler
│   ├── config.ts               # Load env + config file, validate with zod
│   └── hash.ts                 # SHA-256 helpers, normalize()
├── data/                       # .gitignored; hire-radar.db lives here
├── config.example.json         # Template for user config
├── package.json
└── tsconfig.json
```

### Structure Rationale

- **`adapters/`:** One file per source type. The `types.ts` interface contract keeps adapters interchangeable. New source = new file, zero changes elsewhere.
- **`pipeline/`:** Orchestration is a single concern separated from both adapters and DB. Makes it easy to test the sequence without touching the DB.
- **`extraction/`:** LLM logic isolated from DB logic. Prompt templates live here, not scattered in DB code.
- **`db/`:** One file per table. No ORM — better-sqlite3 with plain SQL for a CLI is simpler than Prisma migrations at this scale.
- **`commands/`:** Each CLI subcommand is a thin handler that calls pipeline/db code. Commander wires these up in `bin/`.

## Architectural Patterns

### Pattern 1: Adapter Interface Boundary

**What:** All source adapters implement a single interface — `id: string` and `fetch(since: Date): Promise<RawItem[]>`. The pipeline only knows this interface; it never imports concrete adapters directly (the registry returns instances).

**When to use:** Always. This is the core extensibility point for new sources.

**Trade-offs:** Slightly more indirection than direct calls, but enables per-source error isolation and a uniform pipeline.

```typescript
// src/adapters/types.ts
export interface RawItem {
  sourceId: string;
  externalId: string | null;
  rawText: string;
  rawJson: unknown | null;
  fetchedAt: Date;
  contentHash: string; // SHA-256(rawText)
}

export interface SourceAdapter {
  id: string;
  fetch(since: Date): Promise<RawItem[]>;
}
```

### Pattern 2: Persist-Before-Extract

**What:** Every RawItem is written to `raw_items` before LLM extraction begins. The extractor reads unextracted rows and updates their status.

**When to use:** Always — especially important for a CLI that can be interrupted mid-run.

**Trade-offs:** Slightly more DB writes, but enables idempotent re-runs (re-run picks up failed extractions without re-fetching from source), and gives a permanent audit trail of what was fetched.

```
ingest run 1:  fetch → persist raw → extract (fails halfway)
ingest run 2:  fetch (since=lastFetchedAt) → raw_items already exist (INSERT OR IGNORE on contentHash)
               → extractor picks up rows with extraction_status=pending|failed → resumes cleanly
```

### Pattern 3: Content-Hash Extraction Cache

**What:** Before calling Claude, compute SHA-256 of the raw text. Check `extraction_cache` table. If a row exists, deserialize and return it. Only call Claude on a cache miss.

**When to use:** Always. The same Telegram post appears in multiple channels constantly.

**Trade-offs:** Extra DB read per item, but the read is microseconds vs. an API call. Cache never expires — identical text always extracts identically.

```typescript
// src/extraction/extractor.ts (sketch)
async function extract(item: RawItem): Promise<ExtractedVacancy[]> {
  const cached = db.getCachedExtraction(item.contentHash);
  if (cached) return cached;

  const result = await callClaude(item.rawText);
  db.setCachedExtraction(item.contentHash, result);
  return result;
}
```

### Pattern 4: Per-Source Error Isolation

**What:** The orchestrator wraps each source's entire pipeline run in a try/catch. A failed Telegram adapter (e.g. session expired) does not abort the hh.uz or RSS run.

**When to use:** Always in a multi-source CLI. Sources fail independently in production.

```typescript
// src/pipeline/orchestrator.ts (sketch)
for (const adapter of adapters) {
  try {
    const items = await adapter.fetch(since);
    // ... pipeline steps ...
    stats[adapter.id] = { inserted, skipped };
  } catch (err) {
    stats[adapter.id] = { error: err.message };
  }
}
```

## Data Flow

### Ingest Flow

```
hire-radar ingest
    ↓
config.ts loads env (ANTHROPIC_API_KEY, TELEGRAM_*, HH_* …)
    ↓
registry.ts → [TelegramAdapter, HhAdapter, RssAdapter]  (enabled only)
    ↓
orchestrator.ts: for each adapter (sequential):
    ↓
  adapter.fetch(since: lastFetchedAt ?? 24h ago)
    ↓ RawItem[]
  raw_items: INSERT OR IGNORE (skip known contentHashes)
    ↓ new rows only (extraction_status=pending)
  extractor: for each pending raw_item
      ↓ check extraction_cache by contentHash
      ├── HIT  → use cached JSON
      └── MISS → POST /messages (Claude Haiku) → store in extraction_cache
    ↓ ExtractedVacancy[]  (may be empty for non-job posts)
  vacancies: INSERT OR IGNORE (skip known contentHashes)
    ↓
  sources: UPDATE lastFetchedAt = now()
    ↓
orchestrator prints run summary per source
```

### List / Export Flow

```
hire-radar list --skill typescript --remote
    ↓
commands/list.ts → db/vacancies.ts SELECT with filters
    ↓
Format as table to stdout (or JSON for export)
```

### Key Data Flows

1. **New post, first time:** fetch → raw persisted → cache miss → Claude called → vacancy inserted — full cost paid once.
2. **Same post in second channel:** fetch → INSERT OR IGNORE on raw_items (skipped) → zero Claude calls — completely free.
3. **Re-run after partial failure:** fetch → new items since lastFetchedAt → pending raw_items from prior run re-processed by extractor — idempotent.
4. **Vacancy dedup across sources:** two different sources, same vacancy text → same contentHash → second INSERT OR IGNORE on vacancies silently skipped.

## SQLite Schema

```sql
-- src/db/schema.sql

CREATE TABLE IF NOT EXISTS sources (
  id              TEXT PRIMARY KEY,   -- e.g. "telegram_itpark", "hh_uz", "rss_headhunter"
  type            TEXT NOT NULL,      -- TELEGRAM | HH | RSS
  enabled         INTEGER NOT NULL DEFAULT 1,
  config_json     TEXT NOT NULL,      -- adapter-specific config (channel id, feed url, etc.)
  last_fetched_at TEXT                -- ISO-8601; NULL = never run
);

CREATE TABLE IF NOT EXISTS raw_items (
  id                TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  source_id         TEXT NOT NULL,
  external_id       TEXT,             -- source's own ID if available
  raw_text          TEXT NOT NULL,
  raw_json          TEXT,             -- original JSON blob (hh.uz API response, etc.)
  content_hash      TEXT NOT NULL,
  fetched_at        TEXT NOT NULL,
  extraction_status TEXT NOT NULL DEFAULT 'pending',  -- pending | done | failed | skipped
  extraction_error  TEXT,
  UNIQUE(content_hash)
);
CREATE INDEX IF NOT EXISTS raw_items_status ON raw_items(extraction_status);
CREATE INDEX IF NOT EXISTS raw_items_source ON raw_items(source_id);

CREATE TABLE IF NOT EXISTS extraction_cache (
  content_hash  TEXT PRIMARY KEY,
  result_json   TEXT NOT NULL,    -- JSON array of ExtractedVacancy
  extracted_at  TEXT NOT NULL,
  model         TEXT NOT NULL     -- e.g. "claude-haiku-4-5" — audit trail for re-extraction if model changes
);

CREATE TABLE IF NOT EXISTS vacancies (
  id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  source_id       TEXT NOT NULL,
  raw_item_id     TEXT NOT NULL,
  external_id     TEXT,
  title           TEXT NOT NULL,
  company         TEXT NOT NULL,
  description     TEXT NOT NULL,
  skills          TEXT,           -- JSON array
  salary_min      INTEGER,
  salary_max      INTEGER,
  salary_currency TEXT,
  location        TEXT,
  remote_type     TEXT,           -- ONSITE | HYBRID | REMOTE | NULL
  apply_contact   TEXT,           -- URL or email
  posted_at       TEXT,
  content_hash    TEXT NOT NULL,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(content_hash)
);
CREATE INDEX IF NOT EXISTS vacancies_posted_at ON vacancies(posted_at DESC);
CREATE INDEX IF NOT EXISTS vacancies_source    ON vacancies(source_id);
```

**Table design rationale:**

- `raw_items.content_hash` UNIQUE: prevents re-inserting the same fetch across runs; also the key for extraction cache lookup.
- `extraction_cache` is separate from `raw_items`: same content may be fetched from multiple sources; the cache key is the content, not the fetch event.
- `vacancies.content_hash` UNIQUE: dedup at the structured-output level; two different raw items (different sources) producing the same vacancy title+company+description collapse to one row.
- No `updated_at` trigger on `vacancies`: vacancies are write-once in v1; updates (e.g. vacancy closed) are out of scope.

## Build Order

Build in this order — each step unblocks the next:

1. **`src/db/` — schema + client** (everything else reads/writes DB; nothing else can be tested without it)
2. **`src/hash.ts` + `src/config.ts`** (utilities needed by all later layers)
3. **`src/adapters/types.ts`** (interface definition; no dependencies)
4. **`src/adapters/hh.ts`** (simplest adapter — pure REST, no auth setup needed beyond API key; validates the adapter pattern)
5. **`src/adapters/rss.ts`** (second simplest; RSS parsing is stateless)
6. **`src/pipeline/orchestrator.ts`** (wire hh + rss through raw_items persist; end-to-end fetchable without LLM)
7. **`src/extraction/extractor.ts` + `prompt.ts`** (add LLM extraction to the pipeline; cache + Claude call)
8. **`src/adapters/telegram.ts`** (most complex — gramjs session management, channel iteration; add last)
9. **`src/commands/`** (thin CLI handlers; add after pipeline is proven)
10. **`bin/hire-radar.ts`** (wire commander to commands)

## Anti-Patterns

### Anti-Pattern 1: Fetching and Extracting in the Same Adapter

**What people do:** Put the Claude API call inside `adapter.fetch()` so each adapter returns structured vacancies directly.

**Why it's wrong:** You lose the raw payload audit trail, extraction failures abort the fetch, and you can't re-extract with a different prompt without re-fetching from the source. The adapter boundary must be "raw data in, raw data out."

**Do this instead:** Adapters return `RawItem[]`. Extraction is always a separate step after raw persistence.

### Anti-Pattern 2: Running All Sources Concurrently

**What people do:** `Promise.all(adapters.map(a => a.fetch(...)))` to speed up ingestion.

**Why it's wrong:** Telegram gramjs uses a single session with sequential message reads; parallel hh.uz calls risk hitting rate limits; failed sources mask each other's errors in concurrent promise rejection. The pipeline is fast enough sequentially — a full run over 3 sources takes seconds to minutes, and it's a background CLI, not a user-facing request.

**Do this instead:** Sequential loop with per-source try/catch. Print progress per source.

### Anti-Pattern 3: Computing Dedup Hash from Extracted Fields Only

**What people do:** Hash only the structured output (title + company) for dedup.

**Why it's wrong:** Claude's extraction is not perfectly deterministic — two runs on the same raw text can produce slightly different normalized fields (e.g. "Senior Frontend Dev" vs "Senior Frontend Developer"), breaking hash equality.

**Do this instead:** Hash the raw input text for extraction cache; hash `normalize(title + company + description[0:500])` for vacancy dedup. Keep both hashes. The raw-text hash is stable; the structured hash is the business-level dedup key.

### Anti-Pattern 4: Storing Secrets in config.json

**What people do:** Put `TELEGRAM_API_ID`, `ANTHROPIC_API_KEY` in the config file checked into the repo.

**Why it's wrong:** Telegram API credentials are personal; committing them is a security incident.

**Do this instead:** Secrets from environment variables only. `config.json` / `config.example.json` holds non-secret config (channel whitelist, hh.uz region filter, RSS URLs). `config.ts` merges env + file, validates with zod, and fails fast on missing required secrets.

## Integration Points

### External Services

| Service | Integration Pattern | Notes |
|---------|---------------------|-------|
| Claude Haiku (Anthropic API) | `@anthropic-ai/sdk` — single `messages.create` call per cache miss | Use `max_tokens` budget; structured JSON output via tool use or prompt-enforced JSON mode |
| hh.uz REST API | `fetch` — GET `/vacancies` with query params (area, text, date_from) | Free API, no auth needed for public search; rate limit ~7 req/s; use `date_from=since.toISOString()` |
| Telegram (gramjs) | `TelegramClient` user-bot session; `getMessages` per channel | Session file persisted to disk; first run requires interactive phone+code auth; subsequent runs use stored session |
| RSS feeds | `rss-parser` npm package — stateless URL fetch | Cheapest source; `item.isoDate` used as `since` filter |

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| Orchestrator → Adapter | Direct async call via `SourceAdapter` interface | Orchestrator never imports concrete adapter classes |
| Adapter → DB | No direct DB access in adapters | Adapters return `RawItem[]`; orchestrator writes to DB |
| Extractor → DB | Direct better-sqlite3 calls | Extractor reads pending raw_items, writes to extraction_cache, updates extraction_status |
| Commands → DB | Direct better-sqlite3 reads | `list` and `export` commands are read-only; no pipeline involvement |

## Sources

- kasbim `technical-architecture.md` §9 (reference design — source registry, adapter interface, pipeline sequence)
- PROJECT.md (constraints: plain Node/TS, SQLite, Haiku, CLI-only, v1 sources)
- better-sqlite3 documentation (synchronous SQLite API — correct choice for a CLI that doesn't need async I/O on DB)
- Anthropic API structured output patterns (tool use / JSON mode for extraction)

---
*Architecture research for: job-vacancy ingestion agent CLI (hire-radar)*
*Researched: 2026-06-13*
