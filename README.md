# Hire Radar

A standalone job-vacancy ingestion agent for the Uzbekistan / Central Asia market, run as a CLI.

It pulls raw job postings from **Telegram channels, the hh.uz API, and RSS feeds**, uses **Claude (Haiku)** to extract structured vacancies from messy multilingual posts (uz-Latn / uz-Cyrl / ru / en), deduplicates them, and persists everything to a local **SQLite** database. `list` and `export` let you browse the results.

```
sources ──▶ fetch (raw_items) ──▶ Claude extract (cached) ──▶ dedupe ──▶ SQLite ──▶ list / export
```

## Requirements

- **Node.js ≥ 22**
- An **Anthropic API key** (for extraction)
- **Telegram API credentials** (`api_id` / `api_hash` from https://my.telegram.org) — only if you use the Telegram source

## Install

```bash
git clone https://github.com/Javlonbk/hire-radar.git
cd hire-radar
npm install
```

This installs a `hire-radar` command (via the local `bin/`). Run it as `./bin/hire-radar …`, or `npm link` to use `hire-radar` globally.

## Configure

**1. Secrets — put them in a `.env` file** (loaded automatically; never commit it):

```dotenv
ANTHROPIC_API_KEY=sk-ant-...
# Telegram (only if using the Telegram source):
TELEGRAM_API_ID=1234567
TELEGRAM_API_HASH=your_api_hash
TELEGRAM_SESSION=          # produced by `hire-radar auth` — see below
```

**2. Sources — copy the example config** and edit it:

```bash
cp config.example.json config.json
```

```jsonc
{
  "telegram": { "channels": ["itpark_jobs", "example_channel"] },  // public channel usernames
  "hh":       { "area": "97", "text": "developer", "perPage": 100 }, // area 97 = Tashkent
  "rss":      { "feeds": ["https://example.com/jobs.rss"] }
}
```

Any source you omit is simply skipped.

## Usage

**One-time: authenticate Telegram** (skip if you're not using Telegram). This runs an interactive login (phone → code → optional 2FA) and prints a session string:

```bash
hire-radar auth
# copy the printed value into .env as TELEGRAM_SESSION=...
```

**Ingest** — fetch, extract, and persist from all configured sources:

```bash
hire-radar ingest
```

It prints a per-run summary: `fetched`, `extracted`, `deduped`, `skipped`, and `Claude API calls`. Re-running is cheap — already-seen posts are cached and make **zero** API calls.

**Browse** the ingested vacancies:

```bash
hire-radar list --keyword react --since 2026-06-01
hire-radar export --source hh:uz | jq '.[].title'
```

## Commands

| Command | What it does | Options |
|---|---|---|
| `ingest` | Fetch → extract → persist from sources | `--source <id>` (e.g. `hh:uz`), `--since <YYYY-MM-DD>` |
| `list` | Print matching vacancies in aligned columns | `--source`, `--keyword`, `--since`, `--until`, `--limit` (default 20) |
| `export` | Dump matching vacancies as a JSON array to stdout (pipeable) | same filters as `list`; `--limit` has no default |
| `auth` | One-time interactive Telegram login → prints a `TELEGRAM_SESSION` string | — |

`--keyword` matches title, company, skills, or description. Source ids look like `hh:uz`, `telegram:<channel>`, `rss:<hash>`.

## Where data lives

Everything is stored in `data/hire-radar.db` (SQLite, gitignored). Delete the file to start fresh. Duplicate vacancies (same normalized title + company + description) are ignored on insert.

## Development

```bash
npm test          # run the test suite (vitest)
npm run typecheck # tsc --noEmit
npm run build     # bundle to dist/ with esbuild
```

## Notes

- **Cost control:** extraction uses Claude Haiku and caches every result by content hash, so re-ingesting the same posts is free.
- **Scraping ethics:** public Telegram channels only, respects hh.uz rate limits. No LinkedIn scraping.
- **Scope:** v1 is ingestion only — no user matching, notifications, or web UI. See `.planning/` for the full design and roadmap.
