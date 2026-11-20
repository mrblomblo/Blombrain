import type { FastifyInstance } from "fastify";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { pipeline } from "node:stream/promises";
import db, { DATA_DIR } from "../db.js";
import type { AttachmentOut, AttachmentRow } from "../types.js";
import {
  extractDocumentTextAsync,
  isCodeOrTextFilename,
} from "../services/documentExtractor.js";
import { createUploadViewToken } from "../services/uploadTokens.js";

export const UPLOADS_DIR = path.join(DATA_DIR, "uploads");
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

function rowToOut(row: AttachmentRow): AttachmentOut {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    messageId: row.message_id,
    originalName: row.original_name,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    createdAt: row.created_at,
    purpose: row.purpose ?? "attachment",
  };
}

function resolveMimeType(filename: string, rawMime: string): string {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".docx")) {
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  }
  if (lower.endsWith(".doc")) {
    return "application/msword";
  }
  if (lower.endsWith(".svg")) {
    return "image/svg+xml";
  }
  if (isCodeOrTextFilename(lower)) {
    return "text/plain";
  }
  return rawMime || "application/octet-stream";
}

/**
 * Moves any staged attachments into `uploads/<conversationId>/` on disk
 * and links them to the given `conversationId` and `messageId` in SQLite.
 */
export function assignAttachmentsToConversation(
  attachmentIds: string[],
  conversationId: string,
  messageId: string
): void {
  if (!Array.isArray(attachmentIds) || attachmentIds.length === 0) return;

  const targetDir = path.join(UPLOADS_DIR, conversationId);
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  const selectStmt = db.prepare<[string], AttachmentRow>("SELECT * FROM attachments WHERE id = ?");
  const updateStmt = db.prepare(
    "UPDATE attachments SET message_id = ?, conversation_id = ?, disk_path = ? WHERE id = ?"
  );

  for (const id of attachmentIds) {
    const row = selectStmt.get(id);
    if (!row) continue;

    let nextDiskPath = row.disk_path;
    const currentDir = path.dirname(row.disk_path);

    // Move physical file out of staging directory into the conversation's folder
    if (
      fs.existsSync(row.disk_path) &&
      path.resolve(currentDir) !== path.resolve(targetDir) &&
      path.basename(currentDir) === "staging"
    ) {
      const destPath = path.join(targetDir, path.basename(row.disk_path));
      try {
        fs.renameSync(row.disk_path, destPath);
        nextDiskPath = destPath;
      } catch {
        try {
          fs.copyFileSync(row.disk_path, destPath);
          fs.unlinkSync(row.disk_path);
          nextDiskPath = destPath;
        } catch {
          // Keep original path if move failed
        }
      }
    }

    updateStmt.run(messageId, conversationId, nextDiskPath, id);
  }
}

/**
 * Deletes all physical files and DB attachment records belonging to a conversation,
 * including any files that remained in `uploads/staging/`.
 */
export function removeConversationUploads(convId: string): void {
  try {
    const rows = db
      .prepare<[string], AttachmentRow>("SELECT * FROM attachments WHERE conversation_id = ?")
      .all(convId);

    for (const row of rows) {
      if (row.disk_path && fs.existsSync(row.disk_path)) {
        const sharedCount =
          (
            db
              .prepare<[string, string], { cnt: number }>(
                "SELECT COUNT(*) as cnt FROM attachments WHERE disk_path = ? AND conversation_id != ?"
              )
              .get(row.disk_path, convId)?.cnt ?? 0
          );
        if (sharedCount === 0) {
          try {
            fs.unlinkSync(row.disk_path);
          } catch { }
        }
      }
    }
  } catch { }

  try {
    const convDir = path.join(UPLOADS_DIR, convId);
    if (fs.existsSync(convDir)) {
      fs.rmSync(convDir, { recursive: true, force: true });
    }
  } catch { }

  try {
    db.prepare("DELETE FROM attachments WHERE conversation_id = ?").run(convId);
  } catch { }
}

export async function uploadsRoutes(app: FastifyInstance) {
  // Upload a new file
  app.post<{ Querystring: { conversationId?: string; purpose?: string } }>(
    "/api/uploads",
    async (req, reply) => {
      const data = await req.file();
      if (!data) {
        return reply.status(400).send({ error: "No file uploaded" });
      }

      const rawPurpose = req.query.purpose;
      const purpose =
        rawPurpose === "avatar" || rawPurpose === "icon" ? rawPurpose : "attachment";
      const conversationId =
        purpose === "attachment" ? req.query.conversationId || null : null;

      const subDir =
        purpose === "avatar" || purpose === "icon"
          ? "avatars"
          : conversationId
            ? conversationId
            : "staging";
      const targetDir = path.join(UPLOADS_DIR, subDir);
      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
      }

      const fileId = crypto.randomUUID();
      const ext = path.extname(data.filename) || "";
      const diskFilename = `${fileId}${ext}`;
      const diskPath = path.join(targetDir, diskFilename);

      const writeStream = fs.createWriteStream(diskPath);
      await pipeline(data.file, writeStream);

      const stat = fs.statSync(diskPath);
      const now = Date.now();

      db.prepare(`
        INSERT INTO attachments (id, conversation_id, message_id, original_name, mime_type, disk_path, size_bytes, created_at, purpose)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        fileId,
        conversationId,
        null,
        data.filename,
        resolveMimeType(data.filename, data.mimetype),
        diskPath,
        stat.size,
        now,
        purpose
      );

      const row = db.prepare(`SELECT * FROM attachments WHERE id = ?`).get(fileId) as AttachmentRow;
      return rowToOut(row);
    }
  );

  // Extract text preview for an uploaded attachment (supports PDF, DOCX, code, text)
  app.get<{ Params: { id: string } }>("/api/uploads/:id/text", async (req, reply) => {
    const { id } = req.params;
    const row = db.prepare(`SELECT * FROM attachments WHERE id = ?`).get(id) as AttachmentRow | undefined;
    if (!row) {
      return reply.status(404).send({ error: "Attachment not found" });
    }
    if (!fs.existsSync(row.disk_path)) {
      return reply.status(404).send({ error: "File missing on disk" });
    }

    const extracted = await extractDocumentTextAsync(row.disk_path, row.original_name, row.mime_type);
    return reply.send(extracted);
  });

  // Generate a temporary view token to open raw file in external browser
  app.post<{ Params: { id: string } }>("/api/uploads/:id/view-token", async (req, reply) => {
    const { id } = req.params;
    const row = db.prepare(`SELECT * FROM attachments WHERE id = ?`).get(id) as AttachmentRow | undefined;
    if (!row) {
      return reply.status(404).send({ error: "Attachment not found" });
    }
    if (!fs.existsSync(row.disk_path)) {
      return reply.status(404).send({ error: "File missing on disk" });
    }

    const token = createUploadViewToken(id);
    return reply.send({
      token,
      url: `/api/uploads/${encodeURIComponent(id)}?token=${encodeURIComponent(token)}`,
    });
  });

  // Serve a file
  app.get<{ Params: { id: string }; Querystring: { download?: string } }>(
    "/api/uploads/:id",
    async (req, reply) => {
      const { id } = req.params;
      const forceDownload = req.query.download === "1" || req.query.download === "true";
      const row = db.prepare(`SELECT * FROM attachments WHERE id = ?`).get(id) as AttachmentRow | undefined;
      if (!row) {
        return reply.status(404).send({ error: "Attachment not found" });
      }

      if (!fs.existsSync(row.disk_path)) {
        return reply.status(404).send({ error: "File missing on disk" });
      }

      const encodedName = encodeURIComponent(row.original_name);
      const safeAsciiName = row.original_name.replace(/["\\\r\n]/g, "_");
      const dispositionType = forceDownload ? "attachment" : "inline";

      reply.header("X-Content-Type-Options", "nosniff");

      const isMedia =
        row.mime_type.startsWith("image/") ||
        row.mime_type.startsWith("audio/") ||
        row.mime_type.startsWith("video/");
      const isPdf =
        row.mime_type === "application/pdf" || row.original_name.toLowerCase().endsWith(".pdf");
      const isTextOrCode =
        row.mime_type.startsWith("text/") || isCodeOrTextFilename(row.original_name);

      if (isMedia) {
        reply.header("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'");
        reply.header("Content-Type", row.mime_type);
        if (forceDownload) {
          reply.header(
            "Content-Disposition",
            `attachment; filename="${safeAsciiName}"; filename*=UTF-8''${encodedName}`
          );
        }
      } else if (isPdf) {
        reply.header(
          "Content-Security-Policy",
          "default-src 'none'; object-src 'self'; style-src 'unsafe-inline'"
        );
        reply.header("Content-Type", "application/pdf");
        reply.header(
          "Content-Disposition",
          `${dispositionType}; filename="${safeAsciiName}"; filename*=UTF-8''${encodedName}`
        );
      } else if (isTextOrCode && !forceDownload) {
        reply.header("Content-Security-Policy", "default-src 'none'");
        reply.header("Content-Type", "text/plain; charset=utf-8");
        reply.header(
          "Content-Disposition",
          `inline; filename="${safeAsciiName}"; filename*=UTF-8''${encodedName}`
        );
      } else {
        reply.header("Content-Security-Policy", "default-src 'none'");
        reply.header("Content-Type", row.mime_type || "application/octet-stream");
        reply.header(
          "Content-Disposition",
          `attachment; filename="${safeAsciiName}"; filename*=UTF-8''${encodedName}`
        );
      }

      reply.header("Content-Length", row.size_bytes);

      const readStream = fs.createReadStream(row.disk_path);
      return reply.send(readStream);
    }
  );

  // Delete an upload
  app.delete<{ Params: { id: string } }>("/api/uploads/:id", async (req, reply) => {
    const { id } = req.params;
    const row = db.prepare(`SELECT * FROM attachments WHERE id = ?`).get(id) as AttachmentRow | undefined;
    if (!row) {
      return reply.status(200).send({ success: true }); // idempotent
    }

    // Only unlink physical file if no other attachment row shares the same disk_path (e.g. from branching)
    const sharedCount =
      db
        .prepare<[string, string], { cnt: number }>(
          "SELECT COUNT(*) as cnt FROM attachments WHERE disk_path = ? AND id != ?"
        )
        .get(row.disk_path, id)?.cnt ?? 0;

    if (sharedCount === 0 && fs.existsSync(row.disk_path)) {
      try {
        fs.unlinkSync(row.disk_path);
      } catch (err) {
        app.log.warn(err, `Failed to delete file ${row.disk_path}:`);
      }
    }

    // Attempt to delete parent dir if empty
    const dir = path.dirname(row.disk_path);
    try {
      if (
        fs.existsSync(dir) &&
        fs.readdirSync(dir).length === 0 &&
        dir !== UPLOADS_DIR &&
        path.basename(dir) !== "staging" &&
        path.basename(dir) !== "avatars"
      ) {
        fs.rmdirSync(dir);
      }
    } catch {
      // ignore
    }

    // Delete DB row
    db.prepare(`DELETE FROM attachments WHERE id = ?`).run(id);

    return reply.status(200).send({ success: true });
  });

  // Cleanup job (runs periodically)
  // Delete uncommitted attachment rows older than 24 hours, excluding icons and avatars
  const runCleanup = () => {
    try {
      const cutoff = Date.now() - 24 * 3600 * 1000;
      const orphans = db.prepare(`
        SELECT * FROM attachments
        WHERE message_id IS NULL
          AND COALESCE(purpose, 'attachment') = 'attachment'
          AND created_at < ?
          AND id NOT IN (
            SELECT REPLACE(icon, '/api/uploads/', '')
            FROM model_settings
            WHERE icon IS NOT NULL
          )
          AND id NOT IN (
            SELECT REPLACE(user_avatar, '/api/uploads/', '')
            FROM global_settings
            WHERE user_avatar IS NOT NULL
          )
      `).all(cutoff) as AttachmentRow[];

      for (const row of orphans) {
        if (fs.existsSync(row.disk_path)) {
          try {
            fs.unlinkSync(row.disk_path);
          } catch { }
        }
        db.prepare(`DELETE FROM attachments WHERE id = ?`).run(row.id);
        const dir = path.dirname(row.disk_path);
        try {
          if (
            fs.existsSync(dir) &&
            fs.readdirSync(dir).length === 0 &&
            dir !== UPLOADS_DIR &&
            path.basename(dir) !== "staging" &&
            path.basename(dir) !== "avatars"
          ) {
            fs.rmdirSync(dir);
          }
        } catch { }
      }
      if (orphans.length > 0) {
        app.log.info(`Cleaned up ${orphans.length} orphaned attachments`);
      }
    } catch (err) {
      app.log.error(err, "Failed to run attachment cleanup job");
    }
  };

  setTimeout(runCleanup, 1000).unref?.();
  setInterval(runCleanup, 3600 * 1000).unref?.();
}
