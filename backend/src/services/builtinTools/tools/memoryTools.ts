import type { BuiltInToolDefinition, BuiltInToolContext } from "../types.js";
import {
  getScratchpadEntries,
  getScratchpadEntry,
  setScratchpadEntry,
  deleteScratchpadEntry,
  searchMemories,
  createMemory,
  updateMemory,
  deleteMemory,
  searchChatHistory,
} from "../../memory.js";
import db from "../../../db.js";

function isPersistentMemoryAllowed(ctx?: BuiltInToolContext): boolean {
  if (ctx?.memoryEnabled !== undefined) return ctx.memoryEnabled;
  const row = db
    .prepare("SELECT memory_enabled FROM global_settings WHERE id = 'default'")
    .get() as { memory_enabled?: number } | undefined;
  return row?.memory_enabled !== undefined ? Boolean(row.memory_enabled) : true;
}

function isCrossChatRecallAllowed(ctx?: BuiltInToolContext): boolean {
  if (ctx?.crossChatRecallEnabled !== undefined) return ctx.crossChatRecallEnabled;
  const row = db
    .prepare("SELECT cross_chat_recall_enabled FROM global_settings WHERE id = 'default'")
    .get() as { cross_chat_recall_enabled?: number } | undefined;
  return row?.cross_chat_recall_enabled !== undefined
    ? Boolean(row.cross_chat_recall_enabled)
    : true;
}

function shouldIncludeArchivedChats(ctx?: BuiltInToolContext): boolean {
  if (ctx?.crossChatIncludeArchived !== undefined) return ctx.crossChatIncludeArchived;
  const row = db
    .prepare("SELECT cross_chat_include_archived FROM global_settings WHERE id = 'default'")
    .get() as { cross_chat_include_archived?: number } | undefined;
  return Boolean(row?.cross_chat_include_archived);
}

// ---------------------------------------------------------------------------
// Layer 1: Ephemeral Conversation Scratchpad Tools
// ---------------------------------------------------------------------------

export const scratchpadSetToolDef: BuiltInToolDefinition = {
  name: "scratchpad_set",
  category: "memory",
  description:
    "Write or update an ephemeral note in the current conversation's scratchpad. Useful for storing step-by-step plans, intermediate state, checklists, or temporary variables within this conversation. Pass an empty content string to delete a key.",
  parameters: {
    type: "object",
    properties: {
      key: {
        type: "string",
        description: "Identifier key for the scratchpad note (e.g., 'plan', 'todo', 'current_state'). Defaults to 'default'.",
      },
      content: {
        type: "string",
        description: "The text content to store under this key. If empty, deletes the key.",
      },
    },
    required: ["key", "content"],
  },
  execute: async (args: Record<string, any>, ctx: BuiltInToolContext) => {
    const convId = ctx.conversationId;
    if (!convId) {
      return { content: "Error: conversationId is missing.", isError: true };
    }

    const key = String(args.key || "default").trim();
    const content = String(args.content ?? "");

    if (!content.trim()) {
      const deleted = deleteScratchpadEntry(convId, key);
      ctx.emitEvent?.("scratchpad_updated", {
        conversationId: convId,
        entries: getScratchpadEntries(convId),
      });
      return {
        content: JSON.stringify({
          action: "deleted",
          key,
          deleted,
        }),
      };
    }

    const entry = setScratchpadEntry(convId, key, content);
    ctx.emitEvent?.("scratchpad_updated", {
      conversationId: convId,
      entries: getScratchpadEntries(convId),
    });

    return {
      content: JSON.stringify(
        {
          action: "saved",
          key: entry.key,
          length: entry.content.length,
          updatedAt: entry.updatedAt,
        },
        null,
        2
      ),
    };
  },
};

export const scratchpadGetToolDef: BuiltInToolDefinition = {
  name: "scratchpad_get",
  category: "memory",
  description:
    "Read notes from the current conversation's ephemeral scratchpad. Omit 'key' to list all scratchpad entries in this conversation.",
  parameters: {
    type: "object",
    properties: {
      key: {
        type: "string",
        description: "Optional specific key to retrieve. Omit to retrieve all scratchpad entries for this conversation.",
      },
    },
  },
  execute: async (args: Record<string, any>, ctx: BuiltInToolContext) => {
    const convId = ctx.conversationId;
    if (!convId) {
      return { content: "Error: conversationId is missing.", isError: true };
    }

    const key = typeof args.key === "string" ? args.key.trim() : "";
    if (key) {
      const entry = getScratchpadEntry(convId, key);
      if (!entry) {
        return {
          content: JSON.stringify({ found: false, key, message: `No scratchpad entry found for key '${key}'.` }),
        };
      }
      return {
        content: JSON.stringify({ found: true, key: entry.key, content: entry.content, updatedAt: entry.updatedAt }, null, 2),
      };
    }

    const entries = getScratchpadEntries(convId);
    return {
      content: JSON.stringify(
        {
          count: entries.length,
          entries: entries.map((e) => ({
            key: e.key,
            content: e.content,
            updatedAt: e.updatedAt,
          })),
        },
        null,
        2
      ),
    };
  },
};

// ---------------------------------------------------------------------------
// Layer 2: Persistent User Memory Tools (Semantic RAG + BM25)
// ---------------------------------------------------------------------------

export const memorySearchToolDef: BuiltInToolDefinition = {
  name: "memory_search",
  category: "memory",
  description:
    "Search persistent long-term user memories using semantic and keyword relevance ranking. Use this to recall user preferences, personal facts, recurring project context, or standing instructions.",
  isAvailable: (ctx) => isPersistentMemoryAllowed(ctx),
  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "Search query describing the fact, preference, or topic to recall. Pass an empty string to list recent memories.",
      },
      limit: {
        type: "number",
        description: "Maximum number of memories to return (default 8, max 25).",
      },
    },
    required: ["query"],
  },
  execute: async (args: Record<string, any>, ctx: BuiltInToolContext) => {
    if (!isPersistentMemoryAllowed(ctx)) {
      return { content: "Error: Persistent user memory is currently disabled.", isError: true };
    }

    const query = String(args.query ?? "").trim();
    const limit = Math.max(1, Math.min(25, Number(args.limit) || 8));
    const results = await searchMemories(query, limit, true, ctx.abortSignal);

    return {
      content: JSON.stringify(
        {
          query,
          count: results.length,
          memories: results.map((m) => ({
            id: m.id,
            content: m.content,
            category: m.category,
            tags: m.tags,
            score: m.score,
            updatedAt: m.updatedAt,
          })),
        },
        null,
        2
      ),
    };
  },
};

export const memorySetToolDef: BuiltInToolDefinition = {
  name: "memory_set",
  category: "memory",
  description:
    "Store a new persistent long-term memory fact or preference about the user or their projects so it can be recalled in future conversations.",
  isAvailable: (ctx) => isPersistentMemoryAllowed(ctx),
  parameters: {
    type: "object",
    properties: {
      content: {
        type: "string",
        description: "A concise, self-contained statement of the fact or preference to remember.",
      },
      category: {
        type: "string",
        description: "Optional category such as 'preference', 'profile', 'project', 'workflow', or 'general'.",
      },
      tags: {
        type: "array",
        items: { type: "string" },
        description: "Optional keywords or tags for indexing.",
      },
    },
    required: ["content"],
  },
  execute: async (args: Record<string, any>, ctx: BuiltInToolContext) => {
    if (!isPersistentMemoryAllowed(ctx)) {
      return { content: "Error: Persistent user memory is currently disabled.", isError: true };
    }

    const content = String(args.content ?? "").trim();
    if (!content) {
      return { content: "Error: content is required.", isError: true };
    }

    const created = await createMemory(
      {
        content,
        category: typeof args.category === "string" ? args.category : "general",
        tags: Array.isArray(args.tags) ? args.tags.map(String) : [],
        sourceConversationId: ctx.conversationId ?? null,
      },
      ctx.abortSignal
    );

    return {
      content: JSON.stringify(
        {
          action: "created",
          memory: {
            id: created.id,
            content: created.content,
            category: created.category,
            tags: created.tags,
            hasEmbedding: created.hasEmbedding,
          },
        },
        null,
        2
      ),
    };
  },
};

export const memoryUpdateToolDef: BuiltInToolDefinition = {
  name: "memory_update",
  category: "memory",
  description:
    "Update an existing persistent user memory by its ID (obtained via memory_search).",
  isAvailable: (ctx) => isPersistentMemoryAllowed(ctx),
  parameters: {
    type: "object",
    properties: {
      id: {
        type: "string",
        description: "The ID of the memory to update.",
      },
      content: {
        type: "string",
        description: "Updated memory statement.",
      },
      category: {
        type: "string",
        description: "Optional updated category.",
      },
      tags: {
        type: "array",
        items: { type: "string" },
        description: "Optional updated tags array.",
      },
    },
    required: ["id", "content"],
  },
  execute: async (args: Record<string, any>, ctx: BuiltInToolContext) => {
    if (!isPersistentMemoryAllowed(ctx)) {
      return { content: "Error: Persistent user memory is currently disabled.", isError: true };
    }

    const id = String(args.id ?? "").trim();
    const content = String(args.content ?? "").trim();
    if (!id || !content) {
      return { content: "Error: id and content are required.", isError: true };
    }

    const updated = await updateMemory(
      id,
      {
        content,
        ...(typeof args.category === "string" ? { category: args.category } : {}),
        ...(Array.isArray(args.tags) ? { tags: args.tags.map(String) } : {}),
      },
      ctx.abortSignal
    );

    if (!updated) {
      return { content: `Error: Memory with id '${id}' not found.`, isError: true };
    }

    return {
      content: JSON.stringify(
        {
          action: "updated",
          memory: {
            id: updated.id,
            content: updated.content,
            category: updated.category,
            tags: updated.tags,
          },
        },
        null,
        2
      ),
    };
  },
};

export const memoryDeleteToolDef: BuiltInToolDefinition = {
  name: "memory_delete",
  category: "memory",
  description:
    "Delete an outdated or incorrect persistent user memory by its ID.",
  isAvailable: (ctx) => isPersistentMemoryAllowed(ctx),
  parameters: {
    type: "object",
    properties: {
      id: {
        type: "string",
        description: "The ID of the memory to delete.",
      },
    },
    required: ["id"],
  },
  execute: async (args: Record<string, any>, ctx: BuiltInToolContext) => {
    if (!isPersistentMemoryAllowed(ctx)) {
      return { content: "Error: Persistent user memory is currently disabled.", isError: true };
    }

    const id = String(args.id ?? "").trim();
    if (!id) {
      return { content: "Error: id is required.", isError: true };
    }

    const deleted = deleteMemory(id);
    if (!deleted) {
      return { content: `Error: Memory with id '${id}' not found.`, isError: true };
    }

    return {
      content: JSON.stringify({ action: "deleted", id, deleted: true }),
    };
  },
};

// ---------------------------------------------------------------------------
// Layer 3: Cross-Chat Memory / History Search Tool
// ---------------------------------------------------------------------------

export const chatHistorySearchToolDef: BuiltInToolDefinition = {
  name: "chat_history_search",
  category: "memory",
  description:
    "Search past conversations and message history for relevant information, code snippets, or decisions discussed in previous chats.",
  isAvailable: (ctx) => isCrossChatRecallAllowed(ctx),
  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "Keywords or topic to search for across previous conversations.",
      },
      include_archived: {
        type: "boolean",
        description: "Optional override for whether to search archived conversations as well.",
      },
      limit: {
        type: "number",
        description: "Maximum number of matching message snippets to return (default 8, max 20).",
      },
    },
    required: ["query"],
  },
  execute: async (args: Record<string, any>, ctx: BuiltInToolContext) => {
    if (!isCrossChatRecallAllowed(ctx)) {
      return { content: "Error: Cross-chat recall is currently disabled.", isError: true };
    }

    const query = String(args.query ?? "").trim();
    if (!query) {
      return { content: "Error: query is required.", isError: true };
    }

    const includeArchived =
      typeof args.include_archived === "boolean"
        ? args.include_archived && shouldIncludeArchivedChats(ctx)
        : shouldIncludeArchivedChats(ctx);
    const limit = Math.max(1, Math.min(20, Number(args.limit) || 8));

    const hits = searchChatHistory({
      query,
      excludeConversationId: ctx.conversationId ?? null,
      includeArchived,
      limit,
    });

    return {
      content: JSON.stringify(
        {
          query,
          includeArchived,
          count: hits.length,
          results: hits,
        },
        null,
        2
      ),
    };
  },
};
