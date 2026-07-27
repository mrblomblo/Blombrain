import db from "./db.js";
import type { BackendRow, ResolvedBackend, BackendWriteBody } from "./types.js";

function rowToResolved(row: BackendRow): ResolvedBackend {
  return {
    id: row.id,
    name: row.name,
    baseUrl: row.base_url,
    prefix: row.prefix,
    apiKey: row.api_key ?? undefined,
  };
}

/**
 * In-process registry backed by SQLite.
 * All reads go straight to SQLite (no in-memory cache needed -- better-sqlite3
 * is synchronous and fast enough for a single-user app).
 */
class BackendRegistry {
  getAll(): ResolvedBackend[] {
    const rows = db.prepare("SELECT * FROM backends ORDER BY rowid").all() as BackendRow[];
    return rows.map(rowToResolved);
  }

  getById(id: string): ResolvedBackend | undefined {
    const row = db.prepare("SELECT * FROM backends WHERE id = ?").get(id) as BackendRow | undefined;
    return row ? rowToResolved(row) : undefined;
  }

  getByPrefix(prefix: string): ResolvedBackend | undefined {
    const row = db
      .prepare("SELECT * FROM backends WHERE prefix = ?")
      .get(prefix) as BackendRow | undefined;
    return row ? rowToResolved(row) : undefined;
  }

  /** Splits a prefixed model id like "local:llama-3-8b" into backend + raw model id. */
  resolveModelId(prefixedId: string): { backend: ResolvedBackend; rawModelId: string } | undefined {
    const sepIndex = prefixedId.indexOf(":");
    if (sepIndex === -1) return undefined;
    const prefix = prefixedId.slice(0, sepIndex);
    const rawModelId = prefixedId.slice(sepIndex + 1);
    const backend = this.getByPrefix(prefix);
    if (!backend) return undefined;
    return { backend, rawModelId };
  }

  add(body: BackendWriteBody & { id: string }): ResolvedBackend {
    db.prepare(
      `INSERT INTO backends (id, name, base_url, prefix, api_key)
       VALUES (@id, @name, @baseUrl, @prefix, @apiKey)`,
    ).run({
      id: body.id,
      name: body.name,
      baseUrl: body.baseUrl.replace(/\/+$/, ""),
      prefix: body.prefix,
      apiKey: body.apiKey ?? null,
    });
    return this.getById(body.id)!;
  }

  update(id: string, body: BackendWriteBody): ResolvedBackend | undefined {
    const existing = this.getById(id);
    if (!existing) return undefined;
    db.prepare(
      `UPDATE backends
       SET name = @name, base_url = @baseUrl, prefix = @prefix, api_key = @apiKey
       WHERE id = @id`,
    ).run({
      id,
      name: body.name,
      baseUrl: body.baseUrl.replace(/\/+$/, ""),
      prefix: body.prefix,
      apiKey: body.apiKey ?? null,
    });
    return this.getById(id)!;
  }

  remove(id: string): boolean {
    const result = db.prepare("DELETE FROM backends WHERE id = ?").run(id);
    return result.changes > 0;
  }
}

export const backendRegistry = new BackendRegistry();
