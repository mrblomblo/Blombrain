import type { FastifyInstance } from "fastify";
import { backendRegistry } from "../registry.js";
import type { ModelInfo, ResolvedBackend } from "../types.js";

async function fetchModelsForBackend(backend: ResolvedBackend): Promise<ModelInfo[]> {
  try {
    const res = await fetch(`${backend.baseUrl}/v1/models`, {
      signal: AbortSignal.timeout(3000),
      headers: backend.apiKey ? { Authorization: `Bearer ${backend.apiKey}` } : undefined,
    });
    if (!res.ok) return [];

    const body = (await res.json()) as { data?: Array<{ id: string }> } | Array<{ id: string }>;
    const rawModels: Array<{ id: string }> = Array.isArray(body) ? body : (body?.data ?? []);

    return rawModels
      .filter((m) => typeof m?.id === "string")
      .map((m) => ({
        id: `${backend.prefix}:${m.id}`,
        rawId: m.id,
        backendId: backend.id,
        backendName: backend.name,
      }));
  } catch {
    // A single offline/misconfigured backend shouldn't take down the whole
    // aggregated list -- just report zero models for it.
    return [];
  }
}

export async function modelsRoutes(app: FastifyInstance) {
  app.get("/api/models", async () => {
    const results = await Promise.all(backendRegistry.getAll().map(fetchModelsForBackend));
    return results.flat();
  });
}
