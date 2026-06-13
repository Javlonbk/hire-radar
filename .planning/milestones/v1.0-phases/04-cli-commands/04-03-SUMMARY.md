---
phase: 04-cli-commands
plan: "03"
subsystem: cli
tags: [cli, list, export, filtering, json, stdout-stderr, tdd]
dependency_graph:
  requires: [queryVacancies (04-01), registerList/registerExport stubs (04-02)]
  provides: [runList, runExport, src/cli/list.test.ts, src/cli/export.test.ts]
  affects: [src/cli/list.ts, src/cli/export.ts]
tech_stack:
  added: []
  patterns: [injectable-deps seam (ListDeps/ExportDeps), thin CLI wrapper over queryVacancies]
key_files:
  created:
    - src/cli/list.test.ts
    - src/cli/export.test.ts
  modified:
    - src/cli/list.ts
    - src/cli/export.ts
decisions:
  - "Injectable deps seam (ListDeps/ExportDeps) enables in-memory DB testing without real files or filesystem"
  - "formatRow uses trunc(s,n) with padEnd for aligned columns; remote_type surfaced as '(type)' suffix"
  - "runExport serializes VacancyRow[] directly — no config merged; secrets never touch the output stream"
  - "export stdout receives only JSON; any future diagnostics routed to stderr — hire-radar export | jq works"
metrics:
  duration: 3min
  completed: 2026-06-13
---

# Phase 4 Plan 03: list and export Command Implementation Summary

**One-liner:** Injectable-deps runList (aligned table, default limit 20, empty to stderr) and runExport (JSON array stdout-only, no default limit, [] on empty) as thin wrappers over queryVacancies — 14 TDD tests on in-memory DB.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 RED | list tests — aligned table, empty stderr | b181020 | src/cli/list.test.ts |
| 1 GREEN | runList implementation | 596fa78 | src/cli/list.ts |
| 2 RED | export tests — JSON array stdout, empty [] | a180919 | src/cli/export.test.ts |
| 2 GREEN | runExport implementation | bb1672f | src/cli/export.ts |

## What Was Built

**src/cli/list.ts** — `runList(deps: ListDeps, opts: ListOptions): void`
- Builds `VacancyFilters` from opts; default limit 20 when `--limit` not provided
- Calls `queryVacancies` (single filter source of truth)
- Empty result: `deps.err('No vacancies match')` — stderr, exit 0
- `formatRow(r)`: title(30) company(20) location(16) remote_type salary source(14) date, columns padEnd-aligned, `trunc(s,n)` truncates with `…`
- Salary cell: `min-max currency` or `—` when absent
- `registerList(program)` preserved with exact Plan 02 flags and `'20'` default

**src/cli/export.ts** — `runExport(deps: ExportDeps, opts: ExportOptions): void`
- Builds `VacancyFilters` from opts; `limit: undefined` when `--limit` absent (no default)
- Calls `queryVacancies`, serializes result as `JSON.stringify(rows, null, 2)`
- Empty result: `deps.out('[]')` — stdout, exit 0 (JSON.stringify([]) === '[]')
- `out` seam receives only JSON; no log output mixed into stdout stream
- `registerExport(program)` preserved with exact Plan 02 flags

## TDD Gate Compliance

- Task 1 RED: b181020 (`test(04-03): add failing tests for list command`)
- Task 1 GREEN: 596fa78 (`feat(04-03): implement runList`)
- Task 2 RED: a180919 (`test(04-03): add failing tests for export command`)
- Task 2 GREEN: bb1672f (`feat(04-03): implement runExport`)

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None. Both `runList` and `runExport` are fully implemented.

## Threat Flags

No new security surface beyond the plan's threat model.
- T-04-05 mitigated: `runExport` serializes only `VacancyRow[]`; no config/secrets merged. Grep confirms no `anthropicApiKey`/`telegramSession`/`apiKey`/`apiHash` references in `export.ts`.
- T-04-06 mitigated: filters delegated to `queryVacancies` which binds all values via `?`.
- T-04-07 mitigated: `runExport` routes all output through `deps.out` (stdout seam); no stderr mixing in the JSON stream.

## Self-Check: PASSED

- `src/cli/list.ts` exports `runList` (line 39)
- `src/cli/export.ts` exports `runExport` (line 20)
- `queryVacancies(` present in both list.ts and export.ts
- `'No vacancies match'` passed to `deps.err` in list.ts (line 49)
- `limit: 20` default in list.ts, `limit: undefined` in export.ts
- `JSON.stringify(rows` in export.ts (line 29)
- No secret keys in export.ts (grep returns nothing)
- Commits b181020, 596fa78, a180919, bb1672f all present
- `npx vitest run src/cli/list.test.ts src/cli/export.test.ts` — 14/14 pass
- `npx tsc --noEmit` — exits 0
