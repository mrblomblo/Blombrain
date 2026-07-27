import { Readable } from "node:stream";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { backendRegistry } from "../registry.js";

interface ChatCompletionBody {
  model: string;
  messages: Array<{ role: string; content: string }>;
  temperature?: number;
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

    const { model: _incomingModel, ...rest } = body;
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

    // Hand the raw response over to the upstream stream -- Fastify won't try
    // to also send a reply once we've done this.
    reply.hijack();
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });

    const nodeStream = Readable.fromWeb(upstream.body as import("stream/web").ReadableStream);

    req.raw.on("close", () => {
      if (!nodeStream.destroyed) nodeStream.destroy();
    });

    await new Promise<void>((resolve) => {
      nodeStream.pipe(reply.raw);
      nodeStream.on("end", resolve);
      nodeStream.on("error", () => {
        reply.raw.end();
        resolve();
      });
    });
  });
}
