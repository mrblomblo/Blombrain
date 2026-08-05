import { Readable } from "node:stream";
import fs from "node:fs";
import path from "node:path";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { backendRegistry } from "../registry.js";
import { persistChatTurn } from "./conversations.js";
import db from "../db.js";
import type { AttachmentRow, ModelSettingRow } from "../types.js";
import { getAdapter } from "../adapters/index.js";
import { mcpManager } from "../services/mcp.js";
import { getAllSkills } from "../services/skills.js";

interface ChatCompletionBody {
  model: string;
  messages: Array<{ role: string; content: string | any[] }>;
  temperature?: number;
  /** Optional: resume an existing conversation. When omitted a new one is created. */
  conversationId?: string;
  userMessageId?: string;
  userParentId?: string;
  assistantMessageId?: string;
  attachments?: string[];
  [key: string]: unknown;
}

function sendJsonError(reply: FastifyReply, status: number, message: string) {
  reply.code(status).send({ error: { message } });
}

function closeUnclosedTags(content: string, tags: string[] = ["think", "thought"]): string {
  let newContent = content;
  for (const tag of tags) {
    const startCount = (newContent.match(new RegExp(`<${tag}>`, "g")) || []).length;
    const endCount = (newContent.match(new RegExp(`</${tag}>`, "g")) || []).length;
    if (startCount > endCount) {
      newContent += `\n</${tag}>\n`;
    }
  }
  return newContent;
}

function reconstructToolCalls(messages: any[]): any[] {
  const reconstructed: any[] = [];
  for (const msg of messages) {
    if (msg.role === "assistant" && typeof msg.content === "string") {
      let newContent = msg.content.replace(/<router_execution>([\s\S]*?)<\/router_execution>/g, "");
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
          if (e.status === "error") {
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

function extractTextToolCalls(text: string): { cleanContent: string; toolCalls: any[] } {
  let cleanContent = text;
  const toolCalls: any[] = [];

  // Strip common internal junk tokens
  cleanContent = cleanContent.replace(/<\|?channel\|?>/gi, "");

  // 1. Match XML tags like <execute_skill_script ... />
  const xmlRegex = /<execute_skill_script\s+([^>]*?)(?:\/>|>(?:[\s\S]*?<\/execute_skill_script>)?)/gi;
  cleanContent = cleanContent.replace(xmlRegex, (match: string, attrString: string) => {
    try {
      const toolName = "execute_skill_script";
      const args: any = {};
      const attrRegex = /([a-zA-Z0-9_-]+)=("[^"]*"|'[^']*'|[[^\]]*])/g;
      let attrMatch;
      while ((attrMatch = attrRegex.exec(attrString)) !== null) {
        const key = attrMatch[1];
        let valStr = attrMatch[2];
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
      let sanitizedJson = jsonArgs;
      const strings: string[] = [];

      // 1. Extract strings, escaping them safely and replacing with placeholders
      sanitizedJson = sanitizedJson.replace(/<\|"\|>([\s\S]*?)<\|"\|>/g, (m: string, innerText: string) => {
        strings.push(innerText);
        return `"__STR_${strings.length - 1}__"`;
      });

      // 2. Quote structural unquoted keys safely (now that string literals are hidden)
      sanitizedJson = sanitizedJson.replace(/([{,]\s*)([a-zA-Z0-9_-]+)\s*:/g, '$1"$2":');

      // 3. Put strings back with proper JSON escaping
      sanitizedJson = sanitizedJson.replace(/"__STR_(\d+)__"/g, (m: string, idxStr: string) => {
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
}): Promise<{
  content: string;
  reasoning: string;
  toolCalls: Array<{ id?: string; name: string; arguments: Record<string, any> }>;
  usageStats?: any;
  streamError?: string;
  reasoningMode: "oob" | "inband" | null;
}> {
  const { adapter, buildParams, abortController, onChunk } = opts;

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

  const pendingToolCalls = new Map<number, { id?: string; name?: string; argsText: string }>();
  const completedToolCalls: Array<{ id?: string; name: string; arguments: Record<string, any> }> = [];

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
                // Allocate next sequential slot -- do NOT default to 0, which would
                // overwrite any existing pending call and prevent multiple tool calls
                // from Ollama/LM Studio (which emit full arrays without explicit indices).
                idx = pendingToolCalls.size;
              }

              const existing = pendingToolCalls.get(idx) ?? { argsText: "" };
              if (tc.id) existing.id = tc.id;
              if (tc.function?.name !== undefined) existing.name = tc.function.name;
              if (tc.function?.arguments !== undefined) {
                if (typeof tc.function.arguments === "string") {
                  existing.argsText += tc.function.arguments;
                } else {
                  existing.argsText = JSON.stringify(tc.function.arguments);
                }
              }
              pendingToolCalls.set(idx, existing);
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
        if (ev.delta || ev.reasoning || ev.error) {
          onChunk(JSON.stringify({
            id: `chatcmpl-internal`,
            object: "chat.completion.chunk",
            created: Math.floor(Date.now() / 1000),
            choices: [{
              index: 0,
              delta: {
                ...(ev.delta ? { content: ev.delta } : {}),
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
      for (const [, entry] of pendingToolCalls) {
        if (entry.name) {
          let args: Record<string, any> = {};
          try { args = entry.argsText ? JSON.parse(entry.argsText) : {}; } catch { }
          completedToolCalls.push({ id: entry.id, name: entry.name, arguments: args });
        }
      }
      resolve();
    };

    nodeStream.on("end", () => done());
    nodeStream.on("error", (err) => done(String(err)));
    nodeStream.on("close", () => done());
  });

  content = closeUnclosedTags(content);
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

export async function chatRoutes(app: FastifyInstance) {
  app.post("/api/chat/stop", async (req: FastifyRequest, reply: FastifyReply) => {
    const { conversationId } = req.body as { conversationId: string };
    if (!conversationId) return sendJsonError(reply, 400, "conversationId is required");

    const stream = activeStreams.get(conversationId);
    if (stream && !stream.isDone) {
      stream.streamError = "Operation aborted";
      stream.abortController.abort();
      stream.doSaveTurn();
      for (const sub of stream.subscribers) {
        if (!sub.raw.writableEnded) {
          sub.raw.write("data: [DONE]\n\n");
          sub.raw.end();
        }
      }
      activeStreams.delete(conversationId);
    }
    return reply.send({ success: true });
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

      existingStream.subscribers.add(reply);
      const onDisconnect = () => { existingStream.subscribers.delete(reply); };
      reply.raw.on("close", onDisconnect);
      req.raw.on("aborted", onDisconnect);
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

    // -----------------------------------------------------------------------
    // 3. Fetch per-conversation excluded MCP/Skill IDs from the DB
    // -----------------------------------------------------------------------
    let excludedMcps: string[] = [];
    let excludedSkills: string[] = [];
    if (body.conversationId) {
      const convRow = db.prepare("SELECT excluded_mcps, excluded_skills FROM conversations WHERE id = ?").get(body.conversationId) as any;
      if (convRow) {
        try { excludedMcps = JSON.parse(convRow.excluded_mcps || "[]"); } catch { }
        try { excludedSkills = JSON.parse(convRow.excluded_skills || "[]"); } catch { }
      }
    }

    // Extract user query for routing
    const lastUserMsg = [...body.messages].reverse().find((m) => m.role === "user");
    const originalUserContent: string =
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

    const userMessageId = body.userMessageId ? String(body.userMessageId) : crypto.randomUUID();
    const userParentId = body.userParentId ? String(body.userParentId) : null;
    const assistantMessageId = body.assistantMessageId ? String(body.assistantMessageId) : crypto.randomUUID();

    // Hijack response and start SSE stream early so routing progress can be emitted
    reply.hijack();
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });

    const subscribers = new Set<FastifyReply>();
    subscribers.add(reply);

    function broadcastChunk(sseChunk: string) {
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

    // Emit routing status event
    broadcastChunk(JSON.stringify({ type: "status", status: "routing" }));

    let assistantContent = "";
    let routerRawText = "";
    const userQuery = originalUserContent;

    const { routeToolsAndSkills } = await import("../services/toolRouter.js");
    const routingResult = await routeToolsAndSkills(
      userQuery,
      excludedMcps,
      excludedSkills,
      forcedTools,
      body.model,
      (text: string) => {
        routerRawText += text;
        broadcastChunk(JSON.stringify({ type: "router_token", text }));
      },
    );

    const mcpTools = routingResult.mcpTools ?? [];
    const activeSkills = routingResult.selectedSkills ?? [];

    if (routerRawText.trim()) {
      assistantContent = `<router_execution>${routerRawText.trim()}</router_execution>\n` + assistantContent;
    }

    // Emit generating status event
    broadcastChunk(JSON.stringify({ type: "status", status: "generating" }));

    // -----------------------------------------------------------------------
    // 5. Build outgoing messages
    // -----------------------------------------------------------------------
    let outgoingMessages = reconstructToolCalls([...body.messages]);

    if (settingRow?.system_prompt) {
      if (outgoingMessages.length > 0 && outgoingMessages[0].role === "system") {
        outgoingMessages[0] = { ...outgoingMessages[0], content: settingRow.system_prompt };
      } else {
        outgoingMessages.unshift({ role: "system", content: settingRow.system_prompt });
      }
    }

    // Inject skill instructions into the context if any skills are active.
    // Key design decisions:
    //   1. Append to the FIRST system message rather than inserting a second one.
    //      Many open-weight models (Llama/Gemma variants) degrade with multiple system messages.
    //   2. Strip example/template sections from SKILL.md bodies before injection to prevent
    //      the model from confusing template content with prior conversation history.
    //   3. Add a short reminder of the user's original request just before their message
    //      so the model cannot lose track of the actual task across tool rounds.
    if (activeSkills.length > 0) {
      const { stripSkillExamples, getSkillScripts } = await import("../services/skills.js");

      const skillsBlock = activeSkills.map((s) =>
        `### Skill: ${s.name}\n${s.description}\n\nInstructions:\n${stripSkillExamples(s.instructions)}`
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

      // Merge into the existing first system message, or prepend one if none exists.
      if (outgoingMessages.length > 0 && outgoingMessages[0].role === "system") {
        outgoingMessages[0] = {
          ...outgoingMessages[0],
          content: outgoingMessages[0].content + "\n\n" + skillContent,
        };
      } else {
        outgoingMessages.unshift({ role: "system", content: skillContent });
      }

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
          content: `Reminder: the user's actual request for this turn is: "${truncatedRequest}". Apply the skill instructions above to address this request directly.`,
        });
      }
    }

    const { model: _incomingModel, conversationId: _incomingConvId, userMessageId: _umId, userParentId: _upId, assistantMessageId: _amId, attachments: attachmentIds, messages: _msgs, ...rest } = body;

    const finalTemperature = settingRow?.temperature ?? body.temperature;

    // Process file attachments
    const contentParts: any[] = [];
    if (lastUserMsg && typeof lastUserMsg.content === "string") {
      contentParts.push({ type: "text", text: lastUserMsg.content });
    } else if (lastUserMsg && Array.isArray(lastUserMsg.content)) {
      contentParts.push(...lastUserMsg.content);
    }

    const dbAttachments: AttachmentRow[] = [];
    if (attachmentIds && Array.isArray(attachmentIds)) {
      for (const id of attachmentIds) {
        const row = db.prepare(`SELECT * FROM attachments WHERE id = ?`).get(id) as AttachmentRow | undefined;
        if (row && fs.existsSync(row.disk_path)) {
          dbAttachments.push(row);
          const fileData = fs.readFileSync(row.disk_path);
          const base64 = fileData.toString("base64");

          if (row.mime_type.startsWith("image/")) {
            contentParts.push({ type: "image_url", image_url: { url: `data:${row.mime_type};base64,${base64}` } });
          } else if (row.mime_type.startsWith("video/")) {
            contentParts.push({ type: "image_url", image_url: { url: `data:${row.mime_type};base64,${base64}` } });
          } else if (row.mime_type.startsWith("audio/")) {
            contentParts.push({ type: "input_audio", input_audio: { data: base64, format: "wav" } });
          } else {
            try {
              const textContent = fileData.toString("utf-8");
              const sanitizedText = textContent.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "");
              const ext = path.extname(row.original_name).replace(".", "") || "text";
              contentParts.push({
                type: "text",
                text: `\n\n--- Attached Document: ${row.original_name} ---\n\`\`\`${ext}\n${sanitizedText}\n\`\`\``,
              });
            } catch {
              contentParts.push({ type: "text", text: `\n\n--- Attached File: ${row.original_name} (binary attachment) ---` });
            }
          }
        }
      }
    }

    if (lastUserMsg && contentParts.length > 0) {
      if (contentParts.length === 1 && contentParts[0].type === "text") {
        lastUserMsg.content = contentParts[0].text;
      } else {
        lastUserMsg.content = contentParts;
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

    // Inject tools into the request if any are available
    let toolDefinitions: any[] = [];
    if (mcpTools.length > 0) {
      toolDefinitions.push(...mcpToolsToOpenAIFormat(mcpTools));
    }

    // Inject execute_skill_script if needed
    const { getSkillScripts } = await import("../services/skills.js");
    const activeSkillsWithScripts = activeSkills.filter(s => getSkillScripts(s.dirPath).length > 0);
    if (activeSkillsWithScripts.length > 0) {
      toolDefinitions.push({
        type: "function",
        function: {
          name: "execute_skill_script",
          description: "Execute a script provided by an active skill. The script runs in a conversation-scoped working directory. Returns stdout, stderr, and exit code.",
          parameters: {
            type: "object",
            properties: {
              skill_name: {
                type: "string",
                enum: activeSkillsWithScripts.map(s => s.name),
                description: "The name of the active skill that owns the script.",
              },
              skill_id: {
                type: "string",
                enum: activeSkillsWithScripts.map(s => s.id),
                description: "The ID of the active skill that owns the script (optional).",
              },
              script_name: {
                type: "string",
                description: "The script filename inside the skill's scripts/ directory (e.g. 'init-artifact.sh'). Do not include paths or '..'.",
              },
              cwd: {
                type: "string",
                description: "Optional relative subdirectory to execute the script in (e.g. 'apex-fitness-landing'). Runs in the workspace root by default.",
              },
              args: {
                type: "array",
                description: "Command-line arguments to pass to the script (e.g. ['mrblomblo-portfolio']).",
                items: { type: "string" },
              },
            },
            required: ["skill_name", "script_name"],
          },
        },
      });
    }

    if (toolDefinitions.length > 0) {
      extraParams.tools = toolDefinitions;
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
          if (fixes.ctx_length !== undefined) {
            const existing = db.prepare("SELECT id FROM model_settings WHERE id = ?").get(body.model);
            if (existing) {
              db.prepare("UPDATE model_settings SET ctx_length = ? WHERE id = ?").run(fixes.ctx_length, body.model);
            } else {
              db.prepare("INSERT INTO model_settings (id, is_preset, ctx_length) VALUES (?, 0, ?)").run(body.model, fixes.ctx_length);
            }
            console.log(`[blombrain] Auto-corrected ctx_length for model ${body.model} to ${fixes.ctx_length}`);
          }
        } catch (err) {
          console.error("[blombrain] Failed to persist auto-corrected model settings:", err);
        }
      },
    };

    let streamError: string | null = null;
    let usageStats: { promptTokens?: number; completionTokens?: number; totalTokens?: number; durationMs?: number; thinkingTimeMs?: number } | undefined;
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

        assistantContent = closeUnclosedTags(assistantContent);
        const savedTurn = persistChatTurn({
          conversationId,
          model: body.model,
          userMessageId,
          userParentId,
          userContent: originalUserContent,
          assistantMessageId,
          assistantContent,
          assistantError: streamError ?? undefined,
          assistantStats: usageStats,
        });

        if (attachmentIds && Array.isArray(attachmentIds)) {
          const updateStmt = db.prepare(`UPDATE attachments SET message_id = ?, conversation_id = ? WHERE id = ?`);
          for (const id of attachmentIds) {
            updateStmt.run(userMessageId, savedTurn.conversationId, id);
          }
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
    activeStreams.set(conversationId, currentActiveStream);

    const onClientDisconnect = () => { subscribers.delete(reply); };
    reply.raw.on("close", onClientDisconnect);
    req.raw.on("aborted", onClientDisconnect);

    // Fetch context overflow behavior settings
    const globalSettingsRow = db.prepare("SELECT ctx_overflow_behavior FROM global_settings LIMIT 1").get() as any;
    const defaultBehavior = globalSettingsRow?.ctx_overflow_behavior || "truncate_middle";
    const effectiveOverflowBehavior = settingRow?.ctx_overflow_behavior || defaultBehavior;
    const contextLimit = settingRow?.ctx_length ?? null;
    const completionReserve = settingRow?.max_tokens ?? 2048;

    // -----------------------------------------------------------------------
    // 8. Agentic tool-call loop
    // -----------------------------------------------------------------------
    const MAX_TOOL_ROUNDS = 10;
    const TOOL_TIMEOUT_MS = 120_000; // 2 minute cap per individual tool call
    let currentMessages = [...outgoingMessages];
    let toolRound = 0;

    const { applyContextOverflowPolicy } = await import("../services/contextWindow.js");

    try {
      while (!abortController.signal.aborted) {
        const trimResult = applyContextOverflowPolicy({
          messages: currentMessages,
          toolDefinitions,
          contextLimit,
          completionReserve,
          behavior: effectiveOverflowBehavior as any,
        });

        if (trimResult.action === "impossible_fit" || trimResult.action === "stop") {
          const errMsg = trimResult.reason || "Context length limit exceeded.";
          streamError = errMsg;
          broadcastChunk(JSON.stringify({
            type: "context_overflow",
            behavior: effectiveOverflowBehavior,
            reason: errMsg,
          }));
          broadcastChunk(JSON.stringify({ type: "error", error: errMsg }));
          break;
        }

        if (trimResult.trimmed) {
          console.log(`[chat] Trimmed context (${effectiveOverflowBehavior}): dropped ${trimResult.droppedMessageCount} messages in ${trimResult.droppedGroupCount} groups.`);
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

        // CRITICAL FIX: Reassign currentMessages to the trimmed array
        currentMessages = trimResult.messages;

        const passParams = {
          ...buildParams,
          messages: currentMessages,
          extraParams: { ...extraParams, ...(toolDefinitions.length > 0 ? { tools: toolDefinitions } : {}) },
        };

        const pass = await runGenerationPass({
          adapter,
          buildParams: passParams,
          abortController,
          onChunk: broadcastChunk,
        });

        if (pass.streamError) {
          streamError = pass.streamError;
        }
        if (pass.usageStats) usageStats = pass.usageStats;

        if (pass.content) {
          assistantContent += pass.content;
          currentActiveStream.assistantContent = assistantContent;
        }

        // Fallback: If model outputted text tool call tags (XML or raw tags) instead of structured tool_calls
        if (pass.toolCalls.length === 0 && (pass.content || pass.reasoning)) {
          let foundFallback = false;
          let fallbackCalls: any[] = [];

          if (pass.content) {
            const fallback = extractTextToolCalls(pass.content);
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
            const fallback = extractTextToolCalls(pass.reasoning);
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
        if (pass.toolCalls.length === 0 || toolRound >= MAX_TOOL_ROUNDS) {
          break;
        }

        // ----------------------------------------------------------------
        // Execute tool calls and continue the loop
        // ----------------------------------------------------------------
        toolRound++;

        // Append assistant message with tool calls to the conversation
        currentMessages.push({
          role: "assistant",
          content: pass.content || "",
          // Tool calls in OpenAI format (needed for the next model pass)
          tool_calls: pass.toolCalls.map((tc, idx) => ({
            id: tc.id ?? `call_${userMessageId}_${toolRound}_${idx}`,
            type: "function",
            function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
          })),
        } as any);

        // Execute each tool call and emit tool execution events to the stream
        for (const [idx, tc] of pass.toolCalls.entries()) {
          if (abortController.signal.aborted) break;

          const callId = tc.id ?? `call_${userMessageId}_${toolRound}_${idx}`;

          // Defensive Check: Ensure the tool was actually routed/available in mcpTools
          const isBuiltInTool = tc.name === "execute_skill_script";
          const isToolRouted = mcpTools.some((t) => t.name === tc.name);
          const isSkillRouted = activeSkills.some((s) => s.name === tc.name);

          let result: { content: string; isError?: boolean };

          if (isBuiltInTool) {
            broadcastChunk(JSON.stringify({
              type: "tool_execution",
              callId,
              toolName: tc.name,
              args: tc.arguments,
              status: "executing",
            }));

            const { executeSkillScriptTool } = await import("../services/scriptExecution.js");
            try {
              result = await withTimeout(
                executeSkillScriptTool(tc.arguments, {
                  conversationId,
                  activeSkillIds: activeSkills.map(s => s.id),
                  abortSignal: abortController.signal,
                }),
                TOOL_TIMEOUT_MS,
                `execute_skill_script (${tc.arguments?.script_name ?? "unknown"})`,
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
              status: "executing",
            }));

            try {
              result = await withTimeout(
                mcpManager.callTool(tc.name, tc.arguments),
                TOOL_TIMEOUT_MS,
                `MCP tool '${tc.name}'`,
              );
            } catch (err) {
              result = { content: err instanceof Error ? err.message : String(err), isError: true };
            }
          }

          const toolExecPayload = {
            callId,
            toolName: tc.name,
            args: tc.arguments,
            result: result.content,
            status: result.isError ? "error" : "completed",
          };

          // Notify frontend of result
          broadcastChunk(JSON.stringify({
            type: "tool_execution",
            ...toolExecPayload,
          }));

          // Append tool execution tag to assistantContent so it persists in DB
          assistantContent += `\n<tool_execution>${JSON.stringify(toolExecPayload)}</tool_execution>\n`;

          let finalContent = result.content;
          if (result.isError) {
            finalContent = `[Error executing tool: ${result.content}]\n\nINSTRUCTION: The tool call failed. Analyze the error carefully. If it is a parameter validation or usage error, try calling the tool again with corrected arguments. If the error is unrecoverable (e.g., API limits, missing credentials), inform the user about the failure.`;
          }

          // Append tool result message for next model pass
          currentMessages.push({
            role: "tool",
            content: finalContent,
            tool_call_id: callId,
          } as any);
        }

        // Reset content accumulator for the next pass
        currentActiveStream.assistantContent = assistantContent;
      }
    } catch (err) {
      if ((err as any)?.name !== "AbortError") {
        streamError = String(err);
      }
    }

    currentActiveStream.isDone = true;
    currentActiveStream.streamError = streamError;
    currentActiveStream.usageStats = usageStats;

    doSaveTurn();
    setTimeout(() => { activeStreams.delete(conversationId); }, 5000);
  });
}
