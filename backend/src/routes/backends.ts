import type { FastifyInstance } from "fastify";
import { backendRegistry } from "../registry.js";
import type { BackendInfo, ResolvedBackend } from "../types.js";

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

export async function backendsRoutes(app: FastifyInstance) {
  app.get("/api/backends", async () => {
    const backends = backendRegistry.getAll();
    const statuses = await Promise.all(backends.map(pingBackend));

    return backends.map((b, i): BackendInfo => ({
      id: b.id,
      name: b.name,
      prefix: b.prefix,
      baseUrl: b.baseUrl,
      hasApiKey: Boolean(b.apiKey),
      status: statuses[i],
    }));
  });
}
