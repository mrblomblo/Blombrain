import type { FastifyInstance } from "fastify";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { pipeline } from "node:stream/promises";
import db, { DATA_DIR } from "../db.js";
import type { AttachmentOut, AttachmentRow } from "../types.js";

const UPLOADS_DIR = path.join(DATA_DIR, "uploads");
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
  };
}

export async function uploadsRoutes(app: FastifyInstance) {
  // Upload a new file
  app.post<{ Querystring: { conversationId?: string } }>("/api/uploads", async (req, reply) => {
    const data = await req.file();
    if (!data) {
      return reply.status(400).send({ error: "No file uploaded" });
    }

    // conversationId might be missing for new/unsaved conversations.
    // If we need to upload an attachment before a conversation exists,
    // we use a temporary session ID or let it be null. But in our schema
    // conversation_id is nullable? Wait, db.ts says:
    // conversation_id TEXT REFERENCES conversations(id) ON DELETE CASCADE
    // If it's optional, it must allow NULL. Let's check db schema again.
    // Actually, in the frontend, if the conversation is new, the user hasn't sent a message yet.
    // But in chat.svelte.ts we have `activeConversationId`. If it's null, we don't have one.
    // Wait, the plan says: `conversation_id TEXT REFERENCES conversations(id) ON DELETE CASCADE`
    // SQLite allows NULL in foreign keys unless NOT NULL is specified.
    // The plan schema doesn't have NOT NULL for conversation_id in attachments.
    const conversationId = req.query.conversationId || null;
    
    // We can group uploads by conversation ID or just put them in the root of uploads if no conv.
    const convDir = conversationId ? conversationId : "staging";
    const targetDir = path.join(UPLOADS_DIR, convDir);
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
      INSERT INTO attachments (id, conversation_id, message_id, original_name, mime_type, disk_path, size_bytes, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      fileId,
      conversationId,
      null, // message_id is null until sent
      data.filename,
      data.mimetype,
      diskPath, // Store absolute path or relative? Storing absolute for simplicity, or relative to DATA_DIR.
                // It's safer to store relative to DATA_DIR so it's portable.
      stat.size,
      now
    );

    const row = db.prepare(`SELECT * FROM attachments WHERE id = ?`).get(fileId) as AttachmentRow;
    return rowToOut(row);
  });

  // Serve a file
  app.get<{ Params: { id: string } }>("/api/uploads/:id", async (req, reply) => {
    const { id } = req.params;
    const row = db.prepare(`SELECT * FROM attachments WHERE id = ?`).get(id) as AttachmentRow | undefined;
    if (!row) {
      return reply.status(404).send({ error: "Attachment not found" });
    }

    if (!fs.existsSync(row.disk_path)) {
      return reply.status(404).send({ error: "File missing on disk" });
    }

    // Security headers to prevent arbitrary script execution in the browser context
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("Content-Security-Policy", "default-src 'none'");

    const isMedia = row.mime_type.startsWith("image/") || row.mime_type.startsWith("audio/") || row.mime_type.startsWith("video/");
    if (isMedia) {
      reply.header("Content-Type", row.mime_type);
    } else {
      // Force safe text or attachment download for non-media files (e.g. .html, .svg, .js, .py)
      reply.header("Content-Type", "text/plain; charset=utf-8");
      reply.header("Content-Disposition", `inline; filename="${encodeURIComponent(row.original_name)}"`);
    }
    reply.header("Content-Length", row.size_bytes);

    const readStream = fs.createReadStream(row.disk_path);
    return reply.send(readStream);
  });

  // Delete an upload
  app.delete<{ Params: { id: string } }>("/api/uploads/:id", async (req, reply) => {
    const { id } = req.params;
    const row = db.prepare(`SELECT * FROM attachments WHERE id = ?`).get(id) as AttachmentRow | undefined;
    if (!row) {
      return reply.status(200).send({ success: true }); // idempotent
    }

    // Delete file
    if (fs.existsSync(row.disk_path)) {
      try {
        fs.unlinkSync(row.disk_path);
      } catch (err) {
        app.log.warn(err, `Failed to delete file ${row.disk_path}:`);
      }
    }

    // Attempt to delete parent dir if empty
    const dir = path.dirname(row.disk_path);
    try {
      if (fs.existsSync(dir) && fs.readdirSync(dir).length === 0 && dir !== UPLOADS_DIR) {
        fs.rmdirSync(dir);
      }
    } catch (e) {
      // ignore
    }

    // Delete DB row
    db.prepare(`DELETE FROM attachments WHERE id = ?`).run(id);

    return reply.status(200).send({ success: true });
  });

  // Cleanup job (runs once on route registration)
  // Delete all attachment rows where message_id IS NULL AND created_at < now - 1 hour
  setTimeout(() => {
    try {
      const oneHourAgo = Date.now() - 3600 * 1000;
      const orphans = db.prepare(`
        SELECT * FROM attachments 
        WHERE message_id IS NULL 
          AND created_at < ?
          AND id NOT IN (
            SELECT REPLACE(icon, '/api/uploads/', '') 
            FROM model_settings 
            WHERE icon IS NOT NULL
          )
      `).all(oneHourAgo) as AttachmentRow[];
      
      for (const row of orphans) {
        if (fs.existsSync(row.disk_path)) {
          fs.unlinkSync(row.disk_path);
        }
        db.prepare(`DELETE FROM attachments WHERE id = ?`).run(row.id);
        const dir = path.dirname(row.disk_path);
        try {
          if (fs.existsSync(dir) && fs.readdirSync(dir).length === 0 && dir !== UPLOADS_DIR) {
            fs.rmdirSync(dir);
          }
        } catch(e) {}
      }
      if (orphans.length > 0) {
        app.log.info(`Cleaned up ${orphans.length} orphaned attachments`);
      }
    } catch(err) {
      app.log.error(err, "Failed to run attachment cleanup job");
    }
  }, 1000); // slight delay to not block startup
}
