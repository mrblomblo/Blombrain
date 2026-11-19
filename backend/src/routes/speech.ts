import type { FastifyInstance } from "fastify";
import {
  transcribeSpeech,
  synthesizeSpeech,
  speechResourceManager,
} from "../services/speech.js";

export async function speechRoutes(app: FastifyInstance) {
  // GET /api/speech/status
  app.get("/api/speech/status", async (_req, reply) => {
    return reply.send(speechResourceManager.getStatus());
  });

  // POST /api/speech/eject
  app.post<{ Body: { target?: "stt" | "tts" | "all" } }>(
    "/api/speech/eject",
    async (req, reply) => {
      const target = req.body?.target || "all";
      const status = await speechResourceManager.eject(target);
      return reply.send({ success: true, status });
    }
  );

  // POST /api/speech/transcribe (multipart file upload)
  app.post<{ Querystring: { model?: string } }>("/api/speech/transcribe", async (req, reply) => {
    const data = await req.file();
    if (!data) {
      return reply.status(400).send({ error: "No audio file uploaded." });
    }
    const buf = await data.toBuffer();
    try {
      const result = await transcribeSpeech(
        buf,
        data.filename || "audio.wav",
        data.mimetype || "audio/wav",
        req.query.model || null
      );
      return reply.send(result);
    } catch (err: any) {
      return reply.status(400).send({
        error: err?.message || "Speech transcription failed.",
      });
    }
  });

  // POST /api/speech/synthesize
  app.post<{ Body: { text: string } }>("/api/speech/synthesize", async (req, reply) => {
    const text = (req.body?.text ?? "").trim();
    if (!text) {
      return reply.status(400).send({ error: "Text is required for speech synthesis." });
    }

    try {
      const { audio, contentType } = await synthesizeSpeech(text);
      reply.header("Content-Type", contentType);
      reply.header("Cache-Control", "no-store");
      return reply.send(audio);
    } catch (err: any) {
      return reply.status(500).send({
        error: err?.message || "Speech synthesis failed.",
      });
    }
  });
}
