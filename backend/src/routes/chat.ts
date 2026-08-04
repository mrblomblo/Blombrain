import { Readable } from "node:stream";
import fs from "node:fs";
import path from "node:path";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { backendRegistry } from "../registry.js";
import { persistChatTurn } from "./conversations.js";
import db from "../db.js";
import type { AttachmentRow, ModelSettingRow } from "../types.js";
import { getAdapter } from "../adapters/index.js";

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

      // Send meta event
      reply.raw.write(`data: ${JSON.stringify({
        type: "meta",
        conversationId,
        title: "Chat",
        isNew: false,
        userMessageId: existingStream.userMessageId,
        assistantMessageId: existingStream.assistantMessageId,
        stats: existingStream.usageStats,
      })}\n\n`);

      // Replay accumulated content so far
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

      const onDisconnect = () => {
        existingStream.subscribers.delete(reply);
      };
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
      return sendJsonError(
        reply,
        400,
        `Model id "${body.model}" (resolved to "${targetModelId}") doesn't match any configured backend prefix.`,
      );
    }
    const { backend, rawModelId } = resolved;

    // Build the messages array, prepending system prompt if configured
    let outgoingMessages = [...body.messages];
    if (settingRow?.system_prompt) {
      // Check if a system message is already present at the start
      if (outgoingMessages.length > 0 && outgoingMessages[0].role === "system") {
        outgoingMessages[0] = { ...outgoingMessages[0], content: settingRow.system_prompt };
      } else {
        outgoingMessages.unshift({ role: "system", content: settingRow.system_prompt });
      }
    }

    // Find the last user message in the payload
    const lastUserMsg = [...outgoingMessages].reverse().find((m) => m.role === "user");
    // Capture original plain text before we mutate to multimodal array
    const originalUserContent: string =
      typeof lastUserMsg?.content === "string"
        ? lastUserMsg.content
        : Array.isArray(lastUserMsg?.content)
          ? (lastUserMsg.content.find((p: any) => p.type === "text")?.text ?? "")
          : "";
    const userMessageId = body.userMessageId ? String(body.userMessageId) : crypto.randomUUID();
    const userParentId = body.userParentId ? String(body.userParentId) : null;
    const assistantMessageId = body.assistantMessageId ? String(body.assistantMessageId) : crypto.randomUUID();

    const { model: _incomingModel, conversationId: _incomingConvId, userMessageId: _umId, userParentId: _upId, assistantMessageId: _amId, attachments: attachmentIds, messages: _msgs, ...rest } = body;

    // Temperature precedence: preset/setting override > body request > default undefined
    const finalTemperature = settingRow?.temperature ?? body.temperature;

    // Build attachments content array if present
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
            // Text files, code files (.py, .ts, .svelte, .html, .json, .md, .pdf, etc.)
            try {
              const textContent = fileData.toString("utf-8");
              // Basic check to strip any null bytes or non-printable binary characters
              const sanitizedText = textContent.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "");
              const ext = path.extname(row.original_name).replace(".", "") || "text";
              contentParts.push({
                type: "text",
                text: `\n\n--- Attached Document: ${row.original_name} ---\n\`\`\`${ext}\n${sanitizedText}\n\`\`\``,
              });
            } catch {
              contentParts.push({
                type: "text",
                text: `\n\n--- Attached File: ${row.original_name} (binary attachment) ---`,
              });
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

    let reqConfig;
    try {
      reqConfig = await adapter.buildRequest(buildParams);
    } catch (err) {
      return sendJsonError(
        reply,
        500,
        `Adapter failed to build request: ${err instanceof Error ? err.message : err}`,
      );
    }

    let upstream: Response;
    try {
      upstream = await fetch(reqConfig.url, {
        ...reqConfig.init,
        signal: abortController.signal,
      });
    } catch (err) {
      return sendJsonError(
        reply,
        502,
        `Couldn't reach backend "${backend.name}" at ${backend.baseUrl}: ${err instanceof Error ? err.message : err}`,
      );
    }

    if (!upstream.ok || !upstream.body) {
      const text = await upstream.text().catch(() => "");
      return sendJsonError(reply, upstream.status || 502, text || upstream.statusText);
    }

    reply.hijack();
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });

    const isNewConversation = !body.conversationId;

    if (isNewConversation) {
      const earlyMetaEvent = `data: ${JSON.stringify({
        type: "meta",
        conversationId,
        title: "New conversation",
        isNew: true,
        userMessageId,
        assistantMessageId
      })}\n\n`;
      reply.raw.write(earlyMetaEvent);
    }

    let assistantContent = "";
    let streamError: string | null = null;
    let usageStats: { promptTokens?: number; completionTokens?: number; totalTokens?: number; durationMs?: number; thinkingTimeMs?: number } | undefined;
    const startTime = Date.now();
    let hasPersisted = false;

    const subscribers = new Set<FastifyReply>();
    subscribers.add(reply);

    const nodeStream = Readable.fromWeb(upstream.body as import("stream/web").ReadableStream);
    let reasoningMode: "oob" | "inband" | null = null;
    let thinkingStartMs = 0;

    function doSaveTurn() {
      if (hasPersisted) return;
      hasPersisted = true;
      try {
        if (!usageStats) usageStats = {};
        if (!usageStats.durationMs && Date.now() - startTime > 0) {
          usageStats.durationMs = Date.now() - startTime;
        }

        if (assistantContent.includes("<think>") && !assistantContent.includes("</think>")) {
          assistantContent += "\n</think>";
        }

        if (reasoningMode) {
          usageStats.thinkingTimeMs = Date.now() - (thinkingStartMs || startTime);
        }

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
      assistantContent: "",
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

    const onClientDisconnect = () => {
      subscribers.delete(reply);
    };

    reply.raw.on("close", onClientDisconnect);
    req.raw.on("aborted", onClientDisconnect);

    const processContentDelta = (delta?: string, reasoning?: string, errMsg?: string) => {
      if (errMsg) streamError = errMsg;

      if (reasoning) {
        if (!reasoningMode) {
          reasoningMode = "oob";
          thinkingStartMs = Date.now();
          assistantContent += "<think>\n";
        }
        assistantContent += reasoning;
      }

      if (delta) {
        if (reasoningMode === "oob") {
          reasoningMode = null;
          if (!usageStats) usageStats = {};
          usageStats.thinkingTimeMs = Date.now() - (thinkingStartMs || startTime);
          assistantContent += "\n</think>\n";
        }

        if (delta.includes("<think>")) {
          reasoningMode = "inband";
          thinkingStartMs = Date.now();
        }

        if (reasoningMode === "inband" && delta.includes("</think>")) {
          reasoningMode = null;
          if (!usageStats) usageStats = {};
          usageStats.thinkingTimeMs = Date.now() - (thinkingStartMs || startTime);
        }

        assistantContent += delta;
      }

      currentActiveStream.assistantContent = assistantContent;
      currentActiveStream.streamError = streamError;
      currentActiveStream.usageStats = usageStats;
    };

    const parser = adapter.createStreamParser(buildParams);

    await new Promise<void>((resolve) => {
      nodeStream.on("data", (chunk: Buffer) => {
        const events = parser(chunk);
        for (const ev of events) {
          if (ev.error) streamError = ev.error;

          processContentDelta(ev.delta, ev.reasoning, ev.error);

          if (ev.usage) {
            if (!usageStats) usageStats = {};
            usageStats.promptTokens = ev.usage.promptTokens ?? usageStats.promptTokens;
            usageStats.completionTokens = ev.usage.completionTokens ?? usageStats.completionTokens;
            usageStats.totalTokens = ev.usage.totalTokens ?? usageStats.totalTokens;
            usageStats.durationMs = Date.now() - startTime;
            currentActiveStream.usageStats = usageStats;
          }

          if (ev.delta || ev.reasoning || ev.error) {
            const ssePayload = {
              id: `chatcmpl-${userMessageId}`,
              object: "chat.completion.chunk",
              created: Math.floor(Date.now() / 1000),
              model: rawModelId,
              choices: [
                {
                  index: 0,
                  delta: {
                    ...(ev.delta ? { content: ev.delta } : {}),
                    ...(ev.reasoning ? { reasoning_content: ev.reasoning } : {}),
                  },
                  finish_reason: ev.isDone ? "stop" : null,
                },
              ],
              ...(ev.usage
                ? {
                  usage: {
                    prompt_tokens: ev.usage.promptTokens,
                    completion_tokens: ev.usage.completionTokens,
                    total_tokens: ev.usage.totalTokens,
                  },
                }
                : {}),
            };
            const sseChunk = `data: ${JSON.stringify(ssePayload)}\n\n`;
            for (const sub of subscribers) {
              if (!sub.raw.writableEnded) {
                sub.raw.write(sseChunk);
              }
            }
          }
        }
      });

      const finishStream = () => {
        currentActiveStream.isDone = true;
        doSaveTurn();
        setTimeout(() => {
          activeStreams.delete(conversationId);
        }, 5000);
        resolve();
      };

      nodeStream.on("end", finishStream);
      nodeStream.on("error", (err) => {
        if (!streamError) streamError = String(err);
        finishStream();
      });
      nodeStream.on("close", finishStream);
    });
  });
}
