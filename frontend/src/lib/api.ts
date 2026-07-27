import type { BackendInfo, ChatMessage, ModelInfo } from "./types";

async function jsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`${res.status} ${res.statusText}${body ? `: ${body}` : ""}`);
  }
  return res.json() as Promise<T>;
}

export async function fetchBackends(): Promise<BackendInfo[]> {
  const res = await fetch("/api/backends");
  return jsonOrThrow<BackendInfo[]>(res);
}

export async function fetchModels(): Promise<ModelInfo[]> {
  const res = await fetch("/api/models");
  return jsonOrThrow<ModelInfo[]>(res);
}

export interface StreamChatOptions {
  model: string;
  messages: Pick<ChatMessage, "role" | "content">[];
  temperature?: number;
  signal?: AbortSignal;
  onToken: (delta: string) => void;
  onDone: () => void;
  onError: (message: string) => void;
}

/**
 * POSTs to the backend's chat-completions proxy and incrementally parses the
 * OpenAI-style Server-Sent-Events stream it forwards back, calling onToken
 * for every content delta as it arrives.
 */
export async function streamChatCompletion(opts: StreamChatOptions): Promise<void> {
  const { model, messages, temperature, signal, onToken, onDone, onError } = opts;

  let res: Response;
  try {
    res = await fetch("/api/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, messages, temperature, stream: true }),
      signal,
    });
  } catch (err) {
    onError(err instanceof Error ? err.message : "Network request failed");
    return;
  }

  if (!res.ok || !res.body) {
    const body = await res.text().catch(() => "");
    onError(`${res.status} ${res.statusText}${body ? `: ${body}` : ""}`);
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // SSE events are separated by a blank line; each event may contain
      // multiple "data: ..." lines but OpenAI-style servers emit one per event.
      let sepIndex: number;
      while ((sepIndex = buffer.indexOf("\n\n")) !== -1) {
        const rawEvent = buffer.slice(0, sepIndex);
        buffer = buffer.slice(sepIndex + 2);

        for (const line of rawEvent.split("\n")) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;
          const payload = trimmed.slice(5).trim();
          if (payload === "[DONE]") {
            onDone();
            return;
          }
          try {
            const parsed = JSON.parse(payload);
            const delta: string | undefined = parsed?.choices?.[0]?.delta?.content;
            if (delta) onToken(delta);
            const errMsg: string | undefined = parsed?.error?.message;
            if (errMsg) onError(errMsg);
          } catch {
            // Ignore malformed/partial chunks; the buffer logic above should
            // prevent this in practice, but backends vary.
          }
        }
      }
    }
    onDone();
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      onDone();
      return;
    }
    onError(err instanceof Error ? err.message : "Stream reading failed");
  }
}
