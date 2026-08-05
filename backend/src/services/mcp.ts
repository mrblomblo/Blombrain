import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import db from "../db.js";
import type { McpServerRow, McpServerOut, McpServerWriteBody } from "../types.js";

export interface McpToolDefinition {
  serverId: string;
  serverName: string;
  name: string;
  description?: string;
  inputSchema: Record<string, any>;
}

class McpManager {
  private clients = new Map<string, { client: Client; transport: any; status: "connected" | "connecting" | "error" | "stopped"; error?: string }>();
  private crashCounts = new Map<string, number>();

  public getAllServers(excludedIds: string[] = []): McpServerOut[] {
    const rows = db.prepare("SELECT * FROM mcp_servers ORDER BY name ASC").all() as McpServerRow[];
    return rows.map((r) => {
      let args: string[] = [];
      let env: Record<string, string> = {};
      let headers: Record<string, string> = {};
      try { args = JSON.parse(r.args); } catch { }
      try { env = JSON.parse(r.env); } catch { }
      try { headers = JSON.parse(r.headers || "{}"); } catch { }

      const active = this.clients.get(r.id);
      return {
        id: r.id,
        name: r.name,
        type: r.type as "stdio" | "http",
        commandOrUrl: r.command_or_url,
        args,
        env,
        headers,
        isEnabled: r.is_enabled === 1 && !excludedIds.includes(r.id),
        status: active?.status ?? (r.is_enabled === 1 ? "stopped" : "stopped"),
        error: active?.error,
      };
    });
  }

  public getRawServerRow(id: string): McpServerRow | undefined {
    return db.prepare("SELECT * FROM mcp_servers WHERE id = ?").get(id) as McpServerRow | undefined;
  }

  public upsertServer(body: McpServerWriteBody): McpServerOut {
    const id = body.id ?? crypto.randomUUID();
    const argsJson = JSON.stringify(body.args ?? []);
    const envJson = JSON.stringify(body.env ?? {});
    const headersJson = JSON.stringify(body.headers ?? {});
    const isEnabled = body.isEnabled ?? true;

    const existing = db.prepare("SELECT id FROM mcp_servers WHERE id = ?").get(id);
    if (existing) {
      db.prepare(`
        UPDATE mcp_servers
        SET name = ?, type = ?, command_or_url = ?, args = ?, env = ?, headers = ?, is_enabled = ?
        WHERE id = ?
      `).run(body.name, body.type, body.commandOrUrl, argsJson, envJson, headersJson, isEnabled ? 1 : 0, id);
    } else {
      db.prepare(`
        INSERT INTO mcp_servers (id, name, type, command_or_url, args, env, headers, is_enabled)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, body.name, body.type, body.commandOrUrl, argsJson, envJson, headersJson, isEnabled ? 1 : 0);
    }

    // Stop client if disabled or configuration updated
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
  }

  public async getAvailableTools(excludedIds: string[] = []): Promise<McpToolDefinition[]> {
    const servers = this.getAllServers(excludedIds).filter((s) => s.isEnabled);
    const tools: McpToolDefinition[] = [];

    for (const serverRow of servers) {
      const client = await this.getClient(serverRow.id);
      if (!client) continue;

      try {
        const res = await client.listTools();
        for (const t of res.tools) {
          tools.push({
            serverId: serverRow.id,
            serverName: serverRow.name,
            name: `${serverRow.name}__${t.name}`,
            description: t.description,
            inputSchema: t.inputSchema as Record<string, any>,
          });
        }
      } catch (err) {
        console.error(`[McpManager] Failed to list tools for ${serverRow.name}:`, err);
      }
    }

    return tools;
  }

  public async callTool(
    toolNameWithPrefix: string,
    args: Record<string, any>,
    timeoutMs = 60000
  ): Promise<{ content: string; isError?: boolean }> {
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

    try {
      const callPromise = client.callTool({
        name: actualToolName,
        arguments: args,
      });

      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`Tool execution timed out after ${timeoutMs}ms`)), timeoutMs)
      );

      const res = (await Promise.race([callPromise, timeoutPromise])) as any;
      let textResult = "";
      if (Array.isArray(res.content)) {
        textResult = res.content
          .map((c: any) => (c.type === "text" ? c.text : JSON.stringify(c)))
          .join("\n");
      } else {
        textResult = JSON.stringify(res.content ?? res);
      }

      return { content: textResult, isError: res.isError };
    } catch (err: any) {
      console.error(`[McpManager] Error executing tool ${toolNameWithPrefix}:`, err);
      return { content: `[mcp-server] failed to respond: ${err?.message || String(err)}`, isError: true };
    }
  }
}

export const mcpManager = new McpManager();
