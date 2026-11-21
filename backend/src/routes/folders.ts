import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import crypto from "node:crypto";
import db from "../db.js";
import type { FolderOut, FolderRow, WorkspaceApprovalMode } from "../types.js";
import {
  normalizeApprovalMode,
  validateWorkspaceDirectory,
} from "../services/builtinTools/tools/workspaceUtils.js";

function rowToFolder(row: FolderRow): FolderOut {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? "",
    isExpanded: Boolean(row.is_expanded),
    workspacePath: row.workspace_path ?? null,
    workspaceWriteEnabled: Boolean(row.workspace_write_enabled),
    workspaceApprovalMode: normalizeApprovalMode(row.workspace_approval_mode),
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
    const body = (req.body ?? {}) as {
      name?: string;
      description?: string;
      workspacePath?: string | null;
      workspaceWriteEnabled?: boolean;
      workspaceApprovalMode?: WorkspaceApprovalMode;
    };
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) {
      return reply.code(400).send({ error: { message: "Folder name is required." } });
    }
    const description = typeof body.description === "string" ? body.description.trim() : "";

    let workspacePath: string | null = null;
    let workspaceWriteEnabled = 0;
    let workspaceApprovalMode: WorkspaceApprovalMode = "auto";
    if (typeof body.workspacePath === "string" && body.workspacePath.trim()) {
      const check = validateWorkspaceDirectory(body.workspacePath);
      if (!check.ok) {
        return reply.code(400).send({ error: { message: check.error } });
      }
      workspacePath = check.realPath;
      workspaceWriteEnabled = body.workspaceWriteEnabled ? 1 : 0;
      workspaceApprovalMode = normalizeApprovalMode(body.workspaceApprovalMode);
    }

    const now = Date.now();
    const id = crypto.randomUUID();
    db.prepare(
      `INSERT INTO folders (id, name, description, is_expanded, workspace_path, workspace_write_enabled, workspace_approval_mode, created_at, updated_at)
       VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?)`
    ).run(id, name, description, workspacePath, workspaceWriteEnabled, workspaceApprovalMode, now, now);

    const row = db.prepare<[string], FolderRow>("SELECT * FROM folders WHERE id = ?").get(id)!;
    return reply.code(201).send(rowToFolder(row));
  });

  /** PATCH /api/folders/:id -- update folder name, description, workspace, or expanded state. */
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
      workspacePath?: string | null;
      workspaceWriteEnabled?: boolean;
      workspaceApprovalMode?: WorkspaceApprovalMode;
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

    let nextWorkspacePath: string | null = existing.workspace_path ?? null;
    let nextWorkspaceWrite = existing.workspace_write_enabled ?? 0;
    let nextApprovalMode = normalizeApprovalMode(existing.workspace_approval_mode);

    if (body.workspacePath !== undefined) {
      if (body.workspacePath === null || !String(body.workspacePath).trim()) {
        nextWorkspacePath = null;
        nextWorkspaceWrite = 0;
        nextApprovalMode = "auto";
      } else {
        const check = validateWorkspaceDirectory(String(body.workspacePath));
        if (!check.ok) {
          return reply.code(400).send({ error: { message: check.error } });
        }
        nextWorkspacePath = check.realPath;
        if (body.workspaceWriteEnabled !== undefined) {
          nextWorkspaceWrite = body.workspaceWriteEnabled ? 1 : 0;
        }
        if (body.workspaceApprovalMode !== undefined) {
          nextApprovalMode = normalizeApprovalMode(body.workspaceApprovalMode);
        }
      }
    } else {
      if (body.workspaceWriteEnabled !== undefined) {
        nextWorkspaceWrite = nextWorkspacePath ? (body.workspaceWriteEnabled ? 1 : 0) : 0;
      }
      if (body.workspaceApprovalMode !== undefined) {
        nextApprovalMode = normalizeApprovalMode(body.workspaceApprovalMode);
      }
    }

    const now = Date.now();

    db.prepare(
      `UPDATE folders
       SET name = ?, description = ?, is_expanded = ?, workspace_path = ?, workspace_write_enabled = ?, workspace_approval_mode = ?, updated_at = ?
       WHERE id = ?`
    ).run(nextName, nextDescription, nextExpanded, nextWorkspacePath, nextWorkspaceWrite, nextApprovalMode, now, id);

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
