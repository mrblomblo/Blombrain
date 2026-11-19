import fs from "node:fs";
import db from "./db.js";
import type { BackendRow, ResolvedBackend, BackendWriteBody, AttachmentRow } from "./types.js";

function rowToResolved(row: BackendRow): ResolvedBackend {
  return {
    id: row.id,
    name: row.name,
    baseUrl: row.base_url,
    prefix: row.prefix,
    apiKey: row.api_key ?? undefined,
    apiType: (row.api_type as "openai" | "ollama" | "lmstudio") ?? "openai",
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
      `INSERT INTO backends (id, name, base_url, prefix, api_key, api_type)
       VALUES (@id, @name, @baseUrl, @prefix, @apiKey, @apiType)`,
    ).run({
      id: body.id,
      name: body.name,
      baseUrl: body.baseUrl.replace(/\/+$/, ""),
      prefix: body.prefix,
      apiKey: body.apiKey ?? null,
      apiType: body.apiType ?? "openai",
    });
    return this.getById(body.id)!;
  }

  update(id: string, body: BackendWriteBody): ResolvedBackend | undefined {
    const existing = this.getById(id);
    if (!existing) return undefined;

    const nextApiKey =
      body.apiKey === undefined
        ? (existing.apiKey ?? null)
        : body.apiKey === ""
          ? null
          : body.apiKey;

    const oldPrefix = `${existing.prefix}:`;
    const newPrefix = `${body.prefix}:`;

    const tx = db.transaction(() => {
      db.prepare(
        `UPDATE backends
         SET name = @name, base_url = @baseUrl, prefix = @prefix, api_key = @apiKey, api_type = @apiType
         WHERE id = @id`,
      ).run({
        id,
        name: body.name,
        baseUrl: body.baseUrl.replace(/\/+$/, ""),
        prefix: body.prefix,
        apiKey: nextApiKey,
        apiType: body.apiType ?? existing.apiType ?? "openai",
      });

      if (existing.prefix !== body.prefix) {
        // Migrate cached_models, model_settings, presets, and conversation model references to the new prefix
        db.prepare(
          `UPDATE cached_models SET id = ? || SUBSTR(id, ?) WHERE backend_id = ? AND id LIKE ?`
        ).run(newPrefix, oldPrefix.length + 1, id, `${oldPrefix}%`);

        db.prepare(
          `UPDATE model_settings SET id = ? || SUBSTR(id, ?), base_model_id = CASE WHEN base_model_id LIKE ? THEN ? || SUBSTR(base_model_id, ?) ELSE base_model_id END WHERE is_preset = 0 AND id LIKE ?`
        ).run(newPrefix, oldPrefix.length + 1, `${oldPrefix}%`, newPrefix, oldPrefix.length + 1, `${oldPrefix}%`);

        db.prepare(
          `UPDATE model_settings SET base_model_id = ? || SUBSTR(base_model_id, ?) WHERE is_preset = 1 AND base_model_id LIKE ?`
        ).run(newPrefix, oldPrefix.length + 1, `${oldPrefix}%`);

        db.prepare(
          `UPDATE conversations SET model = ? || SUBSTR(model, ?) WHERE model LIKE ?`
        ).run(newPrefix, oldPrefix.length + 1, `${oldPrefix}%`);

        db.prepare(
          `UPDATE messages SET model = ? || SUBSTR(model, ?) WHERE model LIKE ?`
        ).run(newPrefix, oldPrefix.length + 1, `${oldPrefix}%`);

        db.prepare(
          `UPDATE global_settings SET auto_name_model = ? || SUBSTR(auto_name_model, ?) WHERE auto_name_model LIKE ?`
        ).run(newPrefix, oldPrefix.length + 1, `${oldPrefix}%`);

        db.prepare(
          `UPDATE global_settings SET tool_routing_model = ? || SUBSTR(tool_routing_model, ?) WHERE tool_routing_model LIKE ?`
        ).run(newPrefix, oldPrefix.length + 1, `${oldPrefix}%`);
      }
    });

    tx();
    return this.getById(id)!;
  }

  remove(id: string): boolean {
    const existing = this.getById(id);
    if (!existing) return false;

    const prefixPattern = `${existing.prefix}:%`;
    // Collect any custom icons used by non-preset model_settings for this backend before deleting them
    const iconRows = db
      .prepare("SELECT icon FROM model_settings WHERE is_preset = 0 AND id LIKE ? AND icon IS NOT NULL")
      .all(prefixPattern) as Array<{ icon: string }>;

    const tx = db.transaction(() => {
      db.prepare("DELETE FROM model_settings WHERE is_preset = 0 AND id LIKE ?").run(prefixPattern);
      const result = db.prepare("DELETE FROM backends WHERE id = ?").run(id);
      return result.changes > 0;
    });

    const removed = tx();

    for (const { icon } of iconRows) {
      if (icon && icon.startsWith("/api/uploads/")) {
        const attachId = decodeURIComponent(icon.replace("/api/uploads/", ""));
        const stillUsed =
          db.prepare("SELECT 1 FROM model_settings WHERE icon = ?").get(icon) ||
          db.prepare("SELECT 1 FROM global_settings WHERE user_avatar = ?").get(icon);
        if (!stillUsed) {
          const att = db.prepare("SELECT * FROM attachments WHERE id = ? AND message_id IS NULL").get(attachId) as AttachmentRow | undefined;
          if (att) {
            try {
              if (fs.existsSync(att.disk_path)) fs.unlinkSync(att.disk_path);
            } catch { }
            db.prepare("DELETE FROM attachments WHERE id = ?").run(attachId);
          }
        }
      }
    }

    return removed;
  }
}

export const backendRegistry = new BackendRegistry();
