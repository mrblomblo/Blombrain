import type { FastifyInstance } from "fastify";
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
  };
}

export async function settingsRoutes(app: FastifyInstance) {
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

    db.prepare(`
      UPDATE global_settings
      SET user_name = ?, user_avatar = ?, theme = ?, auto_name_mode = ?, auto_name_model = ?, tool_routing_mode = ?, tool_routing_model = ?
      WHERE id = 'default'
    `).run(userName, userAvatar, theme, autoNameMode, autoNameModel, toolRoutingMode, toolRoutingModel);

    const updated = db
      .prepare<[string], GlobalSettingsRow>("SELECT * FROM global_settings WHERE id = ?")
      .get("default")!;

    return reply.send(rowToSettings(updated));
  });
}
