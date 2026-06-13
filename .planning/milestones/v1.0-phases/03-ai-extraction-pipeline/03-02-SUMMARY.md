---
phase: 03-ai-extraction-pipeline
plan: "02"
subsystem: extraction
tags: [anthropic-sdk, forced-tool-use, cache-gate, retry-once, zod, tdd]
dependency_graph:
  requires: [extraction-schema-contract, extraction-cache-helpers, anthropicModel-config]
  provides: [injectable-claude-client, extractOne-cache-gated-extractor]
  affects: [src/extraction/client.ts, src/extraction/extractor.ts]
tech_stack:
  added: []
  patterns: [injection-seam, forced-tool-use, cache-before-call, retry-once-skip, tdd-red-green]
key_files:
  created:
    - src/extraction/client.ts
    - src/extraction/client.test.ts
    - src/extraction/extractor.ts
    - src/extraction/extractor.test.ts
decisions:
  - "MessageCreate injection seam mirrors HhOptions.fetchFn pattern — callClaude never instantiates Anthropic directly"
  - "EXTRACTION_TOOL cast as unknown then Anthropic.Tool to avoid TS2352 readonly required[] mismatch with as const schema"
  - "getCachedExtraction called strictly BEFORE callClaude — cache is a cost/correctness gate not just a DB optimization"
  - "Hard API errors (network, no tool_use block) propagate — only Zod validation failure triggers retry-once-skip"
metrics:
  duration: 8min
  completed_date: "2026-06-13"
  tasks: 2
  files: 4
---

# Phase 3 Plan 02: Injectable Claude Client and extractOne Extractor Summary

**One-liner:** Injectable `callClaude` (forced tool-use via `MessageCreate` seam) + `extractOne` gating API calls behind the content-hash cache, validating with Zod, retrying once on failure then skipping — tested entirely with call-counting fakes, never touching the live API.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 (RED) | client.test.ts failing tests | ca132e2 | src/extraction/client.test.ts |
| 1 (GREEN) | callClaude + realMessageCreate | 6439e74 | src/extraction/client.ts |
| 2 (RED) | extractor.test.ts failing tests | 07c3723 | src/extraction/extractor.test.ts |
| 2 (GREEN) | extractOne + EXTRACTION_SYSTEM_PROMPT | 09d59ee | src/extraction/extractor.ts, src/extraction/client.ts |

## What Was Built

**src/extraction/client.ts** — `MessageCreate` type (injection seam); `callClaude(messageCreate, args)` builds a forced tool-use request (`tool_choice: { type:'tool', name:'extract_vacancies' }`), finds the `tool_use` content block, and returns its `.input` as `unknown` — throws if absent; `realMessageCreate(apiKey)` factory wraps `new Anthropic()` so it stays out of tests and the extractor.

**src/extraction/extractor.ts** — `ExtractDeps` interface with injected `db`, `messageCreate`, `model`, `system`, optional `now` and `log`; `extractOne` algorithm: `contentHash(rawText)` key → `getCachedExtraction` (cache strictly before API call) → on hit: `ExtractionResultSchema.safeParse` + return `apiCalls:0`; on miss: `callClaude` → validate → if ok store+return `apiCalls:1`; if fail retry once → if ok store+return `apiCalls:2`; if fail again log+return `{ result:null, skipped:true, apiCalls:2 }` (no cache write); hard throws from `callClaude` propagate. `EXTRACTION_SYSTEM_PROMPT` exported for Wave 3 reuse.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] TypeScript TS2352 readonly required[] cast**
- **Found during:** Task 2, `npx tsc --noEmit` verification
- **Issue:** `EXTRACTION_TOOL` is `as const` so its `required` field is `readonly string[]`; `Anthropic.Tool` expects mutable `string[]` — direct `as Anthropic.Tool` cast fails with TS2352
- **Fix:** `EXTRACTION_TOOL as unknown as Anthropic.Tool` in client.ts
- **Files modified:** src/extraction/client.ts
- **Commit:** 09d59ee

## Verification Results

- `npx vitest run src/extraction/client.test.ts src/extraction/extractor.test.ts` — 9 tests passed
- `npx vitest run` (full suite) — 100 tests passed across 14 test files
- `npx tsc --noEmit` — exits 0
- `grep -rn "process.env.ANTHROPIC_API_KEY" src/extraction/` — returns nothing
- `grep -c "new Anthropic" src/extraction/client.test.ts` — 0 (no real client in tests)
- Cache-hit test asserts `fake.mock.calls.length === 1` before and after second `extractOne` call (zero new calls on hit)
- Invalid-twice test asserts `skipped===true`, `result===null`, `apiCalls===2`, cache COUNT === 0

## Threat Mitigations Applied

| Threat | Mitigation Applied |
|--------|-------------------|
| T-03-04 (prompt injection) | Forced tool-use with `input_schema` constrains model output shape; `ExtractionResultSchema.safeParse` rejects out-of-contract fields |
| T-03-05 (info disclosure) | `ANTHROPIC_API_KEY` never appears in extraction modules; skip-log uses only `key.slice(0,8)`; `realMessageCreate` factory is the only location of `new Anthropic` |
| T-03-06 (cost runaway) | `getCachedExtraction` runs strictly before `callClaude`; retry capped at one extra call (`apiCalls <= 2`); verified by 0-call cache-hit assertion |

## Self-Check: PASSED

- src/extraction/client.ts: FOUND
- src/extraction/client.test.ts: FOUND
- src/extraction/extractor.ts: FOUND
- src/extraction/extractor.test.ts: FOUND
- Commit ca132e2: FOUND
- Commit 6439e74: FOUND
- Commit 07c3723: FOUND
- Commit 09d59ee: FOUND
