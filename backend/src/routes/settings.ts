import type { FastifyInstance } from "fastify";
import bcrypt from "bcrypt";
import crypto from "crypto";
import db from "../db.js";
import type { GlobalSettingsRow, GlobalSettingsOut, GlobalSettingsWriteBody } from "../types.js";

function rowToSettings(row: GlobalSettingsRow): GlobalSettingsOut {
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
          secure: req.protocol === "https",
          sameSite: "lax",
          maxAge: 60 * 60 * 24 * 7,
        });
      }
    }

    db.prepare(`
      UPDATE global_settings
      SET user_name = ?, user_avatar = ?, theme = ?, auto_name_mode = ?, auto_name_model = ?, tool_routing_mode = ?, tool_routing_model = ?, ctx_overflow_behavior = ?, reasoning_injection_mode = ?
      WHERE id = 'default'
    `).run(userName, userAvatar, theme, autoNameMode, autoNameModel, toolRoutingMode, toolRoutingModel, ctxOverflowBehavior, reasoningInjectionMode);

    const updated = db
      .prepare<[string], GlobalSettingsRow>("SELECT * FROM global_settings WHERE id = ?")
      .get("default")!;

    return reply.send(rowToSettings(updated));
  });
}

