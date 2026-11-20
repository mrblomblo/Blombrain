import type { FastifyInstance, FastifyRequest } from "fastify";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import db from "../db.js";

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const MAX_LOGIN_ATTEMPTS = 5;

interface LoginAttemptRecord {
  count: number;
  firstAttemptAt: number;
  lockedUntil: number;
}

const loginAttempts = new Map<string, LoginAttemptRecord>();

function getClientIp(req: FastifyRequest): string {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) {
    return forwarded.split(",")[0].trim();
  }
  return req.ip || "unknown";
}

function isSecureRequest(req: FastifyRequest): boolean {
  if (req.protocol === "https") return true;
  const proto = req.headers["x-forwarded-proto"];
  if (typeof proto === "string" && proto.split(",")[0].trim().toLowerCase() === "https") {
    return true;
  }
  return false;
}

function getPasswordHash(): string | null {
  const row = db
    .prepare<[string], { password_hash: string | null }>(
      "SELECT password_hash FROM global_settings WHERE id = ?"
    )
    .get("default");
  return row?.password_hash ?? null;
}

export async function authRoutes(app: FastifyInstance) {
  // Periodically purge expired auth sessions and stale rate-limit records
  const cleanupTimer = setInterval(() => {
    try {
      const cutoff = Date.now() - SESSION_TTL_MS;
      db.prepare("DELETE FROM auth_sessions WHERE created_at < ?").run(cutoff);
      const now = Date.now();
      for (const [ip, rec] of loginAttempts.entries()) {
        if (now - rec.firstAttemptAt > RATE_LIMIT_WINDOW_MS && now >= rec.lockedUntil) {
          loginAttempts.delete(ip);
        }
      }
    } catch { }
  }, 3600 * 1000);
  cleanupTimer.unref?.();
  app.addHook("onClose", async () => {
    clearInterval(cleanupTimer);
  });

  // GET /api/auth/check
  app.get("/api/auth/check", async (req, reply) => {
    const passwordHash = getPasswordHash();
    if (!passwordHash) {
      return reply.send({ authEnabled: false, authenticated: true });
    }

    const token = req.cookies?.blombrain_token;
    if (!token) {
      return reply.send({ authEnabled: true, authenticated: false });
    }

    const session = db
      .prepare<[string], { token: string; created_at: number }>(
        "SELECT token, created_at FROM auth_sessions WHERE token = ?"
      )
      .get(token);

    if (!session) {
      return reply.send({ authEnabled: true, authenticated: false });
    }

    if (Date.now() - session.created_at > SESSION_TTL_MS) {
      db.prepare("DELETE FROM auth_sessions WHERE token = ?").run(token);
      return reply.send({ authEnabled: true, authenticated: false });
    }

    return reply.send({ authEnabled: true, authenticated: true });
  });

  // POST /api/auth/login
  app.post("/api/auth/login", async (req, reply) => {
    const passwordHash = getPasswordHash();
    if (!passwordHash) {
      return reply.code(400).send({ error: { message: "Authentication is not enabled" } });
    }

    const ip = getClientIp(req);
    const now = Date.now();
    let record = loginAttempts.get(ip);

    if (record) {
      if (now < record.lockedUntil) {
        const retryAfterSec = Math.max(1, Math.ceil((record.lockedUntil - now) / 1000));
        reply.header("Retry-After", String(retryAfterSec));
        return reply.code(429).send({
          error: {
            message: `Too many failed login attempts. Please wait ${retryAfterSec} seconds before trying again.`,
          },
        });
      }
      if (now - record.firstAttemptAt > RATE_LIMIT_WINDOW_MS) {
        record = undefined;
        loginAttempts.delete(ip);
      }
    }

    const body = req.body as { password?: string };
    const password = body?.password ?? "";

    const matches = await bcrypt.compare(password, passwordHash);
    if (!matches) {
      const nextCount = (record?.count ?? 0) + 1;
      const firstAttemptAt = record?.firstAttemptAt ?? now;
      const lockedUntil = nextCount >= MAX_LOGIN_ATTEMPTS ? now + RATE_LIMIT_WINDOW_MS : 0;
      loginAttempts.set(ip, { count: nextCount, firstAttemptAt, lockedUntil });

      if (lockedUntil > now) {
        const retryAfterSec = Math.ceil(RATE_LIMIT_WINDOW_MS / 1000);
        reply.header("Retry-After", String(retryAfterSec));
        return reply.code(429).send({
          error: {
            message: `Too many failed login attempts. Locked for ${Math.ceil(retryAfterSec / 60)} minutes.`,
          },
        });
      }

      return reply.code(401).send({ error: { message: "Invalid password" } });
    }

    loginAttempts.delete(ip);

    const token = crypto.randomBytes(32).toString("hex");
    db.prepare("INSERT INTO auth_sessions (token, created_at) VALUES (?, ?)").run(
      token,
      now
    );

    reply.setCookie("blombrain_token", token, {
      path: "/",
      httpOnly: true,
      secure: isSecureRequest(req),
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 7, // 7 days
    });

    return reply.send({ success: true });
  });

  // POST /api/auth/logout
  app.post("/api/auth/logout", async (req, reply) => {
    const token = req.cookies?.blombrain_token;
    if (token) {
      db.prepare("DELETE FROM auth_sessions WHERE token = ?").run(token);
    }

    reply.clearCookie("blombrain_token", { path: "/" });
    return reply.send({ success: true });
  });
}
