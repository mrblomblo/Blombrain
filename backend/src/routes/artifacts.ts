import type { FastifyInstance } from "fastify";
import fs from "node:fs";
import db from "../db.js";
import type { ArtifactRow, ArtifactOut } from "../types.js";

function rowToOut(row: ArtifactRow): ArtifactOut {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    filename: row.filename,
    language: row.language,
    title: row.title,
    sizeBytes: row.size_bytes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function artifactsRoutes(app: FastifyInstance) {
  // GET /api/artifacts?conversationId=...
  app.get<{ Querystring: { conversationId?: string } }>("/api/artifacts", async (req, reply) => {
    const { conversationId } = req.query;
    if (!conversationId) {
      return reply.status(400).send({ error: "conversationId is required" });
    }

    const rows = db.prepare<[string], ArtifactRow>(
      "SELECT * FROM artifacts WHERE conversation_id = ? ORDER BY updated_at DESC"
    ).all(conversationId);

    return reply.send(rows.map(rowToOut));
  });

  // GET /api/artifacts/:id/content
  app.get<{ Params: { id: string } }>("/api/artifacts/:id/content", async (req, reply) => {
    const { id } = req.params;
    const row = db.prepare<[string], Pick<ArtifactRow, "disk_path" | "filename">>(
      "SELECT disk_path, filename FROM artifacts WHERE id = ?"
    ).get(id);

    if (!row) {
      return reply.status(404).send({ error: "Artifact not found" });
    }

    if (!fs.existsSync(row.disk_path)) {
      return reply.status(404).send({ error: "Artifact file missing on disk" });
    }

    try {
      const content = fs.readFileSync(row.disk_path, "utf-8");

      // Explicitly tell the browser and Vite proxy NOT to cache this response.
      reply.header("Content-Type", "text/plain; charset=utf-8");
      reply.header("Content-Disposition", `inline; filename="${encodeURIComponent(row.filename)}"`);
      reply.header("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
      reply.header("Pragma", "no-cache");
      reply.header("Expires", "0");
      reply.header("X-Content-Type-Options", "nosniff");
      reply.header("Content-Security-Policy", "default-src 'none'");

      // Fastify handles Content-Length automatically for strings/buffers
      return reply.send(content);
    } catch (err) {
      app.log.error(err, `Failed to read artifact file ${row.disk_path}`);
      return reply.status(500).send({ error: "Failed to read artifact file" });
    }
  });

  // DELETE /api/artifacts/:id
  app.delete<{ Params: { id: string } }>("/api/artifacts/:id", async (req, reply) => {
    const { id } = req.params;
    const row = db.prepare<[string], Pick<ArtifactRow, "disk_path">>(
      "SELECT disk_path FROM artifacts WHERE id = ?"
    ).get(id);

    if (!row) {
      return reply.status(200).send({ success: true });
    }

    if (fs.existsSync(row.disk_path)) {
      try {
        fs.unlinkSync(row.disk_path);
      } catch (err) {
        app.log.warn(err, `Failed to delete artifact file ${row.disk_path}`);
      }
    }

    db.prepare("DELETE FROM artifacts WHERE id = ?").run(id);

    return reply.status(200).send({ success: true });
  });
}
