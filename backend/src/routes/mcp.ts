import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { mcpManager } from "../services/mcp.js";
import { builtInToolRegistry } from "../services/builtinTools/index.js";
import { summarizeMcpServerTools } from "../services/toolRouter.js";
import type { McpServerWriteBody } from "../types.js";

export async function mcpRoutes(app: FastifyInstance) {
  app.get("/api/builtin-tools", async (_req: FastifyRequest, reply: FastifyReply) => {
    const tools = builtInToolRegistry.getAllTools().map((t) => ({
      name: t.name,
      description: t.description,
      category: t.category ?? "utility",
      requiresNetwork: Boolean(t.requiresNetwork),
    }));
    return reply.send(tools);
  });

  app.get("/api/mcp", async (_req: FastifyRequest, reply: FastifyReply) => {
    const servers = mcpManager.getAllServers([], { maskSecrets: true });
    return reply.send(servers);
  });

  app.get("/api/mcp/tools", async (_req: FastifyRequest, reply: FastifyReply) => {
    const tools = await mcpManager.getKnownTools();
    return reply.send(
      tools.map((t) => ({
        serverId: t.serverId,
        serverName: t.serverName,
        name: t.name,
        description: t.description,
      }))
    );
  });

  app.post("/api/mcp", async (req: FastifyRequest, reply: FastifyReply) => {
    const body = req.body as McpServerWriteBody;
    if (!body.name || !body.commandOrUrl || !body.type) {
      return reply.code(400).send({ error: { message: "name, type, and commandOrUrl are required" } });
    }
    try {
      const created = mcpManager.upsertServer(body);
      return reply.send(created);
    } catch (err: any) {
      return reply.code(400).send({ error: { message: err.message } });
    }
  });

  app.put("/api/mcp/:id", async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };
    const body = req.body as McpServerWriteBody;
    try {
      const updated = mcpManager.upsertServer({ ...body, id });
      return reply.send(updated);
    } catch (err: any) {
      return reply.code(400).send({ error: { message: err.message } });
    }
  });

  app.post("/api/mcp/:id/reconnect", async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };
    const reconnected = await mcpManager.reconnectServer(id);
    if (!reconnected) {
      return reply.code(404).send({ error: { message: "MCP server not found" } });
    }
    return reply.send(reconnected);
  });

  app.post("/api/mcp/:id/summarize", async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };
    const body = (req.body ?? {}) as { modelId?: string };
    const rawRow = mcpManager.getRawServerRow(id);
    if (!rawRow) {
      return reply.code(404).send({ error: { message: "MCP server not found" } });
    }

    const client = await mcpManager.getClient(id);
    if (!client) {
      return reply.code(400).send({
        error: { message: "Could not connect to MCP server to inspect its tools." },
      });
    }

    try {
      const listRes = await client.listTools();
      const { summary, keywords } = await summarizeMcpServerTools(
        rawRow.name,
        listRes.tools.map((t) => ({ name: t.name, description: t.description })),
        body.modelId
      );
      const updated = mcpManager.upsertServer({
        id,
        name: rawRow.name,
        type: rawRow.type,
        commandOrUrl: rawRow.command_or_url,
        summary,
        keywords,
      });
      return reply.send({ summary, keywords, server: updated });
    } catch (err: any) {
      return reply.code(500).send({
        error: { message: err?.message || "Failed to summarize MCP server tools." },
      });
    }
  });

  app.delete("/api/mcp/:id", async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };
    const success = mcpManager.deleteServer(id);
    return reply.send({ success });
  });
}
