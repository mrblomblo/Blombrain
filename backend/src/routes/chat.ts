import { Readable } from "node:stream";
import fs from "node:fs";
import path from "node:path";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { backendRegistry } from "../registry.js";
import { persistChatTurn } from "./conversations.js";
import { assignAttachmentsToConversation } from "./uploads.js";
import db, { DATA_DIR } from "../db.js";
import type { ArtifactRow, AttachmentRow, MessageRow, ModelSettingRow, SlashToolSelection } from "../types.js";
import { getAdapter } from "../adapters/index.js";
import { mcpManager } from "../services/mcp.js";
import { extractDocumentTextAsync } from "../services/documentExtractor.js";
import {
  isLikelyBinaryBuffer,
  listWorkspaceEntries,
  resolveEffectiveWorkspace,
  resolveWorkspacePath,
} from "../services/builtinTools/tools/workspaceUtils.js";
import { resolveToolApproval } from "../services/toolApproval.js";
import { getAllPromptTemplates } from "./promptTemplates.js";

interface ChatCompletionBody {
  model: string;
  messages: Array<{ id?: string; role: string; content: string | any[]; attachments?: string[] }>;
  temperature?: number;
  conversationId?: string;
  userMessageId?: string;
  userParentId?: string;
  assistantMessageId?: string;
  isContinue?: boolean;
  isReconnect?: boolean;
  attachments?: string[];
  injectedTools?: SlashToolSelection[];
  [key: string]: unknown;
}

function sendJsonError(reply: FastifyReply, status: number, message: string) {
  reply.code(status).send({ error: { message } });
}

const THINK_TAGS = ["think", "thought", "reason", "reasoning"];

function closeUnclosedTags(content: string, tags: string[] = THINK_TAGS): string {
  let newContent = content;
  let totalOpen = 0;
  let totalClose = 0;
  for (const tag of tags) {
    totalOpen += (newContent.match(new RegExp(`<${tag}>`, "gi")) || []).length;
    totalClose += (newContent.match(new RegExp(`</${tag}>`, "gi")) || []).length;
  }
  if (totalOpen > totalClose) {
    const diff = totalOpen - totalClose;
    for (let i = 0; i < diff; i++) {
      newContent += "\n</think>\n";
    }
  }
  return newContent;
}

function isCompleteJson(text: string): boolean {
  if (!text) return false;
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

function reconstructToolCalls(messages: any[]): any[] {
  const reconstructed: any[] = [];
  for (const msg of messages) {
    if (msg.role === "assistant" && typeof msg.content === "string") {
      let newContent = msg.content
        .replace(/<context_notice>[\s\S]*?<\/context_notice>/g, "")
        .replace(/<router_execution>([\s\S]*?)<\/router_execution>/g, "");
      const toolExecRegex = /<tool_execution>([\s\S]*?)<\/tool_execution>/g;
      const toolExecs: any[] = [];
      newContent = newContent.replace(toolExecRegex, (match: string, jsonStr: string) => {
        try { toolExecs.push(JSON.parse(jsonStr)); } catch { console.warn("[blombrain] Failed to parse tool_execution JSON in history"); }
        return "";
      });
      const cleanContent = newContent.trim();

      if (toolExecs.length > 0) {
        reconstructed.push({
          ...msg,
          content: cleanContent,
          tool_calls: toolExecs.map(e => ({
            id: e.callId || `call_${Date.now()}`,
            type: "function",
            function: { name: e.toolName, arguments: typeof e.args === "string" ? e.args : JSON.stringify(e.args || {}) }
          }))
        });
        for (const e of toolExecs) {
          let finalContent = e.result || "";
          if (e.status === "cancelled") {
            finalContent = "[Tool execution was cancelled by the user.]";
          } else if (e.status === "error") {
            finalContent = `[Error executing tool: ${e.result}]\n\nINSTRUCTION: The tool call failed. Analyze the error carefully. If it is a parameter validation or usage error, try calling the tool again with corrected arguments. If the error is unrecoverable (e.g., API limits, missing credentials), inform the user about the failure.`;
          }
          reconstructed.push({
            role: "tool",
            tool_call_id: e.callId || `call_${Date.now()}`,
            name: e.toolName,
            content: finalContent
          });
        }
        continue;
      } else {
        reconstructed.push({ ...msg, content: cleanContent });
        continue;
      }
    }
    reconstructed.push(msg);
  }
  return reconstructed;
}

function extractTextToolCalls(
  text: string,
  allowedToolNames?: Set<string>
): { cleanContent: string; toolCalls: any[] } {
  let cleanContent = text;
  const toolCalls: any[] = [];

  // Protect fenced code blocks and inline code so tool syntax discussed in prose/code is not executed
  const codePlaceholders: string[] = [];
  cleanContent = cleanContent.replace(/```[\s\S]*?```|`[^`\n]+`/g, (match) => {
    const idx = codePlaceholders.length;
    codePlaceholders.push(match);
    return `__CODE_BLOCK_${idx}__`;
  });

  // Strip common internal junk tokens
  cleanContent = cleanContent.replace(/<\|?channel\|?>/gi, "");

  // 1. Match XML tags like <execute_skill_script ... />
  const xmlRegex = /<execute_skill_script\s+([^>]*?)(?:\/>|>(?:[\s\S]*?<\/execute_skill_script>)?)/gi;
  cleanContent = cleanContent.replace(xmlRegex, (match: string, attrString: string) => {
    try {
      const toolName = "execute_skill_script";
      if (allowedToolNames && !allowedToolNames.has(toolName)) {
        return match;
      }
      const args: any = {};
      const attrRegex = /([a-zA-Z0-9_-]+)=("[^"]*"|'[^']*'|[[^\]]*])/g;
      let attrMatch;
      while ((attrMatch = attrRegex.exec(attrString)) !== null) {
        const key = attrMatch[1];
        const valStr = attrMatch[2];
        if (valStr.startsWith('"') || valStr.startsWith("'")) {
          args[key] = valStr.slice(1, -1);
        } else if (valStr.startsWith("[")) {
          args[key] = JSON.parse(valStr.replace(/'/g, '"'));
        }
      }
      if (Object.keys(args).length > 0) {
        toolCalls.push({
          id: `fallback_xml_${Date.now()}_${toolCalls.length}`,
          name: toolName,
          arguments: args,
        });
        return "";
      }
    } catch (e) {
      console.warn("[chat] Failed to parse XML execute_skill_script tag:", e);
    }
    return match;
  });

  // 2. Match raw tool call tags like <|tool_call>call:func{...}<tool_call|> or <|tool_call|>call:func{...}<|tool_call|>
  const rawTagRegex = /<\|?tool_call\|?>\s*call:([a-zA-Z0-9_-]+)\s*(\{[\s\S]*?\})\s*<\|?\/?tool_call\|?>?(?:<\|?tool_response\|?>?)?/gi;
  cleanContent = cleanContent.replace(rawTagRegex, (match: string, toolName: string, jsonArgs: string) => {
    try {
      if (allowedToolNames && !allowedToolNames.has(toolName)) {
        return match;
      }
      let sanitizedJson = jsonArgs;
      const strings: string[] = [];

      // 1. Extract strings, escaping them safely and replacing with placeholders
      sanitizedJson = sanitizedJson.replace(/<\|"\|>([\s\S]*?)<\|"\|>/g, (_m: string, innerText: string) => {
        strings.push(innerText);
        return `"__STR_${strings.length - 1}__"`;
      });

      // 2. Quote structural unquoted keys safely (now that string literals are hidden)
      sanitizedJson = sanitizedJson.replace(/([{,]\s*)([a-zA-Z0-9_-]+)\s*:/g, '$1"$2":');

      // 3. Put strings back with proper JSON escaping
      sanitizedJson = sanitizedJson.replace(/"__STR_(\d+)__"/g, (_m: string, idxStr: string) => {
        const text = strings[parseInt(idxStr, 10)];
        let escaped = text.replace(/\\/g, "\\\\").replace(/"/g, "\\\"");
        escaped = escaped.replace(/\n/g, "\\n").replace(/\r/g, "\\r").replace(/\t/g, "\\t");
        return '"' + escaped + '"';
      });

      const parsedArgs = JSON.parse(sanitizedJson);
      toolCalls.push({
        id: `fallback_raw_${Date.now()}_${toolCalls.length}`,
        name: toolName,
        arguments: parsedArgs,
      });
      return "";
    } catch (e) {
      console.warn("[chat] Failed to parse raw tool_call tag:", e);
    }
    return match;
  });

  // Restore protected code blocks
  codePlaceholders.forEach((block, idx) => {
    cleanContent = cleanContent.replace(`__CODE_BLOCK_${idx}__`, block);
  });

  return { cleanContent: cleanContent.trim(), toolCalls };
}

export interface ActiveStream {
  conversationId: string;
  userMessageId: string;
  userParentId: string | null;
  assistantMessageId: string;
  model: string;
  originalUserContent: string;
  attachmentIds?: string[];
  assistantContent: string;
  activeToolEvent?: Record<string, any> | null;
  reasoningMode: "oob" | "inband" | null;
  thinkingStartMs: number;
  usageStats: any;
  streamError: string | null;
  startTime: number;
  isDone: boolean;
  abortController: AbortController;
  subscribers: Set<FastifyReply>;
  doSaveTurn: () => void;
}

export const activeStreams = new Map<string, ActiveStream>();

/** Convert MCP tool definitions to OpenAI-compatible tool schema format. */
function mcpToolsToOpenAIFormat(mcpTools: import("../services/mcp.js").McpToolDefinition[]) {
  return mcpTools.map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description ?? "",
      parameters: t.inputSchema ?? { type: "object", properties: {} },
    },
  }));
}

/** Run a single streaming generation pass, collecting all content + tool calls. */
async function runGenerationPass(opts: {
  adapter: import("../adapters/types.js").ApiAdapter;
  buildParams: any;
  abortController: AbortController;
  onChunk: (sseChunk: string) => void;
  stripPrefix?: string;
  allocateCallId?: (rawId: string | undefined, idx: number) => string;
  onToolCallStreaming?: (info: {
    callId: string;
    name: string;
    argsBytes: number;
    partialPath?: string;
  }) => void;
}): Promise<{
  content: string;
  reasoning: string;
  toolCalls: Array<{ id?: string; name: string; arguments: Record<string, any>; parseError?: string }>;
  usageStats?: any;
  streamError?: string;
  reasoningMode: "oob" | "inband" | null;
}> {
  const { adapter, buildParams, abortController, onChunk, stripPrefix, allocateCallId, onToolCallStreaming } = opts;

  let reqConfig;
  try {
    reqConfig = await adapter.buildRequest(buildParams);
  } catch (err) {
    return { content: "", reasoning: "", toolCalls: [], streamError: `Adapter failed: ${err instanceof Error ? err.message : err}`, reasoningMode: null };
  }

  let upstream: Response;
  try {
    upstream = await fetch(reqConfig.url, { ...reqConfig.init, signal: abortController.signal });
  } catch (err) {
    if ((err as any)?.name === "AbortError") return { content: "", reasoning: "", toolCalls: [], reasoningMode: null };
    return { content: "", reasoning: "", toolCalls: [], streamError: `Couldn't reach backend: ${err instanceof Error ? err.message : err}`, reasoningMode: null };
  }

  if (!upstream.ok || !upstream.body) {
    const text = await upstream.text().catch(() => "");
    return { content: "", reasoning: "", toolCalls: [], streamError: text || upstream.statusText, reasoningMode: null };
  }

  const nodeStream = Readable.fromWeb(upstream.body as import("stream/web").ReadableStream);
  const parser = adapter.createStreamParser(buildParams);

  let content = "";
  let reasoning = "";
  let reasoningMode: "oob" | "inband" | null = null;
  let streamError: string | undefined;
  let usageStats: any;
  let streamedChars = 0;
  let prefixBuffer = stripPrefix ? "" : undefined;
  const prefixToStrip = stripPrefix || "";

  const pendingToolCalls = new Map<
    number,
    { id?: string; assignedCallId?: string; name?: string; argsText: string; lastProgressAt: number; lastProgressBytes: number }
  >();
  const completedToolCalls: Array<{ id?: string; name: string; arguments: Record<string, any>; parseError?: string }> = [];

  await new Promise<void>((resolve) => {
    nodeStream.on("data", (chunk: Buffer) => {
      const events = parser(chunk);
      for (const ev of events) {
        if (ev.error) streamError = ev.error;

        if (ev.reasoning) {
          if (!reasoningMode) {
            reasoningMode = "oob";
            content += "<think>\n";
          }
          reasoning += ev.reasoning;
          content += ev.reasoning;
        }

        if (ev.delta) {
          if (reasoningMode === "oob") {
            reasoningMode = null;
            content += "\n</think>\n";
          }
          if (ev.delta.includes("<think>")) {
            reasoningMode = "inband";
          }
          if (reasoningMode === "inband" && ev.delta.includes("</think>")) {
            reasoningMode = null;
          }
          content += ev.delta;
          streamedChars += ev.delta.length;

          let deltaToSend = ev.delta;

          // Strip duplicated prefix if continuing
          if (prefixBuffer !== undefined) {
            prefixBuffer += ev.delta;
            if (prefixBuffer.length >= prefixToStrip.length) {
              if (prefixBuffer.startsWith(prefixToStrip)) {
                deltaToSend = prefixBuffer.slice(prefixToStrip.length);
              } else {
                deltaToSend = prefixBuffer;
              }
              prefixBuffer = undefined;
            } else {
              if (prefixToStrip.startsWith(prefixBuffer)) {
                deltaToSend = "";
              } else {
                deltaToSend = prefixBuffer;
                prefixBuffer = undefined;
              }
            }
          }

          if (deltaToSend) {
            onChunk(JSON.stringify({
              id: `chatcmpl-internal`,
              object: "chat.completion.chunk",
              created: Math.floor(Date.now() / 1000),
              choices: [{
                index: 0,
                delta: { content: deltaToSend },
                finish_reason: ev.isDone ? "stop" : null,
              }],
            }));
          }
        }

        // Accumulate tool calls (may stream in pieces)
        if (ev.toolCalls) {
          for (const tc of ev.toolCalls) {
            if (tc.function?.name !== undefined || tc.function?.arguments !== undefined) {
              let idx = tc.index;
              if (idx === undefined && tc.id) {
                const found = Array.from(pendingToolCalls.entries()).find(([, v]) => v.id === tc.id);
                if (found) idx = found[0];
              }
              if (idx === undefined) {
                // Routing tool calls to the last pending slot to prevent duplicate tool calls.
                const lastIdx = pendingToolCalls.size > 0 ? pendingToolCalls.size - 1 : undefined;
                const lastEntry = lastIdx !== undefined ? pendingToolCalls.get(lastIdx) : undefined;

                if (tc.function?.name === undefined) {
                  // Continuation of whatever call is currently being streamed.
                  idx = lastIdx !== undefined ? lastIdx : 0;
                } else if (
                  lastEntry &&
                  lastEntry.name === tc.function.name &&
                  !isCompleteJson(lastEntry.argsText)
                ) {
                  // Re-emission/continuation of the same call, not a new one.
                  idx = lastIdx;
                } else {
                  // Genuinely a new call.
                  idx = pendingToolCalls.size;
                }
              }

              const targetIdx = idx ?? 0;
              const existing = pendingToolCalls.get(targetIdx) ?? {
                argsText: "",
                lastProgressAt: 0,
                lastProgressBytes: 0,
              };
              if (tc.id) existing.id = tc.id;
              if (tc.function?.name !== undefined) existing.name = tc.function.name;
              if (tc.function?.arguments !== undefined) {
                if (typeof tc.function.arguments === "string") {
                  const incoming = tc.function.arguments;
                  if (existing.argsText && incoming.length >= existing.argsText.length && incoming.startsWith(existing.argsText)) {
                    existing.argsText = incoming;
                  } else if (
                    existing.argsText &&
                    incoming.trimStart().startsWith("{") &&
                    isCompleteJson(existing.argsText) &&
                    isCompleteJson(incoming)
                  ) {
                    existing.argsText = incoming;
                  } else {
                    existing.argsText += incoming;
                  }
                } else {
                  existing.argsText = JSON.stringify(tc.function.arguments);
                }
              }
              if (existing.name && !existing.assignedCallId && allocateCallId) {
                existing.assignedCallId = allocateCallId(existing.id, targetIdx);
              }
              pendingToolCalls.set(targetIdx, existing);

              if (existing.name && existing.assignedCallId && onToolCallStreaming) {
                const nowMs = Date.now();
                const bytes = Buffer.byteLength(existing.argsText, "utf-8");
                if (
                  existing.lastProgressAt === 0 ||
                  nowMs - existing.lastProgressAt >= 350 ||
                  bytes - existing.lastProgressBytes >= 2048
                ) {
                  existing.lastProgressAt = nowMs;
                  existing.lastProgressBytes = bytes;
                  const pathMatch = existing.argsText.match(/"(?:path|filename|from_path|command)"\s*:\s*"([^"\n]{1,140})"/);
                  onToolCallStreaming({
                    callId: existing.assignedCallId,
                    name: existing.name,
                    argsBytes: bytes,
                    partialPath: pathMatch?.[1],
                  });
                }
              }
            }
          }
        }

        if (ev.usage) {
          usageStats = {
            promptTokens: ev.usage.promptTokens,
            completionTokens: ev.usage.completionTokens,
            totalTokens: ev.usage.totalTokens,
          };
        }

        // Forward content and reasoning chunks to SSE subscribers
        if (ev.reasoning || ev.error) {
          onChunk(JSON.stringify({
            id: `chatcmpl-internal`,
            object: "chat.completion.chunk",
            created: Math.floor(Date.now() / 1000),
            choices: [{
              index: 0,
              delta: {
                ...(ev.reasoning ? { reasoning_content: ev.reasoning } : {}),
              },
              finish_reason: ev.isDone ? "stop" : null,
            }],
          }));
        }
      }
    });

    // Guard: `end`, `close`, and `error` can all fire for the same stream.
    // Without this flag we flush pendingToolCalls multiple times, duplicating every tool call.
    let resolved = false;
    const done = (err?: string) => {
      if (resolved) return;
      resolved = true;
      if (err) streamError = err;

      // Flush any partial tool calls
      for (const [entryIdx, entry] of pendingToolCalls) {
        if (entry.name) {
          let args: Record<string, any> = {};
          let parseError: string | undefined;
          if (entry.argsText && entry.argsText.trim()) {
            try {
              const parsed = JSON.parse(entry.argsText);
              if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
                args = parsed;
              } else {
                parseError = `Tool arguments must be a JSON object, got ${typeof parsed}.`;
              }
            } catch (parseErr: any) {
              parseError = `Malformed or truncated JSON arguments for '${entry.name}' (${Buffer.byteLength(entry.argsText, "utf-8")} bytes received): ${parseErr?.message || String(parseErr)}. If the output was truncated by max_tokens, write a shorter file or split edits into smaller chunks.`;
            }
          }
          const finalId =
            entry.assignedCallId ??
            (allocateCallId ? allocateCallId(entry.id, entryIdx) : entry.id);
          completedToolCalls.push({
            id: finalId,
            name: entry.name,
            arguments: args,
            ...(parseError ? { parseError } : {}),
          });
        }
      }

      // Deduplicate identical tool calls (same name + same arguments)
      const seenCalls = new Set<string>();
      const deduped: typeof completedToolCalls = [];
      for (const call of completedToolCalls) {
        const key = `${call.name}::${JSON.stringify(call.arguments)}`;
        if (seenCalls.has(key)) continue;
        seenCalls.add(key);
        deduped.push(call);
      }
      completedToolCalls.length = 0;
      completedToolCalls.push(...deduped);

      resolve();
    };

    nodeStream.on("end", () => done());
    nodeStream.on("error", (err) => done(String(err)));
    nodeStream.on("close", () => done());
  });

  const closedContent = closeUnclosedTags(content);
  if (closedContent !== content) {
    const addedSuffix = closedContent.slice(content.length);
    if (addedSuffix) {
      onChunk(JSON.stringify({
        id: `chatcmpl-internal`,
        object: "chat.completion.chunk",
        created: Math.floor(Date.now() / 1000),
        choices: [{
          index: 0,
          delta: { content: addedSuffix },
          finish_reason: null,
        }],
      }));
    }
    content = closedContent;
  }

  if (stripPrefix && content.startsWith(stripPrefix)) {
    content = content.slice(stripPrefix.length);
  }

  if (!usageStats?.completionTokens && streamedChars > 0) {
    usageStats = {
      ...(usageStats ?? {}),
      completionTokens: Math.ceil(streamedChars / 4)
    };
  }

  return { content, reasoning, toolCalls: completedToolCalls, usageStats, streamError, reasoningMode };
}

/** Helper to run a promise with a timeout, used for MCP tool calls. */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    promise.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}

function buildArtifactCardTag(conversationId: string, filename: string): string | null {
  const row = db.prepare(
    "SELECT * FROM artifacts WHERE conversation_id = ? AND filename = ?"
  ).get(conversationId, filename) as any;
  if (!row) return null;

  const safeTitle = String(row.title ?? filename).replace(/"/g, "'");
  return `<artifact-card id="${row.id}" filename="${row.filename}" title="${safeTitle}" lang="${row.language}"></artifact-card>`;
}

function materializeArtifactCards(
  content: string,
  conversationId: string,
  createdFilenames: Set<string>
): string {
  let result = content;
  const placed = new Set<string>();

  // Replace every [artifact: x] / [present: x] placeholder whose artifact exists.
  result = result.replace(/\[(?:artifact|present):\s*([^\]\n]+)\]/gi, (match, rawName) => {
    const filename = String(rawName).trim();
    const card = buildArtifactCardTag(conversationId, filename);
    if (card) {
      placed.add(filename);
      return `\n${card}\n`;
    }
    return match; // artifact not found -> leave placeholder as-is
  });

  // Append cards for artifacts created/presented this turn that never got a placeholder.
  for (const filename of createdFilenames) {
    if (placed.has(filename)) continue;
    if (result.includes(`filename="${filename}"`)) continue; // already embedded elsewhere
    const card = buildArtifactCardTag(conversationId, filename);
    if (card) {
      result += `\n${card}\n`;
      placed.add(filename);
    }
  }

  return result;
}

export async function chatRoutes(app: FastifyInstance) {
  app.post("/api/chat/stop", async (req: FastifyRequest, reply: FastifyReply) => {
    const { conversationId } = req.body as { conversationId: string };
    if (!conversationId) return sendJsonError(reply, 400, "conversationId is required");

    const stream = activeStreams.get(conversationId);
    if (stream && !stream.isDone) {
      stream.streamError = "Operation aborted";
      stream.abortController.abort();
      stream.doSaveTurn();
      activeStreams.delete(conversationId);
    }
    return reply.send({ success: true });
  });

  app.post("/api/chat/tool-approval", async (req: FastifyRequest, reply: FastifyReply) => {
    const { callId, approved, approveAllInTurn } = (req.body ?? {}) as {
      conversationId?: string;
      callId?: string;
      approved?: boolean;
      approveAllInTurn?: boolean;
    };
    if (!callId || typeof callId !== "string") {
      return sendJsonError(reply, 400, "callId is required");
    }
    const decision = approveAllInTurn ? "approved_all_turn" : approved ? "approved" : "rejected";
    const resolved = resolveToolApproval(callId, decision);
    return reply.send({ ok: true, resolved });
  });

  app.post("/api/chat/completions", async (req: FastifyRequest, reply: FastifyReply) => {
    const body = req.body as ChatCompletionBody;
    if (!body?.model || !Array.isArray(body.messages)) {
      return sendJsonError(reply, 400, "Request body must include `model` and `messages`.");
    }

    const conversationId = body.conversationId ?? crypto.randomUUID();

    // 1. If an active stream is ALREADY running for this conversation, attach to it
    const existingStream = activeStreams.get(conversationId);
    if (existingStream && !existingStream.isDone) {
      reply.hijack();
      reply.raw.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });

      reply.raw.write(`data: ${JSON.stringify({
        type: "meta",
        conversationId,
        title: "Chat",
        isNew: false,
        isReconnect: true,
        userMessageId: existingStream.userMessageId,
        assistantMessageId: existingStream.assistantMessageId,
        stats: existingStream.usageStats,
      })}\n\n`);

      if (existingStream.assistantContent) {
        reply.raw.write(`data: ${JSON.stringify({
          id: `chatcmpl-${existingStream.userMessageId}`,
          object: "chat.completion.chunk",
          created: Math.floor(Date.now() / 1000),
          model: existingStream.model,
          choices: [{ index: 0, delta: { content: existingStream.assistantContent }, finish_reason: null }],
        })}\n\n`);
      }

      if (existingStream.activeToolEvent) {
        reply.raw.write(`data: ${JSON.stringify(existingStream.activeToolEvent)}\n\n`);
      }

      existingStream.subscribers.add(reply);
      const onDisconnect = () => { existingStream.subscribers.delete(reply); };
      reply.raw.on("close", onDisconnect);
      req.raw.on("aborted", onDisconnect);
      return;
    }

    // If this was strictly a reconnect attempt and the stream already finished, return persisted message without starting a duplicate generation
    if (body.isReconnect) {
      reply.hijack();
      reply.raw.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      if (body.assistantMessageId) {
        const savedAsst = db.prepare("SELECT * FROM messages WHERE id = ?").get(body.assistantMessageId) as MessageRow | undefined;
        const convRow = db.prepare("SELECT title FROM conversations WHERE id = ?").get(conversationId) as { title?: string } | undefined;
        if (savedAsst) {
          reply.raw.write(`data: ${JSON.stringify({
            type: "meta",
            conversationId,
            title: convRow?.title || "Chat",
            isNew: false,
            isReconnect: true,
            userMessageId: savedAsst.parent_id ?? "",
            assistantMessageId: savedAsst.id,
            stats: savedAsst.stats ? JSON.parse(savedAsst.stats) : undefined,
          })}\n\n`);
          reply.raw.write(`data: ${JSON.stringify({
            type: "content_replace",
            content: savedAsst.content || "",
          })}\n\n`);
        }
      }
      reply.raw.write("data: [DONE]\n\n");
      reply.raw.end();
      return;
    }

    // 2. Start new generation stream
    const abortController = new AbortController();

    let targetModelId = body.model;
    const settingRow = db.prepare("SELECT * FROM model_settings WHERE id = ?").get(body.model) as ModelSettingRow | undefined;
    if (settingRow && settingRow.is_preset && settingRow.base_model_id) {
      targetModelId = settingRow.base_model_id;
    }

    const resolved = backendRegistry.resolveModelId(targetModelId);
    if (!resolved) {
      return sendJsonError(reply, 400, `Model id "${body.model}" (resolved to "${targetModelId}") doesn't match any configured backend prefix.`);
    }
    const { backend, rawModelId } = resolved;
    if (!backend.isEnabled) {
      return sendJsonError(reply, 409, `Backend "${backend.name}" is disabled. Enable it in Settings > Backends to use this model.`);
    }

    // -----------------------------------------------------------------------
    // 3. Fetch per-conversation excluded MCP/Skill IDs, tools_enabled, memory_enabled, and overrides from DB
    // -----------------------------------------------------------------------
    let excludedMcps: string[] = Array.isArray((body as any).excludedMcps) ? (body as any).excludedMcps : [];
    let excludedSkills: string[] = Array.isArray((body as any).excludedSkills) ? (body as any).excludedSkills : [];
    let toolsEnabled = (body as any).toolsEnabled !== undefined ? Boolean((body as any).toolsEnabled) : true;
    let convMemoryEnabled: boolean | null =
      (body as any).memoryEnabled !== undefined && (body as any).memoryEnabled !== null
        ? Boolean((body as any).memoryEnabled)
        : null;
    let convSystemPromptOverride: string | null =
      typeof (body as any).systemPromptOverride === "string"
        ? (body as any).systemPromptOverride.trim() || null
        : null;
    let convSamplingOverrides: { temperature?: number | null; maxTokens?: number | null; reasoningEffort?: string | null } | null =
      (body as any).samplingOverrides && typeof (body as any).samplingOverrides === "object"
        ? (body as any).samplingOverrides
        : null;

    if (body.conversationId) {
      const convRow = db.prepare("SELECT excluded_mcps, excluded_skills, tools_enabled, memory_enabled, system_prompt_override, sampling_overrides FROM conversations WHERE id = ?").get(body.conversationId) as any;
      if (convRow) {
        if ((body as any).excludedMcps === undefined) {
          try { excludedMcps = JSON.parse(convRow.excluded_mcps || "[]"); } catch { }
        }
        if ((body as any).excludedSkills === undefined) {
          try { excludedSkills = JSON.parse(convRow.excluded_skills || "[]"); } catch { }
        }
        if ((body as any).toolsEnabled === undefined && convRow.tools_enabled !== undefined && convRow.tools_enabled !== null) {
          toolsEnabled = Boolean(convRow.tools_enabled);
        }
        if (convMemoryEnabled === null && convRow.memory_enabled !== undefined && convRow.memory_enabled !== null) {
          convMemoryEnabled = Boolean(convRow.memory_enabled);
        }
        if (convSystemPromptOverride === null && convRow.system_prompt_override) {
          convSystemPromptOverride = String(convRow.system_prompt_override).trim() || null;
        }
        if (convSamplingOverrides === null && convRow.sampling_overrides) {
          try {
            convSamplingOverrides = JSON.parse(convRow.sampling_overrides);
          } catch { }
        }
      }
    }

    // Extract user query for routing
    const lastUserMsg = [...body.messages].reverse().find((m) => m.role === "user");
    const fallbackOriginalUserContent: string =
      typeof lastUserMsg?.content === "string"
        ? lastUserMsg.content
        : Array.isArray(lastUserMsg?.content)
          ? (lastUserMsg.content.find((p: any) => p.type === "text")?.text ?? "")
          : "";

    // Extract forced tools if supplied by frontend
    const forcedTools: string[] = Array.isArray(body.forcedTools)
      ? (body.forcedTools as string[])
      : Array.isArray(body.forceTools)
        ? (body.forceTools as string[])
        : [];

    const isContinue = !!body.isContinue;
    let contextLimit = settingRow?.ctx_length ?? null;

    let userMessageId: string;
    let userParentId: string | null;
    let assistantMessageId: string;
    let originalUserContent: string = fallbackOriginalUserContent;
    let initialAssistantContent: string = "";

    if (isContinue && body.assistantMessageId) {
      assistantMessageId = body.assistantMessageId;
      const existingAsst = db.prepare("SELECT * FROM messages WHERE id = ?").get(assistantMessageId) as MessageRow | undefined;
      if (!existingAsst) {
        return sendJsonError(reply, 400, "Cannot continue: assistant message not found.");
      }
      userMessageId = existingAsst.parent_id!;
      initialAssistantContent = existingAsst.content || "";

      const existingUser = db.prepare("SELECT * FROM messages WHERE id = ?").get(userMessageId) as MessageRow | undefined;
      if (existingUser) {
        userParentId = existingUser.parent_id ?? null;
        originalUserContent = existingUser.content || fallbackOriginalUserContent;
      } else {
        userParentId = null;
      }
    } else {
      userMessageId = body.userMessageId ? String(body.userMessageId) : crypto.randomUUID();
      userParentId = body.userParentId ? String(body.userParentId) : null;
      assistantMessageId = body.assistantMessageId ? String(body.assistantMessageId) : crypto.randomUUID();
    }

    const attachmentIds = body.attachments;

    // Hijack response and start SSE stream early so routing progress can be emitted
    reply.hijack();
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });

    const subscribers = new Set<FastifyReply>();
    subscribers.add(reply);
    let streamRef: ActiveStream | null = null;

    function broadcastChunk(sseChunk: string) {
      if (streamRef && sseChunk.includes('"tool_execution"')) {
        try {
          const parsed = JSON.parse(sseChunk);
          if (parsed?.type === "tool_execution") {
            if (parsed.status === "executing" || parsed.status === "awaiting_approval" || parsed.status === "polling") {
              streamRef.activeToolEvent = parsed;
            } else {
              streamRef.activeToolEvent = null;
            }
          }
        } catch { }
      }
      const line = `data: ${sseChunk}\n\n`;
      for (const sub of subscribers) {
        if (!sub.raw.writableEnded) sub.raw.write(line);
      }
    }

    const isNewConversation = !body.conversationId;
    if (isNewConversation) {
      reply.raw.write(`data: ${JSON.stringify({
        type: "meta",
        conversationId,
        title: "New conversation",
        isNew: true,
        userMessageId,
        assistantMessageId,
      })}\n\n`);
    }

    let assistantContent = isContinue ? initialAssistantContent : "";
    const artifactFilenamesThisTurn = new Set<string>();
    let routerRawText = "";
    const userQuery = originalUserContent;
    let currentToolExecution: { callId: string; toolName: string; args: any } | null = null;
    let streamError: string | null = null;
    let usageStats: {
      promptTokens?: number;
      completionTokens?: number;
      totalTokens?: number;
      durationMs?: number;
      generationMs?: number;
      tokensPerSecond?: number;
      thinkingTimeMs?: number;
    } | undefined;

    let totalGenerationMs = 0;
    let totalCompletionTokens = 0;
    let totalPromptTokens = 0;
    let lastRawUsage: any = null;
    const startTime = Date.now();
    let hasPersisted = false;

    function doSaveTurn() {
      if (hasPersisted) return;
      hasPersisted = true;

      try {
        if (!usageStats) usageStats = {};
        if (!usageStats.durationMs && Date.now() - startTime > 0) {
          usageStats.durationMs = Date.now() - startTime;
        }

        usageStats.promptTokens = totalPromptTokens || lastRawUsage?.promptTokens;
        usageStats.completionTokens = totalCompletionTokens || lastRawUsage?.completionTokens;
        usageStats.totalTokens =
          (usageStats.promptTokens ?? 0) + (usageStats.completionTokens ?? 0);

        if (!usageStats.durationMs) {
          usageStats.durationMs = Date.now() - startTime;
        }

        usageStats.generationMs = totalGenerationMs;
        usageStats.tokensPerSecond =
          totalGenerationMs > 0 && totalCompletionTokens > 0
            ? Number((totalCompletionTokens / (totalGenerationMs / 1000)).toFixed(2))
            : undefined;

        if (lastRawUsage && typeof lastRawUsage === "object") {
          for (const k of Object.keys(lastRawUsage)) {
            if (!(k in usageStats)) (usageStats as any)[k] = lastRawUsage[k];
          }
        }

        if (currentToolExecution && !assistantContent.includes(currentToolExecution.callId)) {
          const cancelledPayload = {
            callId: currentToolExecution.callId,
            toolName: currentToolExecution.toolName,
            args: currentToolExecution.args,
            status: "cancelled",
          };
          assistantContent += `\n<tool_execution>${JSON.stringify(cancelledPayload)}</tool_execution>\n`;
        }

        assistantContent = closeUnclosedTags(assistantContent);
        const savedTurn = persistChatTurn({
          conversationId,
          model: body.model,
          userMessageId,
          userParentId,
          userContent: originalUserContent,
          assistantMessageId,
          assistantContent,
          assistantError: currentActiveStream.streamError ?? streamError ?? undefined,
          assistantStats: usageStats,
          toolsEnabled,
        });

        if (attachmentIds && Array.isArray(attachmentIds)) {
          assignAttachmentsToConversation(attachmentIds, savedTurn.conversationId, userMessageId);
        }

        const metaEvent = `data: ${JSON.stringify({
          type: "meta",
          conversationId: savedTurn.conversationId,
          title: savedTurn.title,
          isNew: savedTurn.isNew,
          userMessageId,
          assistantMessageId,
          stats: usageStats,
        })}\n\n`;

        for (const sub of subscribers) {
          if (!sub.raw.writableEnded) {
            sub.raw.write(metaEvent);
            sub.raw.write("data: [DONE]\n\n");
            sub.raw.end();
          }
        }
      } catch (err) {
        console.error("[blombrain] failed to persist chat turn:", err);
      }
    }

    const currentActiveStream: ActiveStream = {
      conversationId,
      userMessageId,
      userParentId,
      assistantMessageId,
      model: body.model,
      originalUserContent,
      attachmentIds,
      assistantContent,
      activeToolEvent: null,
      reasoningMode: null,
      thinkingStartMs: 0,
      usageStats: undefined,
      streamError: null,
      startTime,
      isDone: false,
      abortController,
      subscribers,
      doSaveTurn,
    };
    streamRef = currentActiveStream;
    activeStreams.set(conversationId, currentActiveStream);

    const onClientDisconnect = () => { subscribers.delete(reply); };
    reply.raw.on("close", onClientDisconnect);
    req.raw.on("aborted", onClientDisconnect);

    const { extractPrefixTokens, resolveSlashInjections, routeToolsAndSkills, buildRecentContext } = await import(
      "../services/toolRouter.js"
    );

    const effectiveWorkspace = resolveEffectiveWorkspace(conversationId);

    const slashInjections = !isContinue
      ? await resolveSlashInjections(
          Array.isArray(body.injectedTools) ? body.injectedTools : [],
          originalUserContent
        )
      : { hasInjections: false, mcpTools: [], selectedSkills: [], selectedBuiltInTools: [] };

    let mcpTools: any[] = [];
    let activeSkills: any[] = [];
    let builtInTools: any[] = [];

    if (slashInjections.hasInjections) {
      // Explicit / selections or /directives bypass disabled flags and skip the LLM routing pre-pass.
      mcpTools = slashInjections.mcpTools;
      activeSkills = slashInjections.selectedSkills;
      builtInTools = slashInjections.selectedBuiltInTools;
    } else if (toolsEnabled && !isContinue && !abortController.signal.aborted) {
      const priorContext = buildRecentContext(body.messages);
      try {
        const routingResult = await routeToolsAndSkills(
          userQuery,
          excludedMcps,
          excludedSkills,
          forcedTools,
          body.model,
          contextLimit,
          (text: string) => {
            routerRawText += text;
            broadcastChunk(JSON.stringify({ type: "router_token", text }));
          },
          priorContext,
          abortController.signal,
          convMemoryEnabled,
          effectiveWorkspace.path,
          effectiveWorkspace.writeEnabled,
          () => {
            broadcastChunk(JSON.stringify({ type: "status", status: "routing" }));
          }
        );
        mcpTools = routingResult.mcpTools ?? [];
        activeSkills = routingResult.selectedSkills ?? [];
        builtInTools = routingResult.selectedBuiltInTools ?? [];
      } catch (err) {
        if (!abortController.signal.aborted && !(err instanceof Error && (err.name === "AbortError" || err.message.includes("aborted")))) {
          console.error("[toolRouter] Error during pre-pass routing:", err);
        }
      }
    }

    if (routerRawText.trim()) {
      assistantContent = `<router_execution>${routerRawText.trim()}</router_execution>\n` + assistantContent;
      currentActiveStream.assistantContent = assistantContent;
    }

    if (abortController.signal.aborted) {
      currentActiveStream.isDone = true;
      currentActiveStream.doSaveTurn();
      activeStreams.delete(conversationId);
      return;
    }

    // Emit generating status event
    broadcastChunk(JSON.stringify({ type: "status", status: "generating" }));

    // -----------------------------------------------------------------------
    // 5. Build outgoing messages
    // -----------------------------------------------------------------------
    let outgoingMessages = reconstructToolCalls([...body.messages]);

    if (isContinue && outgoingMessages.length > 0 && outgoingMessages[outgoingMessages.length - 1].role === "assistant") {
      outgoingMessages[outgoingMessages.length - 1].content = initialAssistantContent;
    }

    const globalSettingsRow = db.prepare("SELECT ctx_overflow_behavior, reasoning_injection_mode, network_tools_enabled, disabled_builtin_tools, memory_enabled, cross_chat_recall_enabled, cross_chat_include_archived FROM global_settings LIMIT 1").get() as any;
    const defaultReasoningMode = globalSettingsRow?.reasoning_injection_mode || "all";
    const effectiveReasoningMode = settingRow?.reasoning_injection_mode || defaultReasoningMode;
    const globalMemoryEnabled = globalSettingsRow?.memory_enabled !== undefined ? Boolean(globalSettingsRow.memory_enabled) : true;
    const effectiveMemoryEnabled = convMemoryEnabled !== null ? convMemoryEnabled : globalMemoryEnabled;
    const crossChatRecallEnabled = globalSettingsRow?.cross_chat_recall_enabled !== undefined ? Boolean(globalSettingsRow.cross_chat_recall_enabled) : true;
    const crossChatIncludeArchived = Boolean(globalSettingsRow?.cross_chat_include_archived);
    const disabledBuiltInSet = new Set<string>();
    if (globalSettingsRow?.disabled_builtin_tools) {
      try {
        const parsed = JSON.parse(globalSettingsRow.disabled_builtin_tools);
        if (Array.isArray(parsed)) {
          for (const item of parsed) disabledBuiltInSet.add(String(item));
        }
      } catch { }
    }

    const { filterReasoningContent } = await import("../services/contextWindow.js");
    outgoingMessages = filterReasoningContent(outgoingMessages, effectiveReasoningMode as any);

    const effectiveSystemPrompt = [settingRow?.system_prompt, convSystemPromptOverride]
      .filter((p) => typeof p === "string" && p.trim().length > 0)
      .join("\n\n");

    if (effectiveSystemPrompt) {
      if (outgoingMessages.length > 0 && outgoingMessages[0].role === "system") {
        outgoingMessages[0] = { ...outgoingMessages[0], content: effectiveSystemPrompt };
      } else {
        outgoingMessages.unshift({ role: "system", content: effectiveSystemPrompt });
      }
    }

    function appendSystemBlock(block: string) {
      if (!block.trim()) return;
      if (outgoingMessages.length > 0 && outgoingMessages[0].role === "system") {
        outgoingMessages[0] = {
          ...outgoingMessages[0],
          content: outgoingMessages[0].content + "\n\n" + block,
        };
      } else {
        outgoingMessages.unshift({ role: "system", content: block });
      }
    }

    if (toolsEnabled || slashInjections.hasInjections) {
      appendSystemBlock(
        `TOOL USE:\n` +
        `- You have access to real tools via native function calling. Whenever a task benefits from exact computation (math, percentages, dates, timezones, unit conversions), file/workspace inspection, memory lookup, or live lookup, call the appropriate tool instead of guessing or doing mental arithmetic.\n` +
        `- Always invoke tools using native tool calls with exact parameter names and types from each tool's schema. Never print pseudo-tool XML, JSON, or shell commands in place of calling a tool.\n` +
        `- Never assume workspace filenames or file contents: inspect them first with \`list_files\` or \`read_file\`.\n` +
        `- If a tool returns an error, read the error message, adjust your arguments or pick a better tool (for example \`write_file\` if \`edit_file\` fails), and retry.`
      );
    }

    // Inject conversation scratchpad and top relevant persistent user memories into the system prompt
    if (toolsEnabled || builtInTools.some((t) => t.category === "memory")) {
      const { getScratchpadEntries, searchMemories } = await import("../services/memory.js");
      const memoryGuideLines: string[] = [];
      if (effectiveMemoryEnabled) {
        memoryGuideLines.push(
          `- Persistent memory (\`memory_set\`, \`memory_search\`, \`memory_update\`, \`memory_delete\`): proactively save durable user preferences, facts, or standing project context when the user shares or asks to remember them, and search memory when prior user context may apply.`
        );
      }
      if (crossChatRecallEnabled) {
        memoryGuideLines.push(
          `- Past conversations (\`chat_history_search\`): search earlier chats whenever the user refers to prior discussions or decisions.`
        );
      }
      memoryGuideLines.push(
        `- Conversation scratchpad (\`scratchpad_set\`, \`scratchpad_get\`): use for multi-step plans, checklists, or temporary working notes in this chat.`
      );
      const memoryBlocks: string[] = [`MEMORY & SCRATCHPAD:\n${memoryGuideLines.join("\n")}`];

      const scratchEntries = getScratchpadEntries(conversationId);
      if (scratchEntries.length > 0) {
        const formattedScratch = scratchEntries
          .map((e) => `[${e.key}]: ${e.content}`)
          .join("\n");
        memoryBlocks.push(
          `CONVERSATION SCRATCHPAD (current notes for this chat; update via scratchpad_set):\n${formattedScratch}`
        );
      }

      if (effectiveMemoryEnabled && userQuery.trim()) {
        try {
          const relevantMemories = await searchMemories(userQuery, 5, true, abortController.signal);
          if (relevantMemories.length > 0) {
            const formattedMems = relevantMemories
              .map((m) => `- (${m.category}, id=${m.id}): ${m.content}`)
              .join("\n");
            memoryBlocks.push(
              `RELEVANT PERSISTENT USER MEMORIES (manage via memory_set / memory_update / memory_delete / memory_search):\n${formattedMems}`
            );
          }
        } catch { }
      }

      appendSystemBlock(memoryBlocks.join("\n\n"));
    }

    // Inject skill instructions into the context if any skills are active.
    // Key design decisions:
    //   1. Append to the FIRST system message rather than inserting a second one.
    //      Many open-weight models (Llama/Gemma variants) degrade with multiple system messages.
    //   2. Inject skill instructions verbatim. The anchor reminder is sufficient
    //      to prevent the model from confusing skill template content with prior
    //      conversation history.
    //   3. Add a short reminder of the user's original request just before their
    //      message so the model cannot lose track of the actual task across tool rounds.
    if (activeSkills.length > 0) {
      const { getSkillScripts } = await import("../services/skills.js");

      const skillsBlock = activeSkills.map((s) =>
        `### Skill: ${s.name}\n${s.description}\n\nInstructions:\n${s.instructions}`
      ).join("\n\n---\n\n");

      let scriptInstructions = "";
      const activeSkillsWithScripts = activeSkills.filter(s => getSkillScripts(s.dirPath).length > 0);
      if (activeSkillsWithScripts.length > 0) {
        const scriptsBlock = activeSkillsWithScripts.map(s => {
          const scripts = getSkillScripts(s.dirPath).map(script => `- ${script}`).join("\n");
          return `Skill Name: "${s.name}" (ID: "${s.id}") has scripts:\n${scripts}`;
        }).join("\n\n");

        scriptInstructions =
          `\n\nAVAILABLE SKILL SCRIPTS:\n` +
          `If a skill instruction directs you to run a script (such as \`scripts/init-artifact.sh <project-name>\` or \`scripts/bundle-artifact.sh\`), you MUST call the \`execute_skill_script\` tool function with:\n` +
          `- skill_name: The name of the skill (e.g., "${activeSkillsWithScripts[0].name}")\n` +
          `- script_name: The script filename (e.g., "init-artifact.sh")\n` +
          `- cwd: (Optional) Subdirectory to run the script in, relative to the workspace root. Useful for running scripts inside generated projects.\n` +
          `- args: Array of string arguments (e.g., ["my-project"])\n\n` +
          `DO NOT output text commands or XML tags like "<execute_skill_script />". Call the tool function natively.\n\n${scriptsBlock}`;
      }

      const skillContent =
        `ACTIVE SKILLS -- apply these instructions directly in your response.\n` +
        `CRITICAL INSTRUCTION: Skills themselves are procedural references, NOT tools or function calls. ` +
        `DO NOT attempt to call them. Follow their instructions and incorporate the behavior directly into your output.` +
        scriptInstructions + `\n\n` +
        skillsBlock;

      appendSystemBlock(skillContent);

      // Anchor the model to the actual user request by inserting a reminder system message
      // immediately before the first user message. This prevents the model from treating
      // skill template content as conversation history and losing the original task.
      const truncatedRequest = originalUserContent.length > 500
        ? originalUserContent.substring(0, 500) + "... [truncated]"
        : originalUserContent;
      const firstUserIdx = outgoingMessages.findIndex((m) => m.role === "user");
      if (firstUserIdx !== -1) {
        outgoingMessages.splice(firstUserIdx, 0, {
          role: "system",
          _isSkillAnchorReminder: true,
          content: `Reminder: the user's actual request for this turn is: "${truncatedRequest}". Apply the skill instructions above to address this request directly.`,
        });
      }
    }

    const { builtInToolRegistry } = await import("../services/builtinTools/index.js");

    if (toolsEnabled || builtInTools.some((t) => t.category === "artifact")) {
      const artifactGuidance =
        `ARTIFACT & FILE TOOLS:\n` +
        `- When generating HTML web pages, SVG graphics, scripts, or standalone markdown documents, call \`create_artifact\` (once per artifact) instead of printing raw standalone HTML or SVG inside markdown code blocks unless explicitly requested.\n` +
        `- CRITICAL: In your visible text response, you MUST include \`[artifact: filename]\` where the newly created artifact card should appear (example: "Here is the chart:\\n[artifact: chart.svg]").\n` +
        `- To re-display an existing artifact, call \`present_artifact\` and include \`[present: filename]\` in your reply (never call \`present_artifact\` if \`create_artifact\` was already called for it in the same turn).\n` +
        `- To inspect workspace artifacts or user uploads, use \`list_files\`, \`read_file\`, and \`find_in_file\`. To update an existing artifact, use \`edit_file\` (matching raw content only; NEVER include \`N | \` line-number prefixes from \`read_file\`) or \`write_file\`.`;

      appendSystemBlock(artifactGuidance);
    }

    if (effectiveWorkspace.path && (toolsEnabled || builtInTools.some((t) => t.category === "workspace"))) {
      const modeDesc = effectiveWorkspace.writeEnabled
        ? `READ-WRITE (${effectiveWorkspace.approvalMode === "ask" ? "user approval required per write/edit" : "automatic write/edit"}; you may inspect and modify files using \`workspace_list\`, \`workspace_search\`, \`workspace_read\`, \`workspace_edit\`, \`workspace_write\`, \`workspace_delete\`, \`workspace_rename\`, and run verification commands via \`workspace_run\`)`
        : "READ-ONLY (you may inspect files using `workspace_list`, `workspace_search`, and `workspace_read`; file edits and writes are disabled)";
      appendSystemBlock(
        `ATTACHED PROJECT WORKSPACE:\n` +
        `- Active Workspace Root: ${effectiveWorkspace.path} (${effectiveWorkspace.source === "folder" ? "inherited from parent chat folder" : "attached to this conversation"})\n` +
        `- Access Mode: ${modeDesc}\n` +
        `- Use relative file paths inside the workspace when calling \`workspace_*\` tools. Never include \`N | \` line-number prefixes from \`workspace_read\` inside \`workspace_edit\` targets.`
      );
    }

    // Resolve reusable slash prompt templates (/review, /tests, /explain, etc.) referenced in the user turn
    if (!isContinue && originalUserContent) {
      const slashTokens = extractPrefixTokens(originalUserContent, "/").map((t) => t.toLowerCase());
      const explicitTemplateIds = new Set(
        (Array.isArray(body.injectedTools) ? body.injectedTools : [])
          .filter((sel) => sel && sel.kind === "prompt_template")
          .map((sel) => sel.id)
      );
      if (slashTokens.length > 0 || explicitTemplateIds.size > 0) {
        const allTemplates = getAllPromptTemplates();
        const matchedTemplates = allTemplates.filter(
          (tpl) =>
            slashTokens.includes(tpl.name.toLowerCase()) || explicitTemplateIds.has(tpl.id)
        );
        if (matchedTemplates.length > 0) {
          const tplBlocks = matchedTemplates
            .map((tpl) => `### /${tpl.name}${tpl.description ? ` (${tpl.description})` : ""}\n${tpl.content}`)
            .join("\n\n");
          appendSystemBlock(
            `ACTIVE PROMPT TEMPLATES -- apply these slash template instructions to the user's request:\n${tplBlocks}`
          );
        }
      }
    }

    const { model: _incomingModel, conversationId: _incomingConvId, userMessageId: _umId, userParentId: _upId, assistantMessageId: _amId, attachments: _attachments, messages: _msgs, ...rest } = body;

    let finalTemperature = settingRow?.temperature ?? body.temperature;

    // Helper to embed attachments (images, audio, video, extracted PDF/DOCX/code/text) into a user message
    const selectAttachmentById = db.prepare<[string], AttachmentRow>("SELECT * FROM attachments WHERE id = ?");
    const selectAttachmentsByMessageId = db.prepare<[string], AttachmentRow>("SELECT * FROM attachments WHERE message_id = ? ORDER BY created_at ASC");

    function deriveAudioFormat(mimeType: string, originalName: string): string {
      const lowerMime = mimeType.toLowerCase();
      const ext = path.extname(originalName).toLowerCase().replace(".", "");
      if (lowerMime.includes("mp3") || lowerMime.includes("mpeg") || ext === "mp3") return "mp3";
      if (lowerMime.includes("ogg") || ext === "ogg") return "ogg";
      if (lowerMime.includes("flac") || ext === "flac") return "flac";
      if (lowerMime.includes("webm") || ext === "webm") return "webm";
      if (lowerMime.includes("mp4") || lowerMime.includes("m4a") || ext === "m4a") return "m4a";
      return "wav";
    }

    async function applyAttachmentsToUserMessage(targetMsg: any, rows: AttachmentRow[]) {
      if (!targetMsg || rows.length === 0) return;

      const parts: any[] = [];
      if (typeof targetMsg.content === "string") {
        parts.push({ type: "text", text: targetMsg.content });
      } else if (Array.isArray(targetMsg.content)) {
        parts.push(...targetMsg.content);
      }

      for (const row of rows) {
        if (!row || !fs.existsSync(row.disk_path)) continue;

        if (row.mime_type.startsWith("image/") || row.mime_type.startsWith("video/")) {
          const base64 = fs.readFileSync(row.disk_path).toString("base64");
          parts.push({ type: "image_url", image_url: { url: `data:${row.mime_type};base64,${base64}` } });
        } else if (row.mime_type.startsWith("audio/")) {
          const base64 = fs.readFileSync(row.disk_path).toString("base64");
          const audioFormat = deriveAudioFormat(row.mime_type, row.original_name);
          parts.push({ type: "input_audio", input_audio: { data: base64, format: audioFormat } });
        } else {
          try {
            const extracted = await extractDocumentTextAsync(row.disk_path, row.original_name, row.mime_type);
            if (extracted.isBinary) {
              parts.push({
                type: "text",
                text: `\n\n--- Attached File: ${row.original_name} (${row.mime_type}, binary file) ---`,
              });
            } else {
              const ext =
                extracted.format === "pdf" || extracted.format === "docx"
                  ? "text"
                  : path.extname(row.original_name).replace(".", "") || "text";
              parts.push({
                type: "text",
                text: `\n\n--- Attached Document: ${row.original_name} ---\n\`\`\`${ext}\n${extracted.text}\n\`\`\``,
              });
            }
          } catch {
            parts.push({
              type: "text",
              text: `\n\n--- Attached File: ${row.original_name} (binary attachment) ---`,
            });
          }
        }
      }

      if (parts.length === 1 && parts[0].type === "text") {
        targetMsg.content = parts[0].text;
      } else if (parts.length > 0) {
        targetMsg.content = parts;
      }
    }

    // Process attachments for all user messages in outgoingMessages (including historical turns)
    const lastOutgoingUserMsg = [...outgoingMessages].reverse().find((m) => m.role === "user");
    for (const msg of outgoingMessages) {
      if (msg.role !== "user") continue;

      const isCurrentUserTurn = msg === lastOutgoingUserMsg;
      const collectedById = new Map<string, AttachmentRow>();

      // 1. If message has a persisted message ID, fetch its attachments from DB
      if (typeof msg.id === "string" && msg.id) {
        for (const r of selectAttachmentsByMessageId.all(msg.id)) {
          collectedById.set(r.id, r);
        }
      }

      // 2. If message carries explicit attachment IDs array
      if (Array.isArray(msg.attachments)) {
        for (const attId of msg.attachments) {
          if (typeof attId === "string" && !collectedById.has(attId)) {
            const r = selectAttachmentById.get(attId);
            if (r) collectedById.set(r.id, r);
          }
        }
      }

      // 3. For the latest user turn, also include top-level body.attachments
      if (isCurrentUserTurn && Array.isArray(attachmentIds)) {
        for (const attId of attachmentIds) {
          if (typeof attId === "string" && !collectedById.has(attId)) {
            const r = selectAttachmentById.get(attId);
            if (r) collectedById.set(r.id, r);
          }
        }
      }

      // 4. Resolve @filename / @"file name" mentions in the latest user turn against session attachments, artifacts, and attached workspace files
      const mentionedArtifacts: ArtifactRow[] = [];
      const mentionedWorkspaceFiles: Array<{ relPath: string; content: string; lang: string }> = [];
      if (isCurrentUserTurn && originalUserContent) {
        const atTokens = extractPrefixTokens(originalUserContent, "@");
        if (atTokens.length > 0) {
          const collectedNames = new Set(
            Array.from(collectedById.values()).map((r) => r.original_name.trim().toLowerCase())
          );

          const sessionAtts = db
            .prepare<[string], AttachmentRow>(
              `SELECT a.* FROM attachments a
               JOIN messages m ON a.message_id = m.id
               WHERE m.conversation_id = ?
               ORDER BY a.created_at DESC`
            )
            .all(conversationId);

          const sessionArts = db
            .prepare<[string], ArtifactRow>(
              "SELECT * FROM artifacts WHERE conversation_id = ? ORDER BY updated_at DESC"
            )
            .all(conversationId);

          let cachedWorkspaceFiles: string[] | null = null;

          for (const token of atTokens) {
            const lowerTok = token.toLowerCase();
            if (!collectedNames.has(lowerTok)) {
              const attMatch = sessionAtts.find(
                (a) => a.original_name.trim().toLowerCase() === lowerTok
              );
              if (attMatch) {
                collectedById.set(attMatch.id, attMatch);
                collectedNames.add(lowerTok);
                continue;
              }
            }
            const artMatch = sessionArts.find(
              (a) => a.filename.trim().toLowerCase() === lowerTok
            );
            if (artMatch) {
              if (!mentionedArtifacts.some((m) => m.id === artMatch.id)) {
                mentionedArtifacts.push(artMatch);
              }
              continue;
            }

            if (effectiveWorkspace.path) {
              let candidateRel = token.replace(/^workspace:/i, "").trim();
              const isExplicitDir = candidateRel.endsWith("/");
              const cleanRel = candidateRel.replace(/\/+$/, "");
              let resolvedTarget = null;
              let resolvedDirTarget = null;
              try {
                const candidate = resolveWorkspacePath(effectiveWorkspace.path, cleanRel || ".", {
                  allowRoot: isExplicitDir && !cleanRel,
                });
                if (fs.existsSync(candidate.realPath)) {
                  const st = fs.statSync(candidate.realPath);
                  if (st.isDirectory()) {
                    resolvedDirTarget = candidate;
                  } else if (st.isFile()) {
                    resolvedTarget = candidate;
                  }
                }
              } catch { }

              if (resolvedDirTarget) {
                try {
                  const dirRel = resolvedDirTarget.relPath || ".";
                  const listed = listWorkspaceEntries(effectiveWorkspace.path, {
                    subPath: dirRel,
                    maxDepth: 4,
                    maxEntries: 200,
                    includeDirs: false,
                  });
                  const dirFiles = listed.entries.filter((e) => e.type === "file").map((e) => e.path);
                  const MAX_DIR_FILES = 12;
                  const MAX_DIR_TOTAL_BYTES = 60 * 1024;
                  const MAX_FILE_BYTES = 16 * 1024;
                  let usedBytes = 0;
                  let includedCount = 0;

                  const outlineText =
                    dirFiles.length > 0
                      ? `Directory '${dirRel}/' contains ${dirFiles.length} file(s):\n${dirFiles.map((f) => `- ${f}`).join("\n")}`
                      : `Directory '${dirRel}/' has no visible files.`;
                  if (!mentionedWorkspaceFiles.some((w) => w.relPath === `${dirRel}/ (outline)`)) {
                    mentionedWorkspaceFiles.push({
                      relPath: `${dirRel}/ (outline)`,
                      content: outlineText,
                      lang: "text",
                    });
                  }

                  for (const relFile of dirFiles) {
                    if (includedCount >= MAX_DIR_FILES || usedBytes >= MAX_DIR_TOTAL_BYTES) break;
                    if (mentionedWorkspaceFiles.some((w) => w.relPath === relFile)) continue;
                    try {
                      const fTarget = resolveWorkspacePath(effectiveWorkspace.path, relFile);
                      const fStat = fs.statSync(fTarget.realPath);
                      if (!fStat.isFile()) continue;
                      const readLen = Math.min(fStat.size, MAX_FILE_BYTES, MAX_DIR_TOTAL_BYTES - usedBytes);
                      if (readLen <= 0) break;
                      const fd = fs.openSync(fTarget.realPath, "r");
                      let buf: Buffer;
                      try {
                        buf = Buffer.alloc(readLen);
                        fs.readSync(fd, buf, 0, readLen, 0);
                      } finally {
                        fs.closeSync(fd);
                      }
                      if (isLikelyBinaryBuffer(buf)) continue;
                      usedBytes += readLen;
                      includedCount++;
                      const ext = path.extname(fTarget.relPath).replace(".", "") || "text";
                      const suffix =
                        fStat.size > readLen
                          ? `\n... [truncated; use workspace_read for remaining lines]`
                          : "";
                      mentionedWorkspaceFiles.push({
                        relPath: fTarget.relPath,
                        content: buf.toString("utf-8") + suffix,
                        lang: ext,
                      });
                    } catch { }
                  }
                } catch { }
                continue;
              }

              if (!resolvedTarget && !candidateRel.includes("/")) {
                try {
                  if (!cachedWorkspaceFiles) {
                    const listed = listWorkspaceEntries(effectiveWorkspace.path, {
                      maxDepth: 6,
                      maxEntries: 2000,
                      includeDirs: false,
                    });
                    cachedWorkspaceFiles = listed.entries
                      .filter((e) => e.type === "file")
                      .map((e) => e.path);
                  }
                  const byBasename = cachedWorkspaceFiles.find(
                    (p) => path.posix.basename(p).toLowerCase() === candidateRel.toLowerCase()
                  );
                  if (byBasename) {
                    const candidate = resolveWorkspacePath(effectiveWorkspace.path, byBasename);
                    if (fs.existsSync(candidate.realPath) && fs.statSync(candidate.realPath).isFile()) {
                      resolvedTarget = candidate;
                    }
                  }
                } catch { }
              }

              if (
                resolvedTarget &&
                !mentionedWorkspaceFiles.some((w) => w.relPath === resolvedTarget.relPath)
              ) {
                try {
                  const stat = fs.statSync(resolvedTarget.realPath);
                  const MAX_MENTION_BYTES = 128 * 1024;
                  const readLen = Math.min(stat.size, MAX_MENTION_BYTES);
                  const fd = fs.openSync(resolvedTarget.realPath, "r");
                  let buf: Buffer;
                  try {
                    buf = Buffer.alloc(readLen);
                    fs.readSync(fd, buf, 0, readLen, 0);
                  } finally {
                    fs.closeSync(fd);
                  }
                  if (!isLikelyBinaryBuffer(buf)) {
                    const ext = path.extname(resolvedTarget.relPath).replace(".", "") || "text";
                    const suffix =
                      stat.size > MAX_MENTION_BYTES
                        ? `\n... [truncated at 128 KB; use workspace_read for remaining lines]`
                        : "";
                    mentionedWorkspaceFiles.push({
                      relPath: resolvedTarget.relPath,
                      content: buf.toString("utf-8") + suffix,
                      lang: ext,
                    });
                  }
                } catch { }
              }
            }
          }
        }
      }

      // Strip internal id/attachments fields before sending to LLM adapter
      delete msg.id;
      delete msg.attachments;

      if (collectedById.size > 0) {
        await applyAttachmentsToUserMessage(msg, Array.from(collectedById.values()));
      }

      if (mentionedArtifacts.length > 0) {
        const artifactBlocks: string[] = [];
        for (const art of mentionedArtifacts) {
          try {
            if (fs.existsSync(art.disk_path)) {
              const rawText = fs.readFileSync(art.disk_path, "utf-8");
              const lang = art.language || path.extname(art.filename).replace(".", "") || "text";
              artifactBlocks.push(
                `\n\n--- Referenced Session Artifact: ${art.filename} ---\n\`\`\`${lang}\n${rawText}\n\`\`\``
              );
            }
          } catch { }
        }
        if (artifactBlocks.length > 0) {
          const combined = artifactBlocks.join("");
          if (typeof msg.content === "string") {
            msg.content += combined;
          } else if (Array.isArray(msg.content)) {
            msg.content.push({ type: "text", text: combined });
          }
        }
      }

      if (mentionedWorkspaceFiles.length > 0) {
        const wsBlocks = mentionedWorkspaceFiles.map(
          (w) =>
            `\n\n--- Referenced Workspace File: ${w.relPath} ---\n\`\`\`${w.lang}\n${w.content}\n\`\`\``
        );
        const combined = wsBlocks.join("");
        if (typeof msg.content === "string") {
          msg.content += combined;
        } else if (Array.isArray(msg.content)) {
          msg.content.push({ type: "text", text: combined });
        }
      }
    }

    // -----------------------------------------------------------------------
    // 6. Build extraParams including MCP tools in OpenAI tool format
    // -----------------------------------------------------------------------
    const extraParams: Record<string, any> = {};
    if (settingRow) {
      if (settingRow.seed !== null && settingRow.seed !== undefined) extraParams.seed = settingRow.seed;
      if (settingRow.max_tokens !== null && settingRow.max_tokens !== undefined) extraParams.max_tokens = settingRow.max_tokens;
      if (settingRow.top_k !== null && settingRow.top_k !== undefined) extraParams.top_k = settingRow.top_k;
      if (settingRow.top_p !== null && settingRow.top_p !== undefined) extraParams.top_p = settingRow.top_p;
      if (settingRow.min_p !== null && settingRow.min_p !== undefined) extraParams.min_p = settingRow.min_p;
      if (settingRow.presence_penalty !== null && settingRow.presence_penalty !== undefined) extraParams.presence_penalty = settingRow.presence_penalty;
      if (settingRow.frequency_penalty !== null && settingRow.frequency_penalty !== undefined) extraParams.frequency_penalty = settingRow.frequency_penalty;
      if (settingRow.repeat_penalty !== null && settingRow.repeat_penalty !== undefined) extraParams.repeat_penalty = settingRow.repeat_penalty;
      if (settingRow.reasoning_effort) extraParams.reasoning_effort = settingRow.reasoning_effort;
      if (settingRow.ctx_length !== null && settingRow.ctx_length !== undefined) {
        extraParams.num_ctx = settingRow.ctx_length;
      }
    }

    if (convSamplingOverrides) {
      if (convSamplingOverrides.maxTokens !== null && convSamplingOverrides.maxTokens !== undefined) {
        extraParams.max_tokens = convSamplingOverrides.maxTokens;
      }
      if (convSamplingOverrides.reasoningEffort) {
        extraParams.reasoning_effort = convSamplingOverrides.reasoningEffort;
      }
      if (convSamplingOverrides.temperature !== null && convSamplingOverrides.temperature !== undefined) {
        finalTemperature = convSamplingOverrides.temperature;
      }
    }

    // Inject tools into the request if any are available
    let toolDefinitions: any[] = [];
    if (mcpTools.length > 0) {
      toolDefinitions.push(...mcpToolsToOpenAIFormat(mcpTools));
    }

    const { builtInToolRegistry: _registry } = await import("../services/builtinTools/index.js");
    let turnWriteApproved = false;

    const builtInCtx = {
      conversationId,
      activeSkillIds: activeSkills.map((s) => s.id),
      activeSkills,
      abortSignal: abortController.signal,
      uploadsDir: path.join(DATA_DIR, "uploads"),
      memoryEnabled: effectiveMemoryEnabled,
      crossChatRecallEnabled,
      crossChatIncludeArchived,
      workspacePath: effectiveWorkspace.path,
      workspaceWriteEnabled: effectiveWorkspace.writeEnabled,
      workspaceApprovalMode: effectiveWorkspace.approvalMode,
      isTurnWriteApproved: () => turnWriteApproved,
      markTurnWriteApproved: () => {
        turnWriteApproved = true;
      },
      emitEvent: (type: string, payload: Record<string, any>) => {
        if ((type === "artifact_created" || type === "artifact_updated") && typeof payload.filename === "string") {
          artifactFilenamesThisTurn.add(payload.filename);
        }
        broadcastChunk(JSON.stringify({ type, ...payload }));
      },
    };

    const availableBuiltInTools =
      toolsEnabled || slashInjections.hasInjections
        ? builtInTools.filter((t) =>
            t.category === "workspace" ? (t.isAvailable ? t.isAvailable(builtInCtx) : true) : true
          )
        : [];

    if (toolsEnabled) {
      // Force-include any non-disabled artifact tools the router might have dropped
      const artifactTools = builtInToolRegistry
        .getAllTools()
        .filter((t) => t.category === "artifact" && !disabledBuiltInSet.has(t.name));
      for (const tool of artifactTools) {
        if (!availableBuiltInTools.some((t) => t.name.trim() === tool.name.trim())) {
          availableBuiltInTools.push(tool);
        }
      }

      // When a workspace is attached, ensure available non-disabled workspace tools are always exposed
      if (effectiveWorkspace.path) {
        const workspaceTools = builtInToolRegistry
          .getAllTools()
          .filter(
            (t) =>
              t.category === "workspace" &&
              !disabledBuiltInSet.has(t.name) &&
              (!t.isAvailable || t.isAvailable(builtInCtx))
          );
        for (const tool of workspaceTools) {
          if (!availableBuiltInTools.some((t) => t.name.trim() === tool.name.trim())) {
            availableBuiltInTools.push(tool);
          }
        }
      }
    }

    for (const bTool of availableBuiltInTools) {
      const params =
        typeof bTool.parameters === "function"
          ? bTool.parameters(builtInCtx)
          : bTool.parameters;
      toolDefinitions.push({
        type: "function",
        function: {
          name: bTool.name.trim(),
          description: bTool.description.trim(),
          parameters: params,
        },
      });
    }

    if (toolDefinitions.length > 0) {
      const seen = new Set<string>();
      extraParams.tools = toolDefinitions.filter((t) => {
        const name = t?.function?.name;
        if (!name || seen.has(name)) return false;
        seen.add(name);
        return true;
      });
    }

    const adapter = getAdapter(backend.apiType);
    const buildParams = {
      backend,
      modelId: rawModelId,
      messages: outgoingMessages,
      extraParams,
      temperature: finalTemperature,
      onConfigFix: (fixes: Record<string, any>) => {
        try {
          if (typeof fixes.ctx_length === "number" && fixes.ctx_length > 0) {
            contextLimit = fixes.ctx_length;
            const existing = db.prepare("SELECT id, ctx_length FROM model_settings WHERE id = ?").get(body.model) as { id: string; ctx_length: number | null } | undefined;
            if (!existing) {
              db.prepare("INSERT INTO model_settings (id, is_preset, ctx_length) VALUES (?, 0, ?)").run(body.model, fixes.ctx_length);
              console.log(`[blombrain] Auto-populated unset ctx_length for model ${body.model} to ${fixes.ctx_length}`);
            } else if (existing.ctx_length === null || existing.ctx_length === undefined) {
              db.prepare("UPDATE model_settings SET ctx_length = ? WHERE id = ?").run(fixes.ctx_length, body.model);
              console.log(`[blombrain] Auto-populated unset ctx_length for model ${body.model} to ${fixes.ctx_length}`);
            }
          }
        } catch (err) {
          console.error("[blombrain] Failed to persist auto-detected model settings:", err);
        }
      },
    };

    // Fetch context overflow behavior settings
    const defaultBehavior = globalSettingsRow?.ctx_overflow_behavior || "truncate_middle";
    const effectiveOverflowBehavior = settingRow?.ctx_overflow_behavior || defaultBehavior;
    const completionReserve = settingRow?.max_tokens ?? 2048;

    // -----------------------------------------------------------------------
    // 7. Agentic tool-call loop
    // -----------------------------------------------------------------------
    const MAX_TOOL_ROUNDS = 100;
    const TOOL_TIMEOUT_MS = 120_000; // 2 minute cap per individual tool call
    let currentMessages = [...outgoingMessages];
    let toolRound = 0;
    const executedToolCallsInTurn = new Map<string, string>();
    const usedCallIds = new Set<string>();
    let lastRoundToolCallKeys = new Set<string>();
    currentToolExecution = null;

    const allocateUniqueCallId = (rawId: string | undefined, roundNum: number, idx: number): string => {
      const base = rawId && rawId.trim() ? rawId.trim() : `call_${userMessageId}_${roundNum}_${idx}`;
      if (!usedCallIds.has(base)) {
        usedCallIds.add(base);
        return base;
      }
      let candidate = `${base}_r${roundNum}_${idx}`;
      let suffix = 1;
      while (usedCallIds.has(candidate)) {
        candidate = `${base}_r${roundNum}_${idx}_${suffix++}`;
      }
      usedCallIds.add(candidate);
      return candidate;
    };

    const { applyContextOverflowPolicy } = await import("../services/contextWindow.js");

    try {
      while (!abortController.signal.aborted) {
        const trimResult = applyContextOverflowPolicy({
          messages: currentMessages,
          toolDefinitions,
          contextLimit,
          completionReserve,
          behavior: effectiveOverflowBehavior as any,
          forcedToolNames: forcedTools,
        });

        if (trimResult.action === "impossible_fit" || trimResult.action === "stop") {
          const errMsg = trimResult.reason || "Context length limit exceeded.";
          streamError = errMsg;
          broadcastChunk(JSON.stringify({
            type: "context_overflow",
            behavior: effectiveOverflowBehavior,
            reason: errMsg,
          }));
          broadcastChunk(JSON.stringify({
            type: "error",
            error: { message: errMsg }
          }));
          break;
        }

        if (trimResult.trimmed) {
          console.log(`[chat] Trimmed context (${effectiveOverflowBehavior}): dropped ${trimResult.droppedMessageCount} messages in ${trimResult.droppedGroupCount} groups.`);
          const noticeTag = `<context_notice>${JSON.stringify({
            kind: "trimmed",
            message: `Trimmed ${trimResult.droppedMessageCount} older message(s) (${effectiveOverflowBehavior}) to fit context window.`,
          })}</context_notice>\n\n`;
          if (!assistantContent.includes(noticeTag)) {
            assistantContent = noticeTag + assistantContent;
            currentActiveStream.assistantContent = assistantContent;
          }
          broadcastChunk(JSON.stringify({
            type: "context_trimmed",
            behavior: effectiveOverflowBehavior,
            droppedMessageCount: trimResult.droppedMessageCount,
            estimatedTokensBefore: trimResult.breakdown.totalTokens,
            estimatedTokensAfter: trimResult.breakdown.messagesTokens + trimResult.breakdown.toolSchemasTokens,
            contextLimit,
            promptBudget: trimResult.breakdown.promptBudget,
          }));
        }

        if (trimResult.prunedToolCount > 0) {
          const droppedNames = toolDefinitions
            .filter((t) => !trimResult.toolDefinitions.includes(t))
            .map((t) => t?.function?.name)
            .filter(Boolean);
          console.log(`[chat] Pruned ${trimResult.prunedToolCount} tool/skill schema(s) to fit prompt budget: ${droppedNames.join(", ")}`);
          toolDefinitions = trimResult.toolDefinitions;
          const noticeTag = `<context_notice>${JSON.stringify({
            kind: "tools_pruned",
            message: `Pruned ${trimResult.prunedToolCount} tool(s) to fit context window: ${droppedNames.join(", ")}.`,
          })}</context_notice>\n\n`;
          if (!assistantContent.includes(noticeTag)) {
            assistantContent = noticeTag + assistantContent;
            currentActiveStream.assistantContent = assistantContent;
          }
          broadcastChunk(JSON.stringify({
            type: "tools_pruned",
            prunedCount: trimResult.prunedToolCount,
            remainingCount: toolDefinitions.length,
            droppedToolNames: droppedNames,
          }));
        }

        currentMessages = trimResult.messages;

        const passParams = {
          ...buildParams,
          messages: currentMessages,
          extraParams: { ...extraParams, ...(toolDefinitions.length > 0 ? { tools: toolDefinitions } : {}) },
        };

        const passStart = Date.now();
        const nextRoundNum = toolRound + 1;
        const streamedCallIds = new Set<string>();
        const pass = await runGenerationPass({
          adapter,
          buildParams: passParams,
          abortController,
          onChunk: broadcastChunk,
          stripPrefix: isContinue && toolRound === 0 ? initialAssistantContent : undefined,
          allocateCallId: (rawId, idx) => allocateUniqueCallId(rawId, nextRoundNum, idx),
          onToolCallStreaming: ({ callId, name, argsBytes, partialPath }) => {
            streamedCallIds.add(callId);
            const sizeLabel =
              argsBytes >= 1024 ? `${(argsBytes / 1024).toFixed(1)} KB` : `${argsBytes} B`;
            const detail = partialPath
              ? `Preparing ${partialPath} (${sizeLabel})...`
              : `Preparing arguments (${sizeLabel})...`;
            broadcastChunk(JSON.stringify({
              type: "tool_execution",
              callId,
              toolName: name,
              args: partialPath ? { path: partialPath } : {},
              cacheable: false,
              message: detail,
              status: "executing",
            }));
          },
        });

        if (!pass.streamError || (pass.content || pass.reasoning || pass.toolCalls.length)) {
          totalGenerationMs += Date.now() - passStart;
        }

        if (pass.streamError) {
          streamError = pass.streamError;
        }
        if (pass.usageStats) {
          lastRawUsage = pass.usageStats;
          if (typeof pass.usageStats.completionTokens === "number") {
            totalCompletionTokens += pass.usageStats.completionTokens;
          }
          if (typeof pass.usageStats.promptTokens === "number") {
            totalPromptTokens += pass.usageStats.promptTokens;
          }
        }

        if (pass.content) {
          assistantContent += pass.content;
          currentActiveStream.assistantContent = assistantContent;
        }

        // Fallback: If model outputted text tool call tags (XML or raw tags) instead of structured tool_calls
        if (pass.toolCalls.length === 0 && (pass.content || pass.reasoning)) {
          let foundFallback = false;
          const fallbackCalls: any[] = [];
          const allowedNames = new Set<string>(
            toolDefinitions.map((t) => t?.function?.name).filter(Boolean)
          );

          if (pass.content) {
            const fallback = extractTextToolCalls(pass.content, allowedNames);
            if (fallback.toolCalls.length > 0) {
              foundFallback = true;
              fallbackCalls.push(...fallback.toolCalls);
              const contentLenBeforePass = assistantContent.length - pass.content.length;
              assistantContent = assistantContent.slice(0, contentLenBeforePass) + fallback.cleanContent;
              currentActiveStream.assistantContent = assistantContent;
              pass.content = fallback.cleanContent;
            }
          }

          if (pass.reasoning) {
            const fallback = extractTextToolCalls(pass.reasoning, allowedNames);
            if (fallback.toolCalls.length > 0) {
              foundFallback = true;
              fallbackCalls.push(...fallback.toolCalls);
              pass.reasoning = fallback.cleanContent;
            }
          }

          if (foundFallback) {
            console.log(`[chat] Extracted ${fallbackCalls.length} fallback text tool calls from generation pass`);
            pass.toolCalls = fallbackCalls;

            let replaceText = assistantContent;
            if (pass.reasoning) {
              replaceText += `\n<think>\n${pass.reasoning}\n</think>\n`;
            }

            broadcastChunk(JSON.stringify({
              type: "content_replace",
              content: replaceText,
            }));
          }
        }

        // No tool calls -- generation is complete
        if (pass.toolCalls.length === 0) {
          break;
        }

        if (toolRound >= MAX_TOOL_ROUNDS) {
          const limitNotice = `\n\n> [!WARNING]\n> Reached the maximum limit of ${MAX_TOOL_ROUNDS} tool execution rounds for this turn.\n`;
          assistantContent += limitNotice;
          currentActiveStream.assistantContent = assistantContent;
          broadcastChunk(JSON.stringify({
            id: `chatcmpl-internal`,
            object: "chat.completion.chunk",
            created: Math.floor(Date.now() / 1000),
            choices: [{
              index: 0,
              delta: { content: limitNotice },
              finish_reason: "stop",
            }],
          }));
          break;
        }

        // ----------------------------------------------------------------
        // Execute tool calls and continue the loop
        // ----------------------------------------------------------------
        toolRound++;
        const currentRoundToolCallKeys = new Set<string>();

        // Ensure every tool call in this round has a unique callId across the turn
        const resolvedRoundToolCalls = pass.toolCalls.map((tc, idx) => {
          const callId =
            tc.id && usedCallIds.has(tc.id)
              ? tc.id
              : allocateUniqueCallId(tc.id, toolRound, idx);
          return { ...tc, callId };
        });

        // Append assistant message with tool calls to the conversation
        currentMessages.push({
          role: "assistant",
          content: pass.content || "",
          // Tool calls in OpenAI format (needed for the next model pass)
          tool_calls: resolvedRoundToolCalls.map((tc) => ({
            id: tc.callId,
            type: "function",
            function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
          })),
        } as any);

        // Execute each tool call and emit tool execution events to the stream
        for (const tc of resolvedRoundToolCalls) {
          if (abortController.signal.aborted) break;

          const callId = tc.callId;
          currentToolExecution = { callId, toolName: tc.name, args: tc.arguments };

          const builtInTool = builtInToolRegistry.getTool(tc.name);
          const isBuiltInTool = !!builtInTool;
          const isToolRouted = mcpTools.some((t) => t.name === tc.name) || isBuiltInTool;
          const isSkillRouted = activeSkills.some((s) => s.name === tc.name);
          const isCacheable = !isBuiltInTool || builtInTool?.cacheable !== false;

          let result: import("../services/builtinTools/types.js").BuiltInToolResult;

          const toolCallKey = `${tc.name}::${JSON.stringify(tc.arguments)}`;
          currentRoundToolCallKeys.add(toolCallKey);
          // For built-in pure tools (isBuiltInTool && isCacheable), cache across the turn.
          // For external MCP tools, only suppress if called identically in consecutive rounds (loop prevention).
          const isDuplicateCall =
            !tc.parseError &&
            isCacheable &&
            executedToolCallsInTurn.has(toolCallKey) &&
            (isBuiltInTool || lastRoundToolCallKeys.has(toolCallKey));

          if (!isDuplicateCall) {
            currentToolExecution = { callId, toolName: tc.name, args: tc.arguments };
          }

          if (tc.parseError) {
            result = {
              content: tc.parseError,
              isError: true,
            };
          } else if (isDuplicateCall) {
            console.log(`[chat] Suppressing duplicate tool call execution and UI event: ${tc.name}`);
            const prevResult = executedToolCallsInTurn.get(toolCallKey) || "";
            result = {
              content: `[Notice: Tool '${tc.name}' with identical arguments was already executed in a previous round of this turn. Result was: ${prevResult}. Do not invoke this tool again with identical arguments. Synthesize your final response using the existing result.]`,
              isError: false,
            };
          } else if (isBuiltInTool) {
            broadcastChunk(JSON.stringify({
              type: "tool_execution",
              callId,
              toolName: tc.name,
              args: tc.arguments,
              cacheable: isCacheable,
              status: "executing",
            }));

            const mayAwaitApproval =
              tc.name === "workspace_run" ||
              (builtInTool?.category === "workspace" && effectiveWorkspace.approvalMode === "ask");
            const effectiveTimeoutMs = mayAwaitApproval ? 10 * 60_000 : TOOL_TIMEOUT_MS;

            try {
              result = await withTimeout(
                builtInToolRegistry.executeTool(tc.name, tc.arguments, {
                  ...builtInCtx,
                  callId,
                  abortSignal: abortController.signal,
                }),
                effectiveTimeoutMs,
                `${tc.name}`,
              );
            } catch (err) {
              result = { content: err instanceof Error ? err.message : String(err), isError: true };
            }
          } else if (isSkillRouted && !isToolRouted) {
            console.warn(`[chat] Model attempted to call skill '${tc.name}' as a tool`);
            result = {
              content: `Skill acknowledged. Reminder: '${tc.name}' is a procedural skill, not a tool. You do not need to call it. Please continue your response directly applying the skill's instructions.`,
              isError: false,
            };
          } else if (!isToolRouted) {
            console.warn(`[chat] Model attempted to call unrouted tool '${tc.name}'`);
            result = {
              content: `Error: Tool '${tc.name}' is not currently available or active in your context for this turn.`,
              isError: true,
            };
          } else {
            // Notify frontend that tool is executing
            broadcastChunk(JSON.stringify({
              type: "tool_execution",
              callId,
              toolName: tc.name,
              args: tc.arguments,
              cacheable: isCacheable,
              status: "executing",
            }));

            try {
              result = await mcpManager.callTool(tc.name, tc.arguments, {
                signal: abortController.signal,
                onProgress: (evt) => {
                  broadcastChunk(JSON.stringify({
                    type: "tool_progress",
                    callId,
                    toolName: tc.name,
                    args: tc.arguments,
                    ...evt,
                  }));
                },
              });
            } catch (err) {
              result = { content: err instanceof Error ? err.message : String(err), isError: true };
            }
          }

          const isCancelled = abortController.signal.aborted;
          const status = isCancelled ? "cancelled" : (result.isError ? "error" : "completed");

          const toolExecPayload = {
            callId,
            toolName: tc.name,
            args: tc.arguments,
            cacheable: isCacheable,
            ...(isCancelled ? {} : { result: result.content }),
            ...(result.checkpointId ? { checkpointId: result.checkpointId } : {}),
            ...(result.diffPreview ? { diffPreview: result.diffPreview } : {}),
            ...(result.commandPreview ? { commandPreview: result.commandPreview } : {}),
            ...(result.cwd ? { cwd: result.cwd } : {}),
            status,
          };

          if (!result.isError && !isCancelled && !isDuplicateCall) {
            executedToolCallsInTurn.set(toolCallKey, result.content);
          }

          if (!isDuplicateCall) {
            // Notify frontend of result
            broadcastChunk(JSON.stringify({
              type: "tool_execution",
              ...toolExecPayload,
            }));

            // Append tool execution tag to assistantContent so it persists in DB
            assistantContent += `\n<tool_execution>${JSON.stringify(toolExecPayload)}</tool_execution>\n`;
            currentToolExecution = null;
          } else if (streamedCallIds.has(callId)) {
            broadcastChunk(JSON.stringify({
              type: "tool_execution",
              ...toolExecPayload,
              status: "completed",
            }));
          }

          if (isCancelled) break;

          let finalContent = result.content;
          if (result.isError) {
            finalContent = `[Error executing tool: ${result.content}]\n\nINSTRUCTION: The tool call failed. Analyze the error carefully. If it is a parameter validation or usage error, try calling the tool again with corrected arguments. If the error is unrecoverable (e.g., API limits, missing credentials), inform the user about the failure.`;
          } else if (finalContent.length > 30000) {
            const head = finalContent.slice(0, 15000);
            const tail = finalContent.slice(-15000);
            finalContent = `${head}\n\n[Note: Output truncated for LLM context. Full data saved in UI.]\n\n${tail}`;
          }

          // Append tool result message for next model pass
          currentMessages.push({
            role: "tool",
            content: finalContent,
            tool_call_id: callId,
            name: tc.name,
          } as any);
        }

        lastRoundToolCallKeys = currentRoundToolCallKeys;
        // Reset content accumulator for the next pass
        currentActiveStream.assistantContent = assistantContent;
      }
    } catch (err) {
      if ((err as any)?.name !== "AbortError") {
        streamError = String(err);
      }
    }

    const materialized = materializeArtifactCards(assistantContent, conversationId, artifactFilenamesThisTurn);
    if (materialized !== assistantContent) {
      assistantContent = materialized;
      currentActiveStream.assistantContent = assistantContent;
      broadcastChunk(JSON.stringify({ type: "content_replace", content: assistantContent }));
    }

    currentActiveStream.isDone = true;
    currentActiveStream.streamError = streamError;
    currentActiveStream.usageStats = usageStats;

    doSaveTurn();
    setTimeout(() => { activeStreams.delete(conversationId); }, 5000);
  });
}
