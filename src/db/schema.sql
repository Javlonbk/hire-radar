CREATE TABLE IF NOT EXISTS sources (
  id              TEXT PRIMARY KEY,
  type            TEXT NOT NULL,
  enabled         INTEGER NOT NULL DEFAULT 1,
  config_json     TEXT NOT NULL,
  last_fetched_at TEXT
);

CREATE TABLE IF NOT EXISTS raw_items (
  id                TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  source_id         TEXT NOT NULL,
  external_id       TEXT,
  raw_text          TEXT NOT NULL,
  raw_json          TEXT,
  content_hash      TEXT NOT NULL,
  fetched_at        TEXT NOT NULL,
  extraction_status TEXT NOT NULL DEFAULT 'pending',
  extraction_error  TEXT,
  UNIQUE(content_hash)
);
CREATE INDEX IF NOT EXISTS raw_items_status ON raw_items(extraction_status);
CREATE INDEX IF NOT EXISTS raw_items_source ON raw_items(source_id);

CREATE TABLE IF NOT EXISTS extraction_cache (
  content_hash  TEXT PRIMARY KEY,
  result_json   TEXT NOT NULL,
  extracted_at  TEXT NOT NULL,
  model         TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS vacancies (
  id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  source_id       TEXT NOT NULL,
  raw_item_id     TEXT NOT NULL,
  external_id     TEXT,
  title           TEXT NOT NULL,
  company         TEXT NOT NULL,
  description     TEXT NOT NULL,
  skills          TEXT,
  salary_min      INTEGER,
  salary_max      INTEGER,
  salary_currency TEXT,
  location        TEXT,
  remote_type     TEXT,
  apply_contact   TEXT,
  lang            TEXT,
  posted_at       TEXT,
  content_hash    TEXT NOT NULL,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(content_hash)
);
CREATE INDEX IF NOT EXISTS vacancies_posted_at ON vacancies(posted_at DESC);
CREATE INDEX IF NOT EXISTS vacancies_source    ON vacancies(source_id);
