import type { FastifyInstance } from "fastify";
import db from "../db.js";
import type { ModelConfigRow, ModelCapabilities } from "../types.js";

function rowToCaps(row: ModelConfigRow | undefined): ModelCapabilities {
  if (!row) {
    return { canImage: false, canAudio: false, canVideo: false };
  }
  return {
    canImage: row.can_image === 1,
    canAudio: row.can_audio === 1,
    canVideo: row.can_video === 1,
  };
}

export async function modelConfigsRoutes(app: FastifyInstance) {
  // Get all configs
  app.get("/api/model-configs", async () => {
    const rows = db.prepare(`SELECT * FROM model_configs`).all() as ModelConfigRow[];
    const result: Record<string, ModelCapabilities> = {};
    for (const row of rows) {
      result[row.model_id] = rowToCaps(row);
    }
    return result;
  });

  // Get specific model config
  app.get<{ Params: { modelId: string } }>("/api/model-configs/:modelId", async (req) => {
    const { modelId } = req.params;
    const row = db.prepare(`SELECT * FROM model_configs WHERE model_id = ?`).get(modelId) as ModelConfigRow | undefined;
    return rowToCaps(row);
  });

  // Upsert model config
  app.put<{ Params: { modelId: string }; Body: ModelCapabilities }>("/api/model-configs/:modelId", async (req, reply) => {
    const { modelId } = req.params;
    const { canImage, canAudio, canVideo } = req.body;
    
    db.prepare(`
      INSERT INTO model_configs (model_id, can_image, can_audio, can_video)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(model_id) DO UPDATE SET
        can_image = excluded.can_image,
        can_audio = excluded.can_audio,
        can_video = excluded.can_video
    `).run(
      modelId,
      canImage ? 1 : 0,
      canAudio ? 1 : 0,
      canVideo ? 1 : 0
    );

    return reply.status(200).send({ success: true });
  });

  // Reset/delete model config
  app.delete<{ Params: { modelId: string } }>("/api/model-configs/:modelId", async (req, reply) => {
    const { modelId } = req.params;
    db.prepare(`DELETE FROM model_configs WHERE model_id = ?`).run(modelId);
    return reply.status(200).send({ success: true });
  });
}
