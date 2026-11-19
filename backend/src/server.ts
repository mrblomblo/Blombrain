import path from "node:path";
import crypto from "node:crypto";
import { existsSync } from "node:fs";
import Fastify from "fastify";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import fastifyMultipart from "@fastify/multipart";
import cookie from "@fastify/cookie";
import db from "./db.js";
import { FRONTEND_DIST } from "./paths.js";
import { backendsRoutes } from "./routes/backends.js";
import { modelsRoutes } from "./routes/models.js";
import { chatRoutes } from "./routes/chat.js";
import { conversationsRoutes } from "./routes/conversations.js";
import { uploadsRoutes } from "./routes/uploads.js";
import { settingsRoutes } from "./routes/settings.js";
import { mcpRoutes } from "./routes/mcp.js";
import { skillRoutes } from "./routes/skills.js";
import { artifactsRoutes } from "./routes/artifacts.js";
import { authRoutes } from "./routes/auth.js";
import { memoriesRoutes } from "./routes/memories.js";
import { backupRoutes } from "./routes/backup.js";
import { speechRoutes } from "./routes/speech.js";
import { initModelSync, stopModelSync } from "./services/modelSync.js";
import { tryLoadSqliteVec } from "./services/memory.js";
import { mcpManager } from "./services/mcp.js";
import { speechResourceManager } from "./services/speech.js";

// --- Configuration (env-overridable; sane defaults for local dev) ---------

const PORT = Number(process.env.PORT ?? 4300);
if (!Number.isFinite(PORT) || PORT <= 0) {
  throw new Error(`Invalid PORT: ${process.env.PORT}`);
}

const IS_DESKTOP = process.env.BLOMBRAIN_DESKTOP === "1";
const LAUNCH_SECRET = process.env.BLOMBRAIN_LAUNCH_SECRET || "";
const DESKTOP_COOKIE_TOKEN = LAUNCH_SECRET
  ? crypto.randomBytes(32).toString("hex")
  : "";

function safeTokenEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function isAllowedDesktopHost(hostHeader: string | undefined): boolean {
  if (!hostHeader) return true;
  const normalized = hostHeader.trim().toLowerCase();
  return (
    normalized === `127.0.0.1:${PORT}` ||
    normalized === `localhost:${PORT}` ||
    normalized === "127.0.0.1" ||
    normalized === "localhost"
  );
}

// Defaults to localhost-only. Set HOST=0.0.0.0 (or a specific LAN/tailscale address)
const HOST = process.env.HOST ?? "127.0.0.1";

// Comma-separated list of allowed origins, "*" for any origin, or unset for localhost/loopback origins
const LOCAL_ORIGIN_REGEX = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$|^tauri:\/\/localhost$|^https?:\/\/tauri\.localhost$/i;
const CORS_ORIGIN: boolean | string[] | ((origin: string | undefined, cb: (err: Error | null, allow: boolean) => void) => void) =
  process.env.CORS_ORIGIN
    ? process.env.CORS_ORIGIN === "*"
      ? true
      : process.env.CORS_ORIGIN.split(",").map((o) => o.trim())
    : (origin, cb) => {
        if (!origin || LOCAL_ORIGIN_REGEX.test(origin)) {
          cb(null, true);
        } else {
          cb(null, false);
        }
      };

const MAX_UPLOAD_MB = Number(process.env.MAX_UPLOAD_MB ?? 100);

const LOG_LEVEL = process.env.LOG_LEVEL ?? "info";

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

const TRUST_PROXY =
  process.env.TRUST_PROXY !== undefined
    ? process.env.TRUST_PROXY === "true" || process.env.TRUST_PROXY === "1"
      ? true
      : process.env.TRUST_PROXY === "false" || process.env.TRUST_PROXY === "0"
        ? false
        : process.env.TRUST_PROXY
    : true;

async function main() {
  const app = Fastify({
    logger: { level: LOG_LEVEL },
    trustProxy: TRUST_PROXY,
  });

  await app.register(cors, { origin: CORS_ORIGIN, credentials: true });
  await app.register(fastifyMultipart, {
    limits: { fileSize: MAX_UPLOAD_MB * 1024 * 1024 },
  });
  await app.register(cookie);

  app.get("/api/health", async (_req, reply) => {
    return reply.send({ ok: true, desktop: IS_DESKTOP });
  });

  app.addHook("onRequest", async (req, reply) => {
    const rawUrl = req.raw.url ?? "";

    if (IS_DESKTOP && !isAllowedDesktopHost(req.headers.host)) {
      return reply.code(403).send({ error: { message: "Forbidden host header" } });
    }

    if (LAUNCH_SECRET && !rawUrl.startsWith("/api")) {
      const qIdx = rawUrl.indexOf("?");
      if (qIdx !== -1) {
        const params = new URLSearchParams(rawUrl.slice(qIdx + 1));
        const supplied = params.get("launch");
        if (supplied && safeTokenEqual(supplied, LAUNCH_SECRET)) {
          reply.setCookie("blombrain_launch", DESKTOP_COOKIE_TOKEN, {
            path: "/",
            httpOnly: true,
            sameSite: "lax",
            maxAge: 60 * 60 * 24 * 30,
          });
          return reply.redirect("/");
        }
      }
    }

    if (!rawUrl.startsWith("/api")) return;
    if (rawUrl === "/api/health" || rawUrl.startsWith("/api/health?")) return;

    if (LAUNCH_SECRET) {
      const launchCookie = req.cookies?.blombrain_launch;
      if (!launchCookie || !safeTokenEqual(launchCookie, DESKTOP_COOKIE_TOKEN)) {
        return reply.code(401).send({ error: { message: "Desktop launch session required" } });
      }
    }

    if (rawUrl.startsWith("/api/auth/")) return;
    if (rawUrl.startsWith("/api/instance-info")) return;

    const row = db
      .prepare<[string], { password_hash: string | null }>(
        "SELECT password_hash FROM global_settings WHERE id = ?"
      )
      .get("default");

    if (!row?.password_hash) return;

    const token = req.cookies?.blombrain_token;
    if (!token) {
      return reply.code(401).send({ error: { message: "Unauthorized" } });
    }

    const session = db
      .prepare<[string], { token: string; created_at: number }>(
        "SELECT token, created_at FROM auth_sessions WHERE token = ?"
      )
      .get(token);

    if (!session) {
      return reply.code(401).send({ error: { message: "Unauthorized" } });
    }

    if (Date.now() - session.created_at > SESSION_TTL_MS) {
      db.prepare("DELETE FROM auth_sessions WHERE token = ?").run(token);
      return reply.code(401).send({ error: { message: "Session expired" } });
    }
  });

  await app.register(authRoutes);
  await app.register(backendsRoutes);
  await app.register(modelsRoutes);
  await app.register(chatRoutes);
  await app.register(conversationsRoutes);
  await app.register(uploadsRoutes);
  await app.register(settingsRoutes);
  await app.register(mcpRoutes);
  await app.register(skillRoutes);
  await app.register(artifactsRoutes);
  await app.register(memoriesRoutes);
  await app.register(backupRoutes);
  await app.register(speechRoutes);

  await tryLoadSqliteVec();
  initModelSync();

  // If the frontend has been built (frontend/dist), serve it directly so the
  // whole app can run as a single process. During `npm run dev` this
  // directory won't exist yet -- Vite's dev server handles the frontend
  // instead and proxies /api to us (see frontend/vite.config.ts).
  const frontendDist = FRONTEND_DIST;
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

  let isShuttingDown = false;
  const gracefulShutdown = async (reason: string) => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    app.log.info(`Shutting down Blombrain backend (${reason})...`);

    const forceTimer = setTimeout(() => {
      process.exit(0);
    }, 2500);
    forceTimer.unref();

    try { stopModelSync(); } catch { }
    try { mcpManager.stopAllServers(); } catch { }
    try { await speechResourceManager.eject("all"); } catch { }
    try { await app.close(); } catch { }
    try {
      db.pragma("wal_checkpoint(TRUNCATE)");
      db.close();
    } catch { }

    process.exit(0);
  };

  process.on("SIGTERM", () => { void gracefulShutdown("SIGTERM"); });
  process.on("SIGINT", () => { void gracefulShutdown("SIGINT"); });

  if (process.env.BLOMBRAIN_PARENT_WATCH === "1") {
    process.stdin.resume();
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk: string) => {
      if (chunk.includes("__BLOMBRAIN_SHUTDOWN__")) {
        void gracefulShutdown("parent shutdown command");
      }
    });
    process.stdin.on("end", () => {
      void gracefulShutdown("parent stdin closed");
    });
  }

  await app.listen({ port: PORT, host: HOST });
  process.stdout.write(`BLOMBRAIN_READY port=${PORT}\n`);
}

main().catch((err) => {
  console.error("[blombrain] failed to start:", err);
  process.exit(1);
});
