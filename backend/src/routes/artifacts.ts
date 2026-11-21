import type { FastifyInstance } from "fastify";
import fs from "node:fs";
import path from "node:path";
import db, { DATA_DIR } from "../db.js";
import type { ArtifactRow, ArtifactOut } from "../types.js";
import {
  recordWorkspaceCheckpoint,
  resolveEffectiveWorkspace,
  resolveWorkspacePath,
} from "../services/builtinTools/tools/workspaceUtils.js";

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

  // PUT /api/artifacts/:id/content -- direct user edit & save from ArtifactPanel
  app.put<{ Params: { id: string }; Body: { content?: string } }>(
    "/api/artifacts/:id/content",
    async (req, reply) => {
      const { id } = req.params;
      const content = req.body?.content;
      if (typeof content !== "string") {
        return reply.status(400).send({ error: "Body must include string `content`" });
      }

      const row = db
        .prepare<[string], ArtifactRow>("SELECT * FROM artifacts WHERE id = ?")
        .get(id);
      if (!row) {
        return reply.status(404).send({ error: "Artifact not found" });
      }

      const uploadsRoot = path.resolve(DATA_DIR, "uploads") + path.sep;
      const resolvedDiskPath = path.resolve(row.disk_path);
      const isUploadedArtifact = resolvedDiskPath.startsWith(uploadsRoot);

      try {
        let previousContent: string | null = null;
        if (fs.existsSync(resolvedDiskPath)) {
          previousContent = fs.readFileSync(resolvedDiskPath, "utf-8");
        }

        if (!isUploadedArtifact) {
          const eff = resolveEffectiveWorkspace(row.conversation_id);
          if (!eff.path) {
            return reply.status(403).send({ error: "No workspace is attached to this conversation." });
          }
          if (!eff.writeEnabled) {
            return reply.status(403).send({
              error: "Workspace is in Read-Only mode. Switch to Ask First or Read-Write to save edits.",
            });
          }
          // Re-validate path stays inside the active workspace root
          const target = resolveWorkspacePath(eff.path, row.filename, { allowMissingLeaf: true });
          fs.mkdirSync(path.dirname(target.absPath), { recursive: true });
          fs.writeFileSync(target.absPath, content, "utf-8");

          recordWorkspaceCheckpoint({
            conversationId: row.conversation_id,
            toolName: "manual_edit",
            workspaceRoot: target.realRoot,
            relPath: target.relPath,
            action: previousContent === null ? "create" : "edit",
            previousContent,
            newContent: content,
          });
        } else {
          fs.mkdirSync(path.dirname(resolvedDiskPath), { recursive: true });
          fs.writeFileSync(resolvedDiskPath, content, "utf-8");
        }

        const sizeBytes = Buffer.byteLength(content, "utf-8");
        const now = Date.now();
        db.prepare("UPDATE artifacts SET size_bytes = ?, updated_at = ? WHERE id = ?").run(
          sizeBytes,
          now,
          id
        );

        const updated = db
          .prepare<[string], ArtifactRow>("SELECT * FROM artifacts WHERE id = ?")
          .get(id)!;
        return reply.send(rowToOut(updated));
      } catch (err: any) {
        app.log.error(err, `Failed to update artifact file ${row.disk_path}`);
        return reply.status(500).send({ error: err?.message || "Failed to save artifact content" });
      }
    }
  );

  // DELETE /api/artifacts/:id
  app.delete<{ Params: { id: string } }>("/api/artifacts/:id", async (req, reply) => {
    const { id } = req.params;
    const row = db.prepare<[string], Pick<ArtifactRow, "disk_path">>(
      "SELECT disk_path FROM artifacts WHERE id = ?"
    ).get(id);

    if (!row) {
      return reply.status(200).send({ success: true });
    }

    const uploadsRoot = path.resolve(DATA_DIR, "uploads") + path.sep;
    const resolvedDiskPath = path.resolve(row.disk_path);
    if (resolvedDiskPath.startsWith(uploadsRoot) && fs.existsSync(resolvedDiskPath)) {
      try {
        fs.unlinkSync(resolvedDiskPath);
      } catch (err) {
        app.log.warn(err, `Failed to delete artifact file ${row.disk_path}`);
      }
    }

    db.prepare("DELETE FROM artifacts WHERE id = ?").run(id);

    return reply.status(200).send({ success: true });
  });
}
