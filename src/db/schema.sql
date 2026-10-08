CREATE TABLE IF NOT EXISTS domains (
  id INTEGER PRIMARY KEY,
  host TEXT UNIQUE NOT NULL,
  first_seen TEXT NOT NULL,
  last_scanned TEXT
);

CREATE TABLE IF NOT EXISTS scans (
  id INTEGER PRIMARY KEY,
  domain_id INTEGER NOT NULL REFERENCES domains(id),
  requested_url TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  started_at TEXT,
  finished_at TEXT,
  pages_crawled INTEGER DEFAULT 0,
  pages_discovered INTEGER DEFAULT 0,
  crawl_limit_hit INTEGER DEFAULT 0,
  options_json TEXT,
  share_token TEXT UNIQUE NOT NULL,
  unlocked_at TEXT,
  created_via TEXT DEFAULT 'web'
);

CREATE TABLE IF NOT EXISTS pages (
  id INTEGER PRIMARY KEY,
  scan_id INTEGER NOT NULL REFERENCES scans(id),
  url TEXT NOT NULL,
  status_code INTEGER,
  redirect_chain TEXT,
  depth INTEGER,
  title TEXT,
  meta_desc TEXT,
  canonical TEXT,
  robots_meta TEXT,
  h1_count INTEGER,
  word_count INTEGER,
  lang TEXT,
  hreflang TEXT,
  simhash TEXT,
  links_out TEXT,
  images_missing_alt INTEGER DEFAULT 0,
  bytes_html INTEGER,
  fetched_at TEXT
);

CREATE TABLE IF NOT EXISTS findings (
  id INTEGER PRIMARY KEY,
  scan_id INTEGER NOT NULL REFERENCES scans(id),
  check_id TEXT NOT NULL,
  severity TEXT NOT NULL,
  payload_json TEXT,
  impact INTEGER,
  effort INTEGER
);

CREATE TABLE IF NOT EXISTS leads (
  id INTEGER PRIMARY KEY,
  scan_id INTEGER NOT NULL REFERENCES scans(id),
  email TEXT NOT NULL,
  domain_id INTEGER REFERENCES domains(id),
  created_at TEXT DEFAULT (datetime('now')),
  source TEXT DEFAULT 'web',
  ip_hash TEXT
);

CREATE INDEX IF NOT EXISTS idx_scans_domain ON scans(domain_id);
CREATE INDEX IF NOT EXISTS idx_pages_scan ON pages(scan_id);
CREATE INDEX IF NOT EXISTS idx_findings_scan ON findings(scan_id);
