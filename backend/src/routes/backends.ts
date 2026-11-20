import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { backendRegistry } from "../registry.js";
import type { BackendInfo, BackendWriteBody, ResolvedBackend } from "../types.js";
import { getAllAdaptersInfo } from "../adapters/index.js";
import {
  getBackendStatus,
  syncSingleBackend,
  clearBackendStatus,
} from "../services/modelSync.js";
import { backendProcessManager } from "../services/backendProcesses.js";

function toBackendInfo(b: ResolvedBackend, status: BackendInfo["status"] = "unknown"): BackendInfo {
  return {
    id: b.id,
    name: b.name,
    prefix: b.prefix,
    baseUrl: b.baseUrl,
    hasApiKey: Boolean(b.apiKey),
    status,
    apiType: b.apiType ?? "openai",
    isEnabled: b.isEnabled,
    launchCommand: b.launchCommand,
    launchCwd: b.launchCwd,
    process: b.launchCommand ? backendProcessManager.getInfo(b.id) : null,
  };
}

type LifecycleSnapshot = Pick<ResolvedBackend, "isEnabled" | "launchCommand" | "launchCwd">;

/**
 * Brings the managed launch command in line with a backend's new configuration:
 * disabling (or removing the command) stops it, enabling starts it, and changing the
 * command or working directory restarts a running process.
 */
async function applyLifecycle(before: LifecycleSnapshot, after: ResolvedBackend): Promise<void> {
  try {
    if (!after.isEnabled || !after.launchCommand) {
      await backendProcessManager.stop(after.id);
      return;
    }
    const justEnabled = !before.isEnabled;
    const commandAdded = !before.launchCommand;
    const specChanged =
      before.launchCommand !== after.launchCommand || before.launchCwd !== after.launchCwd;

    if (justEnabled || commandAdded) {
      await backendProcessManager.start(after.id);
    } else if (specChanged && backendProcessManager.isRunning(after.id)) {
      await backendProcessManager.restart(after.id);
    }
  } catch (err) {
    console.error(`[backends] lifecycle update failed for "${after.id}":`, err);
  }
}

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

export async function backendsRoutes(app: FastifyInstance) {
  /** GET /api/backends/protocols -- list supported API adapter protocols. */
  app.get("/api/backends/protocols", async () => {
    return getAllAdaptersInfo();
  });

  /** GET /api/backends -- list all backends using cached sync status (or ping if not yet synced). */
  app.get("/api/backends", async (req: FastifyRequest) => {
    const backends = backendRegistry.getAll();
    const forceLive = (req.query as { refresh?: string } | undefined)?.refresh === "1";
    const statuses = await Promise.all(
      backends.map(async (b): Promise<BackendInfo["status"]> => {
        if (!b.isEnabled) return "disabled";
        const cached = getBackendStatus(b.id);
        if (!forceLive && cached !== "unknown" && cached !== "disabled") {
          return cached;
        }
        return syncSingleBackend(b);
      })
    );
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
      await applyLifecycle({ isEnabled: false, launchCommand: null, launchCwd: null }, created);
      const status = await syncSingleBackend(created);
      return reply.code(201).send(toBackendInfo(created, status));
    } catch (err) {
      return reply
        .code(500)
        .send({ error: { message: errorMessage(err, "Failed to create backend.") } });
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

    const before = backendRegistry.getById(id);
    const updated = backendRegistry.update(id, body);
    if (!before || !updated) {
      return reply.code(404).send({ error: { message: `Backend "${id}" not found.` } });
    }
    await applyLifecycle(before, updated);
    const status = await syncSingleBackend(updated);
    return toBackendInfo(updated, status);
  });

  /** POST /api/backends/:id/enabled -- enable or disable a backend (starts / stops its launch command). */
  app.post("/api/backends/:id/enabled", async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };
    const enabled = (req.body as { enabled?: unknown } | undefined)?.enabled;
    if (typeof enabled !== "boolean") {
      return reply.code(400).send({ error: { message: 'Request body must include a boolean "enabled".' } });
    }
    const before = backendRegistry.getById(id);
    if (!before) {
      return reply.code(404).send({ error: { message: `Backend "${id}" not found.` } });
    }
    const updated = backendRegistry.setEnabled(id, enabled)!;
    await applyLifecycle(before, updated);
    const status = await syncSingleBackend(updated);
    return toBackendInfo(updated, status);
  });

  /** POST /api/backends/:id/process/:action -- manually start, stop, or restart the launch command. */
  app.post("/api/backends/:id/process/:action", async (req: FastifyRequest, reply: FastifyReply) => {
    const { id, action } = req.params as { id: string; action: string };
    if (action !== "start" && action !== "stop" && action !== "restart") {
      return reply.code(400).send({ error: { message: `Unknown action "${action}".` } });
    }
    const backend = backendRegistry.getById(id);
    if (!backend) {
      return reply.code(404).send({ error: { message: `Backend "${id}" not found.` } });
    }
    try {
      if (action === "stop") await backendProcessManager.stop(id);
      else if (action === "start") await backendProcessManager.start(id);
      else await backendProcessManager.restart(id);
    } catch (err) {
      return reply.code(409).send({ error: { message: errorMessage(err, `Failed to ${action} process.`) } });
    }
    return toBackendInfo(backend, getBackendStatus(id));
  });

  /** GET /api/backends/:id/logs -- recent output of the launch command. */
  app.get("/api/backends/:id/logs", async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };
    if (!backendRegistry.getById(id)) {
      return reply.code(404).send({ error: { message: `Backend "${id}" not found.` } });
    }
    return { lines: backendProcessManager.getLogs(id) };
  });

  /** DELETE /api/backends/:id -- remove a backend (stopping its launch command first). */
  app.delete("/api/backends/:id", async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };
    await backendProcessManager.stop(id);
    const removed = backendRegistry.remove(id);
    if (!removed) {
      return reply.code(404).send({ error: { message: `Backend "${id}" not found.` } });
    }
    clearBackendStatus(id);
    return reply.code(204).send();
  });
}
