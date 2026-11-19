import { randomUUID } from "node:crypto";
import db from "../db.js";
import { backendRegistry } from "../registry.js";
import type {
  ScratchpadEntryRow,
  ScratchpadEntryOut,
  MemoryRow,
  MemoryOut,
  MemoryWriteBody,
} from "../types.js";

// ---------------------------------------------------------------------------
// Optional sqlite-vec extension loader (with pure-TS Float32 + BM25 fallback)
// ---------------------------------------------------------------------------

let sqliteVecLoaded = false;

export async function tryLoadSqliteVec(): Promise<boolean> {
  if (sqliteVecLoaded) return true;
  try {
    const modName = "sqlite-vec";
    const sqliteVec = await import(/* @vite-ignore */ modName).catch(() => null);
    if (sqliteVec && typeof sqliteVec.load === "function") {
      sqliteVec.load(db);
      sqliteVecLoaded = true;
      console.log("[memory] sqlite-vec extension loaded.");
      return true;
    }
  } catch {
    // Fallback to pure-TS Float32 cosine + BM25 hybrid retrieval
  }
  return false;
}

// ---------------------------------------------------------------------------
// Embedding & Hybrid Similarity Utilities
// ---------------------------------------------------------------------------

export function float32ToBuffer(vec: Float32Array): Buffer {
  return Buffer.from(vec.buffer, vec.byteOffset, vec.byteLength);
}

export function bufferToFloat32(buf: Buffer | null | undefined): Float32Array | null {
  if (!buf || buf.byteLength === 0 || buf.byteLength % 4 !== 0) return null;
  const copy = new Uint8Array(buf.byteLength);
  copy.set(buf);
  return new Float32Array(copy.buffer);
}

export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom > 0 ? dot / denom : 0;
}

const STOP_WORDS = new Set([
  "the", "and", "for", "that", "this", "with", "from", "have", "has", "had",
  "are", "was", "were", "will", "would", "could", "should", "what", "when",
  "where", "which", "who", "whom", "into", "onto", "about", "your", "their",
]);

export function tokenizeForSearch(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9_\u00C0-\u024F]+/gi, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 2 && !STOP_WORDS.has(t));
}

export function computeLexicalScore(query: string, candidateText: string, tags: string[] = []): number {
  const qLower = query.trim().toLowerCase();
  if (!qLower) return 0;

  const candLower = (candidateText + " " + tags.join(" ")).toLowerCase();
  const queryTokens = tokenizeForSearch(qLower);
  const candTokens = tokenizeForSearch(candLower);

  if (queryTokens.length === 0) {
    return candLower.includes(qLower) ? 1 : 0;
  }

  const candFreq = new Map<string, number>();
  for (const t of candTokens) {
    candFreq.set(t, (candFreq.get(t) ?? 0) + 1);
  }

  let matchedTokens = 0;
  let bm25Sum = 0;
  const k1 = 1.2;
  const b = 0.75;
  const avgLen = 32;
  const docLen = Math.max(1, candTokens.length);

  for (const qt of queryTokens) {
    let tf = candFreq.get(qt) ?? 0;
    if (tf === 0) {
      // Partial prefix/stem match
      for (const [ct, count] of candFreq.entries()) {
        if ((ct.length >= 4 && qt.length >= 4 && (ct.startsWith(qt) || qt.startsWith(ct))) || ct.includes(qt)) {
          tf += count * 0.6;
        }
      }
    }
    if (tf > 0) {
      matchedTokens++;
      const normTf = (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * (docLen / avgLen)));
      bm25Sum += normTf;
    }
  }

  let score = bm25Sum / (queryTokens.length * 1.8);
  const coverage = matchedTokens / queryTokens.length;
  score = score * 0.6 + coverage * 0.4;

  if (candLower.includes(qLower)) {
    score += 0.35;
  }

  return Math.min(1, score);
}

export async function generateEmbedding(text: string, signal?: AbortSignal): Promise<Float32Array | null> {
  const row = db
    .prepare("SELECT embedding_model FROM global_settings WHERE id = 'default'")
    .get() as { embedding_model?: string | null } | undefined;

  const modelId = row?.embedding_model?.trim();
  if (!modelId) return null;

  const resolved = backendRegistry.resolveModelId(modelId);
  if (!resolved) return null;

  const { backend, rawModelId } = resolved;
  const baseUrl = backend.baseUrl.replace(/\/+$/, "");
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (backend.apiKey) {
    headers["Authorization"] = `Bearer ${backend.apiKey}`;
  }

  try {
    // 1. Try OpenAI-compatible /v1/embeddings
    const v1Url = baseUrl.endsWith("/v1") ? `${baseUrl}/embeddings` : `${baseUrl}/v1/embeddings`;
    const res = await fetch(v1Url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: rawModelId,
        input: text.slice(0, 8000),
      }),
      signal: signal ?? AbortSignal.timeout(8000),
    });

    if (res.ok) {
      const data = (await res.json()) as any;
      const vec = data?.data?.[0]?.embedding;
      if (Array.isArray(vec) && vec.length > 0) {
        return new Float32Array(vec.map(Number));
      }
    }

    // 2. Fallback to Ollama /api/embed if backend is ollama
    if (backend.apiType === "ollama") {
      const ollamaBase = baseUrl.replace(/\/v1$/, "");
      const ollamaRes = await fetch(`${ollamaBase}/api/embed`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          model: rawModelId,
          input: text.slice(0, 8000),
        }),
        signal: signal ?? AbortSignal.timeout(8000),
      });
      if (ollamaRes.ok) {
        const data = (await ollamaRes.json()) as any;
        const vec = data?.embeddings?.[0] ?? data?.embedding;
        if (Array.isArray(vec) && vec.length > 0) {
          return new Float32Array(vec.map(Number));
        }
      }
    }
  } catch {
    // Gracefully fallback to lexical BM25 scoring when embedding endpoint is unavailable
  }

  return null;
}

// ---------------------------------------------------------------------------
// Layer 1: Ephemeral Conversation Scratchpad
// ---------------------------------------------------------------------------

function rowToScratchpadOut(row: ScratchpadEntryRow): ScratchpadEntryOut {
  return {
    conversationId: row.conversation_id,
    key: row.key,
    content: row.content,
    updatedAt: row.updated_at,
  };
}

export function getScratchpadEntries(conversationId: string): ScratchpadEntryOut[] {
  const rows = db
    .prepare<[string], ScratchpadEntryRow>(
      "SELECT * FROM conversation_scratchpad WHERE conversation_id = ? ORDER BY updated_at ASC"
    )
    .all(conversationId);
  return rows.map(rowToScratchpadOut);
}

export function getScratchpadEntry(conversationId: string, key: string): ScratchpadEntryOut | null {
  const row = db
    .prepare<[string, string], ScratchpadEntryRow>(
      "SELECT * FROM conversation_scratchpad WHERE conversation_id = ? AND key = ?"
    )
    .get(conversationId, key);
  return row ? rowToScratchpadOut(row) : null;
}

export function setScratchpadEntry(
  conversationId: string,
  key: string,
  content: string
): ScratchpadEntryOut {
  const cleanKey = key.trim() || "default";
  const now = Date.now();
  db.prepare(
    `INSERT INTO conversation_scratchpad (conversation_id, key, content, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(conversation_id, key) DO UPDATE SET
       content = excluded.content,
       updated_at = excluded.updated_at`
  ).run(conversationId, cleanKey, content, now);

  return {
    conversationId,
    key: cleanKey,
    content,
    updatedAt: now,
  };
}

export function deleteScratchpadEntry(conversationId: string, key: string): boolean {
  const res = db
    .prepare("DELETE FROM conversation_scratchpad WHERE conversation_id = ? AND key = ?")
    .run(conversationId, key.trim());
  return res.changes > 0;
}

export function clearScratchpad(conversationId: string): void {
  db.prepare("DELETE FROM conversation_scratchpad WHERE conversation_id = ?").run(conversationId);
}

// ---------------------------------------------------------------------------
// Layer 2: Persistent User Memory
// ---------------------------------------------------------------------------

function rowToMemoryOut(row: MemoryRow, score?: number): MemoryOut {
  let tags: string[] = [];
  try {
    const parsed = JSON.parse(row.tags || "[]");
    if (Array.isArray(parsed)) tags = parsed.map(String);
  } catch { }

  return {
    id: row.id,
    content: row.content,
    category: row.category || "general",
    tags,
    sourceConversationId: row.source_conversation_id ?? null,
    hasEmbedding: Boolean(row.embedding && row.embedding.byteLength > 0),
    isEnabled: Boolean(row.is_enabled),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(score !== undefined ? { score } : {}),
  };
}

export function listMemories(onlyEnabled = false): MemoryOut[] {
  const sql = onlyEnabled
    ? "SELECT * FROM memories WHERE is_enabled = 1 ORDER BY updated_at DESC"
    : "SELECT * FROM memories ORDER BY updated_at DESC";
  const rows = db.prepare<[], MemoryRow>(sql).all();
  return rows.map((r) => rowToMemoryOut(r));
}

export function getMemoryById(id: string): MemoryOut | null {
  const row = db.prepare<[string], MemoryRow>("SELECT * FROM memories WHERE id = ?").get(id);
  return row ? rowToMemoryOut(row) : null;
}

export async function createMemory(
  body: MemoryWriteBody,
  signal?: AbortSignal
): Promise<MemoryOut> {
  const id = randomUUID();
  const content = body.content.trim();
  const category = (body.category || "general").trim().toLowerCase();
  const tags = Array.isArray(body.tags) ? body.tags.map((t) => String(t).trim()).filter(Boolean) : [];
  const sourceConversationId = body.sourceConversationId ?? null;
  const isEnabled = body.isEnabled !== undefined ? (body.isEnabled ? 1 : 0) : 1;
  const now = Date.now();

  const embeddingVec = await generateEmbedding(`${category} ${tags.join(" ")}: ${content}`, signal);
  const embeddingBuf = embeddingVec ? float32ToBuffer(embeddingVec) : null;

  db.prepare(
    `INSERT INTO memories (id, content, category, tags, source_conversation_id, embedding, is_enabled, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    content,
    category,
    JSON.stringify(tags),
    sourceConversationId,
    embeddingBuf,
    isEnabled,
    now,
    now
  );

  return getMemoryById(id)!;
}

export async function updateMemory(
  id: string,
  patch: Partial<MemoryWriteBody>,
  signal?: AbortSignal
): Promise<MemoryOut | null> {
  const existing = db.prepare<[string], MemoryRow>("SELECT * FROM memories WHERE id = ?").get(id);
  if (!existing) return null;

  const content = patch.content !== undefined ? patch.content.trim() : existing.content;
  const category =
    patch.category !== undefined ? patch.category.trim().toLowerCase() : existing.category;
  let existingTags: string[] = [];
  try {
    existingTags = JSON.parse(existing.tags || "[]");
  } catch { }
  const tags =
    patch.tags !== undefined
      ? patch.tags.map((t) => String(t).trim()).filter(Boolean)
      : existingTags;
  const isEnabled =
    patch.isEnabled !== undefined ? (patch.isEnabled ? 1 : 0) : existing.is_enabled;
  const now = Date.now();

  let embeddingBuf = existing.embedding;
  if (patch.content !== undefined || patch.category !== undefined || patch.tags !== undefined) {
    const vec = await generateEmbedding(`${category} ${tags.join(" ")}: ${content}`, signal);
    if (vec) {
      embeddingBuf = float32ToBuffer(vec);
    }
  }

  db.prepare(
    `UPDATE memories
     SET content = ?, category = ?, tags = ?, embedding = ?, is_enabled = ?, updated_at = ?
     WHERE id = ?`
  ).run(content, category, JSON.stringify(tags), embeddingBuf, isEnabled, now, id);

  return getMemoryById(id);
}

export function deleteMemory(id: string): boolean {
  const res = db.prepare("DELETE FROM memories WHERE id = ?").run(id);
  return res.changes > 0;
}

export async function searchMemories(
  query: string,
  limit = 8,
  onlyEnabled = true,
  signal?: AbortSignal
): Promise<MemoryOut[]> {
  const sql = onlyEnabled
    ? "SELECT * FROM memories WHERE is_enabled = 1 ORDER BY updated_at DESC"
    : "SELECT * FROM memories ORDER BY updated_at DESC";
  const rows = db.prepare<[], MemoryRow>(sql).all();
  if (rows.length === 0) return [];

  const trimmedQuery = query.trim();
  if (!trimmedQuery) {
    return rows.slice(0, limit).map((r) => rowToMemoryOut(r, 1));
  }

  const queryVec = await generateEmbedding(trimmedQuery, signal);

  const scored = rows.map((row) => {
    const out = rowToMemoryOut(row);
    const lexical = computeLexicalScore(
      trimmedQuery,
      `${out.category} ${out.content}`,
      out.tags
    );

    let semantic = 0;
    let hasSemantic = false;
    if (queryVec && row.embedding) {
      const memVec = bufferToFloat32(row.embedding);
      if (memVec && memVec.length === queryVec.length) {
        semantic = Math.max(0, cosineSimilarity(queryVec, memVec));
        hasSemantic = true;
      }
    }

    const combinedScore = hasSemantic
      ? semantic * 0.65 + lexical * 0.35
      : lexical;

    return {
      out: { ...out, score: Number(combinedScore.toFixed(4)) },
      score: combinedScore,
      updatedAt: row.updated_at,
    };
  });

  return scored
    .filter((item) => item.score > 0.05)
    .sort((a, b) => b.score - a.score || b.updatedAt - a.updatedAt)
    .slice(0, limit)
    .map((item) => item.out);
}

// ---------------------------------------------------------------------------
// Layer 3: Cross-Chat Memory & Full-Text Conversation History Search
// ---------------------------------------------------------------------------

export interface ChatHistorySearchHit {
  conversationId: string;
  conversationTitle: string;
  isArchived: boolean;
  isPinned: boolean;
  messageId: string;
  role: string;
  snippet: string;
  createdAt: number;
  score: number;
}

export function stripInternalMessageTags(rawContent: string): string {
  return (rawContent || "")
    .replace(/<router_execution>[\s\S]*?<\/router_execution>/gi, "")
    .replace(/<tool_execution>[\s\S]*?<\/tool_execution>/gi, "")
    .replace(/<(?:think|thought|reason|reasoning)>[\s\S]*?<\/(?:think|thought|reason|reasoning)>/gi, "")
    .replace(/<artifact-card[^>]*>[\s\S]*?<\/artifact-card>/gi, "")
    .trim();
}

export function extractMatchSnippet(text: string, query: string, maxLen = 240): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= maxLen) return clean;

  const qLower = query.trim().toLowerCase();
  const tokens = tokenizeForSearch(qLower);
  const lowerClean = clean.toLowerCase();

  let matchIdx = lowerClean.indexOf(qLower);
  if (matchIdx === -1 && tokens.length > 0) {
    for (const tok of tokens) {
      matchIdx = lowerClean.indexOf(tok);
      if (matchIdx !== -1) break;
    }
  }

  if (matchIdx === -1) {
    return clean.slice(0, maxLen) + "...";
  }

  const start = Math.max(0, matchIdx - Math.floor(maxLen / 3));
  const end = Math.min(clean.length, start + maxLen);
  const prefix = start > 0 ? "..." : "";
  const suffix = end < clean.length ? "..." : "";
  return prefix + clean.slice(start, end).trim() + suffix;
}

export function searchChatHistory(opts: {
  query: string;
  excludeConversationId?: string | null;
  includeArchived?: boolean;
  limit?: number;
}): ChatHistorySearchHit[] {
  const {
    query,
    excludeConversationId = null,
    includeArchived = false,
    limit = 10,
  } = opts;

  const trimmedQuery = query.trim();
  if (!trimmedQuery) return [];

  const rows = db
    .prepare(
      `SELECT
         m.id AS message_id,
         m.conversation_id,
         m.role,
         m.content,
         m.created_at,
         c.title AS conversation_title,
         COALESCE(c.is_archived, 0) AS is_archived,
         COALESCE(c.is_pinned, 0) AS is_pinned
       FROM messages m
       JOIN conversations c ON c.id = m.conversation_id
       WHERE m.role IN ('user', 'assistant')
         AND (? IS NULL OR m.conversation_id != ?)
         AND (? = 1 OR COALESCE(c.is_archived, 0) = 0)
       ORDER BY m.created_at DESC
       LIMIT 1500`
    )
    .all(
      excludeConversationId,
      excludeConversationId,
      includeArchived ? 1 : 0
    ) as Array<{
      message_id: string;
      conversation_id: string;
      role: string;
      content: string;
      created_at: number;
      conversation_title: string;
      is_archived: number;
      is_pinned: number;
    }>;

  const hits: ChatHistorySearchHit[] = [];

  for (const row of rows) {
    const cleanText = stripInternalMessageTags(row.content);
    if (!cleanText && !row.conversation_title) continue;

    const contentScore = computeLexicalScore(trimmedQuery, cleanText);
    const titleScore = computeLexicalScore(trimmedQuery, row.conversation_title || "");
    const score = Math.max(contentScore, titleScore * 0.85, contentScore * 0.75 + titleScore * 0.25);

    if (score <= 0.1) continue;

    hits.push({
      conversationId: row.conversation_id,
      conversationTitle: row.conversation_title || "Untitled",
      isArchived: Boolean(row.is_archived),
      isPinned: Boolean(row.is_pinned),
      messageId: row.message_id,
      role: row.role,
      snippet: extractMatchSnippet(cleanText || row.conversation_title, trimmedQuery),
      createdAt: row.created_at,
      score: Number(score.toFixed(4)),
    });
  }

  return hits
    .sort((a, b) => b.score - a.score || b.createdAt - a.createdAt)
    .slice(0, limit);
}
