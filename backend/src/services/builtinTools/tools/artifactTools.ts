import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import db, { DATA_DIR } from "../../../db.js";
import type { BuiltInToolDefinition, BuiltInToolContext } from "../types.js";
import type { ArtifactRow, AttachmentRow } from "../../../types.js";
import { resolveSandboxedPath } from "./artifactUtils.js";
import { extractDocumentTextAsync } from "../../documentExtractor.js";

function getLanguageFromFilename(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  switch (ext) {
    case ".html": case ".htm": return "html";
    case ".svg": return "svg";
    case ".md": case ".markdown": return "markdown";
    case ".py": return "python";
    case ".js": case ".mjs": case ".cjs": return "javascript";
    case ".ts": case ".mts": case ".cts": return "typescript";
    case ".jsx": return "jsx";
    case ".tsx": return "tsx";
    case ".svelte": return "svelte";
    case ".vue": return "vue";
    case ".json": return "json";
    case ".css": return "css";
    case ".scss": return "scss";
    case ".rs": return "rust";
    case ".go": return "go";
    case ".c": case ".cpp": case ".h": case ".hpp": return "cpp";
    case ".sh": case ".bash": return "bash";
    case ".sql": return "sql";
    default: return ext.replace(".", "") || "text";
  }
}

function getConvUploadsDir(ctx: BuiltInToolContext): string {
  const convId = ctx.conversationId || "staging";
  const baseDir = ctx.uploadsDir || path.join(DATA_DIR, "uploads");
  return resolveSandboxedPath(baseDir, convId);
}

function resolveFile(convId: string, filename: string, ctx: BuiltInToolContext): { type: "artifact" | "attachment"; diskPath: string; artifactRow?: ArtifactRow; attachmentRow?: AttachmentRow } | null {
  const convDir = getConvUploadsDir(ctx);

  const artifactRow = db.prepare<[string, string], ArtifactRow>(
    "SELECT * FROM artifacts WHERE conversation_id = ? AND filename = ?"
  ).get(convId, filename);
  if (artifactRow && fs.existsSync(artifactRow.disk_path)) {
    return { type: "artifact", diskPath: artifactRow.disk_path, artifactRow };
  }

  const attachmentRow = db.prepare<[string, string], AttachmentRow>(
    "SELECT * FROM attachments WHERE conversation_id = ? AND original_name = ?"
  ).get(convId, filename);
  if (attachmentRow && fs.existsSync(attachmentRow.disk_path)) {
    return { type: "attachment", diskPath: attachmentRow.disk_path, attachmentRow };
  }

  try {
    const artifactDiskPath = resolveSandboxedPath(convDir, "artifacts", filename);
    if (fs.existsSync(artifactDiskPath)) {
      return { type: "artifact", diskPath: artifactDiskPath };
    }
  } catch { }

  return null;
}

export const createArtifactToolDef: BuiltInToolDefinition = {
  name: "create_artifact",
  category: "artifact",
  description: "Create a new rendered artifact file (HTML page, SVG graphic, Markdown document, script, etc.).",
  parameters: {
    type: "object",
    properties: {
      filename: {
        type: "string",
        description: "The exact filename for the artifact (e.g., 'index.html', 'chart.svg').",
      },
      title: {
        type: "string",
        description: "Human-readable display title for the UI (e.g., 'Interactive Chart').",
      },
      content: {
        type: "string",
        description: "The complete source code or text content to write into the artifact file.",
      },
      language: {
        type: "string",
        description: "Language code (e.g., 'html', 'svg', 'markdown'). Inferred from extension if omitted.",
      },
    },
    required: ["filename", "content"],
  },
  execute: async (args: Record<string, any>, ctx: BuiltInToolContext) => {
    const convId = ctx.conversationId;
    if (!convId) return { content: "Error: conversationId missing.", isError: true };

    const filename = String(
      args.filename || args.fileName || args.name || args.file_name || args.artifact_name || ""
    ).trim();

    const content = String(
      args.content ?? args.fileContents ?? args.file_contents ?? args.code ?? args.source ?? args.text ?? ""
    );

    const language = String(
      args.language || args.artifactType || args.type || args.lang || ""
    ).trim() || getLanguageFromFilename(filename);

    let title = String(
      args.title || args.display_name || args.displayName || ""
    ).trim();

    // Auto-generate title if missing
    if (!title && filename) {
      title = path.basename(filename, path.extname(filename)).replace(/[_-]/g, " ");
    }

    if (!filename) return { content: "Error: filename (or fileName/name) is required.", isError: true };
    if (!content) return { content: "Error: content (or fileContents/code) is required.", isError: true };

    try {
      const convDir = getConvUploadsDir(ctx);
      const artifactsDir = resolveSandboxedPath(convDir, "artifacts");
      if (!fs.existsSync(artifactsDir)) fs.mkdirSync(artifactsDir, { recursive: true });

      const filePath = resolveSandboxedPath(artifactsDir, filename);
      fs.writeFileSync(filePath, content, "utf-8");
      const stat = fs.statSync(filePath);
      const now = Date.now();
      const newId = crypto.randomUUID();

      const row = db.prepare(`
        INSERT INTO artifacts (id, conversation_id, filename, language, title, disk_path, size_bytes, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(conversation_id, filename) DO UPDATE SET
          title = excluded.title, language = excluded.language, disk_path = excluded.disk_path,
          size_bytes = excluded.size_bytes, updated_at = excluded.updated_at
        RETURNING id
      `).get(newId, convId, filename, language, title, filePath, stat.size, now, now) as { id: string };

      ctx.emitEvent?.("artifact_created", {
        artifactId: row.id,
        conversationId: convId,
        filename,
        title,
        language,
      });

      return { content: `Artifact '${filename}' created. Display it to the user with [artifact: ${filename}].` };
    } catch (err) {
      return { content: `Failed: ${err instanceof Error ? err.message : String(err)}`, isError: true };
    }
  },
};

export const presentArtifactToolDef: BuiltInToolDefinition = {
  name: "present_artifact",
  category: "artifact",
  description: "Display an existing artifact as an inline card in the chat.",
  parameters: {
    type: "object",
    properties: {
      filename: {
        type: "string",
        description: "Filename of the artifact to present (e.g., 'index.html', 'chart.svg').",
      },
    },
    required: ["filename"],
  },
  execute: async (args: Record<string, any>, ctx: BuiltInToolContext) => {
    const convId = ctx.conversationId;
    if (!convId) return { content: "Error: conversationId missing.", isError: true };

    const filename = String(args.filename || args.name || "").trim();
    if (!filename) return { content: "Error: filename is required.", isError: true };

    const row = db.prepare<[string, string], ArtifactRow>(
      "SELECT * FROM artifacts WHERE conversation_id = ? AND filename = ?"
    ).get(convId, filename);

    if (!row) return { content: `Error: '${filename}' not found.`, isError: true };

    ctx.emitEvent?.("artifact_created", {
      artifactId: row.id,
      conversationId: convId,
      filename: row.filename,
      title: row.title,
      language: row.language,
    });

    return { content: `Artifact '${filename}' presented in the chat UI.` };
  },
};

export const listFilesToolDef: BuiltInToolDefinition = {
  name: "list_files",
  category: "artifact",
  description: "List all artifacts and user-uploaded attachments in the current conversation workspace. Use this to find filenames if you are unsure.",
  parameters: { type: "object", properties: {}, required: [] },
  execute: async (args, ctx) => {
    const convId = ctx.conversationId;
    if (!convId) return { content: "Error: conversationId missing.", isError: true };

    const artifacts = db.prepare("SELECT filename, title, language, size_bytes FROM artifacts WHERE conversation_id = ?").all(convId) as any[];
    const attachments = db.prepare("SELECT original_name, mime_type, size_bytes FROM attachments WHERE conversation_id = ?").all(convId) as any[];

    let result = "Workspace Files:\n\n";
    if (artifacts.length > 0) {
      result += "Artifacts (read/write):\n";
      for (const a of artifacts) result += `- ${a.filename} (${a.language}, ${a.size_bytes} bytes) - "${a.title}"\n`;
    }
    if (attachments.length > 0) {
      result += "\nUser Uploads (read-only):\n";
      for (const a of attachments) result += `- ${a.original_name} (${a.mime_type}, ${a.size_bytes} bytes)\n`;
    }
    if (artifacts.length === 0 && attachments.length === 0) result += "(No files in workspace)";

    return { content: result };
  },
};

export const readFileToolDef: BuiltInToolDefinition = {
  name: "read_file",
  category: "artifact",
  description: "Read full text content of an artifact or user-uploaded file. Prepends line numbers for context.",
  parameters: {
    type: "object",
    properties: {
      filename: { type: "string", description: "The filename to read." },
    },
    required: ["filename"],
  },
  execute: async (args: Record<string, any>, ctx: BuiltInToolContext) => {
    const convId = ctx.conversationId;
    if (!convId) return { content: "Error: conversationId is missing.", isError: true };

    const filename = String(args.filename || args.name || "").trim();
    if (!filename) return { content: "Error: filename is required.", isError: true };

    const resolved = resolveFile(convId, filename, ctx);
    if (!resolved) return { content: `Error: File '${filename}' not found.`, isError: true };

    try {
      const MAX_SIZE = 200 * 1024; // 200 KB cap
      const extracted = await extractDocumentTextAsync(
        resolved.diskPath,
        filename,
        resolved.attachmentRow?.mime_type || "text/plain",
        MAX_SIZE
      );
      if (extracted.isBinary) {
        return {
          content: `File '${filename}' is a binary file (${resolved.attachmentRow?.mime_type || "binary"}) and its text content cannot be extracted directly.`,
          isError: true,
        };
      }
      const text = extracted.text;
      const isTruncated = text.endsWith("[TRUNCATED]");

      // Prepend line numbers to help the LLM with subsequent edit_file calls
      const lines = text.split("\n");
      const numberedText = lines.map((line, i) => `${String(i + 1).padStart(4)} | ${line}`).join("\n");

      const header =
        `--- Content of ${filename} (${resolved.type}) ---${isTruncated ? " [TRUNCATED at 200KB]" : ""}\n` +
        `(Line numbers before '|' are for reference only; omit them when calling edit_file.)\n`;
      return { content: header + numberedText };
    } catch (err) {
      return { content: `Error reading file: ${err instanceof Error ? err.message : String(err)}`, isError: true };
    }
  },
};

function isBinaryUploadForTextEdit(diskPath: string, mimeType?: string): boolean {
  const mime = (mimeType || "").toLowerCase();
  if (
    mime.startsWith("image/") ||
    mime.startsWith("audio/") ||
    mime.startsWith("video/") ||
    mime === "application/pdf" ||
    mime === "application/zip" ||
    mime === "application/gzip" ||
    mime.startsWith("application/vnd.openxmlformats")
  ) {
    if (mime !== "image/svg+xml") return true;
  }
  try {
    const fd = fs.openSync(diskPath, "r");
    try {
      const buf = Buffer.alloc(4096);
      const n = fs.readSync(fd, buf, 0, buf.length, 0);
      for (let i = 0; i < n; i++) {
        if (buf[i] === 0) return true;
      }
    } finally {
      fs.closeSync(fd);
    }
  } catch { }
  return false;
}

export const writeFileToolDef: BuiltInToolDefinition = {
  name: "write_file",
  category: "artifact",
  description: "Overwrite the ENTIRE content of an existing artifact or text/code attachment. Use edit_file for partial changes.",
  parameters: {
    type: "object",
    properties: {
      filename: { type: "string", description: "Filename of the existing artifact or uploaded text file." },
      content: { type: "string", description: "New full content to write." },
    },
    required: ["filename", "content"],
  },
  execute: async (args: Record<string, any>, ctx: BuiltInToolContext) => {
    const convId = ctx.conversationId;
    if (!convId) return { content: "Error: conversationId is missing.", isError: true };

    const filename = String(args.filename || args.name || "").trim();
    const content = String(args.content ?? args.code ?? args.text ?? "");

    const resolved = resolveFile(convId, filename, ctx);
    if (!resolved) {
      return { content: `Error: File '${filename}' not found. Use create_artifact to create a new file.`, isError: true };
    }

    if (resolved.type === "attachment" && resolved.attachmentRow) {
      if (isBinaryUploadForTextEdit(resolved.diskPath, resolved.attachmentRow.mime_type)) {
        return {
          content: `Error: Cannot overwrite binary file '${filename}' (${resolved.attachmentRow.mime_type}) with text.`,
          isError: true,
        };
      }
      try {
        fs.writeFileSync(resolved.diskPath, content, "utf-8");
        const stat = fs.statSync(resolved.diskPath);
        db.prepare("UPDATE attachments SET size_bytes = ? WHERE id = ?").run(stat.size, resolved.attachmentRow.id);
        return { content: `File '${filename}' overwritten (${stat.size} bytes).` };
      } catch (err) {
        return { content: `Failed to write file: ${err instanceof Error ? err.message : String(err)}`, isError: true };
      }
    }

    const artifactRow = resolved.artifactRow!;
    const uploadsRoot = path.resolve(DATA_DIR, "uploads") + path.sep;
    const isUploadedArtifact = path.resolve(resolved.diskPath).startsWith(uploadsRoot);
    if (!isUploadedArtifact && !ctx.workspaceWriteEnabled) {
      return {
        content: `Error: '${filename}' is a workspace file and workspace write access is currently disabled (read-only mode).`,
        isError: true,
      };
    }
    try {
      const filePath = isUploadedArtifact
        ? resolveSandboxedPath(getConvUploadsDir(ctx), "artifacts", filename)
        : resolved.diskPath;
      fs.writeFileSync(filePath, content, "utf-8");
      const stat = fs.statSync(filePath);
      const now = Date.now();

      db.prepare("UPDATE artifacts SET size_bytes = ?, updated_at = ? WHERE id = ?").run(stat.size, now, artifactRow.id);
      ctx.emitEvent?.("artifact_updated", { artifactId: artifactRow.id, conversationId: convId, filename, title: artifactRow.title, language: artifactRow.language });

      return { content: `Artifact '${filename}' fully overwritten (${stat.size} bytes).` };
    } catch (err) {
      return { content: `Failed to write file: ${err instanceof Error ? err.message : String(err)}`, isError: true };
    }
  },
};

export const editFileToolDef: BuiltInToolDefinition = {
  name: "edit_file",
  category: "artifact",
  description: "Replace a specific block of text in an existing artifact or text/code attachment. The old_text must match exactly.",
  parameters: {
    type: "object",
    properties: {
      filename: { type: "string", description: "Filename of the artifact or uploaded text file to modify." },
      old_text: { type: "string", description: "The exact text to find and replace. Must match perfectly including whitespace." },
      new_text: { type: "string", description: "The new text to replace the old text with." },
    },
    required: ["filename", "old_text", "new_text"],
  },
  execute: async (args: Record<string, any>, ctx: BuiltInToolContext) => {
    const convId = ctx.conversationId;
    if (!convId) return { content: "Error: conversationId is missing.", isError: true };

    const filename = String(args.filename || args.name || "").trim();
    const oldText = String(args.old_text ?? "");
    const newText = String(args.new_text ?? "");

    const resolved = resolveFile(convId, filename, ctx);
    if (!resolved) {
      return { content: `Error: File '${filename}' not found.`, isError: true };
    }

    if (resolved.type === "attachment" && resolved.attachmentRow) {
      if (isBinaryUploadForTextEdit(resolved.diskPath, resolved.attachmentRow.mime_type)) {
        return {
          content: `Error: Cannot text-edit binary file '${filename}' (${resolved.attachmentRow.mime_type}).`,
          isError: true,
        };
      }
    }

    const uploadsRoot = path.resolve(DATA_DIR, "uploads") + path.sep;
    const isUploadedArtifact =
      resolved.type === "artifact" &&
      path.resolve(resolved.diskPath).startsWith(uploadsRoot);
    if (resolved.type === "artifact" && !isUploadedArtifact && !ctx.workspaceWriteEnabled) {
      return {
        content: `Error: '${filename}' is a workspace file and workspace write access is currently disabled (read-only mode).`,
        isError: true,
      };
    }

    try {
      const filePath = isUploadedArtifact
        ? resolveSandboxedPath(getConvUploadsDir(ctx), "artifacts", filename)
        : resolved.diskPath;
      let content = fs.readFileSync(filePath, "utf-8");

      let matchedOldText = oldText;
      let matchedNewText = newText;
      if (!content.includes(matchedOldText)) {
        const normContent = content.replace(/\r\n/g, "\n");
        const normOld = oldText.replace(/\r\n/g, "\n");
        if (normContent.includes(normOld)) {
          content = normContent;
          matchedOldText = normOld;
          matchedNewText = newText.replace(/\r\n/g, "\n");
        } else {
          const looksNumbered = /^\s*\d+\s*\|\s?/m.test(oldText);
          const hint = looksNumbered
            ? " It looks like old_text contains 'N | ' line-number prefixes from read_file; remove those prefixes and pass raw file text, or use write_file."
            : " Call read_file to inspect exact text and whitespace, or use write_file to replace the full file.";
          return { content: `Error: old_text not found in '${filename}'.${hint}`, isError: true };
        }
      }

      // Replace only the first occurrence to prevent accidental mass replacements
      content = content.replace(matchedOldText, matchedNewText);
      fs.writeFileSync(filePath, content, "utf-8");

      const stat = fs.statSync(filePath);
      if (resolved.type === "artifact" && resolved.artifactRow) {
        const now = Date.now();
        db.prepare("UPDATE artifacts SET size_bytes = ?, updated_at = ? WHERE id = ?").run(stat.size, now, resolved.artifactRow.id);
        ctx.emitEvent?.("artifact_updated", {
          artifactId: resolved.artifactRow.id,
          conversationId: convId,
          filename,
          title: resolved.artifactRow.title,
          language: resolved.artifactRow.language,
        });
        return { content: `Artifact '${filename}' updated successfully (${stat.size} bytes).` };
      }

      if (resolved.attachmentRow) {
        db.prepare("UPDATE attachments SET size_bytes = ? WHERE id = ?").run(stat.size, resolved.attachmentRow.id);
      }
      return { content: `File '${filename}' updated successfully (${stat.size} bytes).` };
    } catch (err) {
      return { content: `Failed to edit file: ${err instanceof Error ? err.message : String(err)}`, isError: true };
    }
  },
};

export const findInFileToolDef: BuiltInToolDefinition = {
  name: "find_in_file",
  category: "artifact",
  description: "Search for a substring or regex pattern in an artifact or user-uploaded file.",
  parameters: {
    type: "object",
    properties: {
      filename: { type: "string", description: "The filename to search." },
      pattern: { type: "string", description: "Substring or regular expression pattern." },
      is_regex: { type: "boolean", description: "Treat pattern as regex. Defaults to false." },
      case_insensitive: { type: "boolean", description: "Search case-insensitively. Defaults to false." },
      context_lines: { type: "integer", description: "Lines of context before/after match. Defaults to 2." },
    },
    required: ["filename", "pattern"],
  },
  execute: async (args: Record<string, any>, ctx: BuiltInToolContext) => {
    const convId = ctx.conversationId;
    if (!convId) return { content: "Error: conversationId is missing.", isError: true };

    const filename = String(args.filename || args.name || "").trim();
    const patternStr = String(args.pattern || "");
    const isRegex = !!args.is_regex;
    const caseInsensitive = !!args.case_insensitive;
    const contextCount = Math.max(0, parseInt(args.context_lines, 10) || 2);

    const resolved = resolveFile(convId, filename, ctx);
    if (!resolved) return { content: `Error: File '${filename}' not found.`, isError: true };

    try {
      const extracted = await extractDocumentTextAsync(
        resolved.diskPath,
        filename,
        resolved.attachmentRow?.mime_type || "text/plain"
      );
      if (extracted.isBinary) {
        return {
          content: `File '${filename}' is a binary file and cannot be searched as text.`,
          isError: true,
        };
      }
      const fullText = extracted.text;
      const lines = fullText.split("\n");

      let matcher: (line: string) => boolean;
      if (isRegex) {
        const regex = new RegExp(patternStr, caseInsensitive ? "i" : "");
        matcher = (line) => regex.test(line);
      } else {
        const target = caseInsensitive ? patternStr.toLowerCase() : patternStr;
        matcher = (line) => (caseInsensitive ? line.toLowerCase() : line).includes(target);
      }

      const matches: Array<{ lineNumber: number; content: string; contextBefore: string[]; contextAfter: string[] }> = [];
      const MAX_MATCHES = 50;

      for (let i = 0; i < lines.length; i++) {
        if (matcher(lines[i])) {
          const startCtx = Math.max(0, i - contextCount);
          const endCtx = Math.min(lines.length, i + contextCount + 1);
          matches.push({
            lineNumber: i + 1,
            content: lines[i],
            contextBefore: lines.slice(startCtx, i),
            contextAfter: lines.slice(i + 1, endCtx),
          });
          if (matches.length >= MAX_MATCHES) break;
        }
      }

      if (matches.length === 0) return { content: `No matches found for '${patternStr}' in '${filename}'.` };

      let resultText = `Found ${matches.length} match(es) for '${patternStr}' in '${filename}':\n\n`;
      for (const m of matches) {
        resultText += `Match at line ${m.lineNumber}:\n`;
        for (const cb of m.contextBefore) resultText += `  | ${cb}\n`;
        resultText += `> ${m.lineNumber} | ${m.content}\n`;
        for (const ca of m.contextAfter) resultText += `  | ${ca}\n`;
        resultText += `\n---\n`;
      }
      return { content: resultText };
    } catch (err) {
      return { content: `Error searching file: ${err instanceof Error ? err.message : String(err)}`, isError: true };
    }
  },
};
