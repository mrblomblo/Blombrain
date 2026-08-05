import { fileURLToPath } from "node:url";
import path from "node:path";
import { existsSync } from "node:fs";
import Fastify from "fastify";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import fastifyMultipart from "@fastify/multipart";
import "./db.js";
import { backendsRoutes } from "./routes/backends.js";
import { modelsRoutes } from "./routes/models.js";
import { chatRoutes } from "./routes/chat.js";
import { conversationsRoutes } from "./routes/conversations.js";
import { uploadsRoutes } from "./routes/uploads.js";
import { settingsRoutes } from "./routes/settings.js";
import { mcpRoutes } from "./routes/mcp.js";
import { skillRoutes } from "./routes/skills.js";
import { initModelSync } from "./services/modelSync.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// --- Configuration (env-overridable; sane defaults for local dev) ---------

const PORT = Number(process.env.PORT ?? 4300);
if (!Number.isFinite(PORT) || PORT <= 0) {
  throw new Error(`Invalid PORT: ${process.env.PORT}`);
}

// Defaults to localhost-only. Set HOST=0.0.0.0 (or a specific LAN/tailscale address)
const HOST = process.env.HOST ?? "127.0.0.1";

// Comma-separated list of allowed origins, or "*"/unset for any origin
const CORS_ORIGIN = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN === "*"
    ? true
    : process.env.CORS_ORIGIN.split(",").map((o) => o.trim())
  : true;

const MAX_UPLOAD_MB = Number(process.env.MAX_UPLOAD_MB ?? 100);

const LOG_LEVEL = process.env.LOG_LEVEL ?? "info";

async function main() {
  const app = Fastify({ logger: { level: LOG_LEVEL } });

  await app.register(cors, { origin: CORS_ORIGIN });
  await app.register(fastifyMultipart, {
    limits: { fileSize: MAX_UPLOAD_MB * 1024 * 1024 },
  });

  await app.register(backendsRoutes);
  await app.register(modelsRoutes);
  await app.register(chatRoutes);
  await app.register(conversationsRoutes);
  await app.register(uploadsRoutes);
  await app.register(settingsRoutes);
  await app.register(mcpRoutes);
  await app.register(skillRoutes);

  initModelSync();

  // If the frontend has been built (frontend/dist), serve it directly so the
  // whole app can run as a single process. During `npm run dev` this
  // directory won't exist yet -- Vite's dev server handles the frontend
  // instead and proxies /api to us (see frontend/vite.config.ts).
  const frontendDist =
    process.env.FRONTEND_DIST ??
    path.join(__dirname, "..", "..", "frontend", "dist");
  if (existsSync(frontendDist)) {
    await app.register(fastifyStatic, { root: frontendDist });
    app.setNotFoundHandler((req, reply) => {
      if (req.raw.url?.startsWith("/api")) {
        reply.code(404).send({ error: { message: "Not found" } });
        return;
      }
      reply.sendFile("index.html");
    });
    app.log.info(`Serving built frontend from ${frontendDist}`);
  } else {
    app.log.info(
      "No built frontend found -- run the Vite dev server separately (npm run dev in frontend/).",
    );
  }

  await app.listen({ port: PORT, host: HOST });
}

main().catch((err) => {
  console.error("[blombrain] failed to start:", err);
  process.exit(1);
});
