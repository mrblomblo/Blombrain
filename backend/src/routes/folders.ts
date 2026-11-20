import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import crypto from "node:crypto";
import db from "../db.js";
import type { FolderOut, FolderRow } from "../types.js";

function rowToFolder(row: FolderRow): FolderOut {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? "",
    isExpanded: Boolean(row.is_expanded),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function foldersRoutes(app: FastifyInstance) {
  /** GET /api/folders -- list all folders ordered alphabetically. */
  app.get("/api/folders", async () => {
    const rows = db
      .prepare<[], FolderRow>("SELECT * FROM folders ORDER BY LOWER(name) ASC, created_at ASC")
      .all();
    return rows.map(rowToFolder);
  });

  /** POST /api/folders -- create a new folder. */
  app.post("/api/folders", async (req: FastifyRequest, reply: FastifyReply) => {
    const body = (req.body ?? {}) as { name?: string; description?: string };
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) {
      return reply.code(400).send({ error: { message: "Folder name is required." } });
    }
    const description = typeof body.description === "string" ? body.description.trim() : "";
    const now = Date.now();
    const id = crypto.randomUUID();
    db.prepare(
      `INSERT INTO folders (id, name, description, is_expanded, created_at, updated_at)
       VALUES (?, ?, ?, 1, ?, ?)`
    ).run(id, name, description, now, now);

    const row = db.prepare<[string], FolderRow>("SELECT * FROM folders WHERE id = ?").get(id)!;
    return reply.code(201).send(rowToFolder(row));
  });

  /** PATCH /api/folders/:id -- update folder name, description, or expanded state. */
  app.patch("/api/folders/:id", async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };
    const existing = db.prepare<[string], FolderRow>("SELECT * FROM folders WHERE id = ?").get(id);
    if (!existing) {
      return reply.code(404).send({ error: { message: `Folder "${id}" not found.` } });
    }

    const body = (req.body ?? {}) as {
      name?: string;
      description?: string;
      isExpanded?: boolean;
    };

    const nextName =
      body.name !== undefined ? body.name.trim() : existing.name;
    if (!nextName) {
      return reply.code(400).send({ error: { message: "Folder name cannot be empty." } });
    }
    const nextDescription =
      body.description !== undefined ? body.description.trim() : existing.description;
    const nextExpanded =
      body.isExpanded !== undefined ? (body.isExpanded ? 1 : 0) : existing.is_expanded;
    const now = Date.now();

    db.prepare(
      `UPDATE folders SET name = ?, description = ?, is_expanded = ?, updated_at = ? WHERE id = ?`
    ).run(nextName, nextDescription, nextExpanded, now, id);

    if (nextName !== existing.name) {
      db.prepare("UPDATE conversations SET folder = ? WHERE folder_id = ?").run(nextName, id);
    }

    const updated = db.prepare<[string], FolderRow>("SELECT * FROM folders WHERE id = ?").get(id)!;
    return rowToFolder(updated);
  });

  /** DELETE /api/folders/:id -- delete folder and unfile its conversations. */
  app.delete("/api/folders/:id", async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };
    const existing = db.prepare<[string], FolderRow>("SELECT * FROM folders WHERE id = ?").get(id);
    if (!existing) {
      return reply.code(404).send({ error: { message: `Folder "${id}" not found.` } });
    }

    db.prepare("UPDATE conversations SET folder_id = NULL, folder = NULL WHERE folder_id = ?").run(id);
    db.prepare("DELETE FROM folders WHERE id = ?").run(id);

    return reply.code(204).send();
  });
}
