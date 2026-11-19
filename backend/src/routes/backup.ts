import type { FastifyInstance } from "fastify";
import fs from "node:fs";
import path from "node:path";
import db, { DATA_DIR } from "../db.js";
import { syncModels } from "../services/modelSync.js";

const SECRET_KEY_REGEX = /(key|token|secret|password|auth|credential|bearer|cookie|jwt|private)/i;
const MASKED_VALUE = "••••••••";

function maskObjectSecrets(obj: Record<string, string>): Record<string, string> {
  const masked: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v && (SECRET_KEY_REGEX.test(k) || /^(Bearer|Basic|Token)\s+/i.test(v))) {
      masked[k] = MASKED_VALUE;
    } else {
      masked[k] = v;
    }
  }
  return masked;
}

function collectDirectoryFiles(rootDir: string, baseRel = ""): Array<{ relativePath: string; base64: string }> {
  const results: Array<{ relativePath: string; base64: string }> = [];
  if (!fs.existsSync(rootDir)) return results;

  const entries = fs.readdirSync(rootDir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name === ".git") continue;
    const absPath = path.join(rootDir, entry.name);
    const relPath = baseRel ? `${baseRel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      results.push(...collectDirectoryFiles(absPath, relPath));
    } else if (entry.isFile()) {
      try {
        const stat = fs.statSync(absPath);
        if (stat.size <= 5 * 1024 * 1024) {
          const buf = fs.readFileSync(absPath);
          results.push({ relativePath: relPath, base64: buf.toString("base64") });
        }
      } catch { }
    }
  }
  return results;
}

export async function backupRoutes(app: FastifyInstance) {
  // GET /api/backup/export?includeSecrets=0&includeFiles=1
  app.get<{ Querystring: { includeSecrets?: string; includeFiles?: string } }>(
    "/api/backup/export",
    async (req, reply) => {
      const includeSecrets =
        req.query.includeSecrets === "1" || req.query.includeSecrets === "true";
      const includeFiles =
        req.query.includeFiles !== "0" && req.query.includeFiles !== "false";

      const globalSettingsRow = db
        .prepare("SELECT * FROM global_settings WHERE id = 'default'")
        .get() as Record<string, any> | undefined;
      const globalSettings = globalSettingsRow ? { ...globalSettingsRow } : null;
      if (globalSettings) {
        delete globalSettings.password_hash;
      }

      const backends = (db.prepare("SELECT * FROM backends").all() as any[]).map((b) => ({
        ...b,
        api_key: includeSecrets ? b.api_key : null,
      }));

      const modelSettings = db.prepare("SELECT * FROM model_settings").all() as any[];

      const mcpServers = (db.prepare("SELECT * FROM mcp_servers").all() as any[]).map((s) => {
        if (includeSecrets) return s;
        let env = {};
        let headers = {};
        try { env = maskObjectSecrets(JSON.parse(s.env || "{}")); } catch { }
        try { headers = maskObjectSecrets(JSON.parse(s.headers || "{}")); } catch { }
        return {
          ...s,
          env: JSON.stringify(env),
          headers: JSON.stringify(headers),
        };
      });

      const skills = (db.prepare("SELECT * FROM skills").all() as any[]).map((sk) => {
        let embeddedFiles: Array<{ relativePath: string; base64: string }> | undefined;
        const managedSkillDir = path.join(DATA_DIR, "skills", sk.id);
        if (includeFiles && fs.existsSync(managedSkillDir)) {
          embeddedFiles = collectDirectoryFiles(managedSkillDir);
        }
        return {
          ...sk,
          embeddedFiles,
        };
      });

      const memories = (db.prepare("SELECT * FROM memories").all() as any[]).map((m) => ({
        ...m,
        embedding:
          m.embedding && Buffer.isBuffer(m.embedding)
            ? m.embedding.toString("base64")
            : null,
      }));

      const conversations = db.prepare("SELECT * FROM conversations").all() as any[];
      const messages = db.prepare("SELECT * FROM messages").all() as any[];
      const scratchpad = db.prepare("SELECT * FROM conversation_scratchpad").all() as any[];

      const artifacts = (db.prepare("SELECT * FROM artifacts").all() as any[]).map((art) => {
        let content: string | null = null;
        if (includeFiles && art.disk_path && fs.existsSync(art.disk_path)) {
          try {
            content = fs.readFileSync(art.disk_path, "utf-8");
          } catch { }
        }
        return {
          ...art,
          content,
        };
      });

      const attachments = (db.prepare("SELECT * FROM attachments").all() as any[]).map((att) => {
        let base64: string | null = null;
        const maxEmbedBytes = att.purpose === "icon" || att.purpose === "avatar" ? 5 * 1024 * 1024 : 2 * 1024 * 1024;
        if (
          includeFiles &&
          att.disk_path &&
          fs.existsSync(att.disk_path) &&
          att.size_bytes <= maxEmbedBytes
        ) {
          try {
            base64 = fs.readFileSync(att.disk_path).toString("base64");
          } catch { }
        }
        return {
          ...att,
          base64,
        };
      });

      const bundle = {
        format: "blombrain-backup",
        version: 1,
        exportedAt: Date.now(),
        includeSecrets,
        includeFiles,
        data: {
          globalSettings,
          backends,
          modelSettings,
          mcpServers,
          skills,
          memories,
          conversations,
          messages,
          scratchpad,
          artifacts,
          attachments,
        },
      };

      const dateStr = new Date().toISOString().slice(0, 10);
      reply.header("Content-Type", "application/json; charset=utf-8");
      reply.header(
        "Content-Disposition",
        `attachment; filename="blombrain-backup-${dateStr}.json"`
      );
      return reply.send(JSON.stringify(bundle, null, 2));
    }
  );

  // POST /api/backup/import
  app.post<{ Body: { bundle: any; mode?: "merge" | "replace" } }>(
    "/api/backup/import",
    async (req, reply) => {
      const { bundle, mode = "merge" } = req.body || {};
      if (
        !bundle ||
        bundle.format !== "blombrain-backup" ||
        typeof bundle.data !== "object" ||
        !bundle.data
      ) {
        return reply.status(400).send({
          error: "Invalid backup file format. Expected a valid Blombrain backup bundle.",
        });
      }

      const d = bundle.data;
      const counts = {
        backends: 0,
        modelSettings: 0,
        mcpServers: 0,
        skills: 0,
        memories: 0,
        conversations: 0,
        messages: 0,
        artifacts: 0,
      };

      db.pragma("foreign_keys = OFF");
      try {
        const tx = db.transaction(() => {
          if (mode === "replace") {
            db.exec(`
              DELETE FROM conversation_scratchpad;
              DELETE FROM artifacts;
              DELETE FROM attachments;
              DELETE FROM messages;
              DELETE FROM conversations;
              DELETE FROM memories;
              DELETE FROM skills;
              DELETE FROM mcp_servers;
              DELETE FROM model_settings;
              DELETE FROM cached_models;
              DELETE FROM backends;
            `);
          }

          // 1. Global Settings
          if (d.globalSettings && typeof d.globalSettings === "object") {
            const gs = d.globalSettings;
            const currentGs = db
              .prepare("SELECT * FROM global_settings WHERE id = 'default'")
              .get() as any;
            if (currentGs) {
              db.prepare(
                `UPDATE global_settings SET
                  user_name = COALESCE(?, user_name),
                  user_avatar = COALESCE(?, user_avatar),
                  theme = COALESCE(?, theme),
                  auto_name_mode = COALESCE(?, auto_name_mode),
                  auto_name_model = ?,
                  tool_routing_mode = COALESCE(?, tool_routing_mode),
                  tool_routing_model = ?,
                  ctx_overflow_behavior = COALESCE(?, ctx_overflow_behavior),
                  reasoning_injection_mode = COALESCE(?, reasoning_injection_mode),
                  network_tools_enabled = COALESCE(?, network_tools_enabled),
                  artifact_network_enabled = COALESCE(?, artifact_network_enabled),
                  disabled_builtin_tools = COALESCE(?, disabled_builtin_tools),
                  memory_enabled = COALESCE(?, memory_enabled),
                  cross_chat_recall_enabled = COALESCE(?, cross_chat_recall_enabled),
                  cross_chat_include_archived = COALESCE(?, cross_chat_include_archived),
                  embedding_model = ?,
                  stt_provider = COALESCE(?, stt_provider),
                  stt_endpoint = ?,
                  stt_model = ?,
                  stt_device = COALESCE(?, stt_device),
                  tts_provider = COALESCE(?, tts_provider),
                  tts_endpoint = ?,
                  tts_model = ?,
                  tts_voice = ?,
                  tts_device = COALESCE(?, tts_device),
                  speech_idle_timeout_sec = COALESCE(?, speech_idle_timeout_sec)
                WHERE id = 'default'`
              ).run(
                gs.user_name ?? null,
                gs.user_avatar ?? null,
                gs.theme ?? null,
                gs.auto_name_mode ?? null,
                gs.auto_name_model ?? null,
                gs.tool_routing_mode ?? null,
                gs.tool_routing_model ?? null,
                gs.ctx_overflow_behavior ?? null,
                gs.reasoning_injection_mode ?? null,
                gs.network_tools_enabled ?? null,
                gs.artifact_network_enabled ?? null,
                gs.disabled_builtin_tools ?? null,
                gs.memory_enabled ?? null,
                gs.cross_chat_recall_enabled ?? null,
                gs.cross_chat_include_archived ?? null,
                gs.embedding_model ?? null,
                gs.stt_provider ?? null,
                gs.stt_endpoint ?? null,
                gs.stt_model ?? null,
                gs.stt_device ?? null,
                gs.tts_provider ?? null,
                gs.tts_endpoint ?? null,
                gs.tts_model ?? null,
                gs.tts_voice ?? null,
                gs.tts_device ?? null,
                gs.speech_idle_timeout_sec ?? null
              );
            }
          }

          // 2. Backends
          if (Array.isArray(d.backends)) {
            const stmt = db.prepare(
              `INSERT INTO backends (id, name, base_url, prefix, api_key, api_type)
               VALUES (?, ?, ?, ?, ?, ?)
               ON CONFLICT(id) DO UPDATE SET
                 name = excluded.name,
                 base_url = excluded.base_url,
                 prefix = excluded.prefix,
                 api_key = COALESCE(excluded.api_key, backends.api_key),
                 api_type = excluded.api_type`
            );
            for (const b of d.backends) {
              if (!b.id || !b.name || !b.base_url || !b.prefix) continue;
              try {
                stmt.run(
                  b.id,
                  b.name,
                  b.base_url,
                  b.prefix,
                  b.api_key ?? null,
                  b.api_type || "openai"
                );
                counts.backends++;
              } catch { }
            }
          }

          // 3. Model Settings & Presets
          if (Array.isArray(d.modelSettings)) {
            const stmt = db.prepare(
              `INSERT OR REPLACE INTO model_settings (
                 id, is_preset, name, base_model_id, system_prompt,
                 can_image, can_audio, can_video, temperature, icon,
                 seed, reasoning_effort, max_tokens, top_k, top_p, min_p,
                 presence_penalty, frequency_penalty, repeat_penalty,
                 ctx_length, ctx_overflow_behavior, reasoning_injection_mode,
                 is_hidden, sort_order, is_default
               ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
            );
            for (const m of d.modelSettings) {
              if (!m.id) continue;
              stmt.run(
                m.id,
                m.is_preset ? 1 : 0,
                m.name ?? null,
                m.base_model_id ?? null,
                m.system_prompt ?? null,
                m.can_image ? 1 : 0,
                m.can_audio ? 1 : 0,
                m.can_video ? 1 : 0,
                m.temperature ?? null,
                m.icon ?? null,
                m.seed ?? null,
                m.reasoning_effort ?? null,
                m.max_tokens ?? null,
                m.top_k ?? null,
                m.top_p ?? null,
                m.min_p ?? null,
                m.presence_penalty ?? null,
                m.frequency_penalty ?? null,
                m.repeat_penalty ?? null,
                m.ctx_length ?? null,
                m.ctx_overflow_behavior ?? null,
                m.reasoning_injection_mode ?? null,
                m.is_hidden ? 1 : 0,
                m.sort_order ?? 0,
                m.is_default ? 1 : 0
              );
              counts.modelSettings++;
            }
          }

          // 4. MCP Servers
          if (Array.isArray(d.mcpServers)) {
            const stmt = db.prepare(
              `INSERT INTO mcp_servers (id, name, type, command_or_url, args, env, headers, is_enabled, summary, keywords)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(id) DO UPDATE SET
                 name = excluded.name,
                 type = excluded.type,
                 command_or_url = excluded.command_or_url,
                 args = excluded.args,
                 is_enabled = excluded.is_enabled,
                 summary = COALESCE(excluded.summary, mcp_servers.summary),
                 keywords = COALESCE(excluded.keywords, mcp_servers.keywords)`
            );
            for (const s of d.mcpServers) {
              if (!s.id || !s.name || !s.command_or_url) continue;
              try {
                stmt.run(
                  s.id,
                  s.name,
                  s.type || "stdio",
                  s.command_or_url,
                  s.args || "[]",
                  s.env || "{}",
                  s.headers || "{}",
                  s.is_enabled !== undefined ? (s.is_enabled ? 1 : 0) : 1,
                  s.summary ?? null,
                  s.keywords ?? null
                );
                counts.mcpServers++;
              } catch { }
            }
          }

          // 5. Skills
          if (Array.isArray(d.skills)) {
            const stmt = db.prepare(
              `INSERT OR REPLACE INTO skills (id, name, description, instructions, dir_path, source_url, content_hash, is_enabled, created_at, summary, keywords)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
            );
            for (const sk of d.skills) {
              if (!sk.id || !sk.name) continue;
              let targetDirPath = sk.dir_path ?? null;
              if (Array.isArray(sk.embeddedFiles) && sk.embeddedFiles.length > 0) {
                const managedDir = path.join(DATA_DIR, "skills", sk.id);
                fs.mkdirSync(managedDir, { recursive: true });
                for (const ef of sk.embeddedFiles) {
                  if (!ef.relativePath || !ef.base64) continue;
                  const safeRel = path
                    .normalize(ef.relativePath)
                    .replace(/^(\.\.(\/|\\|$))+/, "");
                  const destPath = path.resolve(managedDir, safeRel);
                  if (!destPath.startsWith(path.resolve(managedDir))) continue;
                  fs.mkdirSync(path.dirname(destPath), { recursive: true });
                  fs.writeFileSync(destPath, Buffer.from(ef.base64, "base64"));
                }
                targetDirPath = managedDir;
              }
              stmt.run(
                sk.id,
                sk.name,
                sk.description || "",
                sk.instructions || "",
                targetDirPath,
                sk.source_url ?? null,
                sk.content_hash || "",
                sk.is_enabled !== undefined ? (sk.is_enabled ? 1 : 0) : 1,
                sk.created_at || Date.now(),
                sk.summary ?? null,
                sk.keywords ?? null
              );
              counts.skills++;
            }
          }

          // 6. Memories
          if (Array.isArray(d.memories)) {
            const stmt = db.prepare(
              `INSERT OR REPLACE INTO memories (id, content, category, tags, source_conversation_id, embedding, is_enabled, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
            );
            for (const mem of d.memories) {
              if (!mem.id || !mem.content) continue;
              const embBuf =
                typeof mem.embedding === "string" && mem.embedding
                  ? Buffer.from(mem.embedding, "base64")
                  : null;
              stmt.run(
                mem.id,
                mem.content,
                mem.category || "general",
                mem.tags || "[]",
                mem.source_conversation_id ?? null,
                embBuf,
                mem.is_enabled !== undefined ? (mem.is_enabled ? 1 : 0) : 1,
                mem.created_at || Date.now(),
                mem.updated_at || Date.now()
              );
              counts.memories++;
            }
          }

          // 7. Conversations
          if (Array.isArray(d.conversations)) {
            const stmt = db.prepare(
              `INSERT OR REPLACE INTO conversations (
                 id, title, model, created_at, updated_at,
                 excluded_mcps, excluded_skills, tools_enabled,
                 is_pinned, is_archived, memory_enabled,
                 system_prompt_override, sampling_overrides
               ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
            );
            for (const c of d.conversations) {
              if (!c.id) continue;
              stmt.run(
                c.id,
                c.title || "New conversation",
                c.model ?? null,
                c.created_at || Date.now(),
                c.updated_at || Date.now(),
                c.excluded_mcps || "[]",
                c.excluded_skills || "[]",
                c.tools_enabled !== undefined ? (c.tools_enabled ? 1 : 0) : 1,
                c.is_pinned ? 1 : 0,
                c.is_archived ? 1 : 0,
                c.memory_enabled === null || c.memory_enabled === undefined
                  ? null
                  : c.memory_enabled
                    ? 1
                    : 0,
                c.system_prompt_override ?? null,
                c.sampling_overrides ?? null
              );
              counts.conversations++;
            }
          }

          // 8. Messages
          if (Array.isArray(d.messages)) {
            const stmt = db.prepare(
              `INSERT OR REPLACE INTO messages (
                 id, conversation_id, parent_id, role, content, error, stats, model, tool_calls, tool_call_id, created_at
               ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
            );
            for (const msg of d.messages) {
              if (!msg.id || !msg.conversation_id) continue;
              stmt.run(
                msg.id,
                msg.conversation_id,
                msg.parent_id ?? null,
                msg.role || "user",
                msg.content ?? "",
                msg.error ?? null,
                msg.stats ?? null,
                msg.model ?? null,
                msg.tool_calls ?? null,
                msg.tool_call_id ?? null,
                msg.created_at || Date.now()
              );
              counts.messages++;
            }
          }

          // 9. Scratchpad
          if (Array.isArray(d.scratchpad)) {
            const stmt = db.prepare(
              `INSERT OR REPLACE INTO conversation_scratchpad (conversation_id, key, content, updated_at)
               VALUES (?, ?, ?, ?)`
            );
            for (const sp of d.scratchpad) {
              if (!sp.conversation_id || !sp.key) continue;
              stmt.run(
                sp.conversation_id,
                sp.key,
                sp.content ?? "",
                sp.updated_at || Date.now()
              );
            }
          }

          // 10. Artifacts
          if (Array.isArray(d.artifacts)) {
            const stmt = db.prepare(
              `INSERT OR REPLACE INTO artifacts (
                 id, conversation_id, filename, language, title, disk_path, size_bytes, created_at, updated_at
               ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
            );
            for (const art of d.artifacts) {
              if (!art.id || !art.conversation_id || !art.filename) continue;
              const safeFilename = path.basename(art.filename);
              const artDir = path.join(DATA_DIR, "uploads", art.conversation_id, "artifacts");
              const diskPath = path.join(artDir, safeFilename);
              if (typeof art.content === "string") {
                fs.mkdirSync(artDir, { recursive: true });
                fs.writeFileSync(diskPath, art.content, "utf-8");
              }
              stmt.run(
                art.id,
                art.conversation_id,
                safeFilename,
                art.language || "html",
                art.title || safeFilename,
                diskPath,
                art.size_bytes ?? (typeof art.content === "string" ? Buffer.byteLength(art.content) : 0),
                art.created_at || Date.now(),
                art.updated_at || Date.now()
              );
              counts.artifacts++;
            }
          }

          // 11. Attachments (icons, avatars, and embedded attachments)
          if (Array.isArray(d.attachments)) {
            const stmt = db.prepare(
              `INSERT OR REPLACE INTO attachments (
                 id, conversation_id, message_id, original_name, mime_type, disk_path, size_bytes, created_at, purpose
               ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
            );
            for (const att of d.attachments) {
              if (!att.id || !att.original_name) continue;
              const subFolder = att.conversation_id || "staging";
              const targetDir = path.join(DATA_DIR, "uploads", subFolder);
              const ext = path.extname(att.original_name);
              const diskPath = path.join(targetDir, `${att.id}${ext}`);
              if (typeof att.base64 === "string" && att.base64) {
                fs.mkdirSync(targetDir, { recursive: true });
                fs.writeFileSync(diskPath, Buffer.from(att.base64, "base64"));
              }
              if (fs.existsSync(diskPath)) {
                stmt.run(
                  att.id,
                  att.conversation_id ?? null,
                  att.message_id ?? null,
                  att.original_name,
                  att.mime_type || "application/octet-stream",
                  diskPath,
                  att.size_bytes || 0,
                  att.created_at || Date.now(),
                  att.purpose || "attachment"
                );
              }
            }
          }
        });

        tx();
        syncModels().catch(() => {});
      } finally {
        db.pragma("foreign_keys = ON");
      }

      return reply.send({
        success: true,
        counts,
      });
    }
  );
}
