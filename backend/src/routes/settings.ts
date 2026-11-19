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
      SET user_name = ?, user_avatar = ?, theme = ?, auto_name_mode = ?, auto_name_model = ?, tool_routing_mode = ?, tool_routing_model = ?, ctx_overflow_behavior = ?, reasoning_injection_mode = ?, network_tools_enabled = ?, artifact_network_enabled = ?, disabled_builtin_tools = ?
      WHERE id = 'default'
    `).run(userName, userAvatar, theme, autoNameMode, autoNameModel, toolRoutingMode, toolRoutingModel, ctxOverflowBehavior, reasoningInjectionMode, networkToolsEnabled, artifactNetworkEnabled, disabledBuiltInTools);

    const updated = db
      .prepare<[string], GlobalSettingsRow>("SELECT * FROM global_settings WHERE id = ?")
      .get("default")!;

    return reply.send(rowToSettings(updated));
  });
}

