import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DATA_DIR = process.env.BLOMBRAIN_DATA_DIR ?? path.join(__dirname, "..", "data");
mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = path.join(DATA_DIR, "blombrain.db");

const db = new Database(DB_PATH);

// WAL mode -- better concurrency for reads alongside long writes.
db.pragma("journal_mode = WAL");
// Enforce foreign-key constraints.
db.pragma("foreign_keys = ON");

/**
 * Schema migrations run synchronously at startup.
 * Each migration is guarded by IF NOT EXISTS / IF NOT EXISTS on columns,
 * so re-running is safe.
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
`);

export default db;
