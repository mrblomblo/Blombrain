import os from "node:os";
import { existsSync } from "node:fs";
import type { FastifyInstance } from "fastify";
import db from "../db.js";
import { FRONTEND_DIST } from "../paths.js";
import { createBlombrainApp, isLoopbackHost } from "../appFactory.js";

export interface NetworkInterfaceAddress {
  name: string;
  address: string;
  family: "IPv4" | "IPv6";
}

export interface WebServerStatus {
  enabled: boolean;
  host: string;
  port: number;
  listening: boolean;
  activeHost: string | null;
  activePort: number | null;
  frontendAvailable: boolean;
  urls: string[];
  interfaces: NetworkInterfaceAddress[];
  error: string | null;
}

export interface WebServerConfig {
  enabled: boolean;
  host: string;
  port: number;
}

function normalizeHost(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function isWildcardHost(host: string): boolean {
  const h = normalizeHost(host).toLowerCase();
  return h === "0.0.0.0" || h === "::";
}

function formatHostForUrl(host: string): string {
  const clean = normalizeHost(host);
  return clean.includes(":") ? `[${clean}]` : clean;
}

function getLocalNetworkInterfaces(): NetworkInterfaceAddress[] {
  const out: NetworkInterfaceAddress[] = [];
  const ifaces = os.networkInterfaces();
  for (const [name, entries] of Object.entries(ifaces)) {
    if (!entries) continue;
    for (const entry of entries) {
      if (entry.internal) continue;
      if (entry.family === "IPv4") {
        out.push({ name, address: entry.address, family: "IPv4" });
      }
    }
  }
  out.sort((a, b) => a.name.localeCompare(b.name) || a.address.localeCompare(b.address));
  return out;
}

function formatListenError(err: any, host: string, port: number): string {
  const code = err?.code;
  if (code === "EADDRINUSE") {
    return `Port ${port} on ${host} is already in use by another process.`;
  }
  if (code === "EACCES") {
    return `Permission denied binding port ${port}. Use a port >= 1024.`;
  }
  if (code === "EADDRNOTAVAIL") {
    return `Host address "${host}" is not available on this machine.`;
  }
  return err?.message || `Failed to listen on ${host}:${port}`;
}

class WebServerManager {
  private instance: FastifyInstance | null = null;
  private primaryHost = "127.0.0.1";
  private primaryPort = 4300;
  private runtimeOpts = {
    corsOriginEnv: process.env.CORS_ORIGIN,
    maxUploadMb: Number(process.env.MAX_UPLOAD_MB ?? 100),
    logLevel: process.env.LOG_LEVEL ?? "info",
    trustProxy: true as boolean | string,
  };

  private configured: WebServerConfig = {
    enabled: false,
    host: "127.0.0.1",
    port: 4300,
  };
  private activeHost: string | null = null;
  private activePort: number | null = null;
  private lastError: string | null = null;
  private pendingOp: Promise<WebServerStatus> = Promise.resolve(this.getStatus());

  setPrimaryEndpoint(
    host: string,
    port: number,
    runtimeOpts?: {
      corsOriginEnv?: string;
      maxUploadMb?: number;
      logLevel?: string;
      trustProxy?: boolean | string;
    },
  ) {
    this.primaryHost = host;
    this.primaryPort = port;
    if (runtimeOpts) {
      this.runtimeOpts = {
        corsOriginEnv: runtimeOpts.corsOriginEnv,
        maxUploadMb: runtimeOpts.maxUploadMb ?? this.runtimeOpts.maxUploadMb,
        logLevel: runtimeOpts.logLevel ?? this.runtimeOpts.logLevel,
        trustProxy: runtimeOpts.trustProxy ?? this.runtimeOpts.trustProxy,
      };
    }
  }

  private conflictsWithPrimary(host: string, port: number): boolean {
    if (port !== this.primaryPort) return false;
    const h = normalizeHost(host).toLowerCase();
    const p = normalizeHost(this.primaryHost).toLowerCase();
    if (h === p) return true;
    if (isWildcardHost(h) || isWildcardHost(p)) return true;
    if (isLoopbackHost(h) && isLoopbackHost(p)) return true;
    return false;
  }

  getStatus(): WebServerStatus {
    const interfaces = getLocalNetworkInterfaces();
    const listening = Boolean(this.instance && this.activeHost && this.activePort);
    const urls: string[] = [];

    if (listening && this.activeHost && this.activePort) {
      if (isWildcardHost(this.activeHost)) {
        urls.push(`http://127.0.0.1:${this.activePort}`);
        for (const iface of interfaces) {
          urls.push(`http://${formatHostForUrl(iface.address)}:${this.activePort}`);
        }
      } else {
        urls.push(`http://${formatHostForUrl(this.activeHost)}:${this.activePort}`);
      }
    }

    return {
      enabled: this.configured.enabled,
      host: this.configured.host,
      port: this.configured.port,
      listening,
      activeHost: this.activeHost,
      activePort: this.activePort,
      frontendAvailable: existsSync(FRONTEND_DIST),
      urls,
      interfaces,
      error: this.lastError,
    };
  }

  async applyFromDb(): Promise<WebServerStatus> {
    const row = db
      .prepare<[string], { web_enabled?: number; web_host?: string; web_port?: number }>(
        "SELECT web_enabled, web_host, web_port FROM global_settings WHERE id = ?",
      )
      .get("default");

    return this.applyConfig({
      enabled: Boolean(row?.web_enabled),
      host: row?.web_host?.trim() || "127.0.0.1",
      port: Number(row?.web_port) || 4300,
    });
  }

  applyConfig(config: WebServerConfig): Promise<WebServerStatus> {
    const cleanConfig: WebServerConfig = {
      enabled: Boolean(config.enabled),
      host: normalizeHost(config.host || "127.0.0.1"),
      port: Number(config.port) || 4300,
    };

    this.pendingOp = this.pendingOp
      .catch(() => this.getStatus())
      .then(() => this.reconfigure(cleanConfig));
    return this.pendingOp;
  }

  async stop(): Promise<void> {
    await this.applyConfig({
      enabled: false,
      host: this.configured.host,
      port: this.configured.port,
    });
  }

  private async closeActiveInstance(): Promise<void> {
    if (!this.instance) return;
    const prev = this.instance;
    this.instance = null;
    this.activeHost = null;
    this.activePort = null;
    try {
      await prev.close();
    } catch { }
  }

  private async reconfigure(config: WebServerConfig): Promise<WebServerStatus> {
    const sameActive =
      config.enabled &&
      Boolean(this.instance) &&
      this.activeHost === config.host &&
      this.activePort === config.port;

    this.configured = config;

    if (sameActive) {
      this.lastError = null;
      return this.getStatus();
    }

    await this.closeActiveInstance();
    this.lastError = null;

    if (!config.enabled) {
      return this.getStatus();
    }

    if (this.conflictsWithPrimary(config.host, config.port)) {
      this.lastError = `Port ${config.port} conflicts with the primary server listener. Pick a different port (e.g. ${config.port + 1}).`;
      return this.getStatus();
    }

    let candidate: FastifyInstance | null = null;
    try {
      candidate = await createBlombrainApp({
        port: config.port,
        host: config.host,
        isDesktopInternal: false,
        corsOriginEnv: this.runtimeOpts.corsOriginEnv,
        maxUploadMb: this.runtimeOpts.maxUploadMb,
        logLevel: this.runtimeOpts.logLevel,
        trustProxy: this.runtimeOpts.trustProxy,
      });

      await candidate.listen({ port: config.port, host: config.host });
      this.instance = candidate;
      this.activeHost = config.host;
      this.activePort = config.port;
      this.lastError = null;
      console.log(`[web-server] Exposing web interface at http://${formatHostForUrl(config.host)}:${config.port}`);
    } catch (err) {
      if (candidate) {
        try {
          await candidate.close();
        } catch { }
      }
      this.instance = null;
      this.activeHost = null;
      this.activePort = null;
      this.lastError = formatListenError(err, config.host, config.port);
      console.warn(`[web-server] ${this.lastError}`);
    }

    return this.getStatus();
  }
}

export const webServerManager = new WebServerManager();
