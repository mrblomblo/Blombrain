import type { FastifyInstance, FastifyRequest } from "fastify";
import fs from "node:fs";
import bcrypt from "bcrypt";
import crypto from "crypto";
import db from "../db.js";
import type { GlobalSettingsRow, GlobalSettingsOut, GlobalSettingsWriteBody, AttachmentRow } from "../types.js";

function isSecureRequest(req: FastifyRequest): boolean {
  if (req.protocol === "https") return true;
  const proto = req.headers["x-forwarded-proto"];
  if (typeof proto === "string" && proto.split(",")[0].trim().toLowerCase() === "https") {
    return true;
  }
  return false;
}

function rowToSettings(row: GlobalSettingsRow): GlobalSettingsOut {
  let disabledBuiltInTools: string[] = [];
  if (row.disabled_builtin_tools) {
    try {
      const parsed = JSON.parse(row.disabled_builtin_tools);
      if (Array.isArray(parsed)) disabledBuiltInTools = parsed.map(String);
    } catch { }
  }
  return {
    id: row.id,
    userName: row.user_name,
    userAvatar: row.user_avatar,
    theme: row.theme,
    autoNameMode: (row.auto_name_mode as any) || "first_words",
    autoNameModel: row.auto_name_model ?? null,
    toolRoutingMode: (row.tool_routing_mode as any) || "off",
    toolRoutingModel: row.tool_routing_model ?? null,
    ctxOverflowBehavior: (row.ctx_overflow_behavior as any) || "truncate_middle",
    reasoningInjectionMode: (row.reasoning_injection_mode as any) || "all",
    networkToolsEnabled: !!row.network_tools_enabled,
    artifactNetworkEnabled: !!row.artifact_network_enabled,
    disabledBuiltInTools,
    memoryEnabled: row.memory_enabled !== undefined ? !!row.memory_enabled : true,
    crossChatRecallEnabled: row.cross_chat_recall_enabled !== undefined ? !!row.cross_chat_recall_enabled : true,
    crossChatIncludeArchived: !!row.cross_chat_include_archived,
    embeddingModel: row.embedding_model ?? null,
    sttProvider: (row.stt_provider as any) || "browser",
    sttEndpoint: row.stt_endpoint ?? null,
    sttModel: row.stt_model ?? null,
    sttDevice: (row.stt_device as any) || "cpu",
    ttsProvider: (row.tts_provider as any) || "browser",
    ttsEndpoint: row.tts_endpoint ?? null,
    ttsModel: row.tts_model ?? null,
    ttsVoice: row.tts_voice ?? null,
    ttsDevice: (row.tts_device as any) || "cpu",
    speechIdleTimeoutSec: row.speech_idle_timeout_sec ?? 60,
  };
}

export async function settingsRoutes(app: FastifyInstance) {
  // GET /api/instance-info (Public)
  app.get("/api/instance-info", async (_req, reply) => {
    const row = db
      .prepare<[string], { theme: string }>("SELECT theme FROM global_settings WHERE id = ?")
      .get("default");

    return reply.send({
      theme: row?.theme ?? "autumn",
    });
  });

  // GET /api/settings
  app.get("/api/settings", async (_req, reply) => {
    const row = db
      .prepare<[string], GlobalSettingsRow>("SELECT * FROM global_settings WHERE id = ?")
      .get("default");

    if (!row) {
      return reply.code(404).send({ error: { message: "Settings not found" } });
    }

    return reply.send(rowToSettings(row));
  });

  // PATCH /api/settings
  app.patch("/api/settings", async (req, reply) => {
    const body = req.body as GlobalSettingsWriteBody;
    const current = db
      .prepare<[string], GlobalSettingsRow>("SELECT * FROM global_settings WHERE id = ?")
      .get("default");

    if (!current) {
      return reply.code(404).send({ error: { message: "Settings not found" } });
    }

    const userName = body.userName !== undefined ? body.userName : current.user_name;
    const userAvatar = body.userAvatar !== undefined ? body.userAvatar : current.user_avatar;
    const theme = body.theme !== undefined ? body.theme : current.theme;
    const autoNameMode = body.autoNameMode !== undefined ? body.autoNameMode : current.auto_name_mode;
    const autoNameModel = body.autoNameModel !== undefined ? body.autoNameModel : current.auto_name_model;
    const toolRoutingMode = body.toolRoutingMode !== undefined ? body.toolRoutingMode : (current.tool_routing_mode || "off");
    const toolRoutingModel = body.toolRoutingModel !== undefined ? body.toolRoutingModel : current.tool_routing_model;
    const ctxOverflowBehavior = body.ctxOverflowBehavior !== undefined ? body.ctxOverflowBehavior : (current.ctx_overflow_behavior || "truncate_middle");
    const reasoningInjectionMode = body.reasoningInjectionMode !== undefined ? body.reasoningInjectionMode : (current.reasoning_injection_mode || "all");
    const networkToolsEnabled = body.networkToolsEnabled !== undefined ? (body.networkToolsEnabled ? 1 : 0) : (current.network_tools_enabled ?? 0);
    const artifactNetworkEnabled = body.artifactNetworkEnabled !== undefined ? (body.artifactNetworkEnabled ? 1 : 0) : (current.artifact_network_enabled ?? 0);
    const disabledBuiltInTools =
      body.disabledBuiltInTools !== undefined
        ? JSON.stringify(body.disabledBuiltInTools)
        : (current.disabled_builtin_tools ?? "[]");
    const memoryEnabled =
      body.memoryEnabled !== undefined
        ? (body.memoryEnabled ? 1 : 0)
        : (current.memory_enabled ?? 1);
    const crossChatRecallEnabled =
      body.crossChatRecallEnabled !== undefined
        ? (body.crossChatRecallEnabled ? 1 : 0)
        : (current.cross_chat_recall_enabled ?? 1);
    const crossChatIncludeArchived =
      body.crossChatIncludeArchived !== undefined
        ? (body.crossChatIncludeArchived ? 1 : 0)
        : (current.cross_chat_include_archived ?? 0);
    const embeddingModel =
      body.embeddingModel !== undefined ? body.embeddingModel : (current.embedding_model ?? null);
    const sttProvider =
      body.sttProvider !== undefined ? body.sttProvider : (current.stt_provider || "browser");
    const sttEndpoint =
      body.sttEndpoint !== undefined ? body.sttEndpoint : (current.stt_endpoint ?? null);
    const sttModel =
      body.sttModel !== undefined ? body.sttModel : (current.stt_model ?? null);
    const sttDevice =
      body.sttDevice !== undefined ? body.sttDevice : (current.stt_device || "cpu");
    const ttsProvider =
      body.ttsProvider !== undefined ? body.ttsProvider : (current.tts_provider || "browser");
    const ttsEndpoint =
      body.ttsEndpoint !== undefined ? body.ttsEndpoint : (current.tts_endpoint ?? null);
    const ttsModel =
      body.ttsModel !== undefined ? body.ttsModel : (current.tts_model ?? null);
    const ttsVoice =
      body.ttsVoice !== undefined ? body.ttsVoice : (current.tts_voice ?? null);
    const ttsDevice =
      body.ttsDevice !== undefined ? body.ttsDevice : (current.tts_device || "cpu");
    const speechIdleTimeoutSec =
      body.speechIdleTimeoutSec !== undefined
        ? Math.max(5, Math.min(3600, Number(body.speechIdleTimeoutSec) || 60))
        : (current.speech_idle_timeout_sec ?? 60);

    // Mark new avatar attachment as purpose = 'avatar', and clean up old avatar if replaced
    if (body.userAvatar !== undefined && body.userAvatar !== current.user_avatar) {
      if (body.userAvatar && body.userAvatar.startsWith("/api/uploads/")) {
        const newAvatarId = decodeURIComponent(body.userAvatar.replace("/api/uploads/", ""));
        db.prepare("UPDATE attachments SET purpose = 'avatar' WHERE id = ?").run(newAvatarId);
      }
      if (current.user_avatar && current.user_avatar.startsWith("/api/uploads/")) {
        const oldAvatarId = decodeURIComponent(current.user_avatar.replace("/api/uploads/", ""));
        const stillUsedByModel = db.prepare("SELECT 1 FROM model_settings WHERE icon = ?").get(current.user_avatar);
        if (!stillUsedByModel) {
          const oldRow = db.prepare("SELECT * FROM attachments WHERE id = ? AND message_id IS NULL").get(oldAvatarId) as AttachmentRow | undefined;
          if (oldRow) {
            try {
              if (fs.existsSync(oldRow.disk_path)) fs.unlinkSync(oldRow.disk_path);
            } catch { }
            db.prepare("DELETE FROM attachments WHERE id = ?").run(oldAvatarId);
          }
        }
      }
    }

    if (body.password !== undefined) {
      if (body.password.trim() === "") {
        db.prepare("UPDATE global_settings SET password_hash = NULL WHERE id = 'default'").run();
        db.prepare("DELETE FROM auth_sessions").run();
        reply.clearCookie("blombrain_token", { path: "/" });
      } else {
        const hash = await bcrypt.hash(body.password, 10);
        db.prepare("UPDATE global_settings SET password_hash = ? WHERE id = 'default'").run(hash);
        db.prepare("DELETE FROM auth_sessions").run();

        // Auto-authenticate current session with the new password
        const token = crypto.randomBytes(32).toString("hex");
        db.prepare("INSERT INTO auth_sessions (token, created_at) VALUES (?, ?)").run(
          token,
          Date.now()
        );

        reply.setCookie("blombrain_token", token, {
          path: "/",
          httpOnly: true,
          secure: isSecureRequest(req),
          sameSite: "lax",
          maxAge: 60 * 60 * 24 * 7,
        });
      }
    }

    db.prepare(`
      UPDATE global_settings
      SET user_name = ?, user_avatar = ?, theme = ?, auto_name_mode = ?, auto_name_model = ?, tool_routing_mode = ?, tool_routing_model = ?, ctx_overflow_behavior = ?, reasoning_injection_mode = ?, network_tools_enabled = ?, artifact_network_enabled = ?, disabled_builtin_tools = ?, memory_enabled = ?, cross_chat_recall_enabled = ?, cross_chat_include_archived = ?, embedding_model = ?, stt_provider = ?, stt_endpoint = ?, stt_model = ?, stt_device = ?, tts_provider = ?, tts_endpoint = ?, tts_model = ?, tts_voice = ?, tts_device = ?, speech_idle_timeout_sec = ?
      WHERE id = 'default'
    `).run(
      userName,
      userAvatar,
      theme,
      autoNameMode,
      autoNameModel,
      toolRoutingMode,
      toolRoutingModel,
      ctxOverflowBehavior,
      reasoningInjectionMode,
      networkToolsEnabled,
      artifactNetworkEnabled,
      disabledBuiltInTools,
      memoryEnabled,
      crossChatRecallEnabled,
      crossChatIncludeArchived,
      embeddingModel,
      sttProvider,
      sttEndpoint,
      sttModel,
      sttDevice,
      ttsProvider,
      ttsEndpoint,
      ttsModel,
      ttsVoice,
      ttsDevice,
      speechIdleTimeoutSec
    );

    const updated = db
      .prepare<[string], GlobalSettingsRow>("SELECT * FROM global_settings WHERE id = ?")
      .get("default")!;

    return reply.send(rowToSettings(updated));
  });
}

