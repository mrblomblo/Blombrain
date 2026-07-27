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
        isHidden: Boolean(setting.is_hidden),
        sortOrder: setting.sort_order ?? 0,
        isDefault: Boolean(setting.is_default),
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
        isHidden: Boolean(p.is_hidden),
        sortOrder: p.sort_order ?? 0,
        isDefault: Boolean(p.is_default),
      };
    });

    const allModels = [...augmentedBaseModels, ...presetModels];
    allModels.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
    return allModels;
  });

  // POST /api/models - Create a new Preset
  app.post<{ Body: ModelSettingWriteBody }>("/api/models", async (req, reply) => {
    const {
      name, baseModelId, systemPrompt, canImage, canAudio, canVideo, temperature,
      icon, seed, reasoningEffort, thinking, maxTokens, topK, topP, minP,
      presencePenalty, frequencyPenalty, repeatPenalty, ctxLength, isHidden, sortOrder, isDefault
    } = req.body;
    if (!name || !baseModelId) {
      return reply.code(400).send({ error: "name and baseModelId are required for creating a preset" });
    }

    if (isDefault) {
      db.prepare("UPDATE model_settings SET is_default = 0").run();
    }

    const id = `preset_${crypto.randomUUID()}`;
    db.prepare(`
      INSERT INTO model_settings (
        id, is_preset, name, base_model_id, system_prompt, can_image, can_audio, can_video, temperature,
        icon, seed, reasoning_effort, thinking, max_tokens, top_k, top_p, min_p,
        presence_penalty, frequency_penalty, repeat_penalty, ctx_length,
        is_hidden, sort_order, is_default
      )
      VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      ctxLength ?? null,
      isHidden ? 1 : 0,
      sortOrder ?? 0,
      isDefault ? 1 : 0
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
      isHidden: Boolean(isHidden),
      sortOrder: sortOrder ?? 0,
      isDefault: Boolean(isDefault),
    };
  });

  // PUT /api/models/order - Bulk update model sort orders
  app.put<{ Body: { orders: Array<{ id: string; sortOrder: number; isPreset?: boolean }> } }>(
    "/api/models/order",
    async (req) => {
      const { orders } = req.body ?? {};
      if (!Array.isArray(orders)) return { ok: false };

      const checkStmt = db.prepare("SELECT id FROM model_settings WHERE id = ?");
      const updateStmt = db.prepare("UPDATE model_settings SET sort_order = ? WHERE id = ?");
      const insertStmt = db.prepare(
        "INSERT INTO model_settings (id, is_preset, sort_order) VALUES (?, ?, ?)"
      );

      const transaction = db.transaction(() => {
        for (const item of orders) {
          const row = checkStmt.get(item.id);
          if (row) {
            updateStmt.run(item.sortOrder, item.id);
          } else {
            insertStmt.run(item.id, item.isPreset ? 1 : 0, item.sortOrder);
          }
        }
      });

      transaction();
      return { ok: true };
    }
  );

  // PUT /api/models/* - Update settings for a Base Model or a Preset
  app.put<{ Params: { "*": string }; Body: ModelSettingWriteBody }>("/api/models/*", async (req, reply) => {
    const modelId = req.params["*"];
    if (!modelId) {
      return reply.code(400).send({ error: "Missing model ID" });
    }

    const {
      name, baseModelId, systemPrompt, canImage, canAudio, canVideo, temperature, isPreset,
      icon, seed, reasoningEffort, thinking, maxTokens, topK, topP, minP,
      presencePenalty, frequencyPenalty, repeatPenalty, ctxLength,
      isHidden, sortOrder, isDefault
    } = req.body;

    const existing = db.prepare("SELECT * FROM model_settings WHERE id = ?").get(modelId) as ModelSettingRow | undefined;
    const willBeHidden = isHidden !== undefined ? Boolean(isHidden) : (existing ? Boolean(existing.is_hidden) : false);

    if (isDefault === true) {
      if (willBeHidden) {
        return reply.code(400).send({ error: "A hidden model cannot be set as default" });
      }
      db.prepare("UPDATE model_settings SET is_default = 0").run();
    }

    let nextIsDefault: number;
    if (willBeHidden) {
      nextIsDefault = 0;
    } else if (isDefault !== undefined) {
      nextIsDefault = isDefault ? 1 : 0;
    } else {
      nextIsDefault = existing ? existing.is_default : 0;
    }

    if (existing) {
      db.prepare(`
        UPDATE model_settings
        SET name = ?, base_model_id = ?, system_prompt = ?, can_image = ?, can_audio = ?, can_video = ?, temperature = ?,
            icon = ?, seed = ?, reasoning_effort = ?, thinking = ?, max_tokens = ?, top_k = ?, top_p = ?, min_p = ?,
            presence_penalty = ?, frequency_penalty = ?, repeat_penalty = ?, ctx_length = ?,
            is_hidden = ?, sort_order = ?, is_default = ?
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
        isHidden !== undefined ? (isHidden ? 1 : 0) : existing.is_hidden,
        sortOrder !== undefined ? sortOrder : existing.sort_order,
        nextIsDefault,
        modelId
      );
    } else {
      db.prepare(`
        INSERT INTO model_settings (
          id, is_preset, name, base_model_id, system_prompt, can_image, can_audio, can_video, temperature,
          icon, seed, reasoning_effort, thinking, max_tokens, top_k, top_p, min_p,
          presence_penalty, frequency_penalty, repeat_penalty, ctx_length,
          is_hidden, sort_order, is_default
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        ctxLength ?? null,
        isHidden ? 1 : 0,
        sortOrder ?? 0,
        nextIsDefault
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
