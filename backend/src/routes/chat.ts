import { Readable } from "node:stream";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { backendRegistry } from "../registry.js";
import { persistChatTurn } from "./conversations.js";

interface ChatCompletionBody {
  model: string;
  messages: Array<{ role: string; content: string }>;
  temperature?: number;
  /** Optional: resume an existing conversation. When omitted a new one is created. */
  conversationId?: string;
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

    const resolved = backendRegistry.resolveModelId(body.model);
    if (!resolved) {
      return sendJsonError(
        reply,
        400,
        `Model id "${body.model}" doesn't match any configured backend prefix. Expected "<prefix>:<model-id>".`,
      );
    }
    const { backend, rawModelId } = resolved;

    // Find the last user message in the payload -- that's the new turn we'll save.
    const lastUserMsg = [...body.messages].reverse().find((m) => m.role === "user");
    const userMessageId = crypto.randomUUID();
    const assistantMessageId = crypto.randomUUID();

    const { model: _incomingModel, conversationId: _incomingConvId, ...rest } = body;
    const upstreamBody = { ...rest, model: rawModelId, stream: true };

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

    // Collect the full assistant response so we can persist it after the stream ends.
    let assistantContent = "";
    let streamError: string | undefined;

    const nodeStream = Readable.fromWeb(upstream.body as import("stream/web").ReadableStream);
    const decoder = new TextDecoder();
    let buffer = "";

    req.raw.on("close", () => {
      if (!nodeStream.destroyed) nodeStream.destroy();
    });

    await new Promise<void>((resolve) => {
      nodeStream.on("data", (chunk: Buffer) => {
        const text = typeof chunk === "string" ? chunk : decoder.decode(chunk, { stream: true });
        buffer += text;

        // Forward raw bytes to the client immediately.
        reply.raw.write(chunk);

        // Also parse the SSE to accumulate the assistant response.
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
              if (delta) assistantContent += delta;
              const errMsg: string | undefined = parsed?.error?.message;
              if (errMsg) streamError = errMsg;
            } catch {
              // Partial/malformed chunk -- the buffer logic handles this.
            }
          }
        }
      });

      nodeStream.on("end", () => {
        // Persist the completed turn to SQLite.
        try {
          const savedTurn = persistChatTurn({
            conversationId: body.conversationId ?? null,
            model: body.model,
            userMessageId,
            userContent: lastUserMsg?.content ?? "",
            assistantMessageId,
            assistantContent,
            assistantError: streamError,
          });

          // Emit a trailing meta event so the frontend knows the conversation id / title.
          const metaEvent =
            `data: ${JSON.stringify({
              type: "meta",
              conversationId: savedTurn.conversationId,
              title: savedTurn.title,
              isNew: savedTurn.isNew,
              userMessageId,
              assistantMessageId,
            })}\n\n`;
          reply.raw.write(metaEvent);
        } catch (err) {
          // Don't crash the response if persistence fails -- the client already got the answer.
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
