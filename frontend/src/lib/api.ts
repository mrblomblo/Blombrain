import { authStore } from "./stores/auth.svelte";
import type {
  BackendInfo,
  BackendCreateBody,
  BackendUpdateBody,
  BackendProtocolInfo,
  ChatMessage,
  ConversationSummary,
  ConversationDetail,
  MessageOut,
  ModelInfo,
  AttachmentOut,
  McpServerInfo,
  McpServerWriteBody,
  SkillInfo,
  SkillWriteBody,
  ModelSettingWriteBody,
  ResponseStats,
  ToolExecutionEvent,
  CtxOverflowBehavior,
  ReasoningInjectionMode,
} from "./types";
export type { CtxOverflowBehavior, ReasoningInjectionMode };

export async function apiFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const res = await globalThis.fetch(input, { ...init, credentials: "include" });
  if (res.status === 401) {
    authStore.authenticated = false;
  }
  return res;
}

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
  const res = await apiFetch("/api/backends");
  return jsonOrThrow<BackendInfo[]>(res);
}
export async function fetchBackendProtocols(): Promise<BackendProtocolInfo[]> {
  const res = await apiFetch("/api/backends/protocols");
  return jsonOrThrow<BackendProtocolInfo[]>(res);
}
export async function createBackend(data: BackendCreateBody): Promise<BackendInfo> {
  const res = await apiFetch("/api/backends", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  return jsonOrThrow<BackendInfo>(res);
}
export async function updateBackend(id: string, data: BackendUpdateBody): Promise<BackendInfo> {
  const res = await apiFetch(`/api/backends/${encodeURIComponent(id)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  return jsonOrThrow<BackendInfo>(res);
}
export async function deleteBackend(id: string): Promise<void> {
  const res = await apiFetch(`/api/backends/${encodeURIComponent(id)}`, { method: "DELETE" });
  if (!res.ok && res.status !== 204) {
    const body = await res.text().catch(() => "");
    throw new Error(`${res.status} ${res.statusText}${body ? `: ${body}` : ""}`);
  }
}

// ---------------------------------------------------------------------------
// MCP Servers
// ---------------------------------------------------------------------------
export async function fetchMcpServers(): Promise<McpServerInfo[]> {
  const res = await apiFetch("/api/mcp");
  return jsonOrThrow<McpServerInfo[]>(res);
}
export async function createMcpServer(data: McpServerWriteBody): Promise<McpServerInfo> {
  const res = await apiFetch("/api/mcp", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  return jsonOrThrow<McpServerInfo>(res);
}
export async function updateMcpServer(id: string, data: McpServerWriteBody): Promise<McpServerInfo> {
  const res = await apiFetch(`/api/mcp/${encodeURIComponent(id)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  return jsonOrThrow<McpServerInfo>(res);
}
export async function deleteMcpServer(id: string): Promise<void> {
  const res = await apiFetch(`/api/mcp/${encodeURIComponent(id)}`, { method: "DELETE" });
  await jsonOrThrow<{ success: boolean }>(res);
}

// ---------------------------------------------------------------------------
// Skills
// ---------------------------------------------------------------------------
export async function fetchSkills(): Promise<SkillInfo[]> {
  const res = await apiFetch("/api/skills");
  return jsonOrThrow<SkillInfo[]>(res);
}
export async function createSkill(data: SkillWriteBody): Promise<SkillInfo> {
  const res = await apiFetch("/api/skills", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  return jsonOrThrow<SkillInfo>(res);
}
export async function updateSkill(id: string, data: SkillWriteBody): Promise<SkillInfo> {
  const res = await apiFetch(`/api/skills/${encodeURIComponent(id)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  return jsonOrThrow<SkillInfo>(res);
}
export async function deleteSkill(id: string): Promise<void> {
  const res = await apiFetch(`/api/skills/${encodeURIComponent(id)}`, { method: "DELETE" });
  await jsonOrThrow<{ success: boolean }>(res);
}
export async function importSkill(dirPath: string): Promise<SkillInfo> {
  const res = await apiFetch("/api/skills/import", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ dirPath }),
  });
  return jsonOrThrow<SkillInfo>(res);
}
export async function uploadSkillFiles(items: { file: File; relativePath: string }[]): Promise<SkillInfo> {
  const formData = new FormData();
  for (const item of items) {
    formData.append("files", item.file, item.relativePath || item.file.name);
  }
  const res = await apiFetch("/api/skills/upload", { method: "POST", body: formData });
  return jsonOrThrow<SkillInfo>(res);
}

// ---------------------------------------------------------------------------
// Models
// ---------------------------------------------------------------------------
export async function fetchModels(): Promise<ModelInfo[]> {
  const res = await apiFetch("/api/models");
  return jsonOrThrow<ModelInfo[]>(res);
}
export async function forceSyncModels(): Promise<void> {
  const res = await apiFetch("/api/models/sync", { method: "POST" });
  await jsonOrThrow<{ success: boolean }>(res);
}

// ---------------------------------------------------------------------------
// Model Settings & Presets
// ---------------------------------------------------------------------------
export async function createPreset(data: ModelSettingWriteBody): Promise<ModelInfo> {
  const res = await apiFetch("/api/models", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  return jsonOrThrow<ModelInfo>(res);
}
export async function updateModelSettings(modelId: string, data: Partial<ModelSettingWriteBody>): Promise<void> {
  const res = await apiFetch(`/api/models/${encodeURIComponent(modelId)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  await jsonOrThrow<{ ok: boolean }>(res);
}
export async function deleteModelSettings(modelId: string): Promise<void> {
  const res = await apiFetch(`/api/models/${encodeURIComponent(modelId)}`, { method: "DELETE" });
  await jsonOrThrow<{ ok: boolean }>(res);
}
export async function updateModelOrder(orders: Array<{ id: string; sortOrder: number; isPreset?: boolean }>): Promise<void> {
  const res = await apiFetch("/api/models/order", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ orders }),
  });
  await jsonOrThrow<{ ok: boolean }>(res);
}

// ---------------------------------------------------------------------------
// Uploads
// ---------------------------------------------------------------------------
export async function uploadFile(file: File, conversationId?: string | null): Promise<AttachmentOut> {
  const formData = new FormData();
  formData.append("file", file);
  const url = conversationId ? `/api/uploads?conversationId=${encodeURIComponent(conversationId)}` : "/api/uploads";
  const res = await apiFetch(url, { method: "POST", body: formData });
  return jsonOrThrow<AttachmentOut>(res);
}
export async function deleteUpload(id: string): Promise<void> {
  const res = await apiFetch(`/api/uploads/${encodeURIComponent(id)}`, { method: "DELETE" });
  await jsonOrThrow<{ success: boolean }>(res);
}
export function serveUploadUrl(id: string): string {
  return `/api/uploads/${encodeURIComponent(id)}`;
}

// ---------------------------------------------------------------------------
// Conversations
// ---------------------------------------------------------------------------
export async function fetchConversations(): Promise<ConversationSummary[]> {
  const res = await apiFetch("/api/conversations");
  return jsonOrThrow<ConversationSummary[]>(res);
}
export async function fetchConversation(id: string): Promise<ConversationDetail> {
  const res = await apiFetch(`/api/conversations/${encodeURIComponent(id)}`);
  return jsonOrThrow<ConversationDetail>(res);
}
export async function createConversation(opts?: { title?: string; model?: string }): Promise<ConversationSummary> {
  const res = await apiFetch("/api/conversations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(opts ?? {}),
  });
  return jsonOrThrow<ConversationSummary>(res);
}
export async function updateConversation(id: string, patch: { title?: string; model?: string }): Promise<ConversationSummary> {
  const res = await apiFetch(`/api/conversations/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  return jsonOrThrow<ConversationSummary>(res);
}
export async function patchConversationTools(
  id: string,
  patch: { excludedMcps?: string[]; excludedSkills?: string[]; toolsEnabled?: boolean },
): Promise<void> {
  const res = await apiFetch(`/api/conversations/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  await jsonOrThrow<unknown>(res);
}
export async function deleteConversation(id: string): Promise<void> {
  const res = await apiFetch(`/api/conversations/${encodeURIComponent(id)}`, { method: "DELETE" });
  if (!res.ok && res.status !== 204) {
    const body = await res.text().catch(() => "");
    throw new Error(`${res.status} ${res.statusText}${body ? `: ${body}` : ""}`);
  }
}
export async function patchMessage(convId: string, msgId: string, content: string, attachmentIds?: string[]): Promise<MessageOut> {
  const res = await apiFetch(`/api/conversations/${encodeURIComponent(convId)}/messages/${encodeURIComponent(msgId)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content, attachmentIds }),
  });
  return jsonOrThrow<MessageOut>(res);
}
export async function deleteMessage(convId: string, msgId: string): Promise<void> {
  const res = await apiFetch(`/api/conversations/${encodeURIComponent(convId)}/messages/${encodeURIComponent(msgId)}`, {
    method: "DELETE",
  });
  if (!res.ok && res.status !== 204) {
    const body = await res.text().catch(() => "");
    throw new Error(`${res.status} ${res.statusText}${body ? `: ${body}` : ""}`);
  }
}
export async function branchMessage(convId: string, msgId: string, content: string, attachmentIds?: string[]): Promise<MessageOut> {
  const res = await apiFetch(`/api/conversations/${encodeURIComponent(convId)}/messages/${encodeURIComponent(msgId)}/branch`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content, attachmentIds }),
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
  assistantMessageId?: string;
  attachmentIds?: string[];
  toolsEnabled?: boolean;
  excludedMcps?: string[];
  excludedSkills?: string[];
  signal?: AbortSignal;
  onToken: (delta: string) => void;
  onMeta: (meta: {
    conversationId: string;
    title: string;
    isNew: boolean;
    userMessageId: string;
    assistantMessageId: string;
    isReconnect?: boolean;
    stats?: ResponseStats;
  }) => void;
  onStatus?: (status: string) => void;
  onRouterToken?: (text: string) => void;
  onToolExecution?: (evt: ToolExecutionEvent) => void;
  onToolProgress?: (evt: Partial<ToolExecutionEvent> & { callId: string }) => void;
  onContentReplace?: (content: string) => void;
  onContextTrimmed?: (evt: { droppedMessageCount: number; behavior: string }) => void;
  onDone: () => void;
  onError: (message: string) => void;
}

export async function streamChatCompletion(opts: StreamChatOptions): Promise<void> {
  const {
    model,
    messages,
    temperature,
    conversationId,
    userMessageId,
    userParentId,
    assistantMessageId,
    attachmentIds,
    signal,
    onToken,
    onMeta,
    onDone,
    onError,
  } = opts;

  let res: Response;
  try {
    res = await apiFetch("/api/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages,
        temperature,
        conversationId,
        userMessageId,
        userParentId,
        assistantMessageId,
        attachments: attachmentIds,
        toolsEnabled: opts.toolsEnabled,
        excludedMcps: opts.excludedMcps,
        excludedSkills: opts.excludedSkills,
        stream: true,
      }),
      signal,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      onError("Operation aborted");
      onDone();
      return;
    }
    onError(err instanceof Error ? err.message : "Network request failed");
    onDone();
    return;
  }

  if (!res.ok || !res.body) {
    const body = await res.text().catch(() => "");
    onError(`${res.status} ${res.statusText}${body ? `: ${body}` : ""}`);
    onDone();
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let reasoningMode: "oob" | "inband" | null = null;

  try {
    for (; ;) {
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
          if (payload === "[DONE]") continue;

          try {
            const parsed = JSON.parse(payload);

            if (parsed?.type === "meta") {
              onMeta(parsed);
              continue;
            }
            if (parsed?.type === "status") {
              opts.onStatus?.(parsed.status);
              continue;
            }
            if (parsed?.type === "router_token") {
              opts.onRouterToken?.(parsed.text);
              continue;
            }
            if (parsed?.type === "tool_execution") {
              opts.onToolExecution?.(parsed);
              continue;
            }
            if (parsed?.type === "tool_progress") {
              opts.onToolProgress?.(parsed);
              continue;
            }
            if (parsed?.type === "content_replace") {
              opts.onContentReplace?.(parsed.content);
              continue;
            }
            if (parsed?.type === "context_trimmed") {
              opts.onContextTrimmed?.(parsed);
              continue;
            }

            const delta: string | undefined = parsed?.choices?.[0]?.delta?.content;
            const reasoning: string | undefined =
              parsed?.choices?.[0]?.delta?.reasoning_content ||
              parsed?.choices?.[0]?.delta?.reasoning ||
              parsed?.choices?.[0]?.delta?.thinking_content ||
              parsed?.choices?.[0]?.delta?.thinking;

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
    onDone();
  }
}

export async function stopChatCompletion(conversationId: string): Promise<void> {
  await apiFetch("/api/chat/stop", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ conversationId }),
  });
}

export async function autoNameConversation(
  conversationId: string,
  userContent: string,
  targetModelId: string,
  signal?: AbortSignal,
): Promise<{ title: string }> {
  const res = await apiFetch(`/api/conversations/${encodeURIComponent(conversationId)}/auto-name`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userContent, targetModelId }),
    signal,
  });
  return jsonOrThrow<{ title: string }>(res);
}

export type AutoNameMode = "first_words" | "active_model" | "designated_model";
export type ToolRoutingMode = "off" | "active_model" | "designated_model";

export interface GlobalSettingsOut {
  id: string;
  userName: string;
  userAvatar: string | null;
  theme: string;
  autoNameMode: AutoNameMode;
  autoNameModel: string | null;
  toolRoutingMode: ToolRoutingMode;
  toolRoutingModel: string | null;
  ctxOverflowBehavior: CtxOverflowBehavior;
  reasoningInjectionMode: ReasoningInjectionMode;
  networkToolsEnabled: boolean;
  artifactNetworkEnabled: boolean;
}

export async function fetchGlobalSettings(): Promise<GlobalSettingsOut> {
  const res = await apiFetch("/api/settings");
  return jsonOrThrow<GlobalSettingsOut>(res);
}
export async function updateGlobalSettings(
  patch: Partial<{
    userName: string;
    userAvatar: string | null;
    theme: string;
    autoNameMode: AutoNameMode;
    autoNameModel: string | null;
    toolRoutingMode: ToolRoutingMode;
    toolRoutingModel: string | null;
    ctxOverflowBehavior: CtxOverflowBehavior;
    reasoningInjectionMode: ReasoningInjectionMode;
    networkToolsEnabled: boolean;
    artifactNetworkEnabled: boolean;
    password?: string;
  }>,
): Promise<GlobalSettingsOut> {
  const res = await apiFetch("/api/settings", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  return jsonOrThrow<GlobalSettingsOut>(res);
}

export async function fetchInstanceInfo(): Promise<{ theme: string }> {
  const res = await globalThis.fetch("/api/instance-info");
  return jsonOrThrow<{ theme: string }>(res);
}
