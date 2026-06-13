---
phase: 04-cli-commands
plan: "01"
subsystem: db
tags: [sqlite, query, filtering, parameterized-sql]
dependency_graph:
  requires: []
  provides: [queryVacancies, VacancyRow, VacancyFilters]
  affects: [src/cli/list, src/cli/export]
tech_stack:
  added: []
  patterns: [parameterized-sql, incremental-WHERE-builder]
key_files:
  created: []
  modified:
    - src/db/vacancies.ts
    - src/db/vacancies.test.ts
decisions:
  - "created_at used as date column (posted_at always NULL in v1)"
  - "until filter appends ' 23:59:59' for inclusive end-of-day coverage"
  - "keyword LIKE on raw skills JSON string — acceptable for v1 substring search"
metrics:
  duration: 2min
  completed: 2026-06-13
---

# Phase 4 Plan 01: queryVacancies Filter Helper Summary

**One-liner:** Parameterized SQL filter helper on vacancies table — source, keyword (4-column LIKE), date range (created_at), limit — using incremental WHERE builder with `?` placeholders only.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 (RED) | Failing tests for queryVacancies | 03557db | src/db/vacancies.test.ts |
| 1 (GREEN) | queryVacancies implementation | f6ffe36 | src/db/vacancies.ts |

## What Was Built

`queryVacancies(db, filters)` exported from `src/db/vacancies.ts`:
- `VacancyFilters`: optional source, keyword, since, until, limit fields
- `VacancyRow`: all vacancy columns with skills parsed to `string[]` and `date` mapped from `created_at`
- WHERE clause built incrementally into `conditions[]` / `params[]` — every value bound via `?`
- keyword spans all four columns: `title LIKE ? OR company LIKE ? OR skills LIKE ? OR description LIKE ?`
- `until` filter appends ` 23:59:59` for inclusive full-day coverage
- limit sanitized via `Math.trunc` + `Math.max(0, ...)` before binding
- Results ordered `created_at DESC`

## Deviations from Plan

None — plan executed exactly as written.

## TDD Gate Compliance

- RED gate commit: 03557db (`test(04-01): add failing tests for queryVacancies filter helper`)
- GREEN gate commit: f6ffe36 (`feat(04-01): implement queryVacancies parameterized filter helper`)
- REFACTOR: not needed — implementation was clean on first pass

## Known Stubs

None.

## Threat Flags

No new security surface beyond what the plan's threat model already covers. All filter values bound via `?` — T-04-01 mitigated.

## Self-Check: PASSED

- `src/db/vacancies.ts` exists and exports `queryVacancies`, `VacancyRow`, `VacancyFilters`
- Commit 03557db present (RED)
- Commit f6ffe36 present (GREEN)
- All 19 tests pass (`npx vitest run src/db/vacancies.test.ts`)
- `npx tsc --noEmit` exits 0
- No `${filters.*}` interpolation in SQL strings
