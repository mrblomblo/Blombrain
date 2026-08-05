import type {
  ApiAdapter,
  BuildRequestParams,
  Logprob,
  RequestConfig,
  StreamEvent,
  ToolCall,
} from "./types.js";

/** Reasoning-effort values accepted by the `reasoning_effort` field per the OpenAI docs. */
const VALID_REASONING_EFFORTS = new Set(["none", "minimal", "low", "medium", "high", "xhigh", "max"]);

export const openAIAdapter: ApiAdapter = {
  id: "openai",
  name: "OpenAI Compatible",
  badgeLabel: "OpenAI",

  buildRequest({ backend, modelId, messages, extraParams, temperature }: BuildRequestParams): RequestConfig {
    const body: Record<string, any> = {
      ...extraParams,
      model: modelId,
      messages,
      ...(temperature !== undefined ? { temperature } : {}),
      stream: true,
      // Preserve any stream_options the caller already set (e.g. include_obfuscation)
      // and just make sure include_usage is always on so we get a final usage chunk.
      stream_options: { include_usage: true, ...(extraParams.stream_options ?? {}) },
    };

    // `max_tokens` is deprecated in favor of `max_completion_tokens`, and is flatly
    // incompatible with reasoning models (o-series, gpt-5.x). Translate it
    // automatically so callers configured with the legacy field still work
    // against reasoning models, unless the new field was already supplied.
    if (body.max_tokens !== undefined && body.max_completion_tokens === undefined) {
      body.max_completion_tokens = body.max_tokens;
      delete body.max_tokens;
    }

    if (extraParams.reasoning_effort) {
      const eff = String(extraParams.reasoning_effort).toLowerCase();
      if (eff === "yes") {
        body.reasoning_effort = "medium";
      } else if (eff === "no") {
        body.reasoning_effort = "none";
      } else if (VALID_REASONING_EFFORTS.has(eff)) {
        body.reasoning_effort = eff;
      } else {
        // Not a value the API accepts - drop it rather than risk a 400.
        delete body.reasoning_effort;
      }
    }

    return {
      url: `${backend.baseUrl}/v1/chat/completions`,
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

  createStreamParser() {
    const decoder = new TextDecoder();
    let buffer = "";



    return (chunk: Buffer | string): StreamEvent[] => {
      const text = typeof chunk === "string" ? chunk : decoder.decode(chunk, { stream: true });
      buffer += text;

      const events: StreamEvent[] = [];
      let sepIndex: number;

      while ((sepIndex = buffer.indexOf("\n\n")) !== -1) {
        const rawEvent = buffer.slice(0, sepIndex);
        buffer = buffer.slice(sepIndex + 2);

        for (const line of rawEvent.split("\n")) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;
          const payload = trimmed.slice(5).trim();
          if (payload === "[DONE]") {
            events.push({ isDone: true });
            continue;
          }

          try {
            const parsed = JSON.parse(payload);
            // The final usage-only chunk (when stream_options.include_usage is set)
            // has an empty `choices` array, so `choice` may legitimately be undefined.
            const choice = parsed?.choices?.[0];
            const delta = choice?.delta;

            const deltaText: string | undefined = delta?.content;
            // reasoning(_content)/thinking(_content) aren't OpenAI fields, but
            // several "OpenAI compatible" backends (vLLM, DeepSeek, etc.) reuse this
            // adapter and emit reasoning under one of these keys.
            const reasoning: string | undefined =
              delta?.reasoning_content || delta?.reasoning || delta?.thinking_content || delta?.thinking;
            const errMsg: string | undefined = parsed?.error?.message;
            const usage = parsed?.usage || parsed?.x_groq?.usage;
            const finishReason: string | undefined = choice?.finish_reason;

            let toolCalls: ToolCall[] | undefined;
            if (Array.isArray(delta?.tool_calls)) {
              toolCalls = delta.tool_calls.map((tc: any) => ({
                ...(tc.id ? { id: tc.id } : {}),
                ...(tc.index !== undefined ? { index: tc.index } : {}),
                function: {
                  ...(tc.function?.name ? { name: tc.function.name } : {}),
                  ...(tc.function?.arguments ? { arguments: tc.function.arguments } : {}),
                }
              }));
            }

            let logprobs: Logprob[] | undefined;
            const rawLogprobs = choice?.logprobs?.content;
            if (Array.isArray(rawLogprobs)) {
              logprobs = rawLogprobs.map(
                (lp: any): Logprob => ({
                  token: lp.token,
                  logprob: lp.logprob,
                  ...(lp.bytes ? { bytes: lp.bytes } : {}),
                  ...(Array.isArray(lp.top_logprobs)
                    ? {
                      topLogprobs: lp.top_logprobs.map((tlp: any) => ({
                        token: tlp.token,
                        logprob: tlp.logprob,
                        ...(tlp.bytes ? { bytes: tlp.bytes } : {}),
                      })),
                    }
                    : {}),
                }),
              );
            }

            events.push({
              ...(deltaText ? { delta: deltaText } : {}),
              ...(reasoning ? { reasoning } : {}),
              ...(errMsg ? { error: errMsg } : {}),
              ...(delta?.role ? { role: delta.role } : {}),
              ...(parsed?.model ? { model: parsed.model } : {}),
              ...(parsed?.created ? { createdAt: new Date(parsed.created * 1000).toISOString() } : {}),
              ...(parsed?.id ? { id: parsed.id } : {}),
              ...(toolCalls && toolCalls.length ? { toolCalls } : {}),
              ...(logprobs ? { logprobs } : {}),
              ...(usage
                ? {
                  usage: {
                    promptTokens: usage.prompt_tokens,
                    completionTokens: usage.completion_tokens,
                    totalTokens: usage.total_tokens,
                    ...(usage.completion_tokens_details?.reasoning_tokens !== undefined
                      ? { reasoningTokens: usage.completion_tokens_details.reasoning_tokens }
                      : {}),
                  },
                }
                : {}),
              ...(finishReason ? { isDone: true, doneReason: finishReason } : {}),
            });
          } catch {
            // Partial snippet, continue buffering
          }
        }
      }

      return events;
    };
  },
};
