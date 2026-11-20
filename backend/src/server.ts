import crypto from "node:crypto";
import { existsSync } from "node:fs";
import { FRONTEND_DIST } from "./paths.js";
import { createBlombrainApp } from "./appFactory.js";
import { initModelSync, stopModelSync } from "./services/modelSync.js";
import { tryLoadSqliteVec } from "./services/memory.js";
import { mcpManager } from "./services/mcp.js";
import { speechResourceManager } from "./services/speech.js";
import { backendProcessManager } from "./services/backendProcesses.js";
import { webServerManager } from "./services/webServer.js";

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

// Defaults to localhost-only. Set HOST=0.0.0.0 (or a specific LAN/tailscale address)
const HOST = process.env.HOST ?? "127.0.0.1";

const MAX_UPLOAD_MB = Number(process.env.MAX_UPLOAD_MB ?? 100);
const LOG_LEVEL = process.env.LOG_LEVEL ?? "info";

const TRUST_PROXY =
  process.env.TRUST_PROXY !== undefined
    ? process.env.TRUST_PROXY === "true" || process.env.TRUST_PROXY === "1"
      ? true
      : process.env.TRUST_PROXY === "false" || process.env.TRUST_PROXY === "0"
        ? false
        : process.env.TRUST_PROXY
    : true;

async function main() {
  const app = await createBlombrainApp({
    port: PORT,
    host: HOST,
    isDesktopInternal: IS_DESKTOP,
    launchSecret: LAUNCH_SECRET || undefined,
    desktopCookieToken: DESKTOP_COOKIE_TOKEN || undefined,
    corsOriginEnv: process.env.CORS_ORIGIN,
    maxUploadMb: MAX_UPLOAD_MB,
    logLevel: LOG_LEVEL,
    trustProxy: TRUST_PROXY,
  });

  await tryLoadSqliteVec();
  initModelSync();

  if (existsSync(FRONTEND_DIST)) {
    app.log.info(`Serving built frontend from ${FRONTEND_DIST}`);
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

    // Managed backend commands (llama-server, ollama, ...) can take a few seconds to honour
    // SIGTERM; the desktop shell waits longer than this before hard-killing us.
    const forceTimer = setTimeout(() => {
      process.exit(0);
    }, 6000);
    forceTimer.unref();

    try { stopModelSync(); } catch { }
    try { mcpManager.stopAllServers(); } catch { }
    try { await speechResourceManager.eject("all"); } catch { }
    try { await backendProcessManager.stopAll(3500); } catch { }
    try { await webServerManager.stop(); } catch { }
    try { await app.close(); } catch { }

    const dbModule = await import("./db.js");
    try {
      dbModule.default.pragma("wal_checkpoint(TRUNCATE)");
      dbModule.default.close();
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

  webServerManager.setPrimaryEndpoint(HOST, PORT, {
    corsOriginEnv: process.env.CORS_ORIGIN,
    maxUploadMb: MAX_UPLOAD_MB,
    logLevel: LOG_LEVEL,
    trustProxy: TRUST_PROXY,
  });

  await app.listen({ port: PORT, host: HOST });
  process.stdout.write(`BLOMBRAIN_READY port=${PORT}\n`);

  // Start optional web browser exposure listener configured in settings (non-fatal on bind error).
  webServerManager.applyFromDb().catch((err) => {
    console.error("[web-server] Failed to initialize web exposure listener:", err);
  });

  // Start each enabled backend's launch command (after the API is up so the UI can show progress).
  backendProcessManager.init().catch((err) => {
    console.error("[blombrain] backend process startup failed:", err);
  });
}

main().catch((err) => {
  console.error("[blombrain] failed to start:", err);
  process.exit(1);
});
