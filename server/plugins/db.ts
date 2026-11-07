import { runMigrations } from "@agent-native/core/db";

export default runMigrations(
  [
    {
      version: 1,
      name: "reprint-core-tables",
      sql: `CREATE TABLE IF NOT EXISTS reprint_documents (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  page_count INTEGER NOT NULL DEFAULT 1,
  pages JSONB NOT NULL,
  created_at TEXT NOT NULL DEFAULT (now()),
  owner_email TEXT NOT NULL DEFAULT 'local@localhost',
  org_id TEXT,
  visibility TEXT NOT NULL DEFAULT 'private'
);
CREATE TABLE IF NOT EXISTS reprint_document_shares (
  id TEXT PRIMARY KEY,
  resource_id TEXT NOT NULL,
  principal_type TEXT NOT NULL,
  principal_id TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'viewer',
  created_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (now()),
  notified_at TEXT
);
CREATE TABLE IF NOT EXISTS reprint_patches (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES reprint_documents(id) ON DELETE CASCADE,
  page INTEGER NOT NULL,
  rect JSONB NOT NULL,
  target JSONB NOT NULL,
  old_text TEXT NOT NULL DEFAULT '',
  new_text TEXT NOT NULL,
  font_family TEXT NOT NULL DEFAULT 'sans' CHECK (font_family IN ('sans', 'serif', 'mono')),
  bold BOOLEAN NOT NULL DEFAULT false,
  font_size REAL NOT NULL,
  original_font_size REAL NOT NULL,
  align TEXT NOT NULL DEFAULT 'left' CHECK (align IN ('left', 'right', 'center')),
  text_color TEXT NOT NULL DEFAULT '#111111',
  bg_color TEXT NOT NULL DEFAULT '#ffffff',
  border BOOLEAN NOT NULL DEFAULT false,
  layout JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'ok' CHECK (status IN ('ok', 'warn', 'error')),
  warnings JSONB NOT NULL DEFAULT '[]',
  source TEXT NOT NULL DEFAULT 'user' CHECK (source IN ('user', 'agent')),
  owner_email TEXT NOT NULL,
  org_id TEXT,
  created_at TEXT NOT NULL DEFAULT (now()),
  updated_at TEXT NOT NULL DEFAULT (now())
);
CREATE TABLE IF NOT EXISTS reprint_locks (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES reprint_documents(id) ON DELETE CASCADE,
  page INTEGER NOT NULL,
  rect JSONB NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  owner_email TEXT NOT NULL,
  org_id TEXT,
  created_at TEXT NOT NULL DEFAULT (now())
);
CREATE TABLE IF NOT EXISTS reprint_suggestions (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES reprint_documents(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('related', 'weekday', 'past_date', 'combo', 'currency')),
  severity TEXT NOT NULL CHECK (severity IN ('error', 'warn', 'info')),
  page INTEGER NOT NULL,
  target JSONB NOT NULL,
  old_text TEXT NOT NULL,
  suggested_text TEXT NOT NULL DEFAULT '',
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'accepted', 'dismissed')),
  owner_email TEXT NOT NULL,
  org_id TEXT,
  created_at TEXT NOT NULL DEFAULT (now())
);
CREATE INDEX IF NOT EXISTS reprint_documents_owner_org_created_idx ON reprint_documents (owner_email, org_id, created_at);
CREATE INDEX IF NOT EXISTS reprint_document_shares_resource_idx ON reprint_document_shares (resource_id, principal_type, principal_id);
CREATE INDEX IF NOT EXISTS reprint_patches_doc_page_idx ON reprint_patches (document_id, page);
CREATE INDEX IF NOT EXISTS reprint_locks_doc_page_idx ON reprint_locks (document_id, page);
CREATE INDEX IF NOT EXISTS reprint_suggestions_doc_status_idx ON reprint_suggestions (document_id, status)`,
    },
  ],
  { table: "reprint_app_migrations" },
);
