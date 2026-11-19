import type { FastifyInstance } from "fastify";
import {
  listMemories,
  createMemory,
  updateMemory,
  deleteMemory,
  searchMemories,
  getScratchpadEntries,
  setScratchpadEntry,
  deleteScratchpadEntry,
  clearScratchpad,
} from "../services/memory.js";
import db from "../db.js";
import type { MemoryWriteBody } from "../types.js";

export async function memoriesRoutes(app: FastifyInstance) {
  // GET /api/memories?q=...
  app.get<{ Querystring: { q?: string } }>("/api/memories", async (req, reply) => {
    const q = req.query.q?.trim();
    if (q) {
      const results = await searchMemories(q, 50, false);
      return reply.send(results);
    }
    return reply.send(listMemories(false));
  });

  // POST /api/memories
  app.post<{ Body: MemoryWriteBody }>("/api/memories", async (req, reply) => {
    const body = req.body;
    if (!body || typeof body.content !== "string" || !body.content.trim()) {
      return reply.status(400).send({ error: "Memory content is required." });
    }
    const created = await createMemory(body);
    return reply.status(201).send(created);
  });

  // PUT /api/memories/:id
  app.put<{ Params: { id: string }; Body: Partial<MemoryWriteBody> }>(
    "/api/memories/:id",
    async (req, reply) => {
      const { id } = req.params;
      const updated = await updateMemory(id, req.body || {});
      if (!updated) {
        return reply.status(404).send({ error: "Memory not found." });
      }
      return reply.send(updated);
    }
  );

  // DELETE /api/memories/:id
  app.delete<{ Params: { id: string } }>("/api/memories/:id", async (req, reply) => {
    const deleted = deleteMemory(req.params.id);
    if (!deleted) {
      return reply.status(404).send({ error: "Memory not found." });
    }
    return reply.send({ success: true });
  });

  // DELETE /api/memories (clear all)
  app.delete("/api/memories", async (_req, reply) => {
    db.prepare("DELETE FROM memories").run();
    return reply.send({ success: true });
  });

  // GET /api/conversations/:id/scratchpad
  app.get<{ Params: { id: string } }>("/api/conversations/:id/scratchpad", async (req, reply) => {
    return reply.send(getScratchpadEntries(req.params.id));
  });

  // PUT /api/conversations/:id/scratchpad
  app.put<{ Params: { id: string }; Body: { key: string; content: string } }>(
    "/api/conversations/:id/scratchpad",
    async (req, reply) => {
      const { id } = req.params;
      const { key, content } = req.body || {};
      if (!key || typeof key !== "string") {
        return reply.status(400).send({ error: "Scratchpad key is required." });
      }
      if (!content || !content.trim()) {
        deleteScratchpadEntry(id, key);
        return reply.send(getScratchpadEntries(id));
      }
      setScratchpadEntry(id, key, content);
      return reply.send(getScratchpadEntries(id));
    }
  );

  // DELETE /api/conversations/:id/scratchpad/:key
  app.delete<{ Params: { id: string; key: string } }>(
    "/api/conversations/:id/scratchpad/:key",
    async (req, reply) => {
      const { id, key } = req.params;
      if (key === "*") {
        clearScratchpad(id);
      } else {
        deleteScratchpadEntry(id, key);
      }
      return reply.send(getScratchpadEntries(id));
    }
  );
}
