import type { ApiAdapter, BuildRequestParams, RequestConfig, StreamEvent } from "./types.js";

export const ollamaAdapter: ApiAdapter = {
  id: "ollama",
  name: "Ollama Native",
  badgeLabel: "Ollama",

  buildRequest({ backend, modelId, messages, extraParams, temperature }: BuildRequestParams): RequestConfig {
    // A handful of documented ChatRequest fields are top-level (sibling to `options`), not
    // ModelOptions fields, so they're pulled out here rather than spread into `options`.
    const {
      max_tokens,
      reasoning_effort,
      tools,
      format,
      keep_alive,
      logprobs,
      top_logprobs,
      ...restParams
    } = extraParams as Record<string, any>;

    const options: Record<string, any> = { ...restParams };
    if (temperature !== undefined) options.temperature = temperature;
    if (max_tokens !== undefined) {
      options.num_predict = max_tokens;
    }

    const body: Record<string, any> = {
      model: modelId,
      messages,
      options,
      stream: true,
    };

    // Per the docs, `think` is a top-level ChatRequest field: a boolean, or one of
    // "high" | "medium" | "low" | "max" for supported models.
    if (reasoning_effort) {
      const eff = String(reasoning_effort).toLowerCase();
      if (eff === "yes") {
        body.think = true;
      } else if (eff === "no") {
        body.think = false;
      } else {
        body.think = eff;
      }
    }

    // Function/tool calling: array of { type: "function", function: {...} } tool definitions.
    if (tools !== undefined) {
      body.tools = tools;
    }

    // Structured outputs: either the literal string "json" or a JSON Schema object.
    if (format !== undefined) {
      body.format = format;
    }

    // Model keep-alive duration, e.g. "5m" or 0 to unload immediately.
    if (keep_alive !== undefined) {
      body.keep_alive = keep_alive;
    }

    // Log-probabilities of output tokens. `top_logprobs` only makes sense alongside `logprobs`.
    if (logprobs !== undefined) {
      body.logprobs = logprobs;
      if (top_logprobs !== undefined) {
        body.top_logprobs = top_logprobs;
      }
    }

    return {
      url: `${backend.baseUrl}/api/chat`,
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
      let lineIndex: number;

      while ((lineIndex = buffer.indexOf("\n")) !== -1) {
        const rawLine = buffer.slice(0, lineIndex).trim();
        buffer = buffer.slice(lineIndex + 1);
        if (!rawLine) continue;

        try {
          const parsed = JSON.parse(rawLine);
          const delta: string | undefined = parsed?.message?.content;
          const reasoning: string | undefined = parsed?.message?.thinking;
          const isDone = Boolean(parsed?.done);

          // Tool calls the model requests mid-stream (ChatStreamEvent.message.tool_calls).
          const toolCalls = Array.isArray(parsed?.message?.tool_calls)
            ? parsed.message.tool_calls.map((tc: any) => ({
              function: {
                name: tc?.function?.name,
                description: tc?.function?.description,
                arguments: tc?.function?.arguments,
              },
            }))
            : undefined;

          // Partial base64-encoded images the model returns (ChatStreamEvent.message.images).
          const images: string[] | undefined = parsed?.message?.images;
          const logprobs = parsed?.logprobs;

          const event: Record<string, any> = {
            ...(delta ? { delta } : {}),
            ...(reasoning ? { reasoning } : {}),
            ...(parsed?.message?.role ? { role: parsed.message.role } : {}),
            ...(toolCalls?.length ? { toolCalls } : {}),
            ...(images?.length ? { images } : {}),
            ...(parsed?.model ? { model: parsed.model } : {}),
            ...(parsed?.created_at ? { createdAt: parsed.created_at } : {}),
            ...(logprobs ? { logprobs } : {}),
            ...(parsed?.error ? { error: typeof parsed.error === "string" ? parsed.error : String(parsed.error) } : {}),
            ...(isDone
              ? {
                isDone: true,
                ...(parsed?.done_reason ? { doneReason: parsed.done_reason } : {}),
                usage: {
                  promptTokens: parsed?.prompt_eval_count,
                  completionTokens: parsed?.eval_count,
                  totalTokens: (parsed?.prompt_eval_count ?? 0) + (parsed?.eval_count ?? 0),
                  ...(parsed?.total_duration !== undefined ? { totalDurationNs: parsed.total_duration } : {}),
                  ...(parsed?.load_duration !== undefined ? { loadDurationNs: parsed.load_duration } : {}),
                  ...(parsed?.prompt_eval_duration !== undefined
                    ? { promptEvalDurationNs: parsed.prompt_eval_duration }
                    : {}),
                  ...(parsed?.eval_duration !== undefined ? { evalDurationNs: parsed.eval_duration } : {}),
                },
              }
              : {}),
          };

          events.push(event as StreamEvent);
        } catch {
          // Partial line
        }
      }

      return events;
    };
  },
};
