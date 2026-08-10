import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { mcpManager } from "../services/mcp.js";
import type { McpServerWriteBody } from "../types.js";

export async function mcpRoutes(app: FastifyInstance) {
  app.get("/api/mcp", async (_req: FastifyRequest, reply: FastifyReply) => {
    const servers = mcpManager.getAllServers();
    return reply.send(servers);
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

  app.delete("/api/mcp/:id", async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };
    const success = mcpManager.deleteServer(id);
    return reply.send({ success });
  });
}
