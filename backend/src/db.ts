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
    api_key   TEXT,
    api_type  TEXT NOT NULL DEFAULT 'openai'
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
    parent_id       TEXT REFERENCES messages(id) ON DELETE SET NULL,
    role            TEXT NOT NULL CHECK(role IN ('system','user','assistant')),
    content         TEXT NOT NULL DEFAULT '',
    error           TEXT,
    stats           TEXT,
    model           TEXT,
    created_at      INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_messages_conv
    ON messages(conversation_id, created_at);

  -- Drop old model_configs table if present and replace with model_settings
  DROP TABLE IF EXISTS model_configs;

  CREATE TABLE IF NOT EXISTS model_settings (
    id                TEXT PRIMARY KEY,
    is_preset         INTEGER NOT NULL DEFAULT 0,
    name              TEXT,
    base_model_id     TEXT,
    system_prompt     TEXT,
    can_image         INTEGER NOT NULL DEFAULT 0,
    can_audio         INTEGER NOT NULL DEFAULT 0,
    can_video         INTEGER NOT NULL DEFAULT 0,
    temperature       REAL,
    icon              TEXT,
    seed              INTEGER,
    reasoning_effort  TEXT,
    thinking          INTEGER NOT NULL DEFAULT 0,
    max_tokens        INTEGER,
    top_k             INTEGER,
    top_p             REAL,
    min_p             REAL,
    presence_penalty  REAL,
    frequency_penalty REAL,
    repeat_penalty    REAL,
    ctx_length        INTEGER,
    is_hidden         INTEGER NOT NULL DEFAULT 0,
    sort_order        INTEGER NOT NULL DEFAULT 0,
    is_default        INTEGER NOT NULL DEFAULT 0
  );

  -- Cached models from external backends
  CREATE TABLE IF NOT EXISTS cached_models (
    id          TEXT PRIMARY KEY,
    backend_id  TEXT NOT NULL REFERENCES backends(id) ON DELETE CASCADE,
    raw_id      TEXT NOT NULL,
    is_online   INTEGER NOT NULL DEFAULT 1,
    last_synced INTEGER NOT NULL
  );

  -- MCP Servers
  CREATE TABLE IF NOT EXISTS mcp_servers (
    id             TEXT PRIMARY KEY,
    name           TEXT NOT NULL,
    type           TEXT NOT NULL DEFAULT 'stdio',
    command_or_url TEXT NOT NULL,
    args           TEXT NOT NULL DEFAULT '[]',
    env            TEXT NOT NULL DEFAULT '{}',
    headers        TEXT NOT NULL DEFAULT '{}',
    is_enabled     INTEGER NOT NULL DEFAULT 1
  );

  -- Skills
  CREATE TABLE IF NOT EXISTS skills (
    id           TEXT PRIMARY KEY,
    name         TEXT NOT NULL,
    description  TEXT NOT NULL,
    instructions TEXT NOT NULL,
    dir_path     TEXT,
    source_url   TEXT,
    content_hash TEXT NOT NULL,
    is_enabled   INTEGER NOT NULL DEFAULT 1,
    created_at   INTEGER NOT NULL
  );

  -- Global App / User Settings
  CREATE TABLE IF NOT EXISTS global_settings (
    id           TEXT PRIMARY KEY,
    user_name    TEXT NOT NULL DEFAULT 'You',
    user_avatar  TEXT,
    theme        TEXT NOT NULL DEFAULT 'autumn'
  );

  INSERT OR IGNORE INTO global_settings (id, user_name, user_avatar, theme)
  VALUES ('default', 'You', NULL, 'autumn');

  -- Migration helper to ensure existing DBs get the new columns
  CREATE INDEX IF NOT EXISTS idx_attachments_conv ON attachments(conversation_id);
  CREATE INDEX IF NOT EXISTS idx_attachments_msg  ON attachments(message_id);
`);

// Add missing columns if upgrading from earlier table definition
const columnsToAdd = [
  { name: "icon", type: "TEXT" },
  { name: "seed", type: "INTEGER" },
  { name: "reasoning_effort", type: "TEXT" },
  { name: "thinking", type: "INTEGER NOT NULL DEFAULT 0" },
  { name: "max_tokens", type: "INTEGER" },
  { name: "top_k", type: "INTEGER" },
  { name: "top_p", type: "REAL" },
  { name: "min_p", type: "REAL" },
  { name: "presence_penalty", type: "REAL" },
  { name: "frequency_penalty", type: "REAL" },
  { name: "repeat_penalty", type: "REAL" },
  { name: "ctx_length", type: "INTEGER" },
  { name: "is_hidden", type: "INTEGER NOT NULL DEFAULT 0" },
  { name: "sort_order", type: "INTEGER NOT NULL DEFAULT 0" },
  { name: "is_default", type: "INTEGER NOT NULL DEFAULT 0" },
  { name: "ctx_overflow_behavior", type: "TEXT" },
];
const modelSettingCols = (db.pragma("table_info(model_settings)") as { name: string }[]).map(c => c.name);
for (const col of columnsToAdd) {
  if (!modelSettingCols.includes(col.name)) {
    try {
      db.exec(`ALTER TABLE model_settings ADD COLUMN ${col.name} ${col.type}`);
    } catch (e) { }
  }
}

// Migration helper for conversations columns (excluded_mcps, excluded_skills)
const convCols = (db.pragma("table_info(conversations)") as { name: string }[]).map(c => c.name);
if (!convCols.includes("excluded_mcps")) {
  try {
    db.exec(`ALTER TABLE conversations ADD COLUMN excluded_mcps TEXT NOT NULL DEFAULT '[]'`);
  } catch (e) { }
}
if (!convCols.includes("excluded_skills")) {
  try {
    db.exec(`ALTER TABLE conversations ADD COLUMN excluded_skills TEXT NOT NULL DEFAULT '[]'`);
  } catch (e) { }
}

// Migration helper for mcp_servers columns (headers)
const mcpCols = (db.pragma("table_info(mcp_servers)") as { name: string }[]).map(c => c.name);
if (!mcpCols.includes("headers")) {
  try {
    db.exec(`ALTER TABLE mcp_servers ADD COLUMN headers TEXT NOT NULL DEFAULT '{}'`);
  } catch (e) { }
}

// Migration helper for global_settings columns
const globalSettingsCols = (db.pragma("table_info(global_settings)") as { name: string }[]).map(c => c.name);
if (!globalSettingsCols.includes("auto_name_mode")) {
  try {
    db.exec(`ALTER TABLE global_settings ADD COLUMN auto_name_mode TEXT NOT NULL DEFAULT 'first_words'`);
  } catch (e) { }
}
if (!globalSettingsCols.includes("auto_name_model")) {
  try {
    db.exec(`ALTER TABLE global_settings ADD COLUMN auto_name_model TEXT`);
  } catch (e) { }
}
if (!globalSettingsCols.includes("tool_routing_mode")) {
  try {
    db.exec(`ALTER TABLE global_settings ADD COLUMN tool_routing_mode TEXT NOT NULL DEFAULT 'off'`);
  } catch (e) { }
}
if (!globalSettingsCols.includes("tool_routing_model")) {
  try {
    db.exec(`ALTER TABLE global_settings ADD COLUMN tool_routing_model TEXT`);
  } catch (e) { }
}
if (!globalSettingsCols.includes("ctx_overflow_behavior")) {
  try {
    db.exec(`ALTER TABLE global_settings ADD COLUMN ctx_overflow_behavior TEXT NOT NULL DEFAULT 'truncate_middle'`);
  } catch (e) { }
}

// Migration helper for backends.api_type
const backendCols = (db.pragma("table_info(backends)") as { name: string }[]).map(c => c.name);
if (!backendCols.includes("api_type")) {
  try {
    db.exec(`ALTER TABLE backends ADD COLUMN api_type TEXT NOT NULL DEFAULT 'openai'`);
  } catch (e) { }
}

// Migration helper for messages (parent_id, model, tool_calls, tool_call_id)
const msgCols = (db.pragma("table_info(messages)") as { name: string }[]).map(c => c.name);
if (!msgCols.includes("parent_id")) {
  try {
    db.exec(`ALTER TABLE messages ADD COLUMN parent_id TEXT REFERENCES messages(id) ON DELETE SET NULL`);
  } catch (e) { }
}
if (!msgCols.includes("model")) {
  try {
    db.exec(`ALTER TABLE messages ADD COLUMN model TEXT`);
  } catch (e) { }
}
if (!msgCols.includes("tool_calls")) {
  try {
    db.exec(`ALTER TABLE messages ADD COLUMN tool_calls TEXT`);
  } catch (e) { }
}
if (!msgCols.includes("tool_call_id")) {
  try {
    db.exec(`ALTER TABLE messages ADD COLUMN tool_call_id TEXT`);
  } catch (e) { }
}

// Backfill legacy assistant messages with conversation model if model is NULL
try {
  db.exec(`
    UPDATE messages
    SET model = (SELECT model FROM conversations WHERE id = messages.conversation_id)
    WHERE role = 'assistant' AND model IS NULL;
  `);
} catch (e) { }

try {
  db.exec(`CREATE INDEX IF NOT EXISTS idx_messages_parent ON messages(parent_id);`);
} catch (e) { }

export const insertMessage = db.prepare<{
  id: string;
  conversationId: string;
  parentId: string | null;
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  error: string | null;
  stats: string | null;
  model: string | null;
  toolCalls: string | null;
  toolCallId: string | null;
  createdAt: number;
}>(
  "INSERT INTO messages (id, conversation_id, parent_id, role, content, error, stats, model, tool_calls, tool_call_id, created_at) VALUES (@id, @conversationId, @parentId, @role, @content, @error, @stats, @model, @toolCalls, @toolCallId, @createdAt)"
);

// Backfill parent_id for existing linear conversations if null
try {
  const convs = db.prepare("SELECT id FROM conversations").all() as { id: string }[];
  for (const c of convs) {
    const msgs = db.prepare("SELECT id FROM messages WHERE conversation_id = ? ORDER BY created_at ASC").all(c.id) as { id: string }[];
    for (let i = 1; i < msgs.length; i++) {
      db.prepare("UPDATE messages SET parent_id = ? WHERE id = ? AND parent_id IS NULL").run(msgs[i - 1].id, msgs[i].id);
    }
  }
} catch (e) { }

export default db;
