import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import crypto from "node:crypto";
import db from "../db.js";
import type { PromptTemplateOut, PromptTemplateRow } from "../types.js";

function rowToTemplate(row: PromptTemplateRow): PromptTemplateOut {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? "",
    content: row.content,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function normalizeTemplateName(raw: string): string {
  return raw
    .trim()
    .replace(/^\/+/, "")
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function getAllPromptTemplates(): PromptTemplateOut[] {
  const rows = db
    .prepare<[], PromptTemplateRow>(
      "SELECT * FROM prompt_templates ORDER BY LOWER(name) ASC, created_at ASC"
    )
    .all();
  return rows.map(rowToTemplate);
}

export async function promptTemplatesRoutes(app: FastifyInstance) {
  /** GET /api/prompt-templates -- list all reusable slash prompt templates. */
  app.get("/api/prompt-templates", async () => {
    return getAllPromptTemplates();
  });

  /** POST /api/prompt-templates -- create a new reusable slash prompt template. */
  app.post("/api/prompt-templates", async (req: FastifyRequest, reply: FastifyReply) => {
    const body = (req.body ?? {}) as {
      name?: string;
      description?: string;
      content?: string;
    };
    const name = typeof body.name === "string" ? normalizeTemplateName(body.name) : "";
    if (!name) {
      return reply
        .code(400)
        .send({ error: { message: "Template command name is required (letters, numbers, hyphens, underscores)." } });
    }
    const content = typeof body.content === "string" ? body.content.trim() : "";
    if (!content) {
      return reply.code(400).send({ error: { message: "Template content is required." } });
    }
    const description = typeof body.description === "string" ? body.description.trim() : "";

    const existing = db
      .prepare<[string], { id: string }>(
        "SELECT id FROM prompt_templates WHERE LOWER(name) = LOWER(?)"
      )
      .get(name);
    if (existing) {
      return reply
        .code(409)
        .send({ error: { message: `A prompt template named '/${name}' already exists.` } });
    }

    const now = Date.now();
    const id = crypto.randomUUID();
    db.prepare(
      `INSERT INTO prompt_templates (id, name, description, content, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(id, name, description, content, now, now);

    const row = db
      .prepare<[string], PromptTemplateRow>("SELECT * FROM prompt_templates WHERE id = ?")
      .get(id)!;
    return reply.code(201).send(rowToTemplate(row));
  });

  /** PUT /api/prompt-templates/:id -- update an existing prompt template. */
  app.put("/api/prompt-templates/:id", async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };
    const existing = db
      .prepare<[string], PromptTemplateRow>("SELECT * FROM prompt_templates WHERE id = ?")
      .get(id);
    if (!existing) {
      return reply.code(404).send({ error: { message: `Prompt template "${id}" not found.` } });
    }

    const body = (req.body ?? {}) as {
      name?: string;
      description?: string;
      content?: string;
    };
    const nextName =
      body.name !== undefined ? normalizeTemplateName(body.name) : existing.name;
    if (!nextName) {
      return reply.code(400).send({ error: { message: "Template name cannot be empty." } });
    }
    const nextContent =
      body.content !== undefined ? body.content.trim() : existing.content;
    if (!nextContent) {
      return reply.code(400).send({ error: { message: "Template content cannot be empty." } });
    }
    const nextDesc =
      body.description !== undefined ? body.description.trim() : existing.description;

    const collision = db
      .prepare<[string, string], { id: string }>(
        "SELECT id FROM prompt_templates WHERE LOWER(name) = LOWER(?) AND id != ?"
      )
      .get(nextName, id);
    if (collision) {
      return reply
        .code(409)
        .send({ error: { message: `A prompt template named '/${nextName}' already exists.` } });
    }

    const now = Date.now();
    db.prepare(
      `UPDATE prompt_templates
       SET name = ?, description = ?, content = ?, updated_at = ?
       WHERE id = ?`
    ).run(nextName, nextDesc, nextContent, now, id);

    const updated = db
      .prepare<[string], PromptTemplateRow>("SELECT * FROM prompt_templates WHERE id = ?")
      .get(id)!;
    return rowToTemplate(updated);
  });

  /** DELETE /api/prompt-templates/:id -- delete a prompt template. */
  app.delete("/api/prompt-templates/:id", async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };
    const existing = db
      .prepare<[string], PromptTemplateRow>("SELECT * FROM prompt_templates WHERE id = ?")
      .get(id);
    if (!existing) {
      return reply.code(404).send({ error: { message: `Prompt template "${id}" not found.` } });
    }
    db.prepare("DELETE FROM prompt_templates WHERE id = ?").run(id);
    return reply.code(204).send();
  });
}
