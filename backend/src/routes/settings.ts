import type { FastifyInstance } from "fastify";
import db from "../db.js";
import type { GlobalSettingsRow, GlobalSettingsOut, GlobalSettingsWriteBody } from "../types.js";

function rowToSettings(row: GlobalSettingsRow): GlobalSettingsOut {
  return {
    id: row.id,
    userName: row.user_name,
    userAvatar: row.user_avatar,
    theme: row.theme,
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

    db.prepare(`
      UPDATE global_settings
      SET user_name = ?, user_avatar = ?, theme = ?
      WHERE id = 'default'
    `).run(userName, userAvatar, theme);

    const updated = db
      .prepare<[string], GlobalSettingsRow>("SELECT * FROM global_settings WHERE id = ?")
      .get("default")!;

    return reply.send(rowToSettings(updated));
  });
}
