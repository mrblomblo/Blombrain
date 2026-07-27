import type {
  BackendInfo,
  BackendCreateBody,
  BackendUpdateBody,
  ChatMessage,
  ConversationSummary,
  ConversationDetail,
  MessageOut,
  ModelInfo,
  AttachmentOut,
} from "./types";

async function jsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`${res.status} ${res.statusText}${body ? `: ${body}` : ""}`);
  }
  return res.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// Backends
// ---------------------------------------------------------------------------

export async function fetchBackends(): Promise<BackendInfo[]> {
  const res = await fetch("/api/backends");
  return jsonOrThrow<BackendInfo[]>(res);
}

export async function createBackend(data: BackendCreateBody): Promise<BackendInfo> {
  const res = await fetch("/api/backends", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  return jsonOrThrow<BackendInfo>(res);
}

export async function updateBackend(id: string, data: BackendUpdateBody): Promise<BackendInfo> {
  const res = await fetch(`/api/backends/${encodeURIComponent(id)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  return jsonOrThrow<BackendInfo>(res);
}

export async function deleteBackend(id: string): Promise<void> {
  const res = await fetch(`/api/backends/${encodeURIComponent(id)}`, { method: "DELETE" });
  if (!res.ok && res.status !== 204) {
    const body = await res.text().catch(() => "");
    throw new Error(`${res.status} ${res.statusText}${body ? `: ${body}` : ""}`);
  }
}

// ---------------------------------------------------------------------------
// Models
// ---------------------------------------------------------------------------

export async function fetchModels(): Promise<ModelInfo[]> {
  const res = await fetch("/api/models");
  return jsonOrThrow<ModelInfo[]>(res);
}

// ---------------------------------------------------------------------------
// Model Settings & Presets
// ---------------------------------------------------------------------------

export async function createPreset(data: import("./types").ModelSettingWriteBody): Promise<ModelInfo> {
  const res = await fetch("/api/models", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  return jsonOrThrow<ModelInfo>(res);
}

export async function updateModelSettings(modelId: string, data: Partial<import("./types").ModelSettingWriteBody>): Promise<void> {
  const res = await fetch(`/api/models/${encodeURIComponent(modelId)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  await jsonOrThrow<{ ok: boolean }>(res);
}

export async function deleteModelSettings(modelId: string): Promise<void> {
  const res = await fetch(`/api/models/${encodeURIComponent(modelId)}`, { method: "DELETE" });
  await jsonOrThrow<{ ok: boolean }>(res);
}

// ---------------------------------------------------------------------------
// Uploads
// ---------------------------------------------------------------------------

export async function uploadFile(file: File, conversationId?: string | null): Promise<AttachmentOut> {
  const formData = new FormData();
  formData.append("file", file);
  const url = conversationId ? `/api/uploads?conversationId=${encodeURIComponent(conversationId)}` : "/api/uploads";
  const res = await fetch(url, {
    method: "POST",
    body: formData,
  });
  return jsonOrThrow<AttachmentOut>(res);
}

export async function deleteUpload(id: string): Promise<void> {
  const res = await fetch(`/api/uploads/${encodeURIComponent(id)}`, { method: "DELETE" });
  await jsonOrThrow<{ success: boolean }>(res);
}

export function serveUploadUrl(id: string): string {
  return `/api/uploads/${encodeURIComponent(id)}`;
}

// ---------------------------------------------------------------------------
// Conversations
// ---------------------------------------------------------------------------

export async function fetchConversations(): Promise<ConversationSummary[]> {
  const res = await fetch("/api/conversations");
  return jsonOrThrow<ConversationSummary[]>(res);
}

export async function fetchConversation(id: string): Promise<ConversationDetail> {
  const res = await fetch(`/api/conversations/${encodeURIComponent(id)}`);
  return jsonOrThrow<ConversationDetail>(res);
}

export async function createConversation(opts?: {
  title?: string;
  model?: string;
}): Promise<ConversationSummary> {
  const res = await fetch("/api/conversations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(opts ?? {}),
  });
  return jsonOrThrow<ConversationSummary>(res);
}

export async function updateConversation(
  id: string,
  patch: { title?: string; model?: string },
): Promise<ConversationSummary> {
  const res = await fetch(`/api/conversations/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  return jsonOrThrow<ConversationSummary>(res);
}

export async function deleteConversation(id: string): Promise<void> {
  const res = await fetch(`/api/conversations/${encodeURIComponent(id)}`, { method: "DELETE" });
  if (!res.ok && res.status !== 204) {
    const body = await res.text().catch(() => "");
    throw new Error(`${res.status} ${res.statusText}${body ? `: ${body}` : ""}`);
  }
}

export async function patchMessage(convId: string, msgId: string, content: string): Promise<MessageOut> {
  const res = await fetch(`/api/conversations/${encodeURIComponent(convId)}/messages/${encodeURIComponent(msgId)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content }),
  });
  return jsonOrThrow<MessageOut>(res);
}

export async function deleteMessage(convId: string, msgId: string): Promise<void> {
  const res = await fetch(`/api/conversations/${encodeURIComponent(convId)}/messages/${encodeURIComponent(msgId)}`, {
    method: "DELETE",
  });
  if (!res.ok && res.status !== 204) {
    const body = await res.text().catch(() => "");
    throw new Error(`${res.status} ${res.statusText}${body ? `: ${body}` : ""}`);
  }
}

export async function branchMessage(convId: string, msgId: string, content: string): Promise<MessageOut> {
  const res = await fetch(`/api/conversations/${encodeURIComponent(convId)}/messages/${encodeURIComponent(msgId)}/branch`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content }),
  });
  return jsonOrThrow<MessageOut>(res);
}

// ---------------------------------------------------------------------------
// Chat streaming
// ---------------------------------------------------------------------------

export interface StreamChatOptions {
  model: string;
  messages: Pick<ChatMessage, "role" | "content">[];
  temperature?: number;
  conversationId?: string | null;
  userMessageId?: string;
  userParentId?: string | null;
  attachmentIds?: string[];
  signal?: AbortSignal;
  onToken: (delta: string) => void;
  onMeta: (meta: {
    conversationId: string;
    title: string;
    isNew: boolean;
    userMessageId: string;
    assistantMessageId: string;
    stats?: import("./types").ResponseStats;
  }) => void;
  onDone: () => void;
  onError: (message: string) => void;
}

/**
 * POSTs to the backend's chat-completions proxy and incrementally parses the
 * OpenAI-style SSE stream, calling onToken for every content delta.
 * After the stream, a trailing `meta` event is emitted with the persisted
 * conversationId, title, and message IDs.
 */
export async function streamChatCompletion(opts: StreamChatOptions): Promise<void> {
  const {
    model,
    messages,
    temperature,
    conversationId,
    userMessageId,
    userParentId,
    attachmentIds,
    signal,
    onToken,
    onMeta,
    onDone,
    onError,
  } = opts;

  let res: Response;
  try {
    res = await fetch("/api/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages,
        temperature,
        conversationId,
        userMessageId,
        userParentId,
        attachments: attachmentIds,
        stream: true,
      }),
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
  let reasoningMode: "oob" | "inband" | null = null;

  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let sepIndex: number;
      while ((sepIndex = buffer.indexOf("\n\n")) !== -1) {
        const rawEvent = buffer.slice(0, sepIndex);
        buffer = buffer.slice(sepIndex + 2);

        for (const line of rawEvent.split("\n")) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;
          const payload = trimmed.slice(5).trim();
          if (payload === "[DONE]") {
            continue;
          }
          try {
            const parsed = JSON.parse(payload);
            // Trailing meta event from the persistence layer.
            if (parsed?.type === "meta") {
              onMeta(parsed);
              continue;
            }
            const delta: string | undefined = parsed?.choices?.[0]?.delta?.content;
            const reasoning: string | undefined = parsed?.choices?.[0]?.delta?.reasoning_content;
            
            if (reasoning) {
              if (!reasoningMode) {
                reasoningMode = "oob";
                onToken("<think>\n");
              }
              onToken(reasoning);
            }
            if (delta) {
              if (reasoningMode === "oob") {
                reasoningMode = null;
                onToken("\n</think>\n");
              }
              if (delta.includes("<think>")) {
                reasoningMode = "inband";
              }
              if (reasoningMode === "inband" && delta.includes("</think>")) {
                reasoningMode = null;
              }
              onToken(delta);
            }
            const errMsg: string | undefined = parsed?.error?.message;
            if (errMsg) onError(errMsg);
          } catch {
            // Ignore malformed/partial chunks.
          }
        }
      }
    }
    if (reasoningMode === "oob") {
      onToken("\n</think>");
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
