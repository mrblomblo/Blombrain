import type { FastifyInstance } from "fastify";
import { backendRegistry } from "../registry.js";
import type { ModelInfo, ResolvedBackend, ModelSettingRow, ModelSettingWriteBody } from "../types.js";
import db from "../db.js";

async function fetchModelsForBackend(backend: ResolvedBackend): Promise<ModelInfo[]> {
  try {
    const res = await fetch(`${backend.baseUrl}/v1/models`, {
      signal: AbortSignal.timeout(3000),
      headers: backend.apiKey ? { Authorization: `Bearer ${backend.apiKey}` } : undefined,
    });
    if (!res.ok) return [];

    const body = (await res.json()) as { data?: Array<{ id: string }> } | Array<{ id: string }>;
    const rawModels: Array<{ id: string }> = Array.isArray(body) ? body : (body?.data ?? []);

    return rawModels
      .filter((m) => typeof m?.id === "string")
      .map((m) => ({
        id: `${backend.prefix}:${m.id}`,
        rawId: m.id,
        backendId: backend.id,
        backendName: backend.name,
        isPreset: false,
      }));
  } catch {
    return [];
  }
}

export async function modelsRoutes(app: FastifyInstance) {
  // GET /api/models - Unified list of Base Models (with settings) & Presets
  app.get("/api/models", async () => {
    const baseModels = (await Promise.all(backendRegistry.getAll().map(fetchModelsForBackend))).flat();
    
    // Fetch all model_settings from SQLite
    const settingsRows = db.prepare("SELECT * FROM model_settings").all() as ModelSettingRow[];
    const settingsMap = new Map<string, ModelSettingRow>();
    const presetRows: ModelSettingRow[] = [];

    for (const row of settingsRows) {
      if (row.is_preset) {
        presetRows.push(row);
      } else {
        settingsMap.set(row.id, row);
      }
    }

    // Augment Base Models with their settings
    const augmentedBaseModels: ModelInfo[] = baseModels.map((bm) => {
      const setting = settingsMap.get(bm.id);
      if (!setting) return bm;

      return {
        ...bm,
        name: setting.name ?? undefined,
        systemPrompt: setting.system_prompt ?? undefined,
        canImage: Boolean(setting.can_image),
        canAudio: Boolean(setting.can_audio),
        canVideo: Boolean(setting.can_video),
        temperature: setting.temperature ?? undefined,
      };
    });

    // Build Preset ModelInfo entries
    const presetModels: ModelInfo[] = presetRows.map((p) => {
      const parent = augmentedBaseModels.find((bm) => bm.id === p.base_model_id);
      return {
        id: p.id,
        rawId: parent ? parent.rawId : (p.base_model_id ?? p.id),
        backendId: parent ? parent.backendId : "unknown",
        backendName: parent ? parent.backendName : "Preset",
        isPreset: true,
        baseModelId: p.base_model_id ?? undefined,
        name: p.name ?? p.id,
        systemPrompt: p.system_prompt ?? undefined,
        canImage: Boolean(p.can_image),
        canAudio: Boolean(p.can_audio),
        canVideo: Boolean(p.can_video),
        temperature: p.temperature ?? undefined,
      };
    });

    return [...augmentedBaseModels, ...presetModels];
  });

  // POST /api/models - Create a new Preset
  app.post<{ Body: ModelSettingWriteBody }>("/api/models", async (req, reply) => {
    const { name, baseModelId, systemPrompt, canImage, canAudio, canVideo, temperature } = req.body;
    if (!name || !baseModelId) {
      return reply.code(400).send({ error: "name and baseModelId are required for creating a preset" });
    }

    const id = `preset_${crypto.randomUUID()}`;
    db.prepare(`
      INSERT INTO model_settings (id, is_preset, name, base_model_id, system_prompt, can_image, can_audio, can_video, temperature)
      VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      name,
      baseModelId,
      systemPrompt ?? null,
      canImage ? 1 : 0,
      canAudio ? 1 : 0,
      canVideo ? 1 : 0,
      temperature ?? null
    );

    return { id, isPreset: true, name, baseModelId, systemPrompt, canImage: Boolean(canImage), canAudio: Boolean(canAudio), canVideo: Boolean(canVideo), temperature };
  });

  // PUT /api/models/* - Update settings for a Base Model or a Preset
  app.put<{ Params: { "*": string }; Body: ModelSettingWriteBody }>("/api/models/*", async (req, reply) => {
    const modelId = req.params["*"];
    if (!modelId) {
      return reply.code(400).send({ error: "Missing model ID" });
    }

    const { name, baseModelId, systemPrompt, canImage, canAudio, canVideo, temperature, isPreset } = req.body;

    const existing = db.prepare("SELECT * FROM model_settings WHERE id = ?").get(modelId) as ModelSettingRow | undefined;

    if (existing) {
      db.prepare(`
        UPDATE model_settings
        SET name = ?, base_model_id = ?, system_prompt = ?, can_image = ?, can_audio = ?, can_video = ?, temperature = ?
        WHERE id = ?
      `).run(
        name ?? existing.name,
        baseModelId ?? existing.base_model_id,
        systemPrompt !== undefined ? systemPrompt : existing.system_prompt,
        canImage !== undefined ? (canImage ? 1 : 0) : existing.can_image,
        canAudio !== undefined ? (canAudio ? 1 : 0) : existing.can_audio,
        canVideo !== undefined ? (canVideo ? 1 : 0) : existing.can_video,
        temperature !== undefined ? temperature : existing.temperature,
        modelId
      );
    } else {
      db.prepare(`
        INSERT INTO model_settings (id, is_preset, name, base_model_id, system_prompt, can_image, can_audio, can_video, temperature)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        modelId,
        isPreset ? 1 : 0,
        name ?? null,
        baseModelId ?? null,
        systemPrompt ?? null,
        canImage ? 1 : 0,
        canAudio ? 1 : 0,
        canVideo ? 1 : 0,
        temperature ?? null
      );
    }

    return { ok: true };
  });

  // DELETE /api/models/* - Delete a Preset or reset Base Model settings to defaults
  app.delete<{ Params: { "*": string } }>("/api/models/*", async (req, reply) => {
    const modelId = req.params["*"];
    if (!modelId) {
      return reply.code(400).send({ error: "Missing model ID" });
    }

    db.prepare("DELETE FROM model_settings WHERE id = ?").run(modelId);
    return { ok: true };
  });
}
