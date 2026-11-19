import { backendRegistry } from "../registry.js";
import type { BackendInfo, ResolvedBackend } from "../types.js";
import db from "../db.js";

interface FetchedRawModel {
  id: string; // prefixed id, e.g. local:llama-3
  rawId: string; // raw id, e.g. llama-3
}

const backendStatusMap = new Map<string, BackendInfo["status"]>();

export function getBackendStatus(backendId: string): BackendInfo["status"] {
  return backendStatusMap.get(backendId) ?? "unknown";
}

export function clearBackendStatus(backendId: string): void {
  backendStatusMap.delete(backendId);
}

async function fetchRawModelsForBackend(backend: ResolvedBackend): Promise<FetchedRawModel[] | null> {
  const headers = backend.apiKey ? { Authorization: `Bearer ${backend.apiKey}` } : undefined;

  // 1. Try OpenAI-compatible /v1/models endpoint
  try {
    const res = await fetch(`${backend.baseUrl}/v1/models`, {
      signal: AbortSignal.timeout(3000),
      headers,
    });
    if (res.ok) {
      const body = (await res.json()) as { data?: Array<{ id: string }> } | Array<{ id: string }>;
      const rawModels: Array<{ id: string }> = Array.isArray(body) ? body : (body?.data ?? []);

      return rawModels
        .filter((m) => typeof m?.id === "string")
        .filter((m) => {
          if (backend.apiType === "lmstudio" && /:\d+$/.test(m.id)) {
            return false;
          }
          return true;
        })
        .map((m) => ({
          id: `${backend.prefix}:${m.id}`,
          rawId: m.id,
        }));
    }
  } catch {
    // Fall through to protocol-specific fallback if applicable
  }

  // 2. Fallback for Ollama native endpoint (/api/tags)
  if (backend.apiType === "ollama") {
    try {
      const res = await fetch(`${backend.baseUrl}/api/tags`, {
        signal: AbortSignal.timeout(3000),
        headers,
      });
      if (res.ok) {
        const body = (await res.json()) as { models?: Array<{ name?: string; model?: string }> };
        const rawModels = Array.isArray(body?.models) ? body.models : [];
        return rawModels
          .map((m) => m?.model || m?.name)
          .filter((id): id is string => typeof id === "string" && id.length > 0)
          .map((rawId) => ({
            id: `${backend.prefix}:${rawId}`,
            rawId,
          }));
      }
    } catch {
      return null;
    }
  }

  return null;
}

export async function syncSingleBackend(backend: ResolvedBackend): Promise<"online" | "offline"> {
  const now = Date.now();
  const fetched = await fetchRawModelsForBackend(backend);

  if (fetched === null) {
    backendStatusMap.set(backend.id, "offline");
    db.prepare("UPDATE cached_models SET is_online = 0 WHERE backend_id = ?").run(backend.id);
    return "offline";
  }

  backendStatusMap.set(backend.id, "online");
  const fetchedIds = new Set(fetched.map((f) => f.id));

  const upsertStmt = db.prepare(`
    INSERT INTO cached_models (id, backend_id, raw_id, is_online, last_synced)
    VALUES (?, ?, ?, 1, ?)
    ON CONFLICT(id) DO UPDATE SET
      backend_id = excluded.backend_id,
      raw_id = excluded.raw_id,
      is_online = 1,
      last_synced = excluded.last_synced
  `);

  const transaction = db.transaction(() => {
    for (const item of fetched) {
      upsertStmt.run(item.id, backend.id, item.rawId, now);
    }

    // Delete models for this backend that no longer exist on the remote host
    const existingRows = db
      .prepare("SELECT id FROM cached_models WHERE backend_id = ?")
      .all(backend.id) as Array<{ id: string }>;

    const deleteStmt = db.prepare("DELETE FROM cached_models WHERE id = ?");
    for (const row of existingRows) {
      if (!fetchedIds.has(row.id)) {
        deleteStmt.run(row.id);
      }
    }
  });

  transaction();
  return "online";
}

export async function syncModels(): Promise<void> {
  const backends = backendRegistry.getAll();
  await Promise.all(backends.map((backend) => syncSingleBackend(backend)));
}

let syncTimer: NodeJS.Timeout | null = null;
const SYNC_INTERVAL_MS = 10_000;

export function initModelSync(): void {
  // Run an initial sync immediately (non-blocking for startup)
  syncModels().catch((err) => console.error("[blombrain] Initial model sync failed:", err));

  if (syncTimer) clearInterval(syncTimer);
  syncTimer = setInterval(() => {
    syncModels().catch((err) => console.error("[blombrain] Background model sync failed:", err));
  }, SYNC_INTERVAL_MS);
}

export async function forceSync(): Promise<void> {
  if (syncTimer) clearInterval(syncTimer);
  await syncModels();
  syncTimer = setInterval(() => {
    syncModels().catch((err) => console.error("[blombrain] Background model sync failed:", err));
  }, SYNC_INTERVAL_MS);
}
