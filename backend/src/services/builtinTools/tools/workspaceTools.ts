import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { BuiltInToolContext, BuiltInToolDefinition } from "../types.js";
import { requestToolApproval } from "../../toolApproval.js";
import {
  isLikelyBinaryBuffer,
  listWorkspaceEntries,
  recordWorkspaceCheckpoint,
  removeWorkspaceFileArtifact,
  resolveWorkspacePath,
  upsertWorkspaceFileArtifact,
} from "./workspaceUtils.js";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function buildUnifiedDiff(
  relPath: string,
  beforeText: string | null,
  afterText: string,
  maxDiffLines = 120
): string {
  const beforeLines = beforeText === null ? [] : beforeText.replace(/\r\n/g, "\n").split("\n");
  const afterLines = afterText.replace(/\r\n/g, "\n").split("\n");

  const headerOld = beforeText === null ? "--- /dev/null" : `--- a/${relPath}`;
  const headerNew = `+++ b/${relPath}`;

  if (beforeText === null) {
    const body = afterLines.slice(0, maxDiffLines).map((l) => `+${l}`);
    const truncatedNote =
      afterLines.length > maxDiffLines
        ? [`... (${afterLines.length - maxDiffLines} more added lines omitted)`]
        : [];
    return [headerOld, headerNew, `@@ -0,0 +1,${afterLines.length} @@`, ...body, ...truncatedNote].join("\n");
  }

  // Trim common prefix and suffix to keep diff computation fast
  let prefix = 0;
  const minLen = Math.min(beforeLines.length, afterLines.length);
  while (prefix < minLen && beforeLines[prefix] === afterLines[prefix]) {
    prefix++;
  }

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

  if (midOld.length === 0 && midNew.length === 0) {
    return "(No textual changes)";
  }

  type DiffOp = { type: "eq" | "del" | "add"; line: string; oldNum: number; newNum: number };
  const ops: DiffOp[] = [];

  for (let i = 0; i < prefix; i++) {
    ops.push({ type: "eq", line: beforeLines[i], oldNum: i + 1, newNum: i + 1 });
  }

  if (midOld.length * midNew.length <= 250_000) {
    const m = midOld.length;
    const n = midNew.length;
    const dp: Int32Array[] = Array.from({ length: m + 1 }, () => new Int32Array(n + 1));
    for (let i = m - 1; i >= 0; i--) {
      for (let j = n - 1; j >= 0; j--) {
        if (midOld[i] === midNew[j]) {
          dp[i][j] = dp[i + 1][j + 1] + 1;
        } else {
          dp[i][j] = dp[i + 1][j] >= dp[i][j + 1] ? dp[i + 1][j] : dp[i][j + 1];
        }
      }
    }
    let i = 0;
    let j = 0;
    while (i < m && j < n) {
      if (midOld[i] === midNew[j]) {
        ops.push({ type: "eq", line: midOld[i], oldNum: prefix + i + 1, newNum: prefix + j + 1 });
        i++;
        j++;
      } else if (dp[i + 1][j] >= dp[i][j + 1]) {
        ops.push({ type: "del", line: midOld[i], oldNum: prefix + i + 1, newNum: prefix + j + 1 });
        i++;
      } else {
        ops.push({ type: "add", line: midNew[j], oldNum: prefix + i + 1, newNum: prefix + j + 1 });
        j++;
      }
    }
    while (i < m) {
      ops.push({ type: "del", line: midOld[i], oldNum: prefix + i + 1, newNum: prefix + j + 1 });
      i++;
    }
    while (j < n) {
      ops.push({ type: "add", line: midNew[j], oldNum: prefix + i + 1, newNum: prefix + j + 1 });
      j++;
    }
  } else {
    for (let i = 0; i < midOld.length; i++) {
      ops.push({ type: "del", line: midOld[i], oldNum: prefix + i + 1, newNum: prefix + 1 });
    }
    for (let j = 0; j < midNew.length; j++) {
      ops.push({ type: "add", line: midNew[j], oldNum: prefix + midOld.length + 1, newNum: prefix + j + 1 });
    }
  }

  for (let k = 0; k < suffix; k++) {
    const oldIdx = beforeLines.length - suffix + k;
    const newIdx = afterLines.length - suffix + k;
    ops.push({ type: "eq", line: beforeLines[oldIdx], oldNum: oldIdx + 1, newNum: newIdx + 1 });
  }

  // Group into hunks with 3 lines of context
  const CONTEXT = 3;
  const changedIndices: number[] = [];
  for (let idx = 0; idx < ops.length; idx++) {
    if (ops[idx].type !== "eq") changedIndices.push(idx);
  }
  if (changedIndices.length === 0) return "(No textual changes)";

  const hunks: Array<{ start: number; end: number }> = [];
  for (const cIdx of changedIndices) {
    const start = Math.max(0, cIdx - CONTEXT);
    const end = Math.min(ops.length - 1, cIdx + CONTEXT);
    const prev = hunks[hunks.length - 1];
    if (prev && start <= prev.end + 1) {
      prev.end = end;
    } else {
      hunks.push({ start, end });
    }
  }

  const outLines: string[] = [headerOld, headerNew];
  let emittedBodyLines = 0;
  let truncated = false;

  for (const hunk of hunks) {
    const slice = ops.slice(hunk.start, hunk.end + 1);
    const oldStart = slice[0].oldNum;
    const newStart = slice[0].newNum;
    const oldCount = slice.filter((o) => o.type !== "add").length;
    const newCount = slice.filter((o) => o.type !== "del").length;
    outLines.push(`@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`);

    for (const op of slice) {
      if (emittedBodyLines >= maxDiffLines) {
        truncated = true;
        break;
      }
      const prefixChar = op.type === "add" ? "+" : op.type === "del" ? "-" : " ";
      outLines.push(`${prefixChar}${op.line}`);
      emittedBodyLines++;
    }
    if (truncated) break;
  }

  if (truncated) {
    outLines.push("... (diff preview truncated)");
  }
  return outLines.join("\n");
}

function matchesFileFilter(relPath: string, pattern?: string): boolean {
  if (!pattern || !pattern.trim()) return true;
  const raw = pattern.trim().toLowerCase();
  const target = relPath.toLowerCase();
  const base = path.posix.basename(target);

  if (raw.includes("*")) {
    const escaped = raw
      .replace(/[.+^${}()|[\]\\]/g, "\\$&")
      .replace(/\*/g, ".*");
    const rx = new RegExp(`^${escaped}$`, "i");
    return rx.test(base) || rx.test(target);
  }
  if (raw.startsWith(".")) {
    return base.endsWith(raw);
  }
  return target.includes(raw);
}

export const workspaceListToolDef: BuiltInToolDefinition = {
  name: "workspace_list",
  category: "workspace",
  description:
    "List files and directories inside the attached project workspace. Automatically skips heavy build/dependency folders (node_modules, .git, target, dist) and protected secret files (.env, private keys).",
  parameters: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "Optional relative subdirectory path inside the workspace (defaults to '.').",
      },
      max_depth: {
        type: "number",
        description: "Maximum directory traversal depth (1 to 10, default 3).",
      },
      max_entries: {
        type: "number",
        description: "Maximum number of entries to return (default 300, max 2000).",
      },
    },
  },
  isAvailable: (ctx?: BuiltInToolContext) => Boolean(ctx?.workspacePath),
  cacheable: false,
  execute: async (args: Record<string, any>, ctx: BuiltInToolContext) => {
    if (!ctx.workspacePath) {
      return { content: "Error: No workspace is attached to this conversation.", isError: true };
    }
    try {
      const subPath = typeof args.path === "string" && args.path.trim() ? args.path.trim() : ".";
      const maxDepth = Math.min(Math.max(Number(args.max_depth) || 3, 1), 10);
      const maxEntries = Math.min(Math.max(Number(args.max_entries) || 300, 1), 2000);

      const { entries, truncated } = listWorkspaceEntries(ctx.workspacePath, {
        subPath,
        maxDepth,
        maxEntries,
        includeDirs: true,
      });

      if (entries.length === 0) {
        return { content: `No visible files or directories found in '${subPath}'.` };
      }

      const lines = entries.map((e) =>
        e.type === "dir"
          ? `[DIR]  ${e.path}/`
          : `[FILE] ${e.path} (${formatBytes(e.sizeBytes ?? 0)})`
      );
      if (truncated) {
        lines.push(`\n... (truncated at ${maxEntries} entries; pass a more specific 'path' or higher 'max_entries')`);
      }
      return {
        content: `Workspace entries in '${subPath}' (${entries.length} shown):\n${lines.join("\n")}`,
      };
    } catch (err: any) {
      return { content: `Error listing workspace: ${err?.message || String(err)}`, isError: true };
    }
  },
};

export const workspaceSearchToolDef: BuiltInToolDefinition = {
  name: "workspace_search",
  category: "workspace",
  description:
    "Search for a text string or regular expression across files in the attached project workspace. Returns matching file paths, line numbers, and snippets.",
  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "Text or regular expression pattern to search for.",
      },
      path: {
        type: "string",
        description: "Optional relative subdirectory or file path to scope the search.",
      },
      is_regex: {
        type: "boolean",
        description: "Whether to interpret 'query' as a regular expression (default false).",
      },
      case_sensitive: {
        type: "boolean",
        description: "Whether the search should be case-sensitive (default false).",
      },
      file_pattern: {
        type: "string",
        description: "Optional filename/extension filter (e.g. '*.ts', '.svelte', 'routes').",
      },
      max_results: {
        type: "number",
        description: "Maximum number of matching lines to return (default 50, max 200).",
      },
    },
    required: ["query"],
  },
  isAvailable: (ctx?: BuiltInToolContext) => Boolean(ctx?.workspacePath),
  cacheable: false,
  execute: async (args: Record<string, any>, ctx: BuiltInToolContext) => {
    if (!ctx.workspacePath) {
      return { content: "Error: No workspace is attached to this conversation.", isError: true };
    }
    const query = typeof args.query === "string" ? args.query : "";
    if (!query) {
      return { content: "Error: 'query' parameter is required.", isError: true };
    }

    const isRegex = Boolean(args.is_regex);
    const caseSensitive = Boolean(args.case_sensitive);
    const filePattern = typeof args.file_pattern === "string" ? args.file_pattern : undefined;
    const maxResults = Math.min(Math.max(Number(args.max_results) || 50, 1), 200);
    const subPath = typeof args.path === "string" && args.path.trim() ? args.path.trim() : ".";

    let matcher: (line: string) => boolean;
    try {
      if (isRegex) {
        const rx = new RegExp(query, caseSensitive ? "" : "i");
        matcher = (line: string) => rx.test(line);
      } else if (caseSensitive) {
        matcher = (line: string) => line.includes(query);
      } else {
        const lowerQ = query.toLowerCase();
        matcher = (line: string) => line.toLowerCase().includes(lowerQ);
      }
    } catch (err: any) {
      return { content: `Error: Invalid regex '${query}': ${err?.message || String(err)}`, isError: true };
    }

    try {
      const target = resolveWorkspacePath(ctx.workspacePath, subPath, { allowRoot: true });
      const stat = fs.statSync(target.realPath);

      let fileRelPaths: string[] = [];
      if (stat.isFile()) {
        fileRelPaths = [target.relPath];
      } else {
        const listed = listWorkspaceEntries(ctx.workspacePath, {
          subPath,
          maxDepth: 10,
          maxEntries: 3000,
          includeDirs: false,
        });
        fileRelPaths = listed.entries
          .filter((e) => e.type === "file" && (e.sizeBytes ?? 0) <= 2 * 1024 * 1024)
          .map((e) => e.path);
      }

      const matches: string[] = [];
      let truncated = false;

      for (const relPath of fileRelPaths) {
        if (!matchesFileFilter(relPath, filePattern)) continue;

        let resolvedFile;
        try {
          resolvedFile = resolveWorkspacePath(ctx.workspacePath, relPath);
        } catch {
          continue;
        }

        let buf: Buffer;
        try {
          buf = fs.readFileSync(resolvedFile.realPath);
        } catch {
          continue;
        }
        if (isLikelyBinaryBuffer(buf)) continue;

        const text = buf.toString("utf-8");
        const lines = text.split(/\r?\n/);
        for (let i = 0; i < lines.length; i++) {
          if (matcher(lines[i])) {
            const snippet =
              lines[i].length > 240 ? lines[i].slice(0, 240) + "..." : lines[i];
            matches.push(`${relPath}:${i + 1}: ${snippet}`);
            if (matches.length >= maxResults) {
              truncated = true;
              break;
            }
          }
        }
        if (truncated) break;
      }

      if (matches.length === 0) {
        return { content: `No matches found for '${query}' in '${subPath}'.` };
      }

      const header = `Found ${matches.length}${truncated ? "+" : ""} match(es) for '${query}':`;
      const footer = truncated
        ? `\n... (results capped at ${maxResults} matches)`
        : "";
      return { content: `${header}\n${matches.join("\n")}${footer}` };
    } catch (err: any) {
      return { content: `Error searching workspace: ${err?.message || String(err)}`, isError: true };
    }
  },
};

export const workspaceReadToolDef: BuiltInToolDefinition = {
  name: "workspace_read",
  category: "workspace",
  description:
    "Read the contents of a file inside the attached project workspace with 1-indexed line numbers. Supports reading specific line ranges via start_line and end_line.",
  parameters: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "Relative path to the file inside the attached workspace.",
      },
      start_line: {
        type: "number",
        description: "1-indexed line number to start reading from (default 1).",
      },
      end_line: {
        type: "number",
        description: "1-indexed line number to stop reading at (inclusive, default start_line + 299).",
      },
    },
    required: ["path"],
  },
  isAvailable: (ctx?: BuiltInToolContext) => Boolean(ctx?.workspacePath),
  cacheable: false,
  execute: async (args: Record<string, any>, ctx: BuiltInToolContext) => {
    if (!ctx.workspacePath) {
      return { content: "Error: No workspace is attached to this conversation.", isError: true };
    }
    const reqPath = String(args.path || "").trim();
    if (!reqPath) {
      return { content: "Error: 'path' parameter is required.", isError: true };
    }

    try {
      const target = resolveWorkspacePath(ctx.workspacePath, reqPath);
      const stat = fs.statSync(target.realPath);
      if (stat.isDirectory()) {
        return {
          content: `Error: '${target.relPath}' is a directory. Use workspace_list to inspect directories.`,
          isError: true,
        };
      }
      if (stat.size > 5 * 1024 * 1024) {
        return {
          content: `Error: '${target.relPath}' is too large (${formatBytes(stat.size)}; max 5 MB).`,
          isError: true,
        };
      }

      const buf = fs.readFileSync(target.realPath);
      if (isLikelyBinaryBuffer(buf)) {
        return {
          content: `Error: '${target.relPath}' appears to be a binary file (${formatBytes(stat.size)}).`,
          isError: true,
        };
      }

      const text = buf.toString("utf-8");
      const allLines = text.split(/\r?\n/);
      const totalLines = allLines.length;

      const startLine = Math.max(1, Math.floor(Number(args.start_line) || 1));
      const defaultEnd = startLine + 299;
      const requestedEnd = args.end_line !== undefined ? Math.floor(Number(args.end_line)) : defaultEnd;
      const endLine = Math.min(
        totalLines,
        Math.max(startLine, Math.min(requestedEnd, startLine + 999))
      );

      if (startLine > totalLines && totalLines > 0) {
        return {
          content: `File '${target.relPath}' has only ${totalLines} line(s) (requested start_line=${startLine}).`,
        };
      }

      const slice = allLines.slice(startLine - 1, endLine);
      const width = String(endLine).length;
      const numbered = slice
        .map((line, idx) => `${String(startLine + idx).padStart(width, " ")} | ${line}`)
        .join("\n");

      const moreBelow = endLine < totalLines ? ` (${totalLines - endLine} more lines below)` : "";
      return {
        content: `File: ${target.relPath} (lines ${startLine}-${endLine} of ${totalLines})${moreBelow}\n${numbered}`,
      };
    } catch (err: any) {
      return { content: `Error reading workspace file: ${err?.message || String(err)}`, isError: true };
    }
  },
};

export const workspaceEditToolDef: BuiltInToolDefinition = {
  name: "workspace_edit",
  category: "workspace",
  description:
    "Edit an existing file inside the attached project workspace by replacing an exact target text block with replacement text. Only available when workspace write access is enabled.",
  parameters: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "Relative path to the file inside the attached workspace.",
      },
      target: {
        type: "string",
        description: "Exact existing text block in the file to replace.",
      },
      replacement: {
        type: "string",
        description: "New text block that replaces the target.",
      },
      replace_all: {
        type: "boolean",
        description: "Replace every occurrence of target if it appears multiple times (default false).",
      },
    },
    required: ["path", "target", "replacement"],
  },
  isAvailable: (ctx?: BuiltInToolContext) =>
    Boolean(ctx?.workspacePath && ctx?.workspaceWriteEnabled),
  cacheable: false,
  execute: async (args: Record<string, any>, ctx: BuiltInToolContext) => {
    if (!ctx.workspacePath) {
      return { content: "Error: No workspace is attached to this conversation.", isError: true };
    }
    if (!ctx.workspaceWriteEnabled) {
      return {
        content:
          "Error: Workspace write access is disabled (read-only mode). Enable write access in the workspace controls to edit files.",
        isError: true,
      };
    }

    const reqPath = String(args.path || "").trim();
    const targetText = typeof args.target === "string" ? args.target : "";
    const replacementText = typeof args.replacement === "string" ? args.replacement : "";
    const replaceAll = Boolean(args.replace_all);

    if (!reqPath) {
      return { content: "Error: 'path' parameter is required.", isError: true };
    }
    if (!targetText) {
      return { content: "Error: 'target' parameter cannot be empty.", isError: true };
    }

    try {
      const target = resolveWorkspacePath(ctx.workspacePath, reqPath);
      const stat = fs.statSync(target.realPath);
      if (!stat.isFile()) {
        return { content: `Error: '${target.relPath}' is not a regular file.`, isError: true };
      }

      const buf = fs.readFileSync(target.realPath);
      if (isLikelyBinaryBuffer(buf)) {
        return { content: `Error: Cannot edit binary file '${target.relPath}'.`, isError: true };
      }

      const original = buf.toString("utf-8");
      const usesCrLf = original.includes("\r\n");
      const normalizedOrig = usesCrLf ? original.replace(/\r\n/g, "\n") : original;
      const normalizedTarget = targetText.replace(/\r\n/g, "\n");
      const normalizedReplacement = replacementText.replace(/\r\n/g, "\n");

      const parts = normalizedOrig.split(normalizedTarget);
      const occurrences = parts.length - 1;
      if (occurrences === 0) {
        return {
          content: `Error: Target block not found in '${target.relPath}'. Use workspace_read to verify exact lines and whitespace.`,
          isError: true,
        };
      }
      if (occurrences > 1 && !replaceAll) {
        return {
          content: `Error: Target block matched ${occurrences} times in '${target.relPath}'. Include more surrounding context lines or set replace_all=true.`,
          isError: true,
        };
      }

      const updatedNormalized = replaceAll
        ? parts.join(normalizedReplacement)
        : normalizedOrig.replace(normalizedTarget, () => normalizedReplacement);

      const finalOutput = usesCrLf
        ? updatedNormalized.replace(/\n/g, "\r\n")
        : updatedNormalized;

      const oldLines = normalizedTarget.split("\n").length;
      const newLines = normalizedReplacement.split("\n").length;
      const replacedCount = replaceAll ? occurrences : 1;
      const diffPreview = buildUnifiedDiff(target.relPath, normalizedOrig, updatedNormalized);

      if (ctx.workspaceApprovalMode === "ask" && !ctx.isTurnWriteApproved?.()) {
        const decision = await requestToolApproval({
          conversationId: ctx.conversationId,
          callId: ctx.callId,
          toolName: "workspace_edit",
          args,
          diffPreview,
          message: `Approve editing '${target.relPath}'?`,
          emitEvent: ctx.emitEvent,
          abortSignal: ctx.abortSignal,
        });
        if (decision === "approved_all_turn") {
          ctx.markTurnWriteApproved?.();
        } else if (decision !== "approved") {
          return {
            content: `User rejected edit to '${target.relPath}'.`,
            isError: true,
            diffPreview,
          };
        }
        ctx.emitEvent?.("tool_execution", {
          callId: ctx.callId,
          toolName: "workspace_edit",
          args,
          cacheable: false,
          status: "executing",
        });
      }

      fs.writeFileSync(target.realPath, finalOutput, "utf-8");

      const checkpointId = recordWorkspaceCheckpoint({
        conversationId: ctx.conversationId,
        toolCallId: ctx.callId,
        toolName: "workspace_edit",
        workspaceRoot: target.realRoot,
        relPath: target.relPath,
        action: "edit",
        previousContent: original,
        newContent: finalOutput,
      });

      upsertWorkspaceFileArtifact({
        conversationId: ctx.conversationId,
        relPath: target.relPath,
        absPath: target.realPath,
        emitEvent: ctx.emitEvent,
      });

      return {
        content: `Updated '${target.relPath}' (${replacedCount} occurrence(s) replaced, -${oldLines * replacedCount} / +${newLines * replacedCount} lines).\n\`\`\`diff\n${diffPreview}\n\`\`\``,
        checkpointId,
        diffPreview,
      };
    } catch (err: any) {
      return { content: `Error editing workspace file: ${err?.message || String(err)}`, isError: true };
    }
  },
};

export const workspaceWriteToolDef: BuiltInToolDefinition = {
  name: "workspace_write",
  category: "workspace",
  description:
    "Create a new file or overwrite an existing file inside the attached project workspace. Only available when workspace write access is enabled.",
  parameters: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "Relative path to the file inside the attached workspace.",
      },
      content: {
        type: "string",
        description: "Complete text content to write to the file.",
      },
      overwrite: {
        type: "boolean",
        description: "Whether overwriting an existing file is allowed (default true).",
      },
    },
    required: ["path", "content"],
  },
  isAvailable: (ctx?: BuiltInToolContext) =>
    Boolean(ctx?.workspacePath && ctx?.workspaceWriteEnabled),
  cacheable: false,
  execute: async (args: Record<string, any>, ctx: BuiltInToolContext) => {
    if (!ctx.workspacePath) {
      return { content: "Error: No workspace is attached to this conversation.", isError: true };
    }
    if (!ctx.workspaceWriteEnabled) {
      return {
        content:
          "Error: Workspace write access is disabled (read-only mode). Enable write access in the workspace controls to write files.",
        isError: true,
      };
    }

    const reqPath = String(args.path || "").trim();
    const content = typeof args.content === "string" ? args.content : "";
    const overwrite = args.overwrite !== undefined ? Boolean(args.overwrite) : true;

    if (!reqPath) {
      return { content: "Error: 'path' parameter is required.", isError: true };
    }

    try {
      const target = resolveWorkspacePath(ctx.workspacePath, reqPath, {
        allowMissingLeaf: true,
      });

      const existed = fs.existsSync(target.absPath);
      if (existed && !overwrite) {
        return {
          content: `Error: File '${target.relPath}' already exists and overwrite=false.`,
          isError: true,
        };
      }
      if (existed && fs.statSync(target.absPath).isDirectory()) {
        return {
          content: `Error: '${target.relPath}' is an existing directory.`,
          isError: true,
        };
      }

      const previousContent = existed ? fs.readFileSync(target.absPath, "utf-8") : null;
      const diffPreview = buildUnifiedDiff(target.relPath, previousContent, content, 80);

      if (ctx.workspaceApprovalMode === "ask" && !ctx.isTurnWriteApproved?.()) {
        const decision = await requestToolApproval({
          conversationId: ctx.conversationId,
          callId: ctx.callId,
          toolName: "workspace_write",
          args,
          diffPreview,
          message: `Approve ${existed ? "overwriting" : "creating"} '${target.relPath}'?`,
          emitEvent: ctx.emitEvent,
          abortSignal: ctx.abortSignal,
        });
        if (decision === "approved_all_turn") {
          ctx.markTurnWriteApproved?.();
        } else if (decision !== "approved") {
          return {
            content: `User rejected writing '${target.relPath}'.`,
            isError: true,
            diffPreview,
          };
        }
        ctx.emitEvent?.("tool_execution", {
          callId: ctx.callId,
          toolName: "workspace_write",
          args,
          cacheable: false,
          status: "executing",
        });
      }

      const parentDir = path.dirname(target.absPath);
      fs.mkdirSync(parentDir, { recursive: true });
      // Re-verify after directory creation that no symlink escape occurred
      resolveWorkspacePath(ctx.workspacePath, reqPath, { allowMissingLeaf: true });

      fs.writeFileSync(target.absPath, content, "utf-8");
      const lineCount = content.split(/\r?\n/).length;
      const byteSize = Buffer.byteLength(content, "utf-8");

      const checkpointId = recordWorkspaceCheckpoint({
        conversationId: ctx.conversationId,
        toolCallId: ctx.callId,
        toolName: "workspace_write",
        workspaceRoot: target.realRoot,
        relPath: target.relPath,
        action: existed ? "overwrite" : "create",
        previousContent,
        newContent: content,
      });

      upsertWorkspaceFileArtifact({
        conversationId: ctx.conversationId,
        relPath: target.relPath,
        absPath: target.absPath,
        emitEvent: ctx.emitEvent,
      });

      return {
        content: `${existed ? "Overwrote" : "Created"} '${target.relPath}' (${lineCount} lines, ${formatBytes(byteSize)}).\n\`\`\`diff\n${diffPreview}\n\`\`\``,
        checkpointId,
        diffPreview,
      };
    } catch (err: any) {
      return { content: `Error writing workspace file: ${err?.message || String(err)}`, isError: true };
    }
  },
};

export const workspaceDeleteToolDef: BuiltInToolDefinition = {
  name: "workspace_delete",
  category: "workspace",
  description:
    "Delete an existing file inside the attached project workspace. Creates a checkpoint so the deletion can be reverted. Only available when workspace write access is enabled.",
  parameters: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "Relative path to the file inside the attached workspace to delete.",
      },
    },
    required: ["path"],
  },
  isAvailable: (ctx?: BuiltInToolContext) =>
    Boolean(ctx?.workspacePath && ctx?.workspaceWriteEnabled),
  cacheable: false,
  execute: async (args: Record<string, any>, ctx: BuiltInToolContext) => {
    if (!ctx.workspacePath) {
      return { content: "Error: No workspace is attached to this conversation.", isError: true };
    }
    if (!ctx.workspaceWriteEnabled) {
      return {
        content:
          "Error: Workspace write access is disabled (read-only mode). Enable write access in the workspace controls to delete files.",
        isError: true,
      };
    }

    const reqPath = String(args.path || "").trim();
    if (!reqPath) {
      return { content: "Error: 'path' parameter is required.", isError: true };
    }

    try {
      const target = resolveWorkspacePath(ctx.workspacePath, reqPath);
      const stat = fs.statSync(target.realPath);
      if (!stat.isFile()) {
        return {
          content: `Error: '${target.relPath}' is not a regular file (deleting directories is not supported).`,
          isError: true,
        };
      }

      let previousContent: string | null = null;
      if (stat.size <= 5 * 1024 * 1024) {
        const buf = fs.readFileSync(target.realPath);
        if (!isLikelyBinaryBuffer(buf)) {
          previousContent = buf.toString("utf-8");
        }
      }

      const diffPreview = buildUnifiedDiff(
        target.relPath,
        previousContent ?? `(binary file, ${formatBytes(stat.size)})`,
        "",
        60
      );

      if (ctx.workspaceApprovalMode === "ask" && !ctx.isTurnWriteApproved?.()) {
        const decision = await requestToolApproval({
          conversationId: ctx.conversationId,
          callId: ctx.callId,
          toolName: "workspace_delete",
          args,
          diffPreview,
          message: `Approve deleting '${target.relPath}'?`,
          emitEvent: ctx.emitEvent,
          abortSignal: ctx.abortSignal,
        });
        if (decision === "approved_all_turn") {
          ctx.markTurnWriteApproved?.();
        } else if (decision !== "approved") {
          return {
            content: `User rejected deleting '${target.relPath}'.`,
            isError: true,
            diffPreview,
          };
        }
        ctx.emitEvent?.("tool_execution", {
          callId: ctx.callId,
          toolName: "workspace_delete",
          args,
          cacheable: false,
          status: "executing",
        });
      }

      fs.unlinkSync(target.realPath);

      const checkpointId = recordWorkspaceCheckpoint({
        conversationId: ctx.conversationId,
        toolCallId: ctx.callId,
        toolName: "workspace_delete",
        workspaceRoot: target.realRoot,
        relPath: target.relPath,
        action: "delete",
        previousContent,
        newContent: null,
      });

      removeWorkspaceFileArtifact(ctx.conversationId, target.relPath);

      return {
        content: `Deleted '${target.relPath}'.\n\`\`\`diff\n${diffPreview}\n\`\`\``,
        checkpointId,
        diffPreview,
      };
    } catch (err: any) {
      return { content: `Error deleting workspace file: ${err?.message || String(err)}`, isError: true };
    }
  },
};

export const workspaceRenameToolDef: BuiltInToolDefinition = {
  name: "workspace_rename",
  category: "workspace",
  description:
    "Move or rename a file inside the attached project workspace. Creates a checkpoint so the rename can be reverted. Only available when workspace write access is enabled.",
  parameters: {
    type: "object",
    properties: {
      from_path: {
        type: "string",
        description: "Existing relative path of the file inside the workspace.",
      },
      to_path: {
        type: "string",
        description: "New destination relative path inside the workspace.",
      },
      overwrite: {
        type: "boolean",
        description: "Allow overwriting the destination path if it already exists (default false).",
      },
    },
    required: ["from_path", "to_path"],
  },
  isAvailable: (ctx?: BuiltInToolContext) =>
    Boolean(ctx?.workspacePath && ctx?.workspaceWriteEnabled),
  cacheable: false,
  execute: async (args: Record<string, any>, ctx: BuiltInToolContext) => {
    if (!ctx.workspacePath) {
      return { content: "Error: No workspace is attached to this conversation.", isError: true };
    }
    if (!ctx.workspaceWriteEnabled) {
      return {
        content:
          "Error: Workspace write access is disabled (read-only mode). Enable write access in the workspace controls to rename files.",
        isError: true,
      };
    }

    const fromPath = String(args.from_path || "").trim();
    const toPath = String(args.to_path || "").trim();
    const overwrite = Boolean(args.overwrite);

    if (!fromPath || !toPath) {
      return { content: "Error: Both 'from_path' and 'to_path' are required.", isError: true };
    }

    try {
      const srcTarget = resolveWorkspacePath(ctx.workspacePath, fromPath);
      const srcStat = fs.statSync(srcTarget.realPath);
      if (!srcStat.isFile()) {
        return { content: `Error: '${srcTarget.relPath}' is not a regular file.`, isError: true };
      }

      const destTarget = resolveWorkspacePath(ctx.workspacePath, toPath, {
        allowMissingLeaf: true,
      });
      if (srcTarget.relPath === destTarget.relPath) {
        return { content: `Error: Source and destination paths are identical ('${srcTarget.relPath}').`, isError: true };
      }
      if (fs.existsSync(destTarget.absPath) && !overwrite) {
        return {
          content: `Error: Destination '${destTarget.relPath}' already exists and overwrite=false.`,
          isError: true,
        };
      }

      let previousContent: string | null = null;
      if (srcStat.size <= 5 * 1024 * 1024) {
        const buf = fs.readFileSync(srcTarget.realPath);
        if (!isLikelyBinaryBuffer(buf)) {
          previousContent = buf.toString("utf-8");
        }
      }

      const diffPreview = `--- a/${srcTarget.relPath}\n+++ b/${destTarget.relPath}\n@@ rename ${srcTarget.relPath} -> ${destTarget.relPath} @@`;

      if (ctx.workspaceApprovalMode === "ask" && !ctx.isTurnWriteApproved?.()) {
        const decision = await requestToolApproval({
          conversationId: ctx.conversationId,
          callId: ctx.callId,
          toolName: "workspace_rename",
          args,
          diffPreview,
          message: `Approve renaming '${srcTarget.relPath}' to '${destTarget.relPath}'?`,
          emitEvent: ctx.emitEvent,
          abortSignal: ctx.abortSignal,
        });
        if (decision === "approved_all_turn") {
          ctx.markTurnWriteApproved?.();
        } else if (decision !== "approved") {
          return {
            content: `User rejected renaming '${srcTarget.relPath}' to '${destTarget.relPath}'.`,
            isError: true,
            diffPreview,
          };
        }
        ctx.emitEvent?.("tool_execution", {
          callId: ctx.callId,
          toolName: "workspace_rename",
          args,
          cacheable: false,
          status: "executing",
        });
      }

      fs.mkdirSync(path.dirname(destTarget.absPath), { recursive: true });
      resolveWorkspacePath(ctx.workspacePath, toPath, { allowMissingLeaf: true });
      fs.renameSync(srcTarget.realPath, destTarget.absPath);

      const checkpointId = recordWorkspaceCheckpoint({
        conversationId: ctx.conversationId,
        toolCallId: ctx.callId,
        toolName: "workspace_rename",
        workspaceRoot: srcTarget.realRoot,
        relPath: srcTarget.relPath,
        destRelPath: destTarget.relPath,
        action: "rename",
        previousContent,
        newContent: previousContent,
      });

      removeWorkspaceFileArtifact(ctx.conversationId, srcTarget.relPath);
      upsertWorkspaceFileArtifact({
        conversationId: ctx.conversationId,
        relPath: destTarget.relPath,
        absPath: destTarget.absPath,
        emitEvent: ctx.emitEvent,
      });

      return {
        content: `Renamed '${srcTarget.relPath}' to '${destTarget.relPath}'.\n\`\`\`diff\n${diffPreview}\n\`\`\``,
        checkpointId,
        diffPreview,
      };
    } catch (err: any) {
      return { content: `Error renaming workspace file: ${err?.message || String(err)}`, isError: true };
    }
  },
};

export const workspaceRunToolDef: BuiltInToolDefinition = {
  name: "workspace_run",
  category: "workspace",
  description:
    "Propose and run a shell verification command (such as 'npm test', 'cargo check', 'pytest', or a linter/build script) inside the attached project workspace. Requires explicit user approval per command before execution.",
  parameters: {
    type: "object",
    properties: {
      command: {
        type: "string",
        description: "The shell command to execute inside the workspace.",
      },
      cwd: {
        type: "string",
        description: "Optional relative subdirectory inside the workspace to run the command in (defaults to '.').",
      },
      timeout_sec: {
        type: "number",
        description: "Maximum execution time in seconds before terminating the process (default 60, max 300).",
      },
    },
    required: ["command"],
  },
  isAvailable: (ctx?: BuiltInToolContext) =>
    Boolean(ctx?.workspacePath && ctx?.workspaceWriteEnabled),
  cacheable: false,
  execute: async (args: Record<string, any>, ctx: BuiltInToolContext) => {
    if (!ctx.workspacePath) {
      return { content: "Error: No workspace is attached to this conversation.", isError: true };
    }
    if (!ctx.workspaceWriteEnabled) {
      return {
        content:
          "Error: Workspace write access is disabled (read-only mode). Enable write access in the workspace controls to run commands.",
        isError: true,
      };
    }

    const command = String(args.command || "").trim();
    if (!command) {
      return { content: "Error: 'command' parameter is required.", isError: true };
    }

    const subCwd = typeof args.cwd === "string" && args.cwd.trim() ? args.cwd.trim() : ".";
    const timeoutSec = Math.min(Math.max(Number(args.timeout_sec) || 60, 1), 300);

    try {
      const cwdTarget = resolveWorkspacePath(ctx.workspacePath, subCwd, {
        allowRoot: true,
      });
      if (!fs.statSync(cwdTarget.realPath).isDirectory()) {
        return { content: `Error: cwd '${subCwd}' is not a directory.`, isError: true };
      }

      const displayCwd = cwdTarget.relPath || ".";

      if (!ctx.autoApproveCommands) {
        const decision = await requestToolApproval({
          conversationId: ctx.conversationId,
          callId: ctx.callId,
          toolName: "workspace_run",
          args,
          commandPreview: command,
          cwd: displayCwd,
          message: `Approve running '${command}' in '${displayCwd}'?`,
          emitEvent: ctx.emitEvent,
          abortSignal: ctx.abortSignal,
        });
        if (decision !== "approved" && decision !== "approved_all_turn") {
          return {
            content: `User rejected running command: ${command}`,
            isError: true,
            commandPreview: command,
            cwd: displayCwd,
          };
        }
        ctx.emitEvent?.("tool_execution", {
          callId: ctx.callId,
          toolName: "workspace_run",
          args,
          cacheable: false,
          commandPreview: command,
          cwd: displayCwd,
          status: "executing",
        });
      }

      return await new Promise((resolve) => {
        const MAX_OUTPUT_BYTES = 64 * 1024;
        let outBuf = "";
        let errBuf = "";
        let timedOut = false;

        const child = spawn(command, {
          cwd: cwdTarget.realPath,
          shell: true,
          env: { ...process.env, CI: "1" },
          stdio: ["ignore", "pipe", "pipe"],
        });

        const timer = setTimeout(() => {
          timedOut = true;
          try {
            child.kill("SIGTERM");
            setTimeout(() => {
              try {
                child.kill("SIGKILL");
              } catch { }
            }, 1500);
          } catch { }
        }, timeoutSec * 1000);

        const onAbort = () => {
          try {
            child.kill("SIGTERM");
          } catch { }
        };
        ctx.abortSignal?.addEventListener("abort", onAbort, { once: true });

        child.stdout?.on("data", (chunk: Buffer) => {
          if (outBuf.length < MAX_OUTPUT_BYTES) {
            outBuf += chunk.toString("utf-8").slice(0, MAX_OUTPUT_BYTES - outBuf.length);
          }
        });

        child.stderr?.on("data", (chunk: Buffer) => {
          if (errBuf.length < MAX_OUTPUT_BYTES) {
            errBuf += chunk.toString("utf-8").slice(0, MAX_OUTPUT_BYTES - errBuf.length);
          }
        });

        child.on("error", (err) => {
          clearTimeout(timer);
          ctx.abortSignal?.removeEventListener("abort", onAbort);
          resolve({
            content: `Error spawning command '${command}': ${err.message}`,
            isError: true,
            commandPreview: command,
            cwd: displayCwd,
          });
        });

        child.on("close", (code, signal) => {
          clearTimeout(timer);
          ctx.abortSignal?.removeEventListener("abort", onAbort);
          const parts: string[] = [
            `Command: ${command}`,
            `Directory: ${displayCwd}`,
            timedOut
              ? `Status: Timed out after ${timeoutSec}s`
              : `Exit code: ${code ?? "null"}${signal ? ` (signal ${signal})` : ""}`,
          ];
          if (outBuf.trim()) {
            parts.push(`\n--- stdout ---\n${outBuf.trim()}`);
          }
          if (errBuf.trim()) {
            parts.push(`\n--- stderr ---\n${errBuf.trim()}`);
          }
          if (!outBuf.trim() && !errBuf.trim()) {
            parts.push("\n(no stdout/stderr output)");
          }
          resolve({
            content: parts.join("\n"),
            isError: timedOut || (code !== 0 && code !== null),
            commandPreview: command,
            cwd: displayCwd,
          });
        });
      });
    } catch (err: any) {
      return {
        content: `Error running workspace command: ${err?.message || String(err)}`,
        isError: true,
      };
    }
  },
};
