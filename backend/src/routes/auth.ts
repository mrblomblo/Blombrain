import type { FastifyInstance } from "fastify";
import bcrypt from "bcrypt";
import crypto from "crypto";
import db from "../db.js";

function getPasswordHash(): string | null {
  const row = db
    .prepare<[string], { password_hash: string | null }>(
      "SELECT password_hash FROM global_settings WHERE id = ?"
    )
    .get("default");
  return row?.password_hash ?? null;
}

export async function authRoutes(app: FastifyInstance) {
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
      .prepare<[string], { token: string }>(
        "SELECT token FROM auth_sessions WHERE token = ?"
      )
      .get(token);

    if (!session) {
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

    const body = req.body as { password?: string };
    const password = body?.password ?? "";

    const matches = await bcrypt.compare(password, passwordHash);
    if (!matches) {
      return reply.code(401).send({ error: { message: "Invalid password" } });
    }

    const token = crypto.randomBytes(32).toString("hex");
    db.prepare("INSERT INTO auth_sessions (token, created_at) VALUES (?, ?)").run(
      token,
      Date.now()
    );

    reply.setCookie("blombrain_token", token, {
      path: "/",
      httpOnly: true,
      secure: req.protocol === "https",
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
