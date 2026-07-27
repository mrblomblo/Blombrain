import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const DATA_DIR = process.env.BLOMBRAIN_DATA_DIR ?? path.join(__dirname, "..", "data");
mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = path.join(DATA_DIR, "blombrain.db");

const db = new Database(DB_PATH);

// WAL mode -- better concurrency for reads alongside long writes.
db.pragma("journal_mode = WAL");
// Enforce foreign-key constraints.
db.pragma("foreign_keys = ON");

/**
 * Schema migrations run synchronously at startup.
 * Each migration is guarded by IF NOT EXISTS so re-running is safe.
 */
db.exec(`
  -- Inference backends (replaces the old config/backends.json)
  CREATE TABLE IF NOT EXISTS backends (
    id        TEXT PRIMARY KEY,
    name      TEXT NOT NULL,
    base_url  TEXT NOT NULL,
    prefix    TEXT NOT NULL UNIQUE,
    api_key   TEXT
  );

  -- Conversations
  CREATE TABLE IF NOT EXISTS conversations (
    id         TEXT PRIMARY KEY,
    title      TEXT NOT NULL DEFAULT 'New conversation',
    model      TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  -- Messages
  CREATE TABLE IF NOT EXISTS messages (
    id              TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    role            TEXT NOT NULL CHECK(role IN ('system','user','assistant')),
    content         TEXT NOT NULL DEFAULT '',
    error           TEXT,
    created_at      INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_messages_conv
    ON messages(conversation_id, created_at);

  -- Drop old model_configs table if present and replace with model_settings
  DROP TABLE IF EXISTS model_configs;

  CREATE TABLE IF NOT EXISTS model_settings (
    id             TEXT PRIMARY KEY,
    is_preset      INTEGER NOT NULL DEFAULT 0,
    name           TEXT,
    base_model_id  TEXT,
    system_prompt  TEXT,
    can_image      INTEGER NOT NULL DEFAULT 0,
    can_audio      INTEGER NOT NULL DEFAULT 0,
    can_video      INTEGER NOT NULL DEFAULT 0,
    temperature    REAL
  );

  -- Uploaded attachment files
  CREATE TABLE IF NOT EXISTS attachments (
    id              TEXT PRIMARY KEY,
    conversation_id TEXT REFERENCES conversations(id) ON DELETE CASCADE,
    message_id      TEXT,
    original_name   TEXT NOT NULL,
    mime_type       TEXT NOT NULL,
    disk_path       TEXT NOT NULL,
    size_bytes      INTEGER NOT NULL,
    created_at      INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_attachments_conv ON attachments(conversation_id);
  CREATE INDEX IF NOT EXISTS idx_attachments_msg  ON attachments(message_id);
`);

export default db;
