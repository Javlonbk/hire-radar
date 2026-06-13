---
phase: 02-source-adapters
plan: "02"
subsystem: adapters
tags: [adapter, rss, encoding, tdd, security]
dependency_graph:
  requires: [02-01]
  provides: [createRssAdapter]
  affects: [02-03, 02-04]
tech_stack:
  added: [iconv-lite@0.6.3]
  patterns: [conditional GET (ETag/If-Modified-Since), XML encoding detection, SSRF scheme guard, injectable fetchFn for testability]
key_files:
  created:
    - src/adapters/rss.ts
    - src/adapters/rss.test.ts
  modified:
    - package.json
    - package-lock.json
decisions:
  - contentHash key for RSS items is adapter-id + ":" + nativeId (guid ?? link), matching the hh.uz pattern
  - ETag and Last-Modified are stored as instance-local mutable state (not persisted across restarts); 7-day since window + content_hash dedup absorbs overlap
  - Encoding detection reads the XML declaration preamble via latin1 on raw buffer bytes (not Content-Type header) per PITFALL-11
metrics:
  duration: "~3 minutes"
  completed: "2026-06-13T06:59:28Z"
  tasks: 1
  files: 4
---

# Phase 2 Plan 2: RSS Adapter Summary

**One-liner:** RSS adapter with conditional GET (ETag/If-Modified-Since), windows-1251 XML transcoding via iconv-lite, SSRF scheme guard rejecting non-http(s) URLs, and date-cursor filtering of items older than `since`.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 (RED) | Failing tests for RSS adapter | 583eaef | src/adapters/rss.test.ts, package.json, package-lock.json |
| 1 (GREEN) | RSS adapter implementation | ae0ea77 | src/adapters/rss.ts |

## TDD Gate Compliance

- RED commit: 583eaef — `test(02-02): add failing tests for RSS adapter (windows-1251, since filter, 304, SSRF)`
- GREEN commit: ae0ea77 — `feat(02-02): implement RSS adapter with conditional GET, encoding transcode, and SSRF guard`

## Decisions Made

- ETag/Last-Modified stored as mutable instance fields (not persisted to DB); the 7-day `since` window plus `content_hash` INSERT OR IGNORE dedup absorbs any overlap across restarts
- XML encoding read from the XML declaration preamble (`<?xml ... encoding="windows-1251"?>`) via latin1 preamble read on the raw buffer — not from the HTTP Content-Type header, which legacy feeds often omit
- Adapter id uses first 8 hex chars of `contentHash(url)` for a stable, distinct, human-readable id per feed URL

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None.

## Threat Flags

None — T-02-04 (SSRF scheme guard) and T-02-05 (XML encoding transcode) both mitigated as planned. T-02-06 (DoS from hostile feed) accepted per plan.

## Self-Check: PASSED

- src/adapters/rss.ts: FOUND
- src/adapters/rss.test.ts: FOUND
- RED commit 583eaef: FOUND
- GREEN commit ae0ea77: FOUND
- All 5 tests pass, tsc --noEmit exits 0
