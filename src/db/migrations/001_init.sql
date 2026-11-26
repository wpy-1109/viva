CREATE TABLE schema_migrations (
  id TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL
);

CREATE TABLE workspaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE sources (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  config_json TEXT NOT NULL,
  secret_ref TEXT,
  interval_seconds INTEGER NOT NULL DEFAULT 3600,
  enabled INTEGER NOT NULL DEFAULT 1,
  deleted_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE source_revisions (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL,
  checksum TEXT NOT NULL,
  cursor TEXT,
  provenance_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE documents (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  source_id TEXT NOT NULL,
  revision_id TEXT NOT NULL,
  path TEXT NOT NULL,
  title TEXT NOT NULL,
  checksum TEXT NOT NULL,
  byte_size INTEGER NOT NULL,
  text TEXT NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE checkpoints (
  source_id TEXT PRIMARY KEY,
  cursor TEXT,
  last_success_at TEXT,
  last_attempt_at TEXT,
  last_error TEXT
);

CREATE TABLE jobs (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  type TEXT NOT NULL,
  status TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  run_after TEXT NOT NULL,
  lease_owner TEXT,
  lease_until TEXT,
  last_error TEXT,
  cancel_requested INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (workspace_id, idempotency_key)
);

CREATE INDEX jobs_claim ON jobs (status, run_after);
CREATE INDEX jobs_lease ON jobs (status, lease_until);

CREATE TABLE job_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id TEXT NOT NULL,
  at TEXT NOT NULL,
  level TEXT NOT NULL,
  message TEXT NOT NULL,
  data_json TEXT NOT NULL
);

CREATE TABLE proposals (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  source_id TEXT,
  kind TEXT NOT NULL,
  status TEXT NOT NULL,
  title TEXT NOT NULL,
  document_path TEXT,
  document_key TEXT,
  base_text TEXT NOT NULL DEFAULT '',
  candidate_text TEXT NOT NULL DEFAULT '',
  diff_text TEXT NOT NULL,
  evidence_json TEXT NOT NULL,
  base_revision_id TEXT,
  candidate_revision_id TEXT,
  idempotency_key TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  decided_at TEXT,
  decision_note TEXT
);

CREATE TABLE published_chunks (
  rowid INTEGER PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  document_key TEXT NOT NULL,
  source_id TEXT,
  revision_id TEXT,
  path TEXT NOT NULL,
  title TEXT NOT NULL,
  text TEXT NOT NULL,
  checksum TEXT NOT NULL
);

CREATE VIRTUAL TABLE published_fts USING fts5(
  path,
  title,
  text,
  content='published_chunks',
  content_rowid='rowid',
  tokenize='trigram'
);

CREATE TRIGGER published_chunks_ai AFTER INSERT ON published_chunks BEGIN
  INSERT INTO published_fts(rowid, path, title, text)
  VALUES (new.rowid, new.path, new.title, new.text);
END;

CREATE TRIGGER published_chunks_ad AFTER DELETE ON published_chunks BEGIN
  INSERT INTO published_fts(published_fts, rowid, path, title, text)
  VALUES ('delete', old.rowid, old.path, old.title, old.text);
END;

CREATE TRIGGER published_chunks_au AFTER UPDATE ON published_chunks BEGIN
  INSERT INTO published_fts(published_fts, rowid, path, title, text)
  VALUES ('delete', old.rowid, old.path, old.title, old.text);
  INSERT INTO published_fts(rowid, path, title, text)
  VALUES (new.rowid, new.path, new.title, new.text);
END;

CREATE TABLE published_history (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  document_key TEXT NOT NULL,
  source_id TEXT,
  revision_id TEXT,
  path TEXT NOT NULL,
  title TEXT NOT NULL,
  text TEXT NOT NULL,
  checksum TEXT NOT NULL,
  published_at TEXT NOT NULL
);

CREATE TABLE questions (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  query TEXT NOT NULL,
  answer TEXT,
  abstained INTEGER NOT NULL,
  provider_mode TEXT NOT NULL,
  retrieval TEXT NOT NULL,
  citations_json TEXT NOT NULL,
  error TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE feedback (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  question_id TEXT,
  rating TEXT,
  comment TEXT,
  unanswered INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE prompt_versions (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  name TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL,
  parent_id TEXT,
  eval_json TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE policies (
  workspace_id TEXT PRIMARY KEY,
  autopublish_enabled INTEGER NOT NULL DEFAULT 0,
  autopublish_max_lines INTEGER NOT NULL DEFAULT 40,
  autopublish_kinds TEXT NOT NULL DEFAULT 'change',
  github_publish_enabled INTEGER NOT NULL DEFAULT 0,
  active_prompt_id TEXT,
  max_calls_per_run INTEGER NOT NULL DEFAULT 4,
  max_tokens_per_call INTEGER NOT NULL DEFAULT 800,
  max_estimated_usd REAL NOT NULL DEFAULT 0.05,
  usd_per_1k_tokens REAL NOT NULL DEFAULT 0.001
);

CREATE TABLE model_config (
  workspace_id TEXT PRIMARY KEY,
  mode TEXT NOT NULL,
  base_url TEXT,
  model TEXT,
  secret_ref TEXT,
  protocol TEXT NOT NULL DEFAULT 'openai-completions'
);

CREATE TABLE channel_config (
  workspace_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 0,
  accept_inbound INTEGER NOT NULL DEFAULT 0,
  allow_outbound INTEGER NOT NULL DEFAULT 0,
  settings_json TEXT NOT NULL,
  secret_ref TEXT,
  PRIMARY KEY (workspace_id, kind)
);

CREATE TABLE channel_events (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  event_id TEXT NOT NULL,
  received_at TEXT NOT NULL,
  UNIQUE (workspace_id, kind, event_id)
);

CREATE TABLE control (
  workspace_id TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (workspace_id, key)
);

CREATE TABLE heartbeats (
  workspace_id TEXT NOT NULL,
  role TEXT NOT NULL,
  pid INTEGER,
  status TEXT NOT NULL,
  last_seen TEXT NOT NULL,
  detail TEXT,
  PRIMARY KEY (workspace_id, role)
);

CREATE TABLE usage_ledger (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  calls INTEGER NOT NULL,
  tokens_in INTEGER NOT NULL,
  tokens_out INTEGER NOT NULL,
  estimated_usd REAL NOT NULL,
  limited INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id TEXT,
  at TEXT NOT NULL,
  action TEXT NOT NULL,
  detail_json TEXT NOT NULL
);
