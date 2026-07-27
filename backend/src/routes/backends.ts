import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { backendRegistry } from "../registry.js";
import type { BackendInfo, BackendWriteBody, ResolvedBackend } from "../types.js";

async function pingBackend(backend: ResolvedBackend): Promise<BackendInfo["status"]> {
  try {
    const res = await fetch(`${backend.baseUrl}/v1/models`, {
      signal: AbortSignal.timeout(2000),
      headers: backend.apiKey ? { Authorization: `Bearer ${backend.apiKey}` } : undefined,
    });
    return res.ok ? "online" : "offline";
  } catch {
    return "offline";
  }
}

function toBackendInfo(b: ResolvedBackend, status: BackendInfo["status"] = "unknown"): BackendInfo {
  return {
    id: b.id,
    name: b.name,
    prefix: b.prefix,
    baseUrl: b.baseUrl,
    hasApiKey: Boolean(b.apiKey),
    status,
  };
}

export async function backendsRoutes(app: FastifyInstance) {
  /** GET /api/backends -- list all backends with live status ping. */
  app.get("/api/backends", async () => {
    const backends = backendRegistry.getAll();
    const statuses = await Promise.all(backends.map(pingBackend));
    return backends.map((b, i) => toBackendInfo(b, statuses[i]));
  });

  /** POST /api/backends -- create a new backend. */
  app.post("/api/backends", async (req: FastifyRequest, reply: FastifyReply) => {
    const body = req.body as BackendWriteBody;

    if (!body?.id || !body.name || !body.baseUrl || !body.prefix) {
      return reply
        .code(400)
        .send({ error: { message: "Request body must include id, name, baseUrl, and prefix." } });
    }

    if (backendRegistry.getById(body.id)) {
      return reply.code(409).send({ error: { message: `A backend with id "${body.id}" already exists.` } });
    }
    if (backendRegistry.getByPrefix(body.prefix)) {
      return reply
        .code(409)
        .send({ error: { message: `A backend with prefix "${body.prefix}" already exists.` } });
    }

    try {
      const created = backendRegistry.add(body as BackendWriteBody & { id: string });
      const status = await pingBackend(created);
      return reply.code(201).send(toBackendInfo(created, status));
    } catch (err) {
      return reply
        .code(500)
        .send({ error: { message: err instanceof Error ? err.message : "Failed to create backend." } });
    }
  });

  /** PUT /api/backends/:id -- full replace of an existing backend. */
  app.put("/api/backends/:id", async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };
    const body = req.body as BackendWriteBody;

    if (!body?.name || !body.baseUrl || !body.prefix) {
      return reply
        .code(400)
        .send({ error: { message: "Request body must include name, baseUrl, and prefix." } });
    }

    // Check prefix uniqueness -- allow keeping the same prefix.
    const byPrefix = backendRegistry.getByPrefix(body.prefix);
    if (byPrefix && byPrefix.id !== id) {
      return reply
        .code(409)
        .send({ error: { message: `Prefix "${body.prefix}" is already used by backend "${byPrefix.id}".` } });
    }

    const updated = backendRegistry.update(id, body);
    if (!updated) {
      return reply.code(404).send({ error: { message: `Backend "${id}" not found.` } });
    }
    const status = await pingBackend(updated);
    return toBackendInfo(updated, status);
  });

  /** DELETE /api/backends/:id -- remove a backend. */
  app.delete("/api/backends/:id", async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };
    const removed = backendRegistry.remove(id);
    if (!removed) {
      return reply.code(404).send({ error: { message: `Backend "${id}" not found.` } });
    }
    return reply.code(204).send();
  });
}
