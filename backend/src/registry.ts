import { loadBackendRegistry } from "./config.js";
import type { ResolvedBackend } from "./types.js";

/**
 * Step-2 scope: the registry is loaded once from config/backends.json at
 * startup and held in memory. Step 3 (persistence) will move this to
 * SQLite with a CRUD API + frontend editor, but the shape of ResolvedBackend
 * and the prefix-based lookup here are designed to stay the same.
 */
class BackendRegistry {
  private backends: ResolvedBackend[];

  constructor() {
    this.backends = loadBackendRegistry();
  }

  getAll(): ResolvedBackend[] {
    return this.backends;
  }

  getById(id: string): ResolvedBackend | undefined {
    return this.backends.find((b) => b.id === id);
  }

  getByPrefix(prefix: string): ResolvedBackend | undefined {
    return this.backends.find((b) => b.prefix === prefix);
  }

  /** Splits a prefixed model id like "local:llama-3-8b" into its backend + raw model id. */
  resolveModelId(prefixedId: string): { backend: ResolvedBackend; rawModelId: string } | undefined {
    const sepIndex = prefixedId.indexOf(":");
    if (sepIndex === -1) return undefined;
    const prefix = prefixedId.slice(0, sepIndex);
    const rawModelId = prefixedId.slice(sepIndex + 1);
    const backend = this.getByPrefix(prefix);
    if (!backend) return undefined;
    return { backend, rawModelId };
  }
}

export const backendRegistry = new BackendRegistry();
