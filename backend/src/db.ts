import Database from "better-sqlite3";
import { copyFileSync, cpSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { DATA_DIR, MIGRATE_FROM_DIR } from "./paths.js";

export { DATA_DIR };

mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = path.join(DATA_DIR, "blombrain.db");

function copyLegacyDataIfNeeded(): string | null {
  if (!MIGRATE_FROM_DIR || existsSync(DB_PATH)) {
    return null;
  }
  if (path.resolve(MIGRATE_FROM_DIR) === path.resolve(DATA_DIR)) {
    return null;
  }
  const srcDb = path.join(MIGRATE_FROM_DIR, "blombrain.db");
  if (!existsSync(srcDb)) {
    return null;
  }

  console.log(`[db] Migrating existing data from ${MIGRATE_FROM_DIR} to ${DATA_DIR}...`);
  try {
    copyFileSync(srcDb, DB_PATH);
    for (const suffix of ["-wal", "-shm"]) {
      const srcAux = srcDb + suffix;
      if (existsSync(srcAux)) {
        copyFileSync(srcAux, DB_PATH + suffix);
      }
    }
    for (const dirName of ["uploads", "skills"]) {
      const srcSub = path.join(MIGRATE_FROM_DIR, dirName);
      const destSub = path.join(DATA_DIR, dirName);
      if (existsSync(srcSub) && !existsSync(destSub)) {
        cpSync(srcSub, destSub, { recursive: true });
      }
    }
    return path.resolve(MIGRATE_FROM_DIR);
  } catch (err) {
    console.error("[db] Legacy data migration failed:", err);
    return null;
  }
}

function loadNativeSqliteAddon(): unknown | undefined {
  const explicitBinding = process.env.BLOMBRAIN_SQLITE_BINDING;
  if (!explicitBinding) {
    return undefined;
  }
  const resolved = path.resolve(explicitBinding);
  const addonModule = { exports: {} };
  (process as unknown as { dlopen: (mod: { exports: unknown }, filename: string) => void }).dlopen(
    addonModule,
    resolved
  );
  return addonModule.exports;
}

const migratedFromRoot = copyLegacyDataIfNeeded();
const nativeAddon = loadNativeSqliteAddon();
const db = nativeAddon
  ? new Database(DB_PATH, { nativeBinding: nativeAddon as any })
  : new Database(DB_PATH);

// WAL mode -- better concurrency for reads alongside long writes.
db.pragma("journal_mode = WAL");
// Enforce foreign-key constraints.
db.pragma("foreign_keys = ON");

// ---------------------------------------------------------------------------
// Migration System
// ---------------------------------------------------------------------------

interface Migration {
  version: number;
  description: string;
  run: () => void;
}

// Migration 1: Consolidates all existing schema setup and patches into a single
// baseline. This handles both fresh databases and old databases that were
// created before the versioned migration system existed.
const migration1: Migration = {
  version: 1,
  description: "Baseline schema and legacy ALTER TABLE migrations",
  run: () => {
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
        role            TEXT NOT NULL CHECK(role IN ('system','user','assistant','tool')),
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

      -- Auth Sessions
      CREATE TABLE IF NOT EXISTS auth_sessions (
        token      TEXT PRIMARY KEY,
        created_at INTEGER NOT NULL
      );

      -- Artifacts
      CREATE TABLE IF NOT EXISTS artifacts (
        id              TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        filename        TEXT NOT NULL,
        language        TEXT NOT NULL,
        title           TEXT NOT NULL,
        disk_path       TEXT NOT NULL DEFAULT '',
        size_bytes      INTEGER NOT NULL DEFAULT 0,
        created_at      INTEGER NOT NULL,
        updated_at      INTEGER NOT NULL,
        UNIQUE(conversation_id, filename)
      );

      CREATE INDEX IF NOT EXISTS idx_artifacts_conv ON artifacts(conversation_id);

      -- Global App / User Settings
      CREATE TABLE IF NOT EXISTS global_settings (
        id            TEXT PRIMARY KEY,
        user_name     TEXT NOT NULL DEFAULT 'You',
        user_avatar   TEXT,
        theme         TEXT NOT NULL DEFAULT 'autumn',
        network_tools_enabled INTEGER NOT NULL DEFAULT 0,
        artifact_network_enabled INTEGER NOT NULL DEFAULT 0,
        password_hash TEXT
      );

      INSERT OR IGNORE INTO global_settings (id, user_name, user_avatar, theme)
      VALUES ('default', 'You', NULL, 'autumn');

      -- Ensure attachments table exists (conversation_id is nullable for staging/icons/avatars)
      CREATE TABLE IF NOT EXISTS attachments (
        id              TEXT PRIMARY KEY,
        conversation_id TEXT REFERENCES conversations(id) ON DELETE CASCADE,
        message_id      TEXT REFERENCES messages(id) ON DELETE SET NULL,
        original_name   TEXT NOT NULL,
        mime_type       TEXT NOT NULL,
        disk_path       TEXT NOT NULL,
        size_bytes      INTEGER NOT NULL,
        created_at      INTEGER NOT NULL,
        purpose         TEXT NOT NULL DEFAULT 'attachment'
      );

      CREATE INDEX IF NOT EXISTS idx_attachments_conv ON attachments(conversation_id);
      CREATE INDEX IF NOT EXISTS idx_attachments_msg  ON attachments(message_id);
    `);

    // Add missing columns if upgrading from earlier table definition
    const columnsToAdd = [
      { name: "icon", type: "TEXT" },
      { name: "seed", type: "INTEGER" },
      { name: "reasoning_effort", type: "TEXT" },
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
      { name: "reasoning_injection_mode", type: "TEXT" },
    ];
    const modelSettingCols = (db.pragma("table_info(model_settings)") as { name: string }[]).map(c => c.name);
    for (const col of columnsToAdd) {
      if (!modelSettingCols.includes(col.name)) {
        try { db.exec(`ALTER TABLE model_settings ADD COLUMN ${col.name} ${col.type}`); } catch (e) { }
      }
    }

    // Migration helper for conversations columns
    const convCols = (db.pragma("table_info(conversations)") as { name: string }[]).map(c => c.name);
    if (!convCols.includes("excluded_mcps")) {
      try { db.exec(`ALTER TABLE conversations ADD COLUMN excluded_mcps TEXT NOT NULL DEFAULT '[]'`); } catch (e) { }
    }
    if (!convCols.includes("excluded_skills")) {
      try { db.exec(`ALTER TABLE conversations ADD COLUMN excluded_skills TEXT NOT NULL DEFAULT '[]'`); } catch (e) { }
    }
    if (!convCols.includes("tools_enabled")) {
      try { db.exec(`ALTER TABLE conversations ADD COLUMN tools_enabled INTEGER NOT NULL DEFAULT 1`); } catch (e) { }
    }

    // Migration helper for mcp_servers columns
    const mcpCols = (db.pragma("table_info(mcp_servers)") as { name: string }[]).map(c => c.name);
    if (!mcpCols.includes("headers")) {
      try { db.exec(`ALTER TABLE mcp_servers ADD COLUMN headers TEXT NOT NULL DEFAULT '{}'`); } catch (e) { }
    }

    // Migration helper for global_settings columns
    const globalSettingsCols = (db.pragma("table_info(global_settings)") as { name: string }[]).map(c => c.name);
    const globalSettingsToAdd = [
      { name: "auto_name_mode", type: "TEXT NOT NULL DEFAULT 'first_words'" },
      { name: "auto_name_model", type: "TEXT" },
      { name: "tool_routing_mode", type: "TEXT NOT NULL DEFAULT 'off'" },
      { name: "tool_routing_model", type: "TEXT" },
      { name: "ctx_overflow_behavior", type: "TEXT NOT NULL DEFAULT 'truncate_middle'" },
      { name: "reasoning_injection_mode", type: "TEXT NOT NULL DEFAULT 'all'" },
      { name: "password_hash", type: "TEXT" },
      { name: "network_tools_enabled", type: "INTEGER NOT NULL DEFAULT 0" },
      { name: "artifact_network_enabled", type: "INTEGER NOT NULL DEFAULT 0" },
    ];
    for (const col of globalSettingsToAdd) {
      if (!globalSettingsCols.includes(col.name)) {
        try { db.exec(`ALTER TABLE global_settings ADD COLUMN ${col.name} ${col.type}`); } catch (e) { }
      }
    }

    // Migration helper for backends.api_type
    const backendCols = (db.pragma("table_info(backends)") as { name: string }[]).map(c => c.name);
    if (!backendCols.includes("api_type")) {
      try { db.exec(`ALTER TABLE backends ADD COLUMN api_type TEXT NOT NULL DEFAULT 'openai'`); } catch (e) { }
    }

    // Migration helper for messages (parent_id, model, tool_calls, tool_call_id)
    const msgCols = (db.pragma("table_info(messages)") as { name: string }[]).map(c => c.name);
    if (!msgCols.includes("parent_id")) {
      try { db.exec(`ALTER TABLE messages ADD COLUMN parent_id TEXT REFERENCES messages(id) ON DELETE SET NULL`); } catch (e) { }
    }
    if (!msgCols.includes("model")) {
      try { db.exec(`ALTER TABLE messages ADD COLUMN model TEXT`); } catch (e) { }
    }
    if (!msgCols.includes("tool_calls")) {
      try { db.exec(`ALTER TABLE messages ADD COLUMN tool_calls TEXT`); } catch (e) { }
    }
    if (!msgCols.includes("tool_call_id")) {
      try { db.exec(`ALTER TABLE messages ADD COLUMN tool_call_id TEXT`); } catch (e) { }
    }

    // Migration helper for artifacts table
    const artifactCols = (db.pragma("table_info(artifacts)") as { name: string }[]).map(c => c.name);
    if (!artifactCols.includes("disk_path")) {
      try { db.exec(`ALTER TABLE artifacts ADD COLUMN disk_path TEXT NOT NULL DEFAULT ''`); } catch (e) { }
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
  }
};

// Migration 2: Enforce uniqueness on mcp_servers.name
const migration2: Migration = {
  version: 2,
  description: "Add UNIQUE constraint to mcp_servers.name",
  run: () => {
    // SQLite doesn't support adding constraints to existing tables directly.
    // We must recreate the table. It has no inbound foreign keys, so this is safe.
    db.exec(`
      CREATE TABLE IF NOT EXISTS mcp_servers_new (
        id             TEXT PRIMARY KEY,
        name           TEXT NOT NULL UNIQUE,
        type           TEXT NOT NULL DEFAULT 'stdio',
        command_or_url TEXT NOT NULL,
        args           TEXT NOT NULL DEFAULT '[]',
        env            TEXT NOT NULL DEFAULT '{}',
        headers        TEXT NOT NULL DEFAULT '{}',
        is_enabled     INTEGER NOT NULL DEFAULT 1
      );
      
      INSERT INTO mcp_servers_new (id, name, type, command_or_url, args, env, headers, is_enabled)
      SELECT id, name, type, command_or_url, args, env, headers, is_enabled FROM mcp_servers;
      
      DROP TABLE mcp_servers;
      ALTER TABLE mcp_servers_new RENAME TO mcp_servers;
    `);
  }
};

const migration3: Migration = {
  version: 3,
  description: "Allow 'tool' role in messages CHECK constraint, drop dead model_settings.thinking column, make attachments.conversation_id nullable with purpose column, and add disabled_builtin_tools",
  run: () => {
    // 1. Recreate messages table with 'tool' included in role CHECK constraint
    db.exec(`
      CREATE TABLE messages_new (
        id              TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        parent_id       TEXT REFERENCES messages_new(id) ON DELETE SET NULL,
        role            TEXT NOT NULL CHECK(role IN ('system','user','assistant','tool')),
        content         TEXT NOT NULL DEFAULT '',
        error           TEXT,
        stats           TEXT,
        model           TEXT,
        tool_calls      TEXT,
        tool_call_id    TEXT,
        created_at      INTEGER NOT NULL
      );

      INSERT INTO messages_new (id, conversation_id, parent_id, role, content, error, stats, model, tool_calls, tool_call_id, created_at)
      SELECT id, conversation_id, parent_id, role, content, error, stats, model, tool_calls, tool_call_id, created_at FROM messages;

      DROP TABLE messages;
      ALTER TABLE messages_new RENAME TO messages;

      CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_messages_parent ON messages(parent_id);
    `);

    // 2. Drop dead thinking column from model_settings if present
    const modelCols = (db.pragma("table_info(model_settings)") as { name: string }[]).map((c) => c.name);
    if (modelCols.includes("thinking")) {
      try {
        db.exec("ALTER TABLE model_settings DROP COLUMN thinking");
      } catch {
        // Ignore if SQLite version doesn't support DROP COLUMN
      }
    }

    // 3. Recreate attachments table to ensure conversation_id is nullable and purpose column exists
    const attachCols = (db.pragma("table_info(attachments)") as { name: string }[]).map((c) => c.name);
    const hasPurpose = attachCols.includes("purpose");
    db.exec(`
      CREATE TABLE attachments_new (
        id              TEXT PRIMARY KEY,
        conversation_id TEXT REFERENCES conversations(id) ON DELETE CASCADE,
        message_id      TEXT REFERENCES messages(id) ON DELETE SET NULL,
        original_name   TEXT NOT NULL,
        mime_type       TEXT NOT NULL,
        disk_path       TEXT NOT NULL,
        size_bytes      INTEGER NOT NULL,
        created_at      INTEGER NOT NULL,
        purpose         TEXT NOT NULL DEFAULT 'attachment'
      );

      INSERT INTO attachments_new (id, conversation_id, message_id, original_name, mime_type, disk_path, size_bytes, created_at, purpose)
      SELECT id, conversation_id, message_id, original_name, mime_type, disk_path, size_bytes, created_at, ${hasPurpose ? "COALESCE(purpose, 'attachment')" : "'attachment'"} FROM attachments;

      DROP TABLE attachments;
      ALTER TABLE attachments_new RENAME TO attachments;

      CREATE INDEX IF NOT EXISTS idx_attachments_conv ON attachments(conversation_id);
      CREATE INDEX IF NOT EXISTS idx_attachments_msg  ON attachments(message_id);
    `);

    // Backfill purpose for existing model icons and user avatars
    db.exec(`
      UPDATE attachments
      SET purpose = 'icon'
      WHERE id IN (
        SELECT REPLACE(icon, '/api/uploads/', '')
        FROM model_settings
        WHERE icon IS NOT NULL
      );

      UPDATE attachments
      SET purpose = 'avatar'
      WHERE id IN (
        SELECT REPLACE(user_avatar, '/api/uploads/', '')
        FROM global_settings
        WHERE user_avatar IS NOT NULL
      );
    `);

    // 4. Add disabled_builtin_tools to global_settings
    const gsCols = (db.pragma("table_info(global_settings)") as { name: string }[]).map((c) => c.name);
    if (!gsCols.includes("disabled_builtin_tools")) {
      db.exec(`ALTER TABLE global_settings ADD COLUMN disabled_builtin_tools TEXT NOT NULL DEFAULT '[]'`);
    }
  },
};

const migration4: Migration = {
  version: 4,
  description: "Add 3-layer memory tables (conversation_scratchpad, memories), conversation pinning/archiving/session overrides, MCP/skill summaries & keywords, and speech/memory global settings",
  run: () => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS conversation_scratchpad (
        conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        key             TEXT NOT NULL,
        content         TEXT NOT NULL DEFAULT '',
        updated_at      INTEGER NOT NULL,
        PRIMARY KEY (conversation_id, key)
      );

      CREATE TABLE IF NOT EXISTS memories (
        id                     TEXT PRIMARY KEY,
        content                TEXT NOT NULL,
        category               TEXT NOT NULL DEFAULT 'general',
        tags                   TEXT NOT NULL DEFAULT '[]',
        source_conversation_id TEXT REFERENCES conversations(id) ON DELETE SET NULL,
        embedding              BLOB,
        is_enabled             INTEGER NOT NULL DEFAULT 1,
        created_at             INTEGER NOT NULL,
        updated_at             INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_memories_enabled ON memories(is_enabled, updated_at DESC);
    `);

    const convCols = (db.pragma("table_info(conversations)") as { name: string }[]).map((c) => c.name);
    const convAdditions = [
      { name: "is_pinned", type: "INTEGER NOT NULL DEFAULT 0" },
      { name: "is_archived", type: "INTEGER NOT NULL DEFAULT 0" },
      { name: "memory_enabled", type: "INTEGER" },
      { name: "system_prompt_override", type: "TEXT" },
      { name: "sampling_overrides", type: "TEXT" },
    ];
    for (const col of convAdditions) {
      if (!convCols.includes(col.name)) {
        try {
          db.exec(`ALTER TABLE conversations ADD COLUMN ${col.name} ${col.type}`);
        } catch { }
      }
    }

    const mcpCols = (db.pragma("table_info(mcp_servers)") as { name: string }[]).map((c) => c.name);
    if (!mcpCols.includes("summary")) {
      try { db.exec("ALTER TABLE mcp_servers ADD COLUMN summary TEXT"); } catch { }
    }
    if (!mcpCols.includes("keywords")) {
      try { db.exec("ALTER TABLE mcp_servers ADD COLUMN keywords TEXT"); } catch { }
    }

    const skillCols = (db.pragma("table_info(skills)") as { name: string }[]).map((c) => c.name);
    if (!skillCols.includes("summary")) {
      try { db.exec("ALTER TABLE skills ADD COLUMN summary TEXT"); } catch { }
    }
    if (!skillCols.includes("keywords")) {
      try { db.exec("ALTER TABLE skills ADD COLUMN keywords TEXT"); } catch { }
    }

    const gsCols = (db.pragma("table_info(global_settings)") as { name: string }[]).map((c) => c.name);
    const gsAdditions = [
      { name: "memory_enabled", type: "INTEGER NOT NULL DEFAULT 1" },
      { name: "cross_chat_recall_enabled", type: "INTEGER NOT NULL DEFAULT 1" },
      { name: "cross_chat_include_archived", type: "INTEGER NOT NULL DEFAULT 0" },
      { name: "embedding_model", type: "TEXT" },
      { name: "stt_provider", type: "TEXT NOT NULL DEFAULT 'browser'" },
      { name: "stt_endpoint", type: "TEXT" },
      { name: "stt_model", type: "TEXT" },
      { name: "stt_device", type: "TEXT NOT NULL DEFAULT 'cpu'" },
      { name: "tts_provider", type: "TEXT NOT NULL DEFAULT 'browser'" },
      { name: "tts_endpoint", type: "TEXT" },
      { name: "tts_model", type: "TEXT" },
      { name: "tts_voice", type: "TEXT" },
      { name: "tts_device", type: "TEXT NOT NULL DEFAULT 'cpu'" },
      { name: "speech_idle_timeout_sec", type: "INTEGER NOT NULL DEFAULT 60" },
    ];
    for (const col of gsAdditions) {
      if (!gsCols.includes(col.name)) {
        try {
          db.exec(`ALTER TABLE global_settings ADD COLUMN ${col.name} ${col.type}`);
        } catch { }
      }
    }
  },
};

const migration5: Migration = {
  version: 5,
  description: "Add per-backend enabled flag and managed launch command / working directory",
  run: () => {
    const cols = (db.pragma("table_info(backends)") as { name: string }[]).map((c) => c.name);
    if (!cols.includes("is_enabled")) {
      db.exec(`ALTER TABLE backends ADD COLUMN is_enabled INTEGER NOT NULL DEFAULT 1`);
    }
    if (!cols.includes("launch_command")) {
      db.exec(`ALTER TABLE backends ADD COLUMN launch_command TEXT`);
    }
    if (!cols.includes("launch_cwd")) {
      db.exec(`ALTER TABLE backends ADD COLUMN launch_cwd TEXT`);
    }
  },
};

const migration6: Migration = {
  version: 6,
  description: "Add web browser exposure settings (web_enabled, web_host, web_port) to global_settings",
  run: () => {
    const cols = (db.pragma("table_info(global_settings)") as { name: string }[]).map((c) => c.name);
    if (!cols.includes("web_enabled")) {
      db.exec(`ALTER TABLE global_settings ADD COLUMN web_enabled INTEGER NOT NULL DEFAULT 0`);
    }
    if (!cols.includes("web_host")) {
      db.exec(`ALTER TABLE global_settings ADD COLUMN web_host TEXT NOT NULL DEFAULT '127.0.0.1'`);
    }
    if (!cols.includes("web_port")) {
      db.exec(`ALTER TABLE global_settings ADD COLUMN web_port INTEGER NOT NULL DEFAULT 4300`);
    }
  },
};

const migrations: Migration[] = [migration1, migration2, migration3, migration4, migration5, migration6];

const currentVersion = db.pragma("user_version", { simple: true }) as number;

// Run migrations sequentially within a transaction (with foreign_keys temporarily disabled during table rebuilds)
for (const migration of migrations) {
  if (currentVersion < migration.version) {
    console.log(`[db] Running migration V${migration.version}: ${migration.description}...`);
    db.pragma("foreign_keys = OFF");
    try {
      const tx = db.transaction(() => {
        migration.run();
        db.pragma(`user_version = ${migration.version}`);
      });
      tx();
      console.log(`[db] Migration V${migration.version} complete.`);
    } finally {
      db.pragma("foreign_keys = ON");
    }
  }
}

if (migratedFromRoot) {
  try {
    const oldPrefix = migratedFromRoot.endsWith(path.sep)
      ? migratedFromRoot
      : migratedFromRoot + path.sep;
    const newPrefix = path.resolve(DATA_DIR).endsWith(path.sep)
      ? path.resolve(DATA_DIR)
      : path.resolve(DATA_DIR) + path.sep;

    const rewritePrefix = (p: string | null | undefined): string | null => {
      if (!p) return null;
      if (p === migratedFromRoot) return path.resolve(DATA_DIR);
      if (p.startsWith(oldPrefix)) {
        return newPrefix + p.slice(oldPrefix.length);
      }
      return p;
    };

    const tx = db.transaction(() => {
      const atts = db.prepare("SELECT id, disk_path FROM attachments").all() as Array<{
        id: string;
        disk_path: string;
      }>;
      const updAtt = db.prepare("UPDATE attachments SET disk_path = ? WHERE id = ?");
      for (const a of atts) {
        const next = rewritePrefix(a.disk_path);
        if (next && next !== a.disk_path) updAtt.run(next, a.id);
      }

      const arts = db.prepare("SELECT id, disk_path FROM artifacts").all() as Array<{
        id: string;
        disk_path: string;
      }>;
      const updArt = db.prepare("UPDATE artifacts SET disk_path = ? WHERE id = ?");
      for (const a of arts) {
        const next = rewritePrefix(a.disk_path);
        if (next && next !== a.disk_path) updArt.run(next, a.id);
      }

      const sks = db.prepare("SELECT id, dir_path FROM skills WHERE dir_path IS NOT NULL").all() as Array<{
        id: string;
        dir_path: string;
      }>;
      const updSkill = db.prepare("UPDATE skills SET dir_path = ? WHERE id = ?");
      for (const s of sks) {
        const next = rewritePrefix(s.dir_path);
        if (next && next !== s.dir_path) updSkill.run(next, s.id);
      }
    });
    tx();
    console.log(`[db] Rewrote stored attachment, artifact, and skill paths to ${DATA_DIR}.`);
  } catch (err) {
    console.error("[db] Failed to rewrite migrated file paths:", err);
  }
}

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

export default db;
