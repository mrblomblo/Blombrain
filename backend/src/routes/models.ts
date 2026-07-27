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
        icon: setting.icon ?? undefined,
        seed: setting.seed ?? undefined,
        reasoningEffort: setting.reasoning_effort ?? undefined,
        thinking: Boolean(setting.thinking),
        maxTokens: setting.max_tokens ?? undefined,
        topK: setting.top_k ?? undefined,
        topP: setting.top_p ?? undefined,
        minP: setting.min_p ?? undefined,
        presencePenalty: setting.presence_penalty ?? undefined,
        frequencyPenalty: setting.frequency_penalty ?? undefined,
        repeatPenalty: setting.repeat_penalty ?? undefined,
        ctxLength: setting.ctx_length ?? undefined,
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
        icon: p.icon ?? undefined,
        seed: p.seed ?? undefined,
        reasoningEffort: p.reasoning_effort ?? undefined,
        thinking: Boolean(p.thinking),
        maxTokens: p.max_tokens ?? undefined,
        topK: p.top_k ?? undefined,
        topP: p.top_p ?? undefined,
        minP: p.min_p ?? undefined,
        presencePenalty: p.presence_penalty ?? undefined,
        frequencyPenalty: p.frequency_penalty ?? undefined,
        repeatPenalty: p.repeat_penalty ?? undefined,
        ctxLength: p.ctx_length ?? undefined,
      };
    });

    return [...augmentedBaseModels, ...presetModels];
  });

  // POST /api/models - Create a new Preset
  app.post<{ Body: ModelSettingWriteBody }>("/api/models", async (req, reply) => {
    const {
      name, baseModelId, systemPrompt, canImage, canAudio, canVideo, temperature,
      icon, seed, reasoningEffort, thinking, maxTokens, topK, topP, minP,
      presencePenalty, frequencyPenalty, repeatPenalty, ctxLength
    } = req.body;
    if (!name || !baseModelId) {
      return reply.code(400).send({ error: "name and baseModelId are required for creating a preset" });
    }

    const id = `preset_${crypto.randomUUID()}`;
    db.prepare(`
      INSERT INTO model_settings (
        id, is_preset, name, base_model_id, system_prompt, can_image, can_audio, can_video, temperature,
        icon, seed, reasoning_effort, thinking, max_tokens, top_k, top_p, min_p,
        presence_penalty, frequency_penalty, repeat_penalty, ctx_length
      )
      VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      name,
      baseModelId,
      systemPrompt ?? null,
      canImage ? 1 : 0,
      canAudio ? 1 : 0,
      canVideo ? 1 : 0,
      temperature ?? null,
      icon ?? null,
      seed ?? null,
      reasoningEffort ?? null,
      thinking ? 1 : 0,
      maxTokens ?? null,
      topK ?? null,
      topP ?? null,
      minP ?? null,
      presencePenalty ?? null,
      frequencyPenalty ?? null,
      repeatPenalty ?? null,
      ctxLength ?? null
    );

    return {
      id,
      isPreset: true,
      name,
      baseModelId,
      systemPrompt,
      canImage: Boolean(canImage),
      canAudio: Boolean(canAudio),
      canVideo: Boolean(canVideo),
      temperature,
      icon,
      seed,
      reasoningEffort,
      thinking: Boolean(thinking),
      maxTokens,
      topK,
      topP,
      minP,
      presencePenalty,
      frequencyPenalty,
      repeatPenalty,
      ctxLength,
    };
  });

  // PUT /api/models/* - Update settings for a Base Model or a Preset
  app.put<{ Params: { "*": string }; Body: ModelSettingWriteBody }>("/api/models/*", async (req, reply) => {
    const modelId = req.params["*"];
    if (!modelId) {
      return reply.code(400).send({ error: "Missing model ID" });
    }

    const {
      name, baseModelId, systemPrompt, canImage, canAudio, canVideo, temperature, isPreset,
      icon, seed, reasoningEffort, thinking, maxTokens, topK, topP, minP,
      presencePenalty, frequencyPenalty, repeatPenalty, ctxLength
    } = req.body;

    const existing = db.prepare("SELECT * FROM model_settings WHERE id = ?").get(modelId) as ModelSettingRow | undefined;

    if (existing) {
      db.prepare(`
        UPDATE model_settings
        SET name = ?, base_model_id = ?, system_prompt = ?, can_image = ?, can_audio = ?, can_video = ?, temperature = ?,
            icon = ?, seed = ?, reasoning_effort = ?, thinking = ?, max_tokens = ?, top_k = ?, top_p = ?, min_p = ?,
            presence_penalty = ?, frequency_penalty = ?, repeat_penalty = ?, ctx_length = ?
        WHERE id = ?
      `).run(
        name ?? existing.name,
        baseModelId ?? existing.base_model_id,
        systemPrompt !== undefined ? systemPrompt : existing.system_prompt,
        canImage !== undefined ? (canImage ? 1 : 0) : existing.can_image,
        canAudio !== undefined ? (canAudio ? 1 : 0) : existing.can_audio,
        canVideo !== undefined ? (canVideo ? 1 : 0) : existing.can_video,
        temperature !== undefined ? temperature : existing.temperature,
        icon !== undefined ? icon : existing.icon,
        seed !== undefined ? seed : existing.seed,
        reasoningEffort !== undefined ? reasoningEffort : existing.reasoning_effort,
        thinking !== undefined ? (thinking ? 1 : 0) : existing.thinking,
        maxTokens !== undefined ? maxTokens : existing.max_tokens,
        topK !== undefined ? topK : existing.top_k,
        topP !== undefined ? topP : existing.top_p,
        minP !== undefined ? minP : existing.min_p,
        presencePenalty !== undefined ? presencePenalty : existing.presence_penalty,
        frequencyPenalty !== undefined ? frequencyPenalty : existing.frequency_penalty,
        repeatPenalty !== undefined ? repeatPenalty : existing.repeat_penalty,
        ctxLength !== undefined ? ctxLength : existing.ctx_length,
        modelId
      );
    } else {
      db.prepare(`
        INSERT INTO model_settings (
          id, is_preset, name, base_model_id, system_prompt, can_image, can_audio, can_video, temperature,
          icon, seed, reasoning_effort, thinking, max_tokens, top_k, top_p, min_p,
          presence_penalty, frequency_penalty, repeat_penalty, ctx_length
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        modelId,
        isPreset ? 1 : 0,
        name ?? null,
        baseModelId ?? null,
        systemPrompt ?? null,
        canImage ? 1 : 0,
        canAudio ? 1 : 0,
        canVideo ? 1 : 0,
        temperature ?? null,
        icon ?? null,
        seed ?? null,
        reasoningEffort ?? null,
        thinking ? 1 : 0,
        maxTokens ?? null,
        topK ?? null,
        topP ?? null,
        minP ?? null,
        presencePenalty ?? null,
        frequencyPenalty ?? null,
        repeatPenalty ?? null,
        ctxLength ?? null
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
