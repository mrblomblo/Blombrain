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
import { modelConfigsRoutes } from "./routes/modelConfigs.js";
import { uploadsRoutes } from "./routes/uploads.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 4300);

async function main() {
  const app = Fastify({ logger: true });

  await app.register(cors, { origin: true });
  await app.register(fastifyMultipart, { limits: { fileSize: 100 * 1024 * 1024 } }); // 100MB max

  await app.register(backendsRoutes);
  await app.register(modelsRoutes);
  await app.register(chatRoutes);
  await app.register(conversationsRoutes);
  await app.register(modelConfigsRoutes);
  await app.register(uploadsRoutes);

  // If the frontend has been built (frontend/dist), serve it directly so the
  // whole app can run as a single process. During `npm run dev` this
  // directory won't exist yet -- Vite's dev server handles the frontend
  // instead and proxies /api to us (see frontend/vite.config.ts).
  const frontendDist = path.join(__dirname, "..", "..", "frontend", "dist");
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

  await app.listen({ port: PORT, host: "0.0.0.0" });
}

main().catch((err) => {
  console.error("[blombrain] failed to start:", err);
  process.exit(1);
});
