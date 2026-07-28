import { Readable } from "node:stream";
import fs from "node:fs";
import path from "node:path";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { backendRegistry } from "../registry.js";
import { persistChatTurn } from "./conversations.js";
import db from "../db.js";
import type { AttachmentRow, ModelSettingRow } from "../types.js";

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

export async function chatRoutes(app: FastifyInstance) {
  app.post("/api/chat/completions", async (req: FastifyRequest, reply: FastifyReply) => {
    const body = req.body as ChatCompletionBody;

    if (!body?.model || !Array.isArray(body.messages)) {
      return sendJsonError(reply, 400, "Request body must include `model` and `messages`.");
    }

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
    }

    const upstreamBody = {
      ...rest,
      ...extraParams,
      model: rawModelId,
      messages: outgoingMessages,
      ...(finalTemperature !== undefined ? { temperature: finalTemperature } : {}),
      stream: true,
      stream_options: { include_usage: true },
    };

    let upstream: Response;
    try {
      upstream = await fetch(`${backend.baseUrl}/v1/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(backend.apiKey ? { Authorization: `Bearer ${backend.apiKey}` } : {}),
        },
        body: JSON.stringify(upstreamBody),
      });
    } catch (err) {
      return sendJsonError(
        reply,
        502,
        `Couldn't reach backend "${backend.name}" at ${backend.baseUrl}: ${
          err instanceof Error ? err.message : err
        }`,
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

    let assistantContent = "";
    let streamError: string | undefined;
    let usageStats: { promptTokens?: number; completionTokens?: number; totalTokens?: number; durationMs?: number; thinkingTimeMs?: number } | undefined;
    const startTime = Date.now();

    const nodeStream = Readable.fromWeb(upstream.body as import("stream/web").ReadableStream);
    const decoder = new TextDecoder();
    let buffer = "";
    let reasoningMode: "oob" | "inband" | null = null;
    let thinkingStartMs = 0;

    req.raw.on("close", () => {
      if (!nodeStream.destroyed) nodeStream.destroy();
    });

    await new Promise<void>((resolve) => {
      nodeStream.on("data", (chunk: Buffer) => {
        const text = typeof chunk === "string" ? chunk : decoder.decode(chunk, { stream: true });
        buffer += text;

        reply.raw.write(chunk);

        let sepIndex: number;
        while ((sepIndex = buffer.indexOf("\n\n")) !== -1) {
          const rawEvent = buffer.slice(0, sepIndex);
          buffer = buffer.slice(sepIndex + 2);
          for (const line of rawEvent.split("\n")) {
            const trimmed = line.trim();
            if (!trimmed.startsWith("data:")) continue;
            const payload = trimmed.slice(5).trim();
            if (payload === "[DONE]") continue;
            try {
              const parsed = JSON.parse(payload);
              const delta: string | undefined = parsed?.choices?.[0]?.delta?.content;
              const reasoning: string | undefined = parsed?.choices?.[0]?.delta?.reasoning_content;
              
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
              const errMsg: string | undefined = parsed?.error?.message;
              if (errMsg) streamError = errMsg;

              const usage = parsed?.usage || parsed?.x_groq?.usage;
              if (usage) {
                if (!usageStats) usageStats = {};
                usageStats.promptTokens = usage.prompt_tokens ?? usageStats.promptTokens;
                usageStats.completionTokens = usage.completion_tokens ?? usageStats.completionTokens;
                usageStats.totalTokens = usage.total_tokens ?? usageStats.totalTokens;
                usageStats.durationMs = Date.now() - startTime;
              }
            } catch {
              // Partial chunk
            }
          }
        }
      });

      nodeStream.on("end", () => {
        try {
          if (!usageStats) usageStats = {};
          if (!usageStats.durationMs && Date.now() - startTime > 0) {
            usageStats.durationMs = Date.now() - startTime;
          }

          if (reasoningMode) {
            if (reasoningMode === "oob") {
              assistantContent += "\n</think>";
            }
            usageStats.thinkingTimeMs = Date.now() - (thinkingStartMs || startTime);
          }

          const savedTurn = persistChatTurn({
            conversationId: body.conversationId ?? null,
            model: body.model,
            userMessageId,
            userParentId,
            userContent: originalUserContent,
            assistantMessageId,
            assistantContent,
            assistantError: streamError,
            assistantStats: usageStats,
          });

          if (attachmentIds && Array.isArray(attachmentIds)) {
            const updateStmt = db.prepare(`UPDATE attachments SET message_id = ?, conversation_id = ? WHERE id = ?`);
            for (const id of attachmentIds) {
              updateStmt.run(userMessageId, savedTurn.conversationId, id);
            }
          }

          const metaEvent =
            `data: ${JSON.stringify({
              type: "meta",
              conversationId: savedTurn.conversationId,
              title: savedTurn.title,
              isNew: savedTurn.isNew,
              userMessageId,
              assistantMessageId,
              stats: usageStats,
            })}\n\n`;
          reply.raw.write(metaEvent);
        } catch (err) {
          console.error("[blombrain] failed to persist chat turn:", err);
        }
        reply.raw.end();
        resolve();
      });

      nodeStream.on("error", () => {
        reply.raw.end();
        resolve();
      });
    });
  });
}
