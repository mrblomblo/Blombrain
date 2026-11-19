import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import db, { DATA_DIR } from "../db.js";
import type { SkillRow, SkillOut, SkillWriteBody } from "../types.js";

export function computeContentHash(content: string): string {
  return crypto.createHash("sha256").update(content, "utf-8").digest("hex");
}

export function parseSkillMarkdown(markdown: string): { name: string; description: string; instructions: string } {
  let name = "";
  let description = "";
  let instructions = markdown;

  if (markdown.startsWith("---")) {
    const parts = markdown.split("---");
    if (parts.length >= 3) {
      const frontmatter = parts[1];
      instructions = parts.slice(2).join("---").trim();
      for (const line of frontmatter.split("\n")) {
        const colonIndex = line.indexOf(":");
        if (colonIndex !== -1) {
          const key = line.slice(0, colonIndex).trim();
          const val = line.slice(colonIndex + 1).trim().replace(/^['"]|['"]$/g, "");
          if (key === "name") name = val;
          if (key === "description") description = val;
        }
      }
    }
  }

  return { name, description, instructions };
}

/**
 * Locates the `scripts/` directory for a skill, checking:
 * 1. `path.join(skillDirPath, "scripts")`
 * 2. If `skillDirPath` is inside `DATA_DIR/skills/<id>/...`, the top-level `DATA_DIR/skills/<id>/scripts`
 * 3. Any immediate subdirectory containing a `scripts/` folder
 */
export function resolveSkillScriptsDir(skillDirPath: string | null): string | null {
  if (!skillDirPath || !fs.existsSync(skillDirPath)) return null;

  const directScripts = path.join(skillDirPath, "scripts");
  if (fs.existsSync(directScripts) && fs.statSync(directScripts).isDirectory()) {
    return directScripts;
  }

  const managedSkillsRoot = path.resolve(DATA_DIR, "skills");
  const resolvedSkillDir = path.resolve(skillDirPath);
  if (resolvedSkillDir.startsWith(managedSkillsRoot + path.sep)) {
    const rel = path.relative(managedSkillsRoot, resolvedSkillDir);
    const skillRootId = rel.split(path.sep)[0];
    if (skillRootId) {
      const rootScripts = path.join(managedSkillsRoot, skillRootId, "scripts");
      if (fs.existsSync(rootScripts) && fs.statSync(rootScripts).isDirectory()) {
        return rootScripts;
      }
    }
  }

  try {
    const entries = fs.readdirSync(skillDirPath, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() && !entry.name.startsWith(".")) {
        const nestedScripts = path.join(skillDirPath, entry.name, "scripts");
        if (fs.existsSync(nestedScripts) && fs.statSync(nestedScripts).isDirectory()) {
          return nestedScripts;
        }
      }
    }
  } catch { }

  return null;
}

/**
 * Scans a skill's directory for executable scripts.
 * - Scans the resolved `scripts/` subdirectory.
 * - Ignores hidden files, directories, and symlinks.
 * - Restricts to known extensions: .sh, .py, .js, .mjs, .cjs
 * - Returns an array of relative filenames.
 */
export function getSkillScripts(skillDirPath: string | null): string[] {
  const scriptsDir = resolveSkillScriptsDir(skillDirPath);
  if (!scriptsDir) return [];

  const allowedExtensions = new Set([".sh", ".py", ".js", ".mjs", ".cjs"]);
  const results: string[] = [];

  try {
    const entries = fs.readdirSync(scriptsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue; // Ignore hidden files
      if (!entry.isFile()) continue; // Ignore directories, block devices, etc.

      const fullPath = path.join(scriptsDir, entry.name);

      // Reject symlinks
      const lstat = fs.lstatSync(fullPath);
      if (lstat.isSymbolicLink()) continue;

      const ext = path.extname(entry.name).toLowerCase();
      if (allowedExtensions.has(ext)) {
        results.push(entry.name);
      }
    }
  } catch (err) {
    console.error(`[skills] Failed to read scripts dir for ${skillDirPath}:`, err);
  }

  return results.sort();
}

export function getAllSkills(excludedSkillIds: string[] = []): SkillOut[] {
  const rows = db.prepare("SELECT * FROM skills ORDER BY name ASC").all() as SkillRow[];
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description,
    instructions: r.instructions,
    dirPath: r.dir_path,
    sourceUrl: r.source_url,
    contentHash: r.content_hash,
    isEnabled: r.is_enabled === 1 && !excludedSkillIds.includes(r.id),
    createdAt: r.created_at,
  }));
}

export function getSkillById(id: string): SkillOut | null {
  const row = db.prepare("SELECT * FROM skills WHERE id = ?").get(id) as SkillRow | undefined;
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    instructions: row.instructions,
    dirPath: row.dir_path,
    sourceUrl: row.source_url,
    contentHash: row.content_hash,
    isEnabled: row.is_enabled === 1,
    createdAt: row.created_at,
  };
}

export function upsertSkill(body: SkillWriteBody): SkillOut {
  const id = body.id ?? crypto.randomUUID();
  const content = body.instructions;
  const hash = computeContentHash(content);
  const now = Date.now();

  const existing = db.prepare("SELECT * FROM skills WHERE id = ?").get(id) as SkillRow | undefined;
  const isEnabled =
    body.isEnabled !== undefined
      ? body.isEnabled
      : existing
        ? existing.is_enabled === 1
        : true;

  if (existing) {
    db.prepare(`
      UPDATE skills
      SET name = ?, description = ?, instructions = ?, dir_path = ?, source_url = ?, content_hash = ?, is_enabled = ?
      WHERE id = ?
    `).run(
      body.name,
      body.description,
      body.instructions,
      body.dirPath !== undefined ? (body.dirPath || null) : existing.dir_path,
      body.sourceUrl !== undefined ? (body.sourceUrl || null) : existing.source_url,
      hash,
      isEnabled ? 1 : 0,
      id
    );
  } else {
    db.prepare(`
      INSERT INTO skills (id, name, description, instructions, dir_path, source_url, content_hash, is_enabled, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      body.name,
      body.description,
      body.instructions,
      body.dirPath ?? null,
      body.sourceUrl ?? null,
      hash,
      isEnabled ? 1 : 0,
      now
    );
  }

  return getSkillById(id)!;
}

export function deleteSkill(id: string): boolean {
  const existing = db.prepare("SELECT * FROM skills WHERE id = ?").get(id) as SkillRow | undefined;
  const res = db.prepare("DELETE FROM skills WHERE id = ?").run(id);

  // Clean up managed skill directory on disk
  const managedRoot = path.resolve(DATA_DIR, "skills");
  const skillRootDir = path.join(managedRoot, id);
  try {
    if (fs.existsSync(skillRootDir)) {
      fs.rmSync(skillRootDir, { recursive: true, force: true });
    }
    if (existing?.dir_path) {
      const resolvedDir = path.resolve(existing.dir_path);
      if (resolvedDir.startsWith(managedRoot + path.sep) && fs.existsSync(resolvedDir)) {
        fs.rmSync(resolvedDir, { recursive: true, force: true });
      }
    }
  } catch (err) {
    console.warn(`[skills] Failed to delete disk directory for skill ${id}:`, err);
  }

  return res.changes > 0;
}

export function importSkillFromDirectory(sourcePath: string): SkillOut {
  const resolvedPath = path.resolve(sourcePath);
  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`Directory does not exist: ${resolvedPath}`);
  }

  const stat = fs.statSync(resolvedPath);
  if (!stat.isDirectory()) {
    throw new Error(`Path is not a directory: ${resolvedPath}`);
  }

  let skillMdPath: string | null = path.join(resolvedPath, "SKILL.md");
  if (!fs.existsSync(skillMdPath)) {
    skillMdPath = findSkillMdRecursively(resolvedPath);
  }
  if (!skillMdPath || !fs.existsSync(skillMdPath)) {
    throw new Error(`SKILL.md file not found in ${resolvedPath}`);
  }

  const markdownContent = fs.readFileSync(skillMdPath, "utf-8");
  const parsed = parseSkillMarkdown(markdownContent);

  const skillSourceRoot = path.dirname(skillMdPath);
  const name = parsed.name.trim() || path.basename(skillSourceRoot);
  const description = parsed.description.trim() || `Imported skill from ${path.basename(skillSourceRoot)}`;
  const instructions = parsed.instructions.trim();

  if (!instructions) {
    throw new Error(`SKILL.md in ${resolvedPath} has empty instructions.`);
  }

  const id = crypto.randomUUID();
  const destDir = path.join(DATA_DIR, "skills", id);

  fs.mkdirSync(destDir, { recursive: true });
  fs.cpSync(skillSourceRoot, destDir, { recursive: true });

  // If scripts/ was at the top of resolvedPath rather than skillSourceRoot, copy it too
  if (skillSourceRoot !== resolvedPath) {
    const outerScripts = path.join(resolvedPath, "scripts");
    const innerScripts = path.join(destDir, "scripts");
    if (fs.existsSync(outerScripts) && !fs.existsSync(innerScripts)) {
      fs.cpSync(outerScripts, innerScripts, { recursive: true });
    }
  }

  return upsertSkill({
    id,
    name,
    description,
    instructions,
    dirPath: destDir,
  });
}

export function findSkillMdRecursively(dir: string): string | null {
  if (!fs.existsSync(dir)) return null;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isFile() && entry.name.toLowerCase() === "skill.md") {
      return fullPath;
    }
    if (entry.isDirectory()) {
      const res = findSkillMdRecursively(fullPath);
      if (res) return res;
    }
  }
  return null;
}

export function finalizeUploadedSkillFolder(id: string, destDir: string): SkillOut {
  const skillMdPath = findSkillMdRecursively(destDir);
  if (!skillMdPath) {
    fs.rmSync(destDir, { recursive: true, force: true });
    throw new Error("SKILL.md not found in uploaded folder.");
  }

  const markdownContent = fs.readFileSync(skillMdPath, "utf-8");
  const parsed = parseSkillMarkdown(markdownContent);

  const name = parsed.name.trim() || path.basename(destDir);
  const description = parsed.description.trim() || `Uploaded skill`;
  const instructions = parsed.instructions.trim();

  if (!instructions) {
    fs.rmSync(destDir, { recursive: true, force: true });
    throw new Error("SKILL.md in uploaded folder has empty instructions.");
  }

  const effectiveDirPath = path.dirname(skillMdPath);

  return upsertSkill({
    id,
    name,
    description,
    instructions,
    dirPath: effectiveDirPath,
  });
}

/** Fallback tool declaration for loading a skill when the router is off */
export const LOAD_SKILL_TOOL_DEFINITION = {
  type: "function" as const,
  function: {
    name: "load_skill",
    description: "Load full procedural knowledge and instructions for a specific skill by name.",
    parameters: {
      type: "object",
      properties: {
        skill_name: {
          type: "string",
          description: "Name of the skill to load",
        },
      },
      required: ["skill_name"],
    },
  },
};
