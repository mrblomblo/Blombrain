import type { ApiAdapter, BuildRequestParams, RequestConfig, StreamEvent } from "./types.js";

export const openAIAdapter: ApiAdapter = {
  id: "openai",
  name: "OpenAI Compatible",
  badgeLabel: "OpenAI",

  buildRequest({ backend, modelId, messages, extraParams, temperature }: BuildRequestParams): RequestConfig {
    const body = {
      ...extraParams,
      model: modelId,
      messages,
      ...(temperature !== undefined ? { temperature } : {}),
      stream: true,
      stream_options: { include_usage: true },
    };

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
            const delta: string | undefined = parsed?.choices?.[0]?.delta?.content;
            const reasoning: string | undefined =
              parsed?.choices?.[0]?.delta?.reasoning_content ||
              parsed?.choices?.[0]?.delta?.reasoning ||
              parsed?.choices?.[0]?.delta?.thinking_content ||
              parsed?.choices?.[0]?.delta?.thinking;
            const errMsg: string | undefined = parsed?.error?.message;
            const usage = parsed?.usage || parsed?.x_groq?.usage;

            events.push({
              ...(delta ? { delta } : {}),
              ...(reasoning ? { reasoning } : {}),
              ...(errMsg ? { error: errMsg } : {}),
              ...(usage
                ? {
                    usage: {
                      promptTokens: usage.prompt_tokens,
                      completionTokens: usage.completion_tokens,
                      totalTokens: usage.total_tokens,
                    },
                  }
                : {}),
              ...(parsed?.choices?.[0]?.finish_reason ? { isDone: true } : {}),
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
