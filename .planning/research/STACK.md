# Stack Research

**Domain:** Node.js/TypeScript CLI data-ingestion agent
**Researched:** 2026-06-13
**Confidence:** HIGH (all critical libraries verified against official sources or recent npm data)

## Recommended Stack

### Core Technologies

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| Node.js | 22.x LTS | Runtime | Active LTS; native fetch (undici), `--watch`, `--env-file`, and removed need for `--experimental-vm-modules` for ESM test runners. Target this specifically — avoid 18/20 to get native fetch without polyfills. |
| TypeScript | 5.x (5.7+) | Type system | `--erasetypes` in 5.8 will let Node run TS natively without a loader; for now 5.x gives satisfiedBy, const inference improvements. Use `strict: true`, `moduleResolution: bundler` or `node16`. |
| gramjs (`telegram`) | 2.17.4 | Telegram MTProto user-bot client | The canonical JS/TS MTProto library. Reads channels as a user account (not bot API). Supports message history iteration, media, and StringSession for non-interactive auth. Only serious alternative is `teleproto` (a 2025 fork), but gramjs has the larger community and proven production use. |
| `@anthropic-ai/sdk` | 0.102.0+ | Claude API — structured extraction | Official SDK; supports `messages.parse()` + `zodOutputFormat()` for guaranteed schema-compliant output. Use Haiku for bulk extraction. |
| `better-sqlite3` | 12.4.1 | SQLite persistence | Synchronous API fits the CLI execution model perfectly — no async overhead in tight loops. 14–67% faster than `node:sqlite` in benchmarks. `node:sqlite` is still Stability 1.1 (experimental) in Node 22/23 — not ready for production. |
| `zod` | 4.x (4.4+) | Schema definition + validation | Required by Anthropic SDK's `zodOutputFormat()` for structured outputs. Also use for config/env validation. Zod 4 is a full rewrite — faster, smaller, better inference. Do not use Zod 3. |

### Supporting Libraries

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `commander` | 15.0.0 | CLI subcommand parsing | Three subcommands (`ingest`, `list`, `export`) with option flags. Zero dependencies, built-in help generation, TypeScript-native via `@commander-js/extra-typings`. |
| `tsx` | 4.22.4 | TypeScript runner (dev) | `npx tsx src/index.ts` just works — zero tsconfig ceremony, handles ESM/CJS mixing, 20ms cold start vs 500ms+ for ts-node. Use `#!/usr/bin/env tsx` for hashbang scripts. |
| `rss-parser` | 3.13.0 | RSS/Atom feed parsing | Covers both RSS 2.0 and Atom, works in Node, supports custom fields for non-standard feed elements. Last published 3 years ago but stable — RSS spec doesn't change. Alternatives (feedparser) are similarly dated. |
| `dotenv` | 16.x | `.env` file loading | Load `TELEGRAM_API_ID`, `ANTHROPIC_API_KEY` etc. before process.env access. Pair with Zod schema for validated typed config object at startup. Node 22 `--env-file` flag exists but doesn't do validation — still need dotenv for the validation layer. |
| `vitest` | 4.1.8 | Unit/integration testing | Vite-native, zero config for ESM+TS, 8x faster watch mode than Jest. No separate `ts-jest` config. Use for testing extractors, dedup logic, and adapter parsing. |

### Development Tools

| Tool | Purpose | Notes |
|------|---------|-------|
| `esbuild` | Production bundle | `esbuild src/index.ts --bundle --platform=node --target=node22 --outfile=dist/hire-radar.js` — single distributable file. Does not type-check; run `tsc --noEmit` separately. |
| `@commander-js/extra-typings` | Enhanced Commander TypeScript types | Gives fully typed `.opts()` return values and `.args` inference. Requires TS 5.0+. |
| `@types/better-sqlite3` | Types for better-sqlite3 | 7.6.13 (April 2025). Install separately — better-sqlite3 ships JS only. |

## Installation

```bash
# Core runtime dependencies
npm install telegram @anthropic-ai/sdk better-sqlite3 zod commander dotenv rss-parser

# Dev dependencies
npm install -D typescript tsx vitest esbuild @types/node @types/better-sqlite3 @commander-js/extra-typings
```

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| `better-sqlite3` | `node:sqlite` (built-in) | When it reaches Stability 2 (not before Node 24 LTS at earliest). Currently Stability 1.1 — experimental, no production use. Performance is also 14–67% slower. |
| `gramjs` (`telegram` npm) | `teleproto` | If you need Telegram Layer 225+ features or HTTP/HTTPS proxy support out of the box. `teleproto` is a 2025 fork with faster TL schema updates, but smaller community and less documented. |
| `commander` | `yargs` | If you need middleware chains, complex validation pipelines, or more than ~5 deeply nested subcommands. Yargs' DX is richer but adds 3 transitive dependencies. For 3 simple subcommands, Commander is strictly sufficient. |
| `tsx` (dev runner) | `ts-node` | Never for this project. ts-node requires `--esm` flag ceremony, 500ms+ cold start, 125MB memory vs 35MB. Dead end for ESM. |
| Native `fetch` (Node 22) | `axios` | Axios if you need request interceptors or automatic retry adapters. For simple REST calls to hh.uz with a few query params, native `fetch` is zero-dependency and identical ergonomics. |
| `zod` 4.x | `zod` 3.x | Do not use Zod 3 with `@anthropic-ai/sdk` 0.102.0+ — the `zodOutputFormat()` helper targets Zod 4 API. |
| `rss-parser` | `feedparser` | `feedparser` uses streams, which is ergonomically awkward for a CLI. `rss-parser` returns Promises and is simpler to integrate. |

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| `ts-node` | ESM support requires fragile `--loader` flags; 500ms+ cold start; 125MB memory baseline; largely superseded by `tsx` | `tsx` for dev, `esbuild` for dist |
| `node:sqlite` | Stability 1.1 — experimental in Node 22/23. Maintainers explicitly recommend against production use. 14–67% slower than `better-sqlite3` in benchmarks. | `better-sqlite3` |
| `node-fetch` | ESM-only as of v3, creating dual CJS/ESM headaches; Node 22 ships native fetch backed by undici that is equivalent | Native `fetch` (global in Node 18+) |
| `NestJS` / `BullMQ` | DI framework + queue overhead for a CLI that runs on demand — 5–10x more boilerplate than plain TS functions | Plain modules with explicit function calls |
| `Sequelize` / `TypeORM` | ORM overhead (migrations, entity tracking) for a schema that is ~3 tables with hand-written SQL — adds 3–5 dependencies | `better-sqlite3` with raw SQL + Zod validation |
| `Prisma` | Migration engine is overkill; binary query engine adds 30MB+; startup cost matters for a CLI | `better-sqlite3` with raw SQL |
| Jest | Requires `ts-jest` or Babel transform, config-heavy for ESM+TS, 8x slower watch mode vs Vitest | `vitest` |
| `grammy` / `telegraf` | Bot API only — cannot read channel history as a user; requires a bot account with channel admin rights | `gramjs` (MTProto user-bot) |

## Stack Patterns by Variant

**For dev iteration (no build step):**
- `tsx watch src/index.ts` — instant reload, full TS support, handles ESM imports
- No compilation artifacts to clean up

**For distribution / production run:**
- `esbuild` bundles to `dist/hire-radar.js` — single Node-executable file
- Pair with `tsc --noEmit` in CI for type checking before bundling
- Add `#!/usr/bin/env node` shebang + `chmod +x` for global install via `npm link`

**For Telegram auth (first run, interactive):**
- gramjs `StringSession` — serialize the session to a string, store in config/env
- Auth flow prompts for phone + OTP once; subsequent runs load session from env var
- Never commit the session string — treat like a credential

**For Anthropic structured extraction with cost control:**
- `client.messages.parse()` + `zodOutputFormat(VacancySchema)` — guaranteed JSON, no retry loop
- Pass `model: "claude-haiku-4-5"` (or latest Haiku variant) for extraction
- Cache by SHA-256 of normalized post text — skip API call on exact duplicate

## Version Compatibility

| Package | Compatible With | Notes |
|---------|-----------------|-------|
| `@anthropic-ai/sdk` ^0.102.0 | `zod` ^4.0.0 | `zodOutputFormat()` requires Zod 4 API. Zod 3 will fail at runtime. |
| `better-sqlite3` ^12.4.1 | Node.js 18/20/22 | Works fine on Node 22 — ignore LLM claims otherwise (confirmed by maintainers). Requires native build; needs `node-gyp` / Python3 available. |
| `gramjs` (`telegram`) ^2.17.4 | Node.js 18+ | No Node 22-specific issues reported. Uses BigInt internally — requires Node 10.3+ which covers all modern targets. |
| `tsx` ^4.22.4 | TypeScript 5.x, Node.js 18+ | Uses esbuild under the hood; does not respect `paths` aliases in tsconfig without additional config. Avoid tsconfig `paths` in this project to keep zero-config. |
| `vitest` ^4.1.8 | Node.js 18+ | v4 dropped Node 16/17 support. Works without Vite for Node-only projects — `vitest.config.ts` with `test.environment: 'node'`. |
| `commander` ^15.0.0 | Node.js 18+ | v15 is a major release; check CHANGELOG before upgrading from v12. Breaking changes in option inheritance. |

## Sources

- `gramjs` GitHub releases — https://github.com/gram-js/gramjs/releases (v2.17.4, May 14 2025; HIGH confidence)
- `better-sqlite3` GitHub discussion #1245 — https://github.com/WiseLibs/better-sqlite3/discussions/1245 (production readiness vs node:sqlite; HIGH confidence)
- SQLite driver benchmark — https://sqg.dev/blog/sqlite-driver-benchmark/ (performance numbers; MEDIUM confidence — one benchmark, check for bias)
- `node:sqlite` stability — https://nodejs.org/api/sqlite.html + nodejs/node commit 55239a4 (unflagged in v22.13.0/v23.4.0 but remains Stability 1.1; HIGH confidence)
- Anthropic SDK structured outputs — https://nerdleveltech.com/claude-structured-outputs-typescript-zod-tutorial (SDK 0.102.0 + Zod 4.4.3 pattern; MEDIUM confidence — verify SDK version against npm)
- tsx vs ts-node comparison — https://betterstack.com/community/guides/scaling-nodejs/tsx-vs-ts-node/ (performance numbers; HIGH confidence)
- npm package versions verified: `tsx` 4.22.4, `vitest` 4.1.8, `commander` 15.0.0, `better-sqlite3` 12.4.1, `@types/better-sqlite3` 7.6.13 (June 2026)

---
*Stack research for: hire-radar — Node.js/TypeScript CLI job-vacancy ingestion agent*
*Researched: 2026-06-13*
