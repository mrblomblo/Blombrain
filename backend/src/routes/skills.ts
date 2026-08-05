import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { pipeline } from "node:stream/promises";
import { DATA_DIR } from "../db.js";
import {
  getAllSkills,
  getSkillById,
  upsertSkill,
  deleteSkill,
  importSkillFromDirectory,
  finalizeUploadedSkillFolder,
} from "../services/skills.js";
import type { SkillWriteBody } from "../types.js";

export async function skillRoutes(app: FastifyInstance) {
  app.get("/api/skills", async (_req: FastifyRequest, reply: FastifyReply) => {
    const skills = getAllSkills();
    return reply.send(skills);
  });

  app.post("/api/skills/upload", async (req: FastifyRequest, reply: FastifyReply) => {
    const parts = req.files();
    const id = crypto.randomUUID();
    const destDir = path.join(DATA_DIR, "skills", id);

    let fileCount = 0;
    try {
      for await (const part of parts) {
        if (part.type !== "file") continue;

        let relPath = part.filename.replace(/\\/g, "/").replace(/^\/+/, "");
        if (!relPath) continue;

        const targetFilePath = path.join(destDir, relPath);
        if (!path.resolve(targetFilePath).startsWith(path.resolve(destDir))) {
          continue;
        }

        fs.mkdirSync(path.dirname(targetFilePath), { recursive: true });
        await pipeline(part.file, fs.createWriteStream(targetFilePath));
        fileCount++;
      }
    } catch (err: any) {
      fs.rmSync(destDir, { recursive: true, force: true });
      return reply.code(500).send({ error: { message: `Upload failed: ${err?.message || String(err)}` } });
    }

    if (fileCount === 0) {
      fs.rmSync(destDir, { recursive: true, force: true });
      return reply.code(400).send({ error: { message: "No files received in upload." } });
    }

    try {
      const skill = finalizeUploadedSkillFolder(id, destDir);
      return reply.send(skill);
    } catch (err: any) {
      return reply.code(400).send({ error: { message: err?.message || String(err) } });
    }
  });

  app.post("/api/skills/import", async (req: FastifyRequest, reply: FastifyReply) => {
    const { dirPath, sourcePath } = (req.body ?? {}) as { dirPath?: string; sourcePath?: string };
    const targetPath = dirPath || sourcePath;
    if (!targetPath) {
      return reply.code(400).send({ error: { message: "dirPath is required" } });
    }
    try {
      const imported = importSkillFromDirectory(targetPath);
      return reply.send(imported);
    } catch (err: any) {
      return reply.code(400).send({ error: { message: err?.message || String(err) } });
    }
  });

  app.get("/api/skills/:id", async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };
    const skill = getSkillById(id);
    if (!skill) return reply.code(404).send({ error: { message: "Skill not found" } });
    return reply.send(skill);
  });

  app.post("/api/skills", async (req: FastifyRequest, reply: FastifyReply) => {
    const body = req.body as SkillWriteBody;
    if (!body.name || !body.description || !body.instructions) {
      return reply.code(400).send({ error: { message: "name, description, and instructions are required" } });
    }
    const created = upsertSkill(body);
    return reply.send(created);
  });

  app.put("/api/skills/:id", async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };
    const body = req.body as SkillWriteBody;
    const updated = upsertSkill({ ...body, id });
    return reply.send(updated);
  });

  app.delete("/api/skills/:id", async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };
    const success = deleteSkill(id);
    return reply.send({ success });
  });
}
