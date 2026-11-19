import type { ApiAdapter, BuildRequestParams, RequestConfig, StreamEvent } from "./types.js";
import { openAIAdapter } from "./openai.js";

interface JitCacheEntry {
  requestedCtx: number | null;
  detectedCtx: number | null;
  timestamp: number;
}

const JIT_CACHE_TTL_MS = 60_000;
const jitModelCache = new Map<string, JitCacheEntry>();

function buildJitCacheKey(baseUrl: string, rawModelId: string): string {
  const normalizedBase = baseUrl.replace(/\/$/, "");
  const normalizedModel = rawModelId.replace(/:\d+$/, "").toLowerCase();
  return `${normalizedBase}::${normalizedModel}`;
}

export const lmStudioAdapter: ApiAdapter = {
  id: "lmstudio",
  name: "LM Studio (OpenAI Compatible)",
  badgeLabel: "LM Studio",

  async buildRequest(params: BuildRequestParams): Promise<RequestConfig> {
    const { backend, modelId, extraParams, onConfigFix } = params;
    const baseUrl = backend.baseUrl.replace(/\/$/, "");
    const cleanModelId = modelId.replace(/:\d+$/, "");

    // 1. JIT Context-Length Detection (cached with TTL so we don't hit /api/v1/models on every turn)
    const jitCacheKey = buildJitCacheKey(baseUrl, modelId);
    const cachedJit = jitModelCache.get(jitCacheKey);
    const safeExtraParams = { ...(extraParams || {}) };
    const now = Date.now();
    const requestedCtx = typeof safeExtraParams.num_ctx === "number" ? safeExtraParams.num_ctx : null;

    const isCacheFresh =
      cachedJit !== undefined &&
      now - cachedJit.timestamp < JIT_CACHE_TTL_MS &&
      cachedJit.requestedCtx === requestedCtx;

    if (!isCacheFresh) {
      let detectedCtx: number | null = null;
      try {
        const checkRes = await fetch(`${baseUrl}/api/v1/models`, {
          signal: AbortSignal.timeout(1000),
          headers: backend.apiKey ? { Authorization: `Bearer ${backend.apiKey}` } : undefined,
        });
        if (checkRes.ok) {
          const data = (await checkRes.json()) as any;
          const rawModels: any[] = Array.isArray(data?.models) ? data.models : [];
          if (rawModels.length > 0) {
            const lowerTarget = cleanModelId.toLowerCase();
            const matchingModel =
              rawModels.find((m) => typeof m?.key === "string" && m.key.toLowerCase().includes(lowerTarget)) ||
              (rawModels.length === 1 ? rawModels[0] : null);
            if (matchingModel && Array.isArray(matchingModel.loaded_instances) && matchingModel.loaded_instances.length > 0) {
              const instance = matchingModel.loaded_instances[0];
              const nCtx = instance?.config?.context_length;
              if (typeof nCtx === "number") {
                detectedCtx = nCtx;
                if (requestedCtx !== nCtx) {
                  console.log(`[blombrain] Auto-detected LM Studio loaded n_ctx=${nCtx} (configured ${requestedCtx ?? "unset"})`);
                  if (onConfigFix) onConfigFix({ ctx_length: nCtx });
                }
              }
            }
          }
        }
      } catch {
        // Proceed if fetch times out
      }
      jitModelCache.set(jitCacheKey, {
        requestedCtx: detectedCtx ?? requestedCtx,
        detectedCtx,
        timestamp: now,
      });
    }

    // 2. Clean up params for the OpenAI Compatible endpoint
    // Strip `num_ctx` (Ollama/LM Studio Native specific) - OpenAI compat ignores it, 
    // and context is dictated by the loaded model anyway.
    delete safeExtraParams.num_ctx;

    // Map LM Studio's `reasoning` toggle to OpenAI's `reasoning_effort`
    const reasoningParam = safeExtraParams.reasoning ?? safeExtraParams.reasoning_effort;
    delete safeExtraParams.reasoning;

    if (reasoningParam !== undefined && reasoningParam !== null) {
      const eff = String(reasoningParam).toLowerCase();
      if (eff === "on" || eff === "yes" || eff === "true") safeExtraParams.reasoning_effort = "max";
      else if (eff === "off" || eff === "no" || eff === "false" || eff === "none") safeExtraParams.reasoning_effort = "none";
      else if (["low", "medium", "high", "minimal", "xhigh"].includes(eff)) safeExtraParams.reasoning_effort = eff;
      else safeExtraParams.reasoning_effort = eff; // Let openAIAdapter validate/drop it
    }

    // 3. Delegate to OpenAI Adapter
    const openAIParams: BuildRequestParams = {
      ...params,
      extraParams: safeExtraParams,
    };

    return openAIAdapter.buildRequest(openAIParams);
  },

  createStreamParser(params?: BuildRequestParams) {
    const openAIParser = openAIAdapter.createStreamParser(params);

    let startTime = Date.now();
    let firstTokenTime: number | null = null;

    return (chunk: Buffer | string): StreamEvent[] => {
      const events = openAIParser(chunk);

      // Calculate Rich Telemetry manually since OpenAI compat doesn't stream tok/s natively
      for (const event of events) {
        if (event.delta || event.reasoning) {
          if (firstTokenTime === null) {
            firstTokenTime = Date.now();
          }
        }
        if (event.usage) {
          if (event.usage.completionTokens !== undefined) {
            const elapsedSeconds = (Date.now() - startTime) / 1000;
            if (elapsedSeconds > 0) {
              event.usage.tokensPerSecond = Math.round((event.usage.completionTokens / elapsedSeconds) * 100) / 100;
            }
          }
          if (firstTokenTime !== null) {
            event.usage.timeToFirstTokenSeconds = Math.round(((firstTokenTime - startTime) / 1000) * 1000) / 1000;
          }
        }
      }

      return events;
    };
  }
};
