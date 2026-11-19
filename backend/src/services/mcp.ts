import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import db from "../db.js";
import type { McpServerRow, McpServerOut, McpServerWriteBody } from "../types.js";

export const MCP_SECRET_MASK = "••••••••";

export interface McpToolDefinition {
  serverId: string;
  serverName: string;
  name: string;
  description?: string;
  inputSchema: Record<string, any>;
}

function maskRecord(rec: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(rec)) {
    out[k] = v ? MCP_SECRET_MASK : "";
  }
  return out;
}

class McpManager {
  private clients = new Map<string, { client: Client; transport: any; status: "connected" | "connecting" | "error" | "stopped"; error?: string }>();
  private crashCounts = new Map<string, number>();
  private toolsCache = new Map<string, McpToolDefinition[]>();

  public getAllServers(excludedIds: string[] = [], options?: { maskSecrets?: boolean }): McpServerOut[] {
    const shouldMask = options?.maskSecrets ?? true;
    const rows = db.prepare("SELECT * FROM mcp_servers ORDER BY name ASC").all() as McpServerRow[];
    return rows.map((r) => {
      let args: string[] = [];
      let env: Record<string, string> = {};
      let headers: Record<string, string> = {};
      try { args = JSON.parse(r.args); } catch { }
      try { env = JSON.parse(r.env); } catch { }
      try { headers = JSON.parse(r.headers || "{}"); } catch { }

      const active = this.clients.get(r.id);
      const globallyEnabled = r.is_enabled === 1;
      return {
        id: r.id,
        name: r.name,
        type: r.type as "stdio" | "http",
        commandOrUrl: r.command_or_url,
        args,
        env: shouldMask ? maskRecord(env) : env,
        headers: shouldMask ? maskRecord(headers) : headers,
        isEnabled: globallyEnabled && !excludedIds.includes(r.id),
        status: !globallyEnabled ? "disabled" : (active?.status ?? "stopped"),
        error: active?.error,
      };
    });
  }

  public getRawServerRow(id: string): McpServerRow | undefined {
    return db.prepare("SELECT * FROM mcp_servers WHERE id = ?").get(id) as McpServerRow | undefined;
  }

  public upsertServer(body: McpServerWriteBody): McpServerOut {
    const id = body.id ?? crypto.randomUUID();
    const existing = this.getRawServerRow(id);

    const name = body.name ?? existing?.name ?? "";
    const type = body.type ?? (existing?.type as "stdio" | "http") ?? "stdio";
    const commandOrUrl = body.commandOrUrl ?? existing?.command_or_url ?? "";

    const collision = db.prepare("SELECT id FROM mcp_servers WHERE name = ? AND id != ?").get(name, id);
    if (collision) {
      throw new Error(`Server name "${name}" is already in use. Please choose a unique name.`);
    }

    let existingArgs: string[] = [];
    let existingEnv: Record<string, string> = {};
    let existingHeaders: Record<string, string> = {};
    if (existing) {
      try { existingArgs = JSON.parse(existing.args); } catch { }
      try { existingEnv = JSON.parse(existing.env); } catch { }
      try { existingHeaders = JSON.parse(existing.headers || "{}"); } catch { }
    }

    const nextArgs = body.args !== undefined ? body.args : existingArgs;

    let nextEnv: Record<string, string> = existingEnv;
    if (body.env !== undefined) {
      nextEnv = {};
      for (const [k, v] of Object.entries(body.env)) {
        if (v === MCP_SECRET_MASK && k in existingEnv) {
          nextEnv[k] = existingEnv[k];
        } else {
          nextEnv[k] = v;
        }
      }
    }

    let nextHeaders: Record<string, string> = existingHeaders;
    if (body.headers !== undefined) {
      nextHeaders = {};
      for (const [k, v] of Object.entries(body.headers)) {
        if (v === MCP_SECRET_MASK && k in existingHeaders) {
          nextHeaders[k] = existingHeaders[k];
        } else {
          nextHeaders[k] = v;
        }
      }
    }

    const argsJson = JSON.stringify(nextArgs);
    const envJson = JSON.stringify(nextEnv);
    const headersJson = JSON.stringify(nextHeaders);
    const isEnabled =
      body.isEnabled !== undefined
        ? body.isEnabled
        : existing
          ? existing.is_enabled === 1
          : true;

    if (existing) {
      db.prepare(`
        UPDATE mcp_servers
        SET name = ?, type = ?, command_or_url = ?, args = ?, env = ?, headers = ?, is_enabled = ?
        WHERE id = ?
      `).run(name, type, commandOrUrl, argsJson, envJson, headersJson, isEnabled ? 1 : 0, id);
    } else {
      db.prepare(`
        INSERT INTO mcp_servers (id, name, type, command_or_url, args, env, headers, is_enabled)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, name, type, commandOrUrl, argsJson, envJson, headersJson, isEnabled ? 1 : 0);
    }

    // Stop client and reset crash counter when config or enabled state changes
    this.stopServer(id);
    return this.getAllServers().find((s) => s.id === id)!;
  }

  public deleteServer(id: string): boolean {
    this.stopServer(id);
    const res = db.prepare("DELETE FROM mcp_servers WHERE id = ?").run(id);
    return res.changes > 0;
  }

  public async getClient(id: string): Promise<Client | null> {
    const active = this.clients.get(id);
    if (active && active.status === "connected") {
      return active.client;
    }

    const row = this.getRawServerRow(id);
    if (!row || row.is_enabled !== 1) return null;

    return this.connectServer(row);
  }

  public async connectServer(row: McpServerRow): Promise<Client | null> {
    const crashes = this.crashCounts.get(row.id) ?? 0;
    if (crashes >= 3) {
      console.error(`[McpManager] Server ${row.name} (${row.id}) exceeded max crash retry limit (3).`);
      this.clients.set(row.id, {
        client: null as any,
        transport: null,
        status: "error",
        error: "Exceeded maximum retry attempts (3 restarts).",
      });
      return null;
    }

    this.clients.set(row.id, { client: null as any, transport: null, status: "connecting" });

    let args: string[] = [];
    let env: Record<string, string> = {};
    let headers: Record<string, string> = {};
    try { args = JSON.parse(row.args); } catch { }
    try { env = JSON.parse(row.env); } catch { }
    try { headers = JSON.parse(row.headers || "{}"); } catch { }

    if (row.type === "stdio") {
      try {
        const cleanProcessEnv: Record<string, string> = {};
        for (const [k, v] of Object.entries(process.env)) {
          if (v !== undefined) cleanProcessEnv[k] = v;
        }
        const client = new Client({ name: "blombrain-backend", version: "0.1.0" }, { capabilities: {} });
        const transport = new StdioClientTransport({
          command: row.command_or_url,
          args,
          env: { ...cleanProcessEnv, ...env },
        });
        await client.connect(transport);
        this.clients.set(row.id, { client, transport, status: "connected" });
        this.crashCounts.set(row.id, 0);
        return client;
      } catch (err: any) {
        console.error(`[McpManager] Failed to connect stdio server ${row.name}:`, err);
        this.crashCounts.set(row.id, crashes + 1);
        this.clients.set(row.id, {
          client: null as any,
          transport: null,
          status: "error",
          error: err?.message || String(err),
        });
        return null;
      }
    }

    // HTTP server: try Streamable HTTP first (modern standard), fall back to SSE (legacy)
    const serverUrl = new URL(row.command_or_url);
    const requestInit: RequestInit = Object.keys(headers).length > 0 ? { headers } : {};

    // --- Attempt 1: StreamableHTTPClientTransport (used by Firecrawl, most modern servers) ---
    try {
      const client = new Client({ name: "blombrain-backend", version: "0.1.0" }, { capabilities: {} });
      const transport = new StreamableHTTPClientTransport(serverUrl, {
        requestInit,
      });
      await client.connect(transport);
      this.clients.set(row.id, { client, transport, status: "connected" });
      this.crashCounts.set(row.id, 0);
      console.log(`[McpManager] Connected to ${row.name} via Streamable HTTP`);
      return client;
    } catch (streamErr: any) {
      console.warn(`[McpManager] Streamable HTTP failed for ${row.name}, trying SSE fallback:`, streamErr?.message || streamErr);
    }

    // --- Attempt 2: SSEClientTransport (legacy, for servers that only support SSE) ---
    try {
      const client = new Client({ name: "blombrain-backend", version: "0.1.0" }, { capabilities: {} });
      const transport = new SSEClientTransport(serverUrl, {
        requestInit,
      });
      await client.connect(transport);
      this.clients.set(row.id, { client, transport, status: "connected" });
      this.crashCounts.set(row.id, 0);
      console.log(`[McpManager] Connected to ${row.name} via SSE (legacy)`);
      return client;
    } catch (sseErr: any) {
      const errMsg = sseErr?.message || String(sseErr);
      console.error(`[McpManager] Both Streamable HTTP and SSE failed for ${row.name}:`, errMsg);
      this.crashCounts.set(row.id, crashes + 1);
      this.clients.set(row.id, {
        client: null as any,
        transport: null,
        status: "error",
        error: errMsg,
      });
      return null;
    }
  }

  public stopServer(id: string) {
    const active = this.clients.get(id);
    if (active) {
      try {
        if (active.transport?.close) active.transport.close();
      } catch { }
      this.clients.delete(id);
    }
    this.crashCounts.delete(id);
    // Config changed or server stopped -- cached tool schemas may now be stale.
    this.toolsCache.delete(id);
  }

  public async reconnectServer(id: string): Promise<McpServerOut | null> {
    this.stopServer(id);
    const row = this.getRawServerRow(id);
    if (!row) return null;
    if (row.is_enabled === 1) {
      await this.connectServer(row);
    }
    return this.getAllServers().find((s) => s.id === id) ?? null;
  }

  public async getAvailableTools(excludedIds: string[] = []): Promise<McpToolDefinition[]> {
    const servers = this.getAllServers(excludedIds).filter((s) => s.isEnabled);
    const tools: McpToolDefinition[] = [];

    for (const serverRow of servers) {
      const client = await this.getClient(serverRow.id);
      if (!client) continue;

      try {
        const res = await client.listTools();
        const serverTools: McpToolDefinition[] = res.tools.map((t) => ({
          serverId: serverRow.id,
          serverName: serverRow.name,
          name: `${serverRow.name}__${t.name}`,
          description: t.description,
          inputSchema: t.inputSchema as Record<string, any>,
        }));
        this.toolsCache.set(serverRow.id, serverTools);
        tools.push(...serverTools);
      } catch (err) {
        console.error(`[McpManager] Failed to list tools for ${serverRow.name}:`, err);
        // Keep whatever we last cached rather than dropping it on a transient failure.
        const cached = this.toolsCache.get(serverRow.id);
        if (cached) tools.push(...cached);
      }
    }

    return tools;
  }

  // ---------------------------------------------------------------------
  // Async job detection & status/cancel tool resolution
  // ---------------------------------------------------------------------

  private tokenize(name: string): string[] {
    return name.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  }

  /** Strips the `${serverName}__` prefix off a fully-qualified tool name. */
  private rawToolName(qualifiedName: string): string {
    const idx = qualifiedName.indexOf("__");
    return idx === -1 ? qualifiedName : qualifiedName.slice(idx + 2);
  }

  /**
   * Heuristically detects whether a parsed tool result represents an async job
   * handle rather than a final result: an object carrying an id/job_id AND either
   * an explicit in-progress status or no result payload yet.
   */
  private isAsyncJobResult(parsed: any): { jobId: string; status?: string } | null {
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;

    const explicitJobId =
      (typeof parsed.job_id === "string" && parsed.job_id) ||
      (typeof parsed.jobId === "string" && parsed.jobId) ||
      null;
    const genericId = typeof parsed.id === "string" && parsed.id ? parsed.id : null;
    const jobId = explicitJobId || genericId;
    if (!jobId) return null;

    const status = typeof parsed.status === "string" ? parsed.status.toLowerCase() : undefined;
    const inProgressStatuses = new Set(["in_progress", "pending", "queued", "running", "processing", "started"]);
    const terminalStatuses = new Set(["completed", "complete", "success", "succeeded", "failed", "error", "cancelled", "canceled"]);

    // Explicit in-progress status -> definitely async.
    if (status && inProgressStatuses.has(status)) {
      return { jobId, status };
    }
    // Explicit terminal status -> NOT async, this is already the final result.
    if (status && terminalStatuses.has(status)) {
      return null;
    }
    // Without an explicit in-progress status, only treat `{ success: true, job_id/jobId: "..." }`
    // as an async job handle (never a generic `{ success: true, id: "..." }` which is standard for CRUD creates).
    if (parsed.success === true && explicitJobId) {
      const otherKeys = Object.keys(parsed).filter((k) => !["success", "job_id", "jobId", "status"].includes(k));
      if (otherKeys.length === 0) return { jobId: explicitJobId, status };
    }

    return null;
  }

  private findLinkedTool(serverId: string, mainToolRawName: string, keywords: string[]): McpToolDefinition | undefined {
    const candidates = this.toolsCache.get(serverId) || [];
    const mainTokens = new Set(this.tokenize(mainToolRawName));

    let best: { tool: McpToolDefinition; score: number } | undefined;
    for (const t of candidates) {
      const rawName = this.rawToolName(t.name);
      if (rawName === mainToolRawName) continue;

      const nameTokens = this.tokenize(rawName);
      const hasNameKeyword = keywords.some((kw) => nameTokens.includes(kw));
      if (!hasNameKeyword) continue;

      const overlap = nameTokens.filter((tok) => mainTokens.has(tok) && !keywords.includes(tok)).length;
      if (overlap < 1) continue;

      if (!best || overlap > best.score) {
        best = { tool: t, score: overlap };
      }
    }
    return best?.tool;
  }

  private findStatusTool(serverId: string, mainToolRawName: string): McpToolDefinition | undefined {
    return this.findLinkedTool(serverId, mainToolRawName, ["status", "check", "poll", "result"]);
  }

  private findCancelTool(serverId: string, mainToolRawName: string): McpToolDefinition | undefined {
    return this.findLinkedTool(serverId, mainToolRawName, ["cancel", "stop", "abort", "kill"]);
  }

  private async invokeRaw(client: Client, actualToolName: string, args: Record<string, any>): Promise<{ content: string; isError?: boolean }> {
    const res = (await client.callTool({ name: actualToolName, arguments: args })) as any;
    let textResult = "";
    if (Array.isArray(res.content)) {
      textResult = res.content.map((c: any) => (c.type === "text" ? c.text : JSON.stringify(c))).join("\n");
    } else {
      textResult = JSON.stringify(res.content ?? res);
    }
    return { content: textResult, isError: res.isError };
  }

  public async callTool(
    toolNameWithPrefix: string,
    args: Record<string, any>,
    options: { signal?: AbortSignal; onProgress?: (event: any) => void } = {}
  ): Promise<{ content: string; isError?: boolean }> {
    const HARD_CAP_MS = 300_000; // 5 minutes, covers the initial call + all polling
    const startTime = Date.now();

    const parts = toolNameWithPrefix.split("__");
    if (parts.length < 2) {
      return { content: `[mcp-server] Invalid tool name format: ${toolNameWithPrefix}`, isError: true };
    }

    const serverName = parts[0];
    const actualToolName = parts.slice(1).join("__");

    const servers = this.getAllServers();
    const server = servers.find((s) => s.name === serverName);
    if (!server) {
      return { content: `[mcp-server] Server "${serverName}" not found`, isError: true };
    }

    const client = await this.getClient(server.id);
    if (!client) {
      return { content: `[mcp-server] Server "${serverName}" failed to connect`, isError: true };
    }

    const withHardCap = <T,>(p: Promise<T>): Promise<T> => {
      const remaining = HARD_CAP_MS - (Date.now() - startTime);
      return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`MCP tool '${toolNameWithPrefix}' exceeded 5-minute hard cap`)), Math.max(0, remaining));
        p.then((v) => { clearTimeout(timer); resolve(v); }, (e) => { clearTimeout(timer); reject(e); });
      });
    };

    let initial: { content: string; isError?: boolean };
    try {
      initial = await withHardCap(this.invokeRaw(client, actualToolName, args));
    } catch (err: any) {
      console.error(`[McpManager] Error executing tool ${toolNameWithPrefix}:`, err);
      return { content: `[mcp-server] failed to respond: ${err?.message || String(err)}`, isError: true };
    }

    if (initial.isError) return initial;

    // Detect whether this looks like an async job handle rather than a final result.
    let parsedInitial: any;
    try { parsedInitial = JSON.parse(initial.content); } catch { parsedInitial = null; }
    const job = this.isAsyncJobResult(parsedInitial);
    if (!job) {
      // Not async -- this is already the final result.
      return initial;
    }

    const statusTool = this.findStatusTool(server.id, actualToolName);
    if (!statusTool) {
      // Looked like a job handle but we have no way to poll it -- return as-is
      // rather than silently hanging; the model can see the raw job handle.
      return initial;
    }
    const statusRawName = this.rawToolName(statusTool.name);
    const cancelTool = this.findCancelTool(server.id, actualToolName);

    let delayMs = 1500;
    const MAX_DELAY_MS = 15_000;
    const BACKOFF_FACTOR = 1.5;
    let attempts = 0;

    const inProgressStatuses = new Set(["in_progress", "pending", "queued", "running", "processing", "started"]);
    const failedStatuses = new Set(["failed", "error", "cancelled", "canceled"]);

    while (true) {
      if (options.signal?.aborted) {
        if (cancelTool) {
          const cancelRawName = this.rawToolName(cancelTool.name);
          // Fire-and-forget cancellation; don't let it block or throw.
          this.invokeRaw(client, cancelRawName, { id: job.jobId, job_id: job.jobId, jobId: job.jobId }).catch(() => { });
        }
        return { content: `[mcp-server] Job ${job.jobId} aborted by user`, isError: true };
      }

      if (Date.now() - startTime > HARD_CAP_MS) {
        return { content: `[mcp-server] Job ${job.jobId} polling exceeded 5-minute hard cap`, isError: true };
      }

      attempts++;
      options.onProgress?.({
        status: "polling",
        jobId: job.jobId,
        attempts,
        elapsedMs: Date.now() - startTime,
        message: `Polling job ${job.jobId} (attempt ${attempts})...`,
      });

      // Sleep with abort-awareness so we don't block past a user cancellation.
      await new Promise<void>((resolve) => {
        const t = setTimeout(resolve, delayMs);
        options.signal?.addEventListener("abort", () => { clearTimeout(t); resolve(); }, { once: true });
      });
      delayMs = Math.min(delayMs * BACKOFF_FACTOR, MAX_DELAY_MS);

      let statusResult: { content: string; isError?: boolean };
      try {
        statusResult = await withHardCap(
          this.invokeRaw(client, statusRawName, { id: job.jobId, job_id: job.jobId, jobId: job.jobId })
        );
      } catch (err: any) {
        return { content: `[mcp-server] status check failed: ${err?.message || String(err)}`, isError: true };
      }

      if (statusResult.isError) return statusResult;

      let parsedStatus: any;
      try { parsedStatus = JSON.parse(statusResult.content); } catch { parsedStatus = null; }
      const statusVal = parsedStatus && typeof parsedStatus.status === "string" ? parsedStatus.status.toLowerCase() : undefined;

      if (statusVal && inProgressStatuses.has(statusVal)) {
        continue; // still running, keep polling
      }
      if (statusVal && failedStatuses.has(statusVal)) {
        return { content: statusResult.content, isError: true };
      }
      // Anything else (a recognized terminal status, or no status field at all
      // meaning the tool just returned real data) -- treat as done.
      return statusResult;
    }
  }
}

export const mcpManager = new McpManager();
