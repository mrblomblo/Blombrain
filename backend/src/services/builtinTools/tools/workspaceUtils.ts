import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import db from "../../../db.js";
import type {
  WorkspaceApprovalMode,
  WorkspaceCheckpointOut,
  WorkspaceCheckpointRow,
  WorkspaceGitFileStatus,
  WorkspaceGitStatusOut,
  WorkspaceSource,
} from "../../../types.js";

export const IGNORED_WORKSPACE_DIRS = new Set([
  ".git",
  "node_modules",
  "target",
  "dist",
  "build",
  ".next",
  ".svelte-kit",
  ".venv",
  "__pycache__",
]);

const EXACT_BLOCKED_PATHS = new Set([
  "/",
  "/bin",
  "/boot",
  "/dev",
  "/etc",
  "/lib",
  "/lib32",
  "/lib64",
  "/libx32",
  "/proc",
  "/root",
  "/run",
  "/sbin",
  "/sys",
  "/usr",
  "/var",
  "/home",
  "/Users",
  "/System",
  "/Library",
  "/private",
  "/private/etc",
  "/private/var",
]);

const PREFIX_BLOCKED_PATHS = [
  "/bin/",
  "/boot/",
  "/dev/",
  "/etc/",
  "/lib/",
  "/lib32/",
  "/lib64/",
  "/libx32/",
  "/proc/",
  "/root/",
  "/run/",
  "/sbin/",
  "/sys/",
  "/usr/",
  "/System/",
  "/private/etc/",
];

const ALLOWED_ENV_TEMPLATES = new Set([
  ".env.example",
  ".env.sample",
  ".env.template",
  ".env.defaults",
  "example.env",
  "sample.env",
  "template.env",
]);

function getRealTmpDir(): string | null {
  try {
    return fs.realpathSync(os.tmpdir());
  } catch {
    return os.tmpdir();
  }
}

export function validateWorkspaceDirectory(
  rawPath: string
): { ok: true; realPath: string } | { ok: false; error: string } {
  if (typeof rawPath !== "string") {
    return { ok: false, error: "Workspace path must be a string." };
  }
  const trimmed = rawPath.trim();
  if (!trimmed) {
    return { ok: false, error: "Workspace path cannot be empty." };
  }
  if (trimmed.includes("\0")) {
    return { ok: false, error: "Workspace path contains invalid characters." };
  }

  const resolved = path.resolve(trimmed);
  if (!fs.existsSync(resolved)) {
    return { ok: false, error: `Workspace directory does not exist: ${trimmed}` };
  }

  let stat: fs.Stats;
  try {
    stat = fs.statSync(resolved);
  } catch (err: any) {
    return { ok: false, error: `Cannot access workspace directory: ${err?.message || String(err)}` };
  }
  if (!stat.isDirectory()) {
    return { ok: false, error: `Workspace path is not a directory: ${trimmed}` };
  }

  let realDir: string;
  try {
    realDir = fs.realpathSync(resolved);
    fs.accessSync(realDir, fs.constants.R_OK);
  } catch (err: any) {
    return { ok: false, error: `Workspace directory is not readable: ${err?.message || String(err)}` };
  }

  const normalizedUnix = realDir.replace(/\\/g, "/").replace(/\/+$/, "") || "/";
  const realTmp = getRealTmpDir()?.replace(/\\/g, "/").replace(/\/+$/, "");
  const isInsideTmp = Boolean(
    realTmp && (normalizedUnix === realTmp || normalizedUnix.startsWith(realTmp + "/"))
  );

  if (!isInsideTmp) {
    if (EXACT_BLOCKED_PATHS.has(normalizedUnix)) {
      return {
        ok: false,
        error: `Attaching system directory '${realDir}' as a workspace is not allowed for security reasons.`,
      };
    }
    for (const prefix of PREFIX_BLOCKED_PATHS) {
      if (normalizedUnix.startsWith(prefix)) {
        return {
          ok: false,
          error: `Attaching system directory '${realDir}' as a workspace is not allowed for security reasons.`,
        };
      }
    }
  }

  // Windows root & system directories check
  if (/^[a-zA-Z]:\/?$/.test(normalizedUnix)) {
    return {
      ok: false,
      error: `Attaching drive root '${realDir}' as a workspace is not allowed for security reasons.`,
    };
  }
  const lowerWin = normalizedUnix.toLowerCase();
  if (
    lowerWin === "c:/windows" ||
    lowerWin.startsWith("c:/windows/") ||
    lowerWin === "c:/program files" ||
    lowerWin.startsWith("c:/program files/") ||
    lowerWin === "c:/program files (x86)" ||
    lowerWin.startsWith("c:/program files (x86)/")
  ) {
    return {
      ok: false,
      error: `Attaching system directory '${realDir}' as a workspace is not allowed for security reasons.`,
    };
  }

  return { ok: true, realPath: realDir };
}

export interface EffectiveWorkspaceInfo {
  path: string | null;
  writeEnabled: boolean;
  approvalMode: WorkspaceApprovalMode;
  source: WorkspaceSource;
  folderId: string | null;
  ownPath: string | null;
  ownWriteEnabled: boolean;
  ownApprovalMode: WorkspaceApprovalMode;
}

export function normalizeApprovalMode(raw?: string | null): WorkspaceApprovalMode {
  return raw === "ask" ? "ask" : "auto";
}

export function resolveEffectiveWorkspace(conversationId?: string | null): EffectiveWorkspaceInfo {
  if (!conversationId) {
    return {
      path: null,
      writeEnabled: false,
      approvalMode: "auto",
      source: null,
      folderId: null,
      ownPath: null,
      ownWriteEnabled: false,
      ownApprovalMode: "auto",
    };
  }

  const conv = db
    .prepare<
      [string],
      {
        workspace_path: string | null;
        workspace_write_enabled: number;
        workspace_approval_mode?: string | null;
        folder_id: string | null;
      }
    >(
      "SELECT workspace_path, workspace_write_enabled, workspace_approval_mode, folder_id FROM conversations WHERE id = ?"
    )
    .get(conversationId);

  if (!conv) {
    return {
      path: null,
      writeEnabled: false,
      approvalMode: "auto",
      source: null,
      folderId: null,
      ownPath: null,
      ownWriteEnabled: false,
      ownApprovalMode: "auto",
    };
  }

  const ownPath = conv.workspace_path?.trim() || null;
  const ownWriteEnabled = Boolean(conv.workspace_write_enabled);
  const ownApprovalMode = normalizeApprovalMode(conv.workspace_approval_mode);
  const folderId = conv.folder_id ?? null;

  if (ownPath) {
    return {
      path: ownPath,
      writeEnabled: ownWriteEnabled,
      approvalMode: ownApprovalMode,
      source: "conversation",
      folderId,
      ownPath,
      ownWriteEnabled,
      ownApprovalMode,
    };
  }

  if (folderId) {
    const folder = db
      .prepare<
        [string],
        {
          workspace_path: string | null;
          workspace_write_enabled: number;
          workspace_approval_mode?: string | null;
        }
      >(
        "SELECT workspace_path, workspace_write_enabled, workspace_approval_mode FROM folders WHERE id = ?"
      )
      .get(folderId);
    const folderPath = folder?.workspace_path?.trim() || null;
    if (folderPath) {
      return {
        path: folderPath,
        writeEnabled: Boolean(folder?.workspace_write_enabled),
        approvalMode: normalizeApprovalMode(folder?.workspace_approval_mode),
        source: "folder",
        folderId,
        ownPath: null,
        ownWriteEnabled: false,
        ownApprovalMode,
      };
    }
  }

  return {
    path: null,
    writeEnabled: false,
    approvalMode: "auto",
    source: null,
    folderId,
    ownPath: null,
    ownWriteEnabled: false,
    ownApprovalMode,
  };
}

export function isIgnoredWorkspaceDirName(name: string): boolean {
  return IGNORED_WORKSPACE_DIRS.has(name);
}

export function isSensitiveWorkspacePath(relPath: string): boolean {
  const normalized = relPath.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!normalized) return false;

  const segments = normalized.split("/").filter(Boolean);
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (seg === ".git" || seg === ".ssh" || seg === ".gnupg" || seg === ".aws") {
      return true;
    }
  }

  const base = path.posix.basename(normalized);
  const lowerBase = base.toLowerCase();

  if (ALLOWED_ENV_TEMPLATES.has(lowerBase) || lowerBase.endsWith(".env.example") || lowerBase.endsWith(".env.sample") || lowerBase.endsWith(".env.template")) {
    return false;
  }

  if (lowerBase === ".env" || lowerBase.startsWith(".env.")) {
    return true;
  }

  if (
    lowerBase.endsWith(".pem") ||
    lowerBase.endsWith(".key") ||
    lowerBase.endsWith(".p12") ||
    lowerBase.endsWith(".pfx") ||
    lowerBase === "id_rsa" ||
    lowerBase.startsWith("id_rsa.") ||
    lowerBase === "id_ed25519" ||
    lowerBase.startsWith("id_ed25519.") ||
    lowerBase === "id_ecdsa" ||
    lowerBase.startsWith("id_ecdsa.") ||
    lowerBase === "id_dsa" ||
    lowerBase === ".npmrc" ||
    lowerBase === ".pypirc" ||
    lowerBase === ".netrc"
  ) {
    return true;
  }

  return false;
}

function isWithinRealRoot(realRoot: string, targetPath: string): boolean {
  const rel = path.relative(realRoot, targetPath);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

export interface ResolvedWorkspaceTarget {
  realRoot: string;
  absPath: string;
  realPath: string;
  relPath: string;
}

export function resolveWorkspacePath(
  workspaceRoot: string,
  requestedRelPath: string = "",
  options?: {
    allowMissingLeaf?: boolean;
    allowSensitive?: boolean;
    allowRoot?: boolean;
  }
): ResolvedWorkspaceTarget {
  const validRoot = validateWorkspaceDirectory(workspaceRoot);
  if (!validRoot.ok) {
    throw new Error(validRoot.error);
  }
  const realRoot = validRoot.realPath;

  if (typeof requestedRelPath !== "string" || requestedRelPath.includes("\0")) {
    throw new Error("Invalid workspace file path.");
  }

  const rawTrimmed = requestedRelPath.trim();
  if (!rawTrimmed || rawTrimmed === ".") {
    if (options?.allowRoot) {
      return { realRoot, absPath: realRoot, realPath: realRoot, relPath: "" };
    }
    throw new Error("File path is required.");
  }

  let candidate: string;
  if (path.isAbsolute(rawTrimmed)) {
    const resolvedAbs = path.resolve(rawTrimmed);
    if (!isWithinRealRoot(realRoot, resolvedAbs)) {
      throw new Error(`Access denied: '${requestedRelPath}' is outside the attached workspace.`);
    }
    candidate = resolvedAbs;
  } else {
    candidate = path.resolve(realRoot, rawTrimmed);
  }

  if (!isWithinRealRoot(realRoot, candidate)) {
    throw new Error(`Access denied: '${requestedRelPath}' escapes the attached workspace.`);
  }

  const lexicalRel = path.relative(realRoot, candidate).split(path.sep).join("/");
  if (!lexicalRel && !options?.allowRoot) {
    throw new Error("File path must point to a file inside the workspace.");
  }

  if (!options?.allowSensitive && lexicalRel && isSensitiveWorkspacePath(lexicalRel)) {
    throw new Error(`Access denied: '${lexicalRel}' is a protected secret or credential file.`);
  }

  // Walk from realRoot down to candidate to verify no symlink along the path escapes realRoot
  const parts = lexicalRel ? lexicalRel.split("/") : [];
  let currentPath = realRoot;
  for (let i = 0; i < parts.length; i++) {
    currentPath = path.join(currentPath, parts[i]);
    let lstat: fs.Stats | null = null;
    try {
      lstat = fs.lstatSync(currentPath);
    } catch {
      lstat = null;
    }

    if (!lstat) {
      if (options?.allowMissingLeaf) {
        continue;
      }
      throw new Error(`Path does not exist in workspace: ${lexicalRel}`);
    }

    let realStep: string;
    try {
      realStep = fs.realpathSync(currentPath);
    } catch {
      throw new Error(`Access denied: broken or inaccessible symlink at '${lexicalRel}'.`);
    }

    if (!isWithinRealRoot(realRoot, realStep)) {
      throw new Error(`Access denied: symlink '${lexicalRel}' points outside the attached workspace.`);
    }
  }

  const finalReal = fs.existsSync(candidate) ? fs.realpathSync(candidate) : candidate;
  if (!isWithinRealRoot(realRoot, finalReal)) {
    throw new Error(`Access denied: '${lexicalRel}' resolves outside the attached workspace.`);
  }

  const realRel = path.relative(realRoot, finalReal).split(path.sep).join("/");
  if (!options?.allowSensitive && realRel && isSensitiveWorkspacePath(realRel)) {
    throw new Error(`Access denied: '${realRel}' is a protected secret or credential file.`);
  }

  return {
    realRoot,
    absPath: candidate,
    realPath: finalReal,
    relPath: lexicalRel,
  };
}

export function isLikelyBinaryBuffer(buf: Buffer): boolean {
  const len = Math.min(buf.length, 8192);
  for (let i = 0; i < len; i++) {
    if (buf[i] === 0) {
      return true;
    }
  }
  return false;
}

export interface ListWorkspaceOptions {
  subPath?: string;
  maxDepth?: number;
  maxEntries?: number;
  includeDirs?: boolean;
  respectGitignore?: boolean;
}

interface GitignoreRule {
  negated: boolean;
  dirOnly: boolean;
  baseRelDir: string;
  regex: RegExp;
  matchBasenameOnly: boolean;
}

function globToRegexSource(pattern: string): string {
  let out = "";
  let i = 0;
  while (i < pattern.length) {
    const ch = pattern[i];
    if (ch === "*") {
      if (pattern[i + 1] === "*") {
        if (pattern[i + 2] === "/") {
          out += "(?:.*/)?";
          i += 3;
        } else {
          out += ".*";
          i += 2;
        }
      } else {
        out += "[^/]*";
        i += 1;
      }
    } else if (ch === "?") {
      out += "[^/]";
      i += 1;
    } else if (".+^${}()|[]\\".includes(ch)) {
      out += "\\" + ch;
      i += 1;
    } else {
      out += ch;
      i += 1;
    }
  }
  return out;
}

function parseGitignoreFile(filePath: string, baseRelDir: string): GitignoreRule[] {
  if (!fs.existsSync(filePath)) return [];
  let raw: string;
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile() || stat.size > 256 * 1024) return [];
    raw = fs.readFileSync(filePath, "utf-8");
  } catch {
    return [];
  }

  const rules: GitignoreRule[] = [];
  for (const rawLine of raw.split(/\r?\n/)) {
    let line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    let negated = false;
    if (line.startsWith("!")) {
      negated = true;
      line = line.slice(1);
    } else if (line.startsWith("\\#") || line.startsWith("\\!")) {
      line = line.slice(1);
    }
    if (!line) continue;

    let dirOnly = false;
    if (line.endsWith("/")) {
      dirOnly = true;
      line = line.replace(/\/+$/, "");
    }
    if (!line) continue;

    let anchored = false;
    if (line.startsWith("/")) {
      anchored = true;
      line = line.slice(1);
    } else if (line.includes("/")) {
      anchored = true;
    }

    const src = globToRegexSource(line);
    const regex = anchored ? new RegExp(`^${src}$`) : new RegExp(`^${src}$`);
    rules.push({
      negated,
      dirOnly,
      baseRelDir,
      regex,
      matchBasenameOnly: !anchored,
    });
  }
  return rules;
}

function isIgnoredByGitignore(
  relPath: string,
  isDir: boolean,
  rules: GitignoreRule[]
): boolean {
  let ignored = false;
  for (const rule of rules) {
    if (rule.dirOnly && !isDir) continue;

    let relFromBase: string;
    if (!rule.baseRelDir) {
      relFromBase = relPath;
    } else if (relPath === rule.baseRelDir) {
      continue;
    } else if (relPath.startsWith(rule.baseRelDir + "/")) {
      relFromBase = relPath.slice(rule.baseRelDir.length + 1);
    } else {
      continue;
    }

    const target = rule.matchBasenameOnly
      ? path.posix.basename(relFromBase)
      : relFromBase;
    if (rule.regex.test(target)) {
      ignored = !rule.negated;
    }
  }
  return ignored;
}

export function listWorkspaceEntries(
  workspaceRoot: string,
  options?: ListWorkspaceOptions
): { entries: Array<{ path: string; type: "file" | "dir"; sizeBytes?: number }>; truncated: boolean } {
  const maxDepth = Math.min(Math.max(options?.maxDepth ?? 6, 1), 16);
  const maxEntries = Math.min(Math.max(options?.maxEntries ?? 2000, 1), 5000);
  const includeDirs = options?.includeDirs ?? false;
  const respectGitignore = options?.respectGitignore ?? true;

  const startTarget = resolveWorkspacePath(workspaceRoot, options?.subPath || ".", {
    allowRoot: true,
  });

  const stat = fs.statSync(startTarget.realPath);
  if (!stat.isDirectory()) {
    throw new Error(`Path is not a directory: ${startTarget.relPath || "."}`);
  }

  // Preload ancestor .gitignore rules from workspace root down to startTarget
  const initialRules: GitignoreRule[] = [];
  if (respectGitignore) {
    initialRules.push(
      ...parseGitignoreFile(path.join(startTarget.realRoot, ".gitignore"), "")
    );
    if (startTarget.relPath) {
      const ancestorParts = startTarget.relPath.split("/").filter(Boolean);
      let accAbs = startTarget.realRoot;
      let accRel = "";
      // Stop before the final segment because walk() loads startTarget's own .gitignore
      for (let i = 0; i < ancestorParts.length - 1; i++) {
        accAbs = path.join(accAbs, ancestorParts[i]);
        accRel = accRel ? `${accRel}/${ancestorParts[i]}` : ancestorParts[i];
        initialRules.push(
          ...parseGitignoreFile(path.join(accAbs, ".gitignore"), accRel)
        );
      }
    }
  }

  const entries: Array<{ path: string; type: "file" | "dir"; sizeBytes?: number }> = [];
  let truncated = false;

  function walk(
    currentAbs: string,
    currentRel: string,
    depth: number,
    inheritedRules: GitignoreRule[]
  ) {
    if (depth > maxDepth || truncated) return;

    let activeRules = inheritedRules;
    if (respectGitignore && currentRel) {
      const localRules = parseGitignoreFile(
        path.join(currentAbs, ".gitignore"),
        currentRel
      );
      if (localRules.length > 0) {
        activeRules = [...inheritedRules, ...localRules];
      }
    }

    let dirEntries: fs.Dirent[];
    try {
      dirEntries = fs.readdirSync(currentAbs, { withFileTypes: true });
    } catch {
      return;
    }

    dirEntries.sort((a, b) => {
      if (a.isDirectory() !== b.isDirectory()) {
        return a.isDirectory() ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    });

    for (const dirent of dirEntries) {
      if (entries.length >= maxEntries) {
        truncated = true;
        return;
      }

      const name = dirent.name;
      const childRel = currentRel ? `${currentRel}/${name}` : name;
      const childAbs = path.join(currentAbs, name);

      if (isSensitiveWorkspacePath(childRel)) {
        continue;
      }

      let realChild: string;
      let childStat: fs.Stats;
      try {
        realChild = fs.realpathSync(childAbs);
        if (!isWithinRealRoot(startTarget.realRoot, realChild)) {
          continue;
        }
        childStat = fs.statSync(realChild);
      } catch {
        continue;
      }

      const isDir = childStat.isDirectory();
      if (respectGitignore && isIgnoredByGitignore(childRel, isDir, activeRules)) {
        continue;
      }

      if (isDir) {
        if (isIgnoredWorkspaceDirName(name)) {
          continue;
        }
        if (includeDirs) {
          entries.push({ path: childRel, type: "dir" });
          if (entries.length >= maxEntries) {
            truncated = true;
            return;
          }
        }
        if (depth < maxDepth) {
          walk(childAbs, childRel, depth + 1, activeRules);
        }
      } else if (childStat.isFile()) {
        entries.push({ path: childRel, type: "file", sizeBytes: childStat.size });
      }
    }
  }

  walk(startTarget.absPath, startTarget.relPath, 1, initialRules);
  return { entries, truncated };
}

export function inferWorkspaceArtifactLanguage(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  switch (ext) {
    case ".html":
    case ".htm":
      return "html";
    case ".svg":
      return "svg";
    case ".md":
    case ".markdown":
      return "markdown";
    case ".py":
      return "python";
    case ".js":
    case ".mjs":
    case ".cjs":
      return "javascript";
    case ".ts":
    case ".mts":
    case ".cts":
      return "typescript";
    case ".jsx":
      return "jsx";
    case ".tsx":
      return "tsx";
    case ".svelte":
      return "svelte";
    case ".vue":
      return "vue";
    case ".json":
      return "json";
    case ".css":
      return "css";
    case ".scss":
      return "scss";
    case ".rs":
      return "rust";
    case ".go":
      return "go";
    case ".c":
    case ".cpp":
    case ".h":
    case ".hpp":
      return "cpp";
    case ".sh":
    case ".bash":
      return "bash";
    case ".sql":
      return "sql";
    default:
      return ext.replace(".", "") || "text";
  }
}

export function upsertWorkspaceFileArtifact(params: {
  conversationId?: string;
  relPath: string;
  absPath: string;
  emitEvent?: (type: string, payload: Record<string, any>) => void;
}): string | undefined {
  if (!params.conversationId || !params.relPath) return undefined;
  try {
    if (!fs.existsSync(params.absPath)) return undefined;
    const convExists = db
      .prepare<[string], { id: string }>("SELECT id FROM conversations WHERE id = ?")
      .get(params.conversationId);
    if (!convExists) return undefined;

    const stat = fs.statSync(params.absPath);
    if (!stat.isFile()) return undefined;

    const filename = params.relPath;
    const title = params.relPath;
    const language = inferWorkspaceArtifactLanguage(filename);
    const now = Date.now();
    const newId = crypto.randomUUID();

    const row = db
      .prepare(
        `INSERT INTO artifacts (id, conversation_id, filename, language, title, disk_path, size_bytes, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(conversation_id, filename) DO UPDATE SET
           title = excluded.title,
           language = excluded.language,
           disk_path = excluded.disk_path,
           size_bytes = excluded.size_bytes,
           updated_at = excluded.updated_at
         RETURNING id`
      )
      .get(
        newId,
        params.conversationId,
        filename,
        language,
        title,
        params.absPath,
        stat.size,
        now,
        now
      ) as { id: string } | undefined;

    if (!row?.id) return undefined;

    params.emitEvent?.("artifact_created", {
      artifactId: row.id,
      conversationId: params.conversationId,
      filename,
      title,
      language,
    });

    return row.id;
  } catch (err) {
    console.warn("[workspaceUtils] Failed to register workspace file artifact:", err);
    return undefined;
  }
}

export function removeWorkspaceFileArtifact(
  conversationId: string | undefined,
  relPath: string
): void {
  if (!conversationId || !relPath) return;
  try {
    db.prepare("DELETE FROM artifacts WHERE conversation_id = ? AND filename = ?").run(
      conversationId,
      relPath
    );
  } catch (err) {
    console.warn("[workspaceUtils] Failed to remove workspace file artifact:", err);
  }
}

export function recordWorkspaceCheckpoint(params: {
  conversationId?: string;
  toolCallId?: string;
  toolName: string;
  workspaceRoot: string;
  relPath: string;
  destRelPath?: string | null;
  action: "create" | "overwrite" | "edit" | "delete" | "rename";
  previousContent?: string | null;
  newContent?: string | null;
}): string | undefined {
  if (!params.conversationId) return undefined;
  try {
    // Only record if conversation exists in DB
    const convExists = db
      .prepare<[string], { id: string }>("SELECT id FROM conversations WHERE id = ?")
      .get(params.conversationId);
    if (!convExists) return undefined;

    const id = crypto.randomUUID();
    db.prepare(
      `INSERT INTO workspace_checkpoints
       (id, conversation_id, tool_call_id, tool_name, workspace_root, rel_path, dest_rel_path, action, previous_content, new_content, is_reverted, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`
    ).run(
      id,
      params.conversationId,
      params.toolCallId ?? null,
      params.toolName,
      params.workspaceRoot,
      params.relPath,
      params.destRelPath ?? null,
      params.action,
      params.previousContent ?? null,
      params.newContent ?? null,
      Date.now()
    );
    return id;
  } catch (err) {
    console.warn("[workspaceUtils] Failed to record workspace checkpoint:", err);
    return undefined;
  }
}

function buildSimpleUnifiedDiff(
  relPath: string,
  beforeText: string | null,
  afterText: string | null,
  maxDiffLines = 200
): string {
  const beforeLines = beforeText === null ? [] : beforeText.replace(/\r\n/g, "\n").split("\n");
  const afterLines = afterText === null ? [] : afterText.replace(/\r\n/g, "\n").split("\n");

  const headerOld = beforeText === null ? "--- /dev/null" : `--- a/${relPath}`;
  const headerNew = afterText === null ? "+++ /dev/null" : `+++ b/${relPath}`;

  if (beforeText === null) {
    const body = afterLines.slice(0, maxDiffLines).map((l) => `+${l}`);
    const extra = afterLines.length > maxDiffLines ? [`... (${afterLines.length - maxDiffLines} more lines)`] : [];
    return [headerOld, headerNew, `@@ -0,0 +1,${afterLines.length} @@`, ...body, ...extra].join("\n");
  }
  if (afterText === null) {
    const body = beforeLines.slice(0, maxDiffLines).map((l) => `-${l}`);
    const extra = beforeLines.length > maxDiffLines ? [`... (${beforeLines.length - maxDiffLines} more lines)`] : [];
    return [headerOld, headerNew, `@@ -1,${beforeLines.length} +0,0 @@`, ...body, ...extra].join("\n");
  }

  let prefix = 0;
  const minLen = Math.min(beforeLines.length, afterLines.length);
  while (prefix < minLen && beforeLines[prefix] === afterLines[prefix]) prefix++;
  let suffix = 0;
  while (
    suffix < beforeLines.length - prefix &&
    suffix < afterLines.length - prefix &&
    beforeLines[beforeLines.length - 1 - suffix] === afterLines[afterLines.length - 1 - suffix]
  ) {
    suffix++;
  }
  const midOld = beforeLines.slice(prefix, beforeLines.length - suffix);
  const midNew = afterLines.slice(prefix, afterLines.length - suffix);
  if (midOld.length === 0 && midNew.length === 0) return "(No textual changes)";

  const ctxStart = Math.max(0, prefix - 3);
  const ctxBefore = beforeLines.slice(ctxStart, prefix).map((l) => ` ${l}`);
  const ctxAfter = beforeLines
    .slice(beforeLines.length - suffix, Math.min(beforeLines.length, beforeLines.length - suffix + 3))
    .map((l) => ` ${l}`);
  const body = [
    ...ctxBefore,
    ...midOld.map((l) => `-${l}`),
    ...midNew.map((l) => `+${l}`),
    ...ctxAfter,
  ];
  const oldCount = ctxBefore.length + midOld.length + ctxAfter.length;
  const newCount = ctxBefore.length + midNew.length + ctxAfter.length;
  const shown = body.slice(0, maxDiffLines);
  if (body.length > maxDiffLines) {
    shown.push(`... (${body.length - maxDiffLines} more diff lines omitted)`);
  }
  return [headerOld, headerNew, `@@ -${ctxStart + 1},${oldCount} +${ctxStart + 1},${newCount} @@`, ...shown].join("\n");
}

function rowToCheckpoint(row: WorkspaceCheckpointRow, includeDiff = false): WorkspaceCheckpointOut {
  let diffPreview: string | undefined;
  if (includeDiff) {
    if (row.action === "rename" && row.dest_rel_path) {
      diffPreview = `--- a/${row.rel_path}\n+++ b/${row.dest_rel_path}\n@@ rename ${row.rel_path} -> ${row.dest_rel_path} @@`;
    } else {
      diffPreview = buildSimpleUnifiedDiff(row.rel_path, row.previous_content, row.new_content, 200);
    }
  }
  return {
    id: row.id,
    conversationId: row.conversation_id,
    toolCallId: row.tool_call_id ?? null,
    toolName: row.tool_name,
    workspaceRoot: row.workspace_root,
    relPath: row.rel_path,
    destRelPath: row.dest_rel_path ?? null,
    action: row.action,
    isReverted: Boolean(row.is_reverted),
    createdAt: row.created_at,
    ...(diffPreview !== undefined ? { diffPreview } : {}),
  };
}

export function listWorkspaceCheckpoints(
  conversationId: string,
  options?: { relPath?: string; includeDiff?: boolean }
): WorkspaceCheckpointOut[] {
  const relPath = options?.relPath?.trim();
  const includeDiff = Boolean(options?.includeDiff);
  if (relPath) {
    const rows = db
      .prepare<[string, string, string], WorkspaceCheckpointRow>(
        "SELECT * FROM workspace_checkpoints WHERE conversation_id = ? AND (rel_path = ? OR dest_rel_path = ?) ORDER BY created_at DESC LIMIT 50"
      )
      .all(conversationId, relPath, relPath);
    return rows.map((r) => rowToCheckpoint(r, includeDiff));
  }
  const rows = db
    .prepare<[string], WorkspaceCheckpointRow>(
      "SELECT * FROM workspace_checkpoints WHERE conversation_id = ? ORDER BY created_at DESC LIMIT 50"
    )
    .all(conversationId);
  return rows.map((r) => rowToCheckpoint(r, includeDiff));
}

export function getWorkspaceGitStatus(workspaceRoot: string): WorkspaceGitStatusOut {
  const valid = validateWorkspaceDirectory(workspaceRoot);
  if (!valid.ok) {
    return { isGitRepo: false, branch: null, ahead: 0, behind: 0, files: [] };
  }
  try {
    const out = execFileSync("git", ["status", "--porcelain=v1", "-b"], {
      cwd: valid.realPath,
      encoding: "utf-8",
      timeout: 5000,
      stdio: ["ignore", "pipe", "ignore"],
    });
    const lines = out.split(/\r?\n/).filter(Boolean);
    let branch: string | null = null;
    let ahead = 0;
    let behind = 0;
    const files: WorkspaceGitFileStatus[] = [];

    for (const line of lines) {
      if (line.startsWith("## ")) {
        const header = line.slice(3).trim();
        const branchMatch = header.match(/^([^\s.]+)(?:\.\.\.[^\s]+)?(?:\s+\[(.+)\])?/);
        if (branchMatch) {
          branch = branchMatch[1] === "HEAD" ? "HEAD (detached)" : branchMatch[1];
          const tracking = branchMatch[2] || "";
          const aheadMatch = tracking.match(/ahead (\d+)/);
          const behindMatch = tracking.match(/behind (\d+)/);
          if (aheadMatch) ahead = Number(aheadMatch[1]) || 0;
          if (behindMatch) behind = Number(behindMatch[1]) || 0;
        }
        continue;
      }
      if (line.length < 4) continue;
      const x = line[0];
      const y = line[1];
      let filePath = line.slice(3).trim();
      if (filePath.includes(" -> ")) {
        filePath = filePath.split(" -> ").pop()!.trim();
      }
      if (filePath.startsWith('"') && filePath.endsWith('"')) {
        filePath = filePath.slice(1, -1);
      }
      const normalizedPath = filePath.replace(/\\/g, "/").replace(/\/+$/, "");
      if (isSensitiveWorkspacePath(normalizedPath)) continue;

      let code = "M";
      if (x === "?" && y === "?") code = "?";
      else if (x === "A" || y === "A") code = "A";
      else if (x === "D" || y === "D") code = "D";
      else if (x === "R" || y === "R") code = "R";
      else if (x === "M" || y === "M") code = "M";
      else code = (y !== " " ? y : x) || "M";

      files.push({
        path: normalizedPath,
        code,
        staged: x !== " " && x !== "?",
        unstaged: y !== " ",
      });
    }

    return { isGitRepo: true, branch, ahead, behind, files };
  } catch {
    return { isGitRepo: false, branch: null, ahead: 0, behind: 0, files: [] };
  }
}

export function getWorkspaceGitDiff(workspaceRoot: string, relPath?: string): {
  isGitRepo: boolean;
  diff: string;
  truncated: boolean;
} {
  const valid = validateWorkspaceDirectory(workspaceRoot);
  if (!valid.ok) {
    return { isGitRepo: false, diff: "", truncated: false };
  }
  const MAX_DIFF_CHARS = 80_000;
  try {
    let targetRel: string | undefined;
    if (relPath && relPath.trim()) {
      const target = resolveWorkspacePath(valid.realPath, relPath.trim(), { allowMissingLeaf: true });
      targetRel = target.relPath;
    }

    const argsStaged = ["diff", "--cached", "--no-color", "--"];
    const argsUnstaged = ["diff", "--no-color", "--"];
    if (targetRel) {
      argsStaged.push(targetRel);
      argsUnstaged.push(targetRel);
    }

    const staged = execFileSync("git", argsStaged, {
      cwd: valid.realPath,
      encoding: "utf-8",
      timeout: 8000,
      maxBuffer: 2 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
    });
    const unstaged = execFileSync("git", argsUnstaged, {
      cwd: valid.realPath,
      encoding: "utf-8",
      timeout: 8000,
      maxBuffer: 2 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
    });

    // Strip any diff sections touching sensitive paths just in case
    const combinedRaw = [staged.trim(), unstaged.trim()].filter(Boolean).join("\n\n");
    const sections = combinedRaw.split(/(?=^diff --git )/m);
    const safeSections = sections.filter((sec) => {
      const m = sec.match(/^diff --git a\/(.+?) b\/(.+?)$/m);
      if (!m) return true;
      return !isSensitiveWorkspacePath(m[1]) && !isSensitiveWorkspacePath(m[2]);
    });
    let diff = safeSections.join("");
    let truncated = false;
    if (diff.length > MAX_DIFF_CHARS) {
      diff = diff.slice(0, MAX_DIFF_CHARS) + "\n... [diff truncated at 80 KB]";
      truncated = true;
    }
    return { isGitRepo: true, diff, truncated };
  } catch {
    return { isGitRepo: false, diff: "", truncated: false };
  }
}

export function revertWorkspaceCheckpoint(
  conversationId: string,
  checkpointId: string
): WorkspaceCheckpointOut {
  const row = db
    .prepare<[string, string], WorkspaceCheckpointRow>(
      "SELECT * FROM workspace_checkpoints WHERE id = ? AND conversation_id = ?"
    )
    .get(checkpointId, conversationId);

  if (!row) {
    throw new Error(`Checkpoint "${checkpointId}" not found.`);
  }
  if (row.is_reverted) {
    return rowToCheckpoint(row);
  }

  const target = resolveWorkspacePath(row.workspace_root, row.rel_path, {
    allowMissingLeaf: true,
  });

  if (row.action === "create") {
    if (fs.existsSync(target.absPath) && fs.statSync(target.absPath).isFile()) {
      fs.unlinkSync(target.absPath);
    }
    removeWorkspaceFileArtifact(conversationId, row.rel_path);
  } else if (row.action === "overwrite" || row.action === "edit" || row.action === "delete") {
    if (row.previous_content !== null) {
      fs.mkdirSync(path.dirname(target.absPath), { recursive: true });
      resolveWorkspacePath(row.workspace_root, row.rel_path, { allowMissingLeaf: true });
      fs.writeFileSync(target.absPath, row.previous_content, "utf-8");
      upsertWorkspaceFileArtifact({
        conversationId,
        relPath: row.rel_path,
        absPath: target.absPath,
      });
    }
  } else if (row.action === "rename" && row.dest_rel_path) {
    const destTarget = resolveWorkspacePath(row.workspace_root, row.dest_rel_path, {
      allowMissingLeaf: true,
    });
    fs.mkdirSync(path.dirname(target.absPath), { recursive: true });
    resolveWorkspacePath(row.workspace_root, row.rel_path, { allowMissingLeaf: true });
    if (fs.existsSync(destTarget.absPath)) {
      fs.renameSync(destTarget.absPath, target.absPath);
    } else if (row.previous_content !== null) {
      fs.writeFileSync(target.absPath, row.previous_content, "utf-8");
    }
    removeWorkspaceFileArtifact(conversationId, row.dest_rel_path);
    upsertWorkspaceFileArtifact({
      conversationId,
      relPath: row.rel_path,
      absPath: target.absPath,
    });
  }

  db.prepare("UPDATE workspace_checkpoints SET is_reverted = 1 WHERE id = ?").run(row.id);

  // Also mark the persisted <tool_execution> block in messages as reverted
  if (row.tool_call_id) {
    const msgs = db
      .prepare<[string], { id: string; content: string }>(
        "SELECT id, content FROM messages WHERE conversation_id = ? AND role = 'assistant' AND content LIKE '%<tool_execution>%'"
      )
      .all(conversationId);
    const updateMsg = db.prepare("UPDATE messages SET content = ? WHERE id = ?");
    for (const m of msgs) {
      if (!m.content.includes(row.tool_call_id)) continue;
      const nextContent = m.content.replace(
        /<tool_execution>([\s\S]*?)<\/tool_execution>/g,
        (full, jsonStr) => {
          try {
            const parsed = JSON.parse(jsonStr);
            if (parsed.callId === row.tool_call_id || parsed.checkpointId === row.id) {
              parsed.reverted = true;
              return `<tool_execution>${JSON.stringify(parsed)}</tool_execution>`;
            }
          } catch { }
          return full;
        }
      );
      if (nextContent !== m.content) {
        updateMsg.run(nextContent, m.id);
      }
    }
  }

  const updated = db
    .prepare<[string], WorkspaceCheckpointRow>(
      "SELECT * FROM workspace_checkpoints WHERE id = ?"
    )
    .get(row.id)!;
  return rowToCheckpoint(updated);
}
