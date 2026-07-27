import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import db from "../db.js";
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

function rowToMessage(row: MessageRow): MessageOut {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    role: row.role,
    content: row.content,
    error: row.error,
    createdAt: row.created_at,
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
  `INSERT INTO messages (id, conversation_id, role, content, error, created_at)
   VALUES (@id, @conversationId, @role, @content, @error, @createdAt)`,
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
    const detail: ConversationDetail = { ...rowToSummary(row), messages };
    return detail;
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
    return reply.code(204).send();
  });

  /** GET /api/conversations/:id/messages -- messages only. */
  app.get("/api/conversations/:id/messages", async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };
    if (!getConversation.get(id)) {
      return reply.code(404).send({ error: { message: `Conversation "${id}" not found.` } });
    }
    return getMessages.all(id).map(rowToMessage);
  });

  /**
   * POST /api/conversations/:id/messages -- append a single message.
   * Used by the chat route and optionally directly.
   */
  app.post("/api/conversations/:id/messages", async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };
    const row = getConversation.get(id);
    if (!row) {
      return reply.code(404).send({ error: { message: `Conversation "${id}" not found.` } });
    }
    const body = req.body as {
      id?: string;
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
      role: body.role,
      content: body.content,
      error: body.error ?? null,
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
  userContent: string;
  assistantMessageId: string;
  assistantContent: string;
  assistantError?: string;
}): { conversationId: string; title: string; isNew: boolean } {
  const {
    conversationId: incomingId,
    model,
    userMessageId,
    userContent,
    assistantMessageId,
    assistantContent,
    assistantError,
  } = opts;

  const isNew = !incomingId;
  const conversationId = incomingId ?? crypto.randomUUID();

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
      // Update model + timestamp on the existing conversation.
      updateConversationMeta.run({ id: conversationId, title: null, model, updatedAt: now });
      const row = getConversation.get(conversationId);
      title = row?.title ?? title;
    }

    insertMessage.run({
      id: userMessageId,
      conversationId,
      role: "user",
      content: userContent,
      error: null,
      createdAt: now,
    });

    insertMessage.run({
      id: assistantMessageId,
      conversationId,
      role: "assistant",
      content: assistantContent,
      error: assistantError ?? null,
      createdAt: now + 1, // +1ms so messages always sort user-before-assistant
    });

    return title;
  });

  const title = persist() as string;
  return { conversationId, title, isNew };
}
