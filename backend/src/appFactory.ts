import crypto from "node:crypto";
import { existsSync } from "node:fs";
import Fastify, { type FastifyInstance } from "fastify";
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
import { foldersRoutes } from "./routes/folders.js";
import { uploadsRoutes } from "./routes/uploads.js";
import { settingsRoutes } from "./routes/settings.js";
import { mcpRoutes } from "./routes/mcp.js";
import { skillRoutes } from "./routes/skills.js";
import { artifactsRoutes } from "./routes/artifacts.js";
import { authRoutes } from "./routes/auth.js";
import { memoriesRoutes } from "./routes/memories.js";
import { backupRoutes } from "./routes/backup.js";
import { speechRoutes } from "./routes/speech.js";
import { promptTemplatesRoutes } from "./routes/promptTemplates.js";
import { verifyUploadViewToken } from "./services/uploadTokens.js";

const LOCAL_ORIGIN_REGEX =
  /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$|^tauri:\/\/localhost$|^https?:\/\/tauri\.localhost$/i;

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export interface AppServerOptions {
  port: number;
  host: string;
  isDesktopInternal: boolean;
  launchSecret?: string;
  desktopCookieToken?: string;
  corsOriginEnv?: string;
  maxUploadMb: number;
  logLevel: string;
  trustProxy: boolean | string;
}

function safeTokenEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

export function isLoopbackHost(host: string): boolean {
  const h = host.trim().toLowerCase().replace(/^\[|\]$/g, "");
  return h === "127.0.0.1" || h === "localhost" || h === "::1";
}

function isAllowedLoopbackHostHeader(hostHeader: string | undefined, port: number): boolean {
  if (!hostHeader) return true;
  const normalized = hostHeader.trim().toLowerCase();
  if (port === 0) {
    return (
      normalized.startsWith("127.0.0.1") ||
      normalized.startsWith("localhost") ||
      normalized.startsWith("[::1]") ||
      normalized === "::1"
    );
  }
  return (
    normalized === `127.0.0.1:${port}` ||
    normalized === `localhost:${port}` ||
    normalized === `[::1]:${port}` ||
    normalized === "127.0.0.1" ||
    normalized === "localhost" ||
    normalized === "[::1]" ||
    normalized === "::1"
  );
}

export async function createBlombrainApp(opts: AppServerOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: opts.logLevel },
    trustProxy: opts.trustProxy,
  });

  const envCors = opts.corsOriginEnv?.trim();
  if (envCors) {
    const originOpt: boolean | string[] =
      envCors === "*" ? true : envCors.split(",").map((o) => o.trim());
    await app.register(cors, { origin: originOpt, credentials: true });
  } else {
    await app.register(cors, {
      delegator: (req, cb) => {
        const reqHost = req.headers.host?.trim().toLowerCase();
        cb(null, {
          credentials: true,
          origin: (origin, originCb) => {
            if (!origin || LOCAL_ORIGIN_REGEX.test(origin)) {
              originCb(null, true);
              return;
            }
            if (!opts.isDesktopInternal && reqHost) {
              try {
                const parsed = new URL(origin);
                if (parsed.host.toLowerCase() === reqHost) {
                  originCb(null, true);
                  return;
                }
              } catch { }
            }
            originCb(null, false);
          },
        });
      },
    });
  }

  await app.register(fastifyMultipart, {
    limits: { fileSize: opts.maxUploadMb * 1024 * 1024 },
  });
  await app.register(cookie);

  app.get("/api/health", async (_req, reply) => {
    return reply.send({ ok: true, desktop: opts.isDesktopInternal });
  });

  const enforceLoopbackHostHeader = opts.isDesktopInternal || isLoopbackHost(opts.host);
  const launchSecret = opts.launchSecret ?? "";
  const desktopCookieToken = opts.desktopCookieToken ?? "";

  app.addHook("onRequest", async (req, reply) => {
    const rawUrl = req.raw.url ?? "";

    if (enforceLoopbackHostHeader && !isAllowedLoopbackHostHeader(req.headers.host, opts.port)) {
      return reply.code(403).send({ error: { message: "Forbidden host header" } });
    }

    if (launchSecret && !rawUrl.startsWith("/api")) {
      const qIdx = rawUrl.indexOf("?");
      if (qIdx !== -1) {
        const params = new URLSearchParams(rawUrl.slice(qIdx + 1));
        const supplied = params.get("launch");
        if (supplied && safeTokenEqual(supplied, launchSecret)) {
          reply.setCookie("blombrain_launch", desktopCookieToken, {
            path: "/",
            httpOnly: true,
            sameSite: "lax",
            maxAge: 60 * 60 * 24 * 30,
          });
          return reply.redirect("/");
        }
      }
    }

    // Check if this request is authorized by a valid upload view token or launch parameter
    let isUploadViewAuthorized = false;
    if (rawUrl.startsWith("/api/uploads/")) {
      const qIdx = rawUrl.indexOf("?");
      if (qIdx !== -1) {
        const params = new URLSearchParams(rawUrl.slice(qIdx + 1));
        const viewToken = params.get("token");
        const suppliedLaunch = params.get("launch");
        if (suppliedLaunch && launchSecret && safeTokenEqual(suppliedLaunch, launchSecret)) {
          isUploadViewAuthorized = true;
        } else if (viewToken) {
          const pathOnly = rawUrl.slice(0, qIdx);
          const match = pathOnly.match(/^\/api\/uploads\/([^/?#]+)/);
          const uploadId = match ? decodeURIComponent(match[1]) : "";
          if (uploadId && verifyUploadViewToken(viewToken, uploadId)) {
            isUploadViewAuthorized = true;
          }
        }
      }
    }

    if (!rawUrl.startsWith("/api")) return;
    if (rawUrl === "/api/health" || rawUrl.startsWith("/api/health?")) return;

    if (launchSecret && !isUploadViewAuthorized) {
      const launchCookie = req.cookies?.blombrain_launch;
      if (!launchCookie || !safeTokenEqual(launchCookie, desktopCookieToken)) {
        return reply.code(401).send({ error: { message: "Desktop launch session required" } });
      }
    }

    if (rawUrl.startsWith("/api/auth/")) return;
    if (rawUrl.startsWith("/api/instance-info")) return;

    if (isUploadViewAuthorized) {
      if (launchSecret && desktopCookieToken) {
        reply.setCookie("blombrain_launch", desktopCookieToken, {
          path: "/",
          httpOnly: true,
          sameSite: "lax",
          maxAge: 60 * 60 * 24 * 30,
        });
      }
      return;
    }

    const row = db
      .prepare<[string], { password_hash: string | null }>(
        "SELECT password_hash FROM global_settings WHERE id = ?",
      )
      .get("default");

    if (!row?.password_hash) return;

    const token = req.cookies?.blombrain_token;
    if (!token) {
      return reply.code(401).send({ error: { message: "Unauthorized" } });
    }

    const session = db
      .prepare<[string], { token: string; created_at: number }>(
        "SELECT token, created_at FROM auth_sessions WHERE token = ?",
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
  await app.register(foldersRoutes);
  await app.register(uploadsRoutes);
  await app.register(settingsRoutes);
  await app.register(mcpRoutes);
  await app.register(skillRoutes);
  await app.register(artifactsRoutes);
  await app.register(memoriesRoutes);
  await app.register(backupRoutes);
  await app.register(speechRoutes);
  await app.register(promptTemplatesRoutes);

  if (existsSync(FRONTEND_DIST)) {
    await app.register(fastifyStatic, { root: FRONTEND_DIST });
    app.setNotFoundHandler((req, reply) => {
      if (req.raw.url?.startsWith("/api")) {
        reply.code(404).send({ error: { message: "Not found" } });
        return;
      }
      reply.sendFile("index.html");
    });
  }

  return app;
}
