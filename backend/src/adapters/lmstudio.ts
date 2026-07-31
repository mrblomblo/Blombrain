import type { ApiAdapter, BuildRequestParams, RequestConfig, StreamEvent } from "./types.js";

interface JitCacheEntry {
  requestedCtx: number;
  timestamp: number;
}

const jitModelCache = new Map<string, JitCacheEntry>();

function buildJitCacheKey(baseUrl: string, rawModelId: string): string {
  const normalizedBase = baseUrl.replace(/\/$/, "");
  const normalizedModel = rawModelId.replace(/:\d+$/, "").toLowerCase();
  return `${normalizedBase}::${normalizedModel}`;
}

export const lmStudioAdapter: ApiAdapter = {
  id: "lmstudio",
  name: "LM Studio Native",
  badgeLabel: "LM Studio",

  async buildRequest({ backend, modelId, messages, extraParams, temperature, onConfigFix }: BuildRequestParams): Promise<RequestConfig> {
    const baseUrl = backend.baseUrl.replace(/\/$/, "");

    const cleanModelId = modelId.replace(/:\d+$/, "");
    let actualCtxLength = extraParams.num_ctx;

    const jitCacheKey = buildJitCacheKey(baseUrl, modelId);
    const cachedJit = jitModelCache.get(jitCacheKey);
    const userEditedCtx =
      extraParams.num_ctx !== undefined &&
      cachedJit !== undefined &&
      cachedJit.requestedCtx !== extraParams.num_ctx;

    if (userEditedCtx) {
      jitModelCache.set(jitCacheKey, { requestedCtx: extraParams.num_ctx as number, timestamp: Date.now() });
    } else {
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
              if (typeof nCtx === "number" && extraParams.num_ctx !== undefined) {
                if (nCtx !== extraParams.num_ctx) {
                  console.log(`[blombrain] Auto-detected LM Studio loaded n_ctx=${nCtx} (requested ${extraParams.num_ctx})`);
                  actualCtxLength = nCtx;
                  if (onConfigFix) onConfigFix({ ctx_length: nCtx });
                  jitModelCache.set(jitCacheKey, { requestedCtx: nCtx, timestamp: Date.now() });
                } else {
                  jitModelCache.set(jitCacheKey, { requestedCtx: extraParams.num_ctx, timestamp: Date.now() });
                }
              }
            }
          }
        }
      } catch {
        // Proceed with cleanModelId if fetch times out
      }
    }

    // Extract system prompt from system-role messages.
    const systemMessages = messages.filter(m => m.role === 'system');
    const systemPrompt = systemMessages
      .map(m => (typeof m.content === 'string' ? m.content : ''))
      .join('\n');

    const chatMessages = messages.filter(m => m.role !== 'system');
    const lastMessage = chatMessages[chatMessages.length - 1];
    const previousMessages = chatMessages.slice(0, -1);

    let historyText = "";
    if (previousMessages.length > 0) {
      historyText = "Previous conversation:\n";
      for (const msg of previousMessages) {
        let content = "";
        if (typeof msg.content === 'string') {
          content = msg.content;
        } else if (Array.isArray(msg.content)) {
          content = msg.content.map((p: any) => p.text || '').join(' ');
        }
        historyText += `${msg.role === 'user' ? 'User' : 'Assistant'}: ${content}\n`;
      }
      historyText += "\nCurrent message:\n";
    }

    // `input` is either a plain string or an array of typed content parts.
    // Per the docs, supported part types are:
    //   - { type: "text",  content: string }
    //   - { type: "image", data_url: string }   (base64 data URL)
    let input: string | any[];
    if (lastMessage && Array.isArray(lastMessage.content)) {
      input = [];
      if (historyText) {
        input.push({ type: "text", content: historyText });
      }
      for (const part of lastMessage.content) {
        if (part.type === 'text') {
          input.push({ type: "text", content: part.text });
        } else if (part.type === 'image_url') {
          input.push({ type: "image", data_url: part.image_url.url });
        }
      }
    } else if (lastMessage) {
      const content = typeof lastMessage.content === 'string' ? lastMessage.content : "";
      input = historyText + content;
    } else {
      input = historyText;
    }

    const body: Record<string, any> = {
      model: cleanModelId,
      input,
      // We serialize the full history ourselves, so disable server-side
      // conversation storage (defaults to `true` per the docs).
      store: false,
      stream: true,
      ...(systemPrompt ? { system_prompt: systemPrompt } : {}),
      ...(temperature !== undefined ? { temperature } : {}),
    };

    // Map caller-supplied extra parameters to the native API field names.
    if (actualCtxLength !== undefined) {
      body.context_length = actualCtxLength;
    }

    // Per the docs, the native API's only reasoning-related field is
    // `reasoning`, an enum of "off" | "low" | "medium" | "high" | "on".
    // There is no `reasoning_effort` field in this API — accept either
    // `extraParams.reasoning` (already in the docs' vocabulary) or the more
    // conventional `extraParams.reasoning_effort` (used by other adapters)
    // and normalize both onto the field LM Studio actually expects.
    const reasoningParam = extraParams.reasoning ?? extraParams.reasoning_effort;
    if (reasoningParam !== undefined && reasoningParam !== null) {
      const eff = String(reasoningParam).toLowerCase();
      if (eff === "yes" || eff === "true") {
        body.reasoning = "on";
      } else if (eff === "no" || eff === "false" || eff === "none") {
        body.reasoning = "off";
      } else if (eff === "off" || eff === "low" || eff === "medium" || eff === "high" || eff === "on") {
        body.reasoning = eff;
      }
      // Any other value is left unset so LM Studio falls back to its
      // automatically-chosen default for the model, per the docs.
    }
    if (extraParams.top_p !== undefined) body.top_p = extraParams.top_p;
    if (extraParams.top_k !== undefined) body.top_k = extraParams.top_k;
    if (extraParams.min_p !== undefined) body.min_p = extraParams.min_p;
    if (extraParams.repeat_penalty !== undefined) body.repeat_penalty = extraParams.repeat_penalty;
    if (extraParams.max_tokens !== undefined) body.max_output_tokens = extraParams.max_tokens;

    // `integrations`: plugins (e.g. pre-installed MCP servers referenced by
    // id) and/or ephemeral MCP servers defined inline for this request.
    if (Array.isArray(extraParams.integrations) && extraParams.integrations.length > 0) {
      body.integrations = extraParams.integrations;
    }

    return {
      url: `${baseUrl}/api/v1/chat`,
      init: {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(backend.apiKey ? { Authorization: `Bearer ${backend.apiKey}` } : {}),
        },
        body: JSON.stringify(body),
      },
    };
  },

  createStreamParser(buildParams?: BuildRequestParams) {
    const decoder = new TextDecoder();
    let buffer = "";
    let capturedJit = false;

    return (chunk: Buffer | string): StreamEvent[] => {
      const text = typeof chunk === "string" ? chunk : decoder.decode(chunk, { stream: true });
      buffer += text;

      const events: StreamEvent[] = [];

      // The native API streams Server-Sent Events. Each event is terminated
      // by a blank line. Handle BOTH LF (`\n\n`) and CRLF (`\r\n\r\n`)
      // separators — `\r\n\r\n` does *not* contain `\n\n`, so a naive
      // `indexOf("\n\n")` would silently drop events on CRLF streams.
      while (true) {
        const lfIdx = buffer.indexOf("\n\n");
        const crlfIdx = buffer.indexOf("\r\n\r\n");

        let sepIndex = -1;
        let sepLen = 0;
        if (lfIdx === -1 && crlfIdx === -1) break;
        if (lfIdx === -1) { sepIndex = crlfIdx; sepLen = 4; }
        else if (crlfIdx === -1) { sepIndex = lfIdx; sepLen = 2; }
        else if (crlfIdx < lfIdx) { sepIndex = crlfIdx; sepLen = 4; }
        else { sepIndex = lfIdx; sepLen = 2; }

        const rawEvent = buffer.slice(0, sepIndex);
        buffer = buffer.slice(sepIndex + sepLen);

        let eventType = "";
        let dataStr = "";

        // Strip a trailing `\r` from each line so CRLF streams parse cleanly.
        for (const line of rawEvent.split("\n")) {
          const trimmed = line.replace(/\r$/, "").trim();
          if (trimmed.startsWith("event:")) {
            eventType = trimmed.slice(6).trim();
          } else if (trimmed.startsWith("data:")) {
            const d = trimmed.slice(5).trim();
            if (dataStr) dataStr += "\n" + d;
            else dataStr = d;
          }
        }

        if (!dataStr) continue;

        // The native API concludes with a `chat.end` event (NOT OpenAI's
        // `[DONE]` sentinel). Tolerate `[DONE]` only in case a proxy injects it.
        if (dataStr === "[DONE]") {
          events.push({ isDone: true });
          continue;
        }

        try {
          const parsed = JSON.parse(dataStr);

          if (!capturedJit) {
            capturedJit = true;
            if (buildParams && buildParams.extraParams.num_ctx !== undefined && buildParams.onConfigFix) {
              setTimeout(() => {
                const baseUrl = buildParams.backend.baseUrl.replace(/\/$/, "");
                fetch(`${baseUrl}/api/v1/models`, {
                  headers: buildParams.backend.apiKey ? { Authorization: `Bearer ${buildParams.backend.apiKey}` } : undefined,
                })
                  .then((res) => (res.ok ? res.json() : null))
                  .then((data: any) => {
                    if (!data) return;
                    const rawModels: any[] = Array.isArray(data?.models) ? data.models : [];
                    if (rawModels.length === 0) return;
                    const targetId = (buildParams.modelId || "").toLowerCase();
                    const cleanTargetId = targetId.replace(/:\d+$/, "");

                    const matchingModel =
                      rawModels.find((m) => typeof m?.key === "string" && m.key.toLowerCase().includes(cleanTargetId)) ||
                      rawModels[0];

                    if (matchingModel && Array.isArray(matchingModel.loaded_instances) && matchingModel.loaded_instances.length > 0) {
                      const instance = matchingModel.loaded_instances[0];
                      const actualCtx = instance?.config?.context_length;
                      if (typeof actualCtx === "number") {
                        if (buildParams.extraParams.num_ctx !== undefined && actualCtx !== buildParams.extraParams.num_ctx) {
                          console.log(`[blombrain] Stream context length check: requested ${buildParams.extraParams.num_ctx}, actual loaded ${actualCtx}`);
                          buildParams.onConfigFix!({ ctx_length: actualCtx });
                        }
                        // Confirm what's actually loaded now so the next buildRequest call can
                        // correctly tell whether the user edits ctx length again.
                        jitModelCache.set(buildJitCacheKey(buildParams.backend.baseUrl, buildParams.modelId || ""), {
                          requestedCtx: actualCtx,
                          timestamp: Date.now(),
                        });
                      }
                    }
                  })
                  .catch((err) => {
                    console.error("[blombrain] Failed to fetch /api/v1/models for context length fix:", err);
                  });
              }, 500);
            }
          }

          // Prefer the SSE `event:` header (authoritative per the docs),
          // falling back to the JSON `type` field if the header is absent.
          const type = eventType || parsed.type;

          if (type === "message.delta") {
            const content = parsed.content;
            if (content) {
              events.push({ delta: content });
            }
          } else if (type === "reasoning.delta") {
            const content = parsed.content;
            if (content) {
              events.push({ reasoning: content });
            }
          } else if (type === "tool_call") {
            // Documented output item type for MCP/plugin tool calls made
            // via `integrations`. Not previously handled by the parser.
            const toolName = parsed.tool;
            if (toolName) {
              const providerInfo = parsed.provider_info;
              events.push({
                toolCalls: [
                  {
                    function: {
                      name: toolName,
                      arguments: parsed.arguments,
                    },
                    ...(parsed.output !== undefined ? { output: parsed.output } : {}),
                    ...(providerInfo
                      ? {
                        providerInfo: {
                          type: providerInfo.type,
                          ...(providerInfo.plugin_id !== undefined ? { pluginId: providerInfo.plugin_id } : {}),
                          ...(providerInfo.server_label !== undefined
                            ? { serverLabel: providerInfo.server_label }
                            : {}),
                        },
                      }
                      : {}),
                  },
                ],
              });
            }
          } else if (type === "invalid_tool_call") {
            // Documented output item type for a tool call the model made
            // with an invalid name or invalid arguments.
            const toolName = parsed.metadata?.tool_name;
            const reason = parsed.reason || `Invalid tool call${toolName ? ` (${toolName})` : ""}`;
            events.push({ error: reason });
          } else if (type === "chat.end") {
            const stats = parsed.result?.stats;
            if (stats) {
              const promptTokens = stats.input_tokens;
              const completionTokens = stats.total_output_tokens;
              const reasoningTokens = stats.reasoning_output_tokens;
              const tokensPerSecond = stats.tokens_per_second;
              const timeToFirstTokenSeconds = stats.time_to_first_token_seconds;
              const modelLoadTimeSeconds = stats.model_load_time_seconds;
              events.push({
                usage: {
                  ...(promptTokens !== undefined ? { promptTokens } : {}),
                  ...(completionTokens !== undefined ? { completionTokens } : {}),
                  ...(promptTokens !== undefined && completionTokens !== undefined
                    ? { totalTokens: promptTokens + completionTokens }
                    : {}),
                  ...(reasoningTokens !== undefined ? { reasoningTokens } : {}),
                  ...(tokensPerSecond !== undefined ? { tokensPerSecond } : {}),
                  ...(timeToFirstTokenSeconds !== undefined ? { timeToFirstTokenSeconds } : {}),
                  ...(modelLoadTimeSeconds !== undefined ? { modelLoadTimeSeconds } : {}),
                },
                isDone: true,
              });
            } else {
              events.push({ isDone: true });
            }
          } else if (type === "error") {
            const errMsg = parsed.error?.message || "Unknown error";
            events.push({ error: errMsg });
          }
        } catch {
          // Partial JSON across chunk boundaries — keep buffering.
        }
      }

      return events;
    };
  },
};
