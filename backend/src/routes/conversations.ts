import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import fs from "node:fs";
import path from "node:path";
import db, { DATA_DIR } from "../db.js";
import type {
  ConversationRow,
  MessageRow,
  ConversationSummary,
  ConversationDetail,
  MessageOut,
  ConversationPatchBody,
} from "../types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function rowToSummary(row: ConversationRow): ConversationSummary {
  return {
    id: row.id,
    title: row.title,
    model: row.model,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToAttachment(a: import("../types.js").AttachmentRow) {
  return {
    id: a.id,
    conversationId: a.conversation_id,
    messageId: a.message_id,
    originalName: a.original_name,
    mimeType: a.mime_type,
    sizeBytes: a.size_bytes,
    createdAt: a.created_at,
  };
}

function rowToMessage(row: MessageRow): MessageOut {
  const attachRows = db.prepare(`SELECT * FROM attachments WHERE message_id = ?`).all(row.id) as import("../types.js").AttachmentRow[];
  return {
    id: row.id,
    conversationId: row.conversation_id,
    parentId: row.parent_id ?? null,
    role: row.role,
    content: row.content,
    error: row.error,
    stats: row.stats ? JSON.parse(row.stats) : undefined,
    model: row.model ?? undefined,
    createdAt: row.created_at,
    attachments: attachRows.length > 0 ? attachRows.map(rowToAttachment) : undefined,
  };
}

// ---------------------------------------------------------------------------
// Prepared statements (created once, reused on every call)
// ---------------------------------------------------------------------------

const listConversations = db.prepare<[], ConversationRow>(
  "SELECT * FROM conversations ORDER BY updated_at DESC",
);

const getConversation = db.prepare<[string], ConversationRow>(
  "SELECT * FROM conversations WHERE id = ?",
);

const getMessages = db.prepare<[string], MessageRow>(
  "SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC",
);

const insertConversation = db.prepare(
  `INSERT INTO conversations (id, title, model, created_at, updated_at)
   VALUES (@id, @title, @model, @createdAt, @updatedAt)`,
);

const updateConversationMeta = db.prepare(
  `UPDATE conversations
   SET title = COALESCE(@title, title),
       model = COALESCE(@model, model),
       updated_at = @updatedAt
   WHERE id = @id`,
);

const deleteConversation = db.prepare("DELETE FROM conversations WHERE id = ?");

const insertMessage = db.prepare(
  `INSERT INTO messages (id, conversation_id, parent_id, role, content, error, stats, model, created_at)
   VALUES (@id, @conversationId, @parentId, @role, @content, @error, @stats, @model, @createdAt)`,
);

// ---------------------------------------------------------------------------
// Route plugin
// ---------------------------------------------------------------------------

export async function conversationsRoutes(app: FastifyInstance) {
  /** GET /api/conversations -- list all, most-recently-updated first. */
  app.get("/api/conversations", async () => {
    return listConversations.all().map(rowToSummary);
  });

  /** POST /api/conversations -- create a new conversation. */
  app.post("/api/conversations", async (req: FastifyRequest, reply: FastifyReply) => {
    const body = (req.body ?? {}) as { title?: string; model?: string };
    const now = Date.now();
    const id = crypto.randomUUID();
    insertConversation.run({
      id,
      title: body.title ?? "New conversation",
      model: body.model ?? null,
      createdAt: now,
      updatedAt: now,
    });
    const row = getConversation.get(id)!;
    return reply.code(201).send(rowToSummary(row));
  });

  /** GET /api/conversations/:id -- conversation + all messages. */
  app.get("/api/conversations/:id", async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };
    const row = getConversation.get(id);
    if (!row) return reply.code(404).send({ error: { message: `Conversation "${id}" not found.` } });

    const messages = getMessages.all(id).map(rowToMessage);
    return reply.send({
      id: row.id,
      title: row.title,
      model: row.model,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      messages,
    });
  });

  /** PATCH /api/conversations/:id -- update title and/or model. */
  app.patch("/api/conversations/:id", async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };
    if (!getConversation.get(id)) {
      return reply.code(404).send({ error: { message: `Conversation "${id}" not found.` } });
    }
    const body = (req.body ?? {}) as ConversationPatchBody;
    updateConversationMeta.run({
      id,
      title: body.title ?? null,
      model: body.model ?? null,
      updatedAt: Date.now(),
    });
    return rowToSummary(getConversation.get(id)!);
  });

  /** DELETE /api/conversations/:id -- hard delete; cascades to messages. */
  app.delete("/api/conversations/:id", async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };
    const result = deleteConversation.run(id);
    if (result.changes === 0) {
      return reply.code(404).send({ error: { message: `Conversation "${id}" not found.` } });
    }
    try {
      const convDir = path.join(DATA_DIR, "uploads", id);
      if (fs.existsSync(convDir)) {
        fs.rmSync(convDir, { recursive: true, force: true });
      }
    } catch (e) { }

    return reply.code(204).send();
  });

  /** PATCH /api/conversations/:convId/messages/:msgId -- update message content & attachments. */
  app.patch("/api/conversations/:convId/messages/:msgId", async (req: FastifyRequest, reply: FastifyReply) => {
    const { convId, msgId } = req.params as { convId: string; msgId: string };
    const { content, error, attachmentIds } = (req.body ?? {}) as { content?: string; error?: string | null; attachmentIds?: string[] };

    const row = db.prepare<[string, string], MessageRow>(
      "SELECT * FROM messages WHERE id = ? AND conversation_id = ?"
    ).get(msgId, convId);

    if (!row) {
      return reply.code(404).send({ error: { message: `Message "${msgId}" not found.` } });
    }

    const newContent = content !== undefined ? content : row.content;
    const newError = error !== undefined ? error : row.error;

    db.prepare("UPDATE messages SET content = ?, error = ? WHERE id = ?").run(newContent, newError, msgId);

    if (Array.isArray(attachmentIds)) {
      if (attachmentIds.length === 0) {
        db.prepare("UPDATE attachments SET message_id = NULL WHERE message_id = ?").run(msgId);
      } else {
        const placeholders = attachmentIds.map(() => "?").join(",");
        db.prepare(`UPDATE attachments SET message_id = NULL WHERE message_id = ? AND id NOT IN (${placeholders})`).run(msgId, ...attachmentIds);
        const updateStmt = db.prepare("UPDATE attachments SET message_id = ?, conversation_id = ? WHERE id = ?");
        for (const id of attachmentIds) {
          updateStmt.run(msgId, convId, id);
        }
      }
    }

    updateConversationMeta.run({ id: convId, title: null, model: null, updatedAt: Date.now() });

    const updatedRow = db.prepare<[string], MessageRow>("SELECT * FROM messages WHERE id = ?").get(msgId)!;
    return rowToMessage(updatedRow);
  });

  /** DELETE /api/conversations/:convId/messages/:msgId -- delete a message + following assistant pair if user. */
  app.delete("/api/conversations/:convId/messages/:msgId", async (req: FastifyRequest, reply: FastifyReply) => {
    const { convId, msgId } = req.params as { convId: string; msgId: string };

    const row = db.prepare<[string, string], MessageRow>(
      "SELECT * FROM messages WHERE id = ? AND conversation_id = ?"
    ).get(msgId, convId);

    if (!row) {
      return reply.code(404).send({ error: { message: `Message "${msgId}" not found.` } });
    }

    if (row.role === "user") {
      // Find all assistant messages that claim row.id as parent (handles retry branches)
      const childAssts = db.prepare<[string, string], MessageRow>(
        "SELECT * FROM messages WHERE conversation_id = ? AND role = 'assistant' AND parent_id = ?"
      ).all(convId, msgId);

      if (childAssts.length > 0) {
        for (const childAsst of childAssts) {
          // Reparent grandchildren of each branch to the user message's parent so they become sibling branches
          db.prepare("UPDATE messages SET parent_id = ? WHERE parent_id = ? AND conversation_id = ?").run(row.parent_id, childAsst.id, convId);
          db.prepare("DELETE FROM messages WHERE id = ?").run(childAsst.id);
        }
      } else {
        // Reparent direct children of the user message (if any)
        db.prepare("UPDATE messages SET parent_id = ? WHERE parent_id = ? AND conversation_id = ?").run(row.parent_id, msgId, convId);
      }
      db.prepare("DELETE FROM messages WHERE id = ?").run(msgId);
    } else {
      // Assistant message: Delete this message and ALL its descendants
      db.prepare(`
        WITH RECURSIVE descendants AS (
          SELECT id FROM messages WHERE id = ?
          UNION ALL
          SELECT m.id FROM messages m
          INNER JOIN descendants d ON m.parent_id = d.id
        )
        DELETE FROM messages WHERE id IN (SELECT id FROM descendants)
      `).run(msgId);
    }

    const remainingCount = db.prepare<[string], { count: number }>(
      "SELECT COUNT(*) as count FROM messages WHERE conversation_id = ?"
    ).get(convId)?.count ?? 0;

    if (remainingCount === 0) {
      deleteConversation.run(convId);
    } else {
      updateConversationMeta.run({ id: convId, title: null, model: null, updatedAt: Date.now() });
    }

    return reply.code(204).send();
  });

  /** POST /api/conversations/:convId/messages/:msgId/branch -- create a sibling branch user message. */
  app.post("/api/conversations/:convId/messages/:msgId/branch", async (req: FastifyRequest, reply: FastifyReply) => {
    const { convId, msgId } = req.params as { convId: string; msgId: string };
    const { content, attachmentIds } = (req.body ?? {}) as { content: string; attachmentIds?: string[] };

    const target = db.prepare<[string, string], MessageRow>(
      "SELECT * FROM messages WHERE id = ? AND conversation_id = ?"
    ).get(msgId, convId);

    if (!target) {
      return reply.code(404).send({ error: { message: `Target message "${msgId}" not found.` } });
    }

    const newMsgId = crypto.randomUUID();
    const now = Date.now();

    insertMessage.run({
      id: newMsgId,
      conversationId: convId,
      parentId: target.parent_id, // Sibling has same parent_id
      role: "user",
      content: content ?? "",
      error: null,
      stats: null,
      model: null,
      createdAt: now,
    });

    if (Array.isArray(attachmentIds)) {
      const updateStmt = db.prepare("UPDATE attachments SET message_id = ?, conversation_id = ? WHERE id = ?");
      const insertAttachStmt = db.prepare(`
        INSERT INTO attachments (id, conversation_id, message_id, original_name, mime_type, disk_path, size_bytes, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);

      for (const id of attachmentIds) {
        const existing = db.prepare("SELECT * FROM attachments WHERE id = ?").get(id) as import("../types.js").AttachmentRow | undefined;
        if (existing) {
          if (!existing.message_id) {
            // Unattached new upload -> link to newMsgId
            updateStmt.run(newMsgId, convId, id);
          } else if (existing.message_id !== newMsgId) {
            // Existing attachment from parent/sibling -> copy row for new branch message
            const copyId = crypto.randomUUID();
            insertAttachStmt.run(
              copyId,
              convId,
              newMsgId,
              existing.original_name,
              existing.mime_type,
              existing.disk_path,
              existing.size_bytes,
              now
            );
          }
        }
      }
    }

    updateConversationMeta.run({ id: convId, title: null, model: null, updatedAt: now });

    const insertedRow = db.prepare<[string], MessageRow>("SELECT * FROM messages WHERE id = ?").get(newMsgId)!;
    return reply.code(201).send(rowToMessage(insertedRow));
  });

  /** GET /api/conversations/:id/messages -- messages only. */
  app.get("/api/conversations/:id/messages", async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };
    if (!getConversation.get(id)) {
      return reply.code(404).send({ error: { message: `Conversation "${id}" not found.` } });
    }
    const messages = getMessages.all(id).map(rowToMessage);
    const attachRows = db.prepare(`SELECT * FROM attachments WHERE conversation_id = ?`).all(id) as import("../types.js").AttachmentRow[];
    for (const msg of messages) {
      msg.attachments = attachRows
        .filter(a => a.message_id === msg.id)
        .map(a => ({
          id: a.id,
          conversationId: a.conversation_id,
          messageId: a.message_id,
          originalName: a.original_name,
          mimeType: a.mime_type,
          sizeBytes: a.size_bytes,
          createdAt: a.created_at,
        }));
    }
    return messages;
  });

  /**
   * POST /api/conversations/:id/messages -- append a single message.
   */
  app.post("/api/conversations/:id/messages", async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };
    const row = getConversation.get(id);
    if (!row) {
      return reply.code(404).send({ error: { message: `Conversation "${id}" not found.` } });
    }
    const body = req.body as {
      id?: string;
      parentId?: string;
      role: "system" | "user" | "assistant";
      content: string;
      error?: string;
    };
    if (!body?.role || body.content == null) {
      return reply.code(400).send({ error: { message: "Request body must include role and content." } });
    }
    const now = Date.now();
    const msgId = body.id ?? crypto.randomUUID();
    insertMessage.run({
      id: msgId,
      conversationId: id,
      parentId: body.parentId ?? null,
      role: body.role,
      content: body.content,
      error: body.error ?? null,
      stats: null,
      model: (body as any).model ?? null,
      createdAt: now,
    });
    updateConversationMeta.run({ id, title: null, model: null, updatedAt: now });

    const msgRow = db
      .prepare<[string], MessageRow>("SELECT * FROM messages WHERE id = ?")
      .get(msgId)!;
    return reply.code(201).send(rowToMessage(msgRow));
  });
}

// ---------------------------------------------------------------------------
// Helpers used by other routes (e.g. chat.ts)
// ---------------------------------------------------------------------------

/** Derive a short title from the first user message (first-words mode). */
export function deriveTitleFromContent(content: string): string {
  const words = content.trim().split(/\s+/);
  const excerpt = words.slice(0, 8).join(" ");
  return excerpt.length > 60 ? excerpt.slice(0, 57) + "…" : excerpt;
}

/**
 * Create a new conversation and save both the user message and (optionally)
 * the assistant message in a single transaction. Returns the conversation id
 * and title.
 */
export function persistChatTurn(opts: {
  conversationId: string | null;
  model: string;
  userMessageId: string;
  userParentId?: string | null;
  userContent: string;
  assistantMessageId: string;
  assistantContent: string;
  assistantError?: string;
  assistantStats?: any;
}): { conversationId: string; title: string; isNew: boolean } {
  const {
    conversationId: incomingId,
    model,
    userMessageId,
    userParentId,
    userContent,
    assistantMessageId,
    assistantContent,
    assistantError,
    assistantStats,
  } = opts;

  const conversationId = incomingId ?? crypto.randomUUID();
  const isNew = !incomingId || !getConversation.get(conversationId);

  const persist = db.transaction(() => {
    const now = Date.now();

    let title = "New conversation";
    if (isNew) {
      title = deriveTitleFromContent(userContent);
      insertConversation.run({
        id: conversationId,
        title,
        model,
        createdAt: now,
        updatedAt: now,
      });
    } else {
      updateConversationMeta.run({ id: conversationId, title: null, model, updatedAt: now });
      const row = getConversation.get(conversationId);
      title = row?.title ?? title;
    }

    // Determine parentId for userMessage if not specified
    let parentId = userParentId ?? null;
    if (userParentId === undefined && !isNew) {
      const lastMsg = db.prepare("SELECT id FROM messages WHERE conversation_id = ? ORDER BY created_at DESC LIMIT 1").get(conversationId) as { id: string } | undefined;
      if (lastMsg && lastMsg.id !== userMessageId) {
        parentId = lastMsg.id;
      }
    }

    // Check if userMessageId already exists (e.g. inserted via branch endpoint)
    const existingUserMsg = db.prepare("SELECT id FROM messages WHERE id = ?").get(userMessageId);
    if (!existingUserMsg) {
      insertMessage.run({
        id: userMessageId,
        conversationId,
        parentId,
        role: "user",
        content: userContent,
        error: null,
        stats: null,
        model: null,
        createdAt: now,
      });
    }

    insertMessage.run({
      id: assistantMessageId,
      conversationId,
      parentId: userMessageId, // Assistant parent is always the user message
      role: "assistant",
      content: assistantContent,
      error: assistantError ?? null,
      stats: assistantStats ? JSON.stringify(assistantStats) : null,
      model,
      createdAt: now + 1,
    });

    return title;
  });

  const title = persist() as string;
  return { conversationId, title, isNew };
}
