import type { ApiAdapter, BuildRequestParams, RequestConfig, StreamEvent } from "./types.js";

export const ollamaAdapter: ApiAdapter = {
  id: "ollama",
  name: "Ollama Native",
  badgeLabel: "Ollama",

  buildRequest({ backend, modelId, messages, extraParams, temperature }: BuildRequestParams): RequestConfig {
    const options: Record<string, any> = { ...extraParams };
    if (temperature !== undefined) options.temperature = temperature;
    if (extraParams.max_tokens !== undefined) {
      options.num_predict = extraParams.max_tokens;
    }

    const body = {
      model: modelId,
      messages,
      options,
      stream: true,
    };

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

          events.push({
            ...(delta ? { delta } : {}),
            ...(reasoning ? { reasoning } : {}),
            ...(parsed?.error ? { error: typeof parsed.error === "string" ? parsed.error : String(parsed.error) } : {}),
            ...(isDone
              ? {
                  isDone: true,
                  usage: {
                    promptTokens: parsed?.prompt_eval_count,
                    completionTokens: parsed?.eval_count,
                    totalTokens: (parsed?.prompt_eval_count ?? 0) + (parsed?.eval_count ?? 0),
                  },
                }
              : {}),
          });
        } catch {
          // Partial line
        }
      }

      return events;
    };
  },
};
