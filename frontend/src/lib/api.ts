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
  McpToolInfo,
  BuiltInToolInfo,
  SlashToolSelection,
  SkillInfo,
  SkillWriteBody,
  ModelSettingWriteBody,
  ResponseStats,
  ToolExecutionEvent,
  CtxOverflowBehavior,
  ReasoningInjectionMode,
  ConversationSamplingOverrides,
  ScratchpadEntryInfo,
  MemoryInfo,
  MemoryWriteBody,
  ChatHistorySearchHit,
  ArtifactInfo,
  SpeechProviderType,
  SpeechDeviceType,
} from "./types";
export type {
  CtxOverflowBehavior,
  ReasoningInjectionMode,
  SpeechProviderType,
  SpeechDeviceType,
};

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
export async function reconnectMcpServer(id: string): Promise<McpServerInfo> {
  const res = await apiFetch(`/api/mcp/${encodeURIComponent(id)}/reconnect`, {
    method: "POST",
  });
  return jsonOrThrow<McpServerInfo>(res);
}
export async function summarizeMcpServer(
  id: string,
  modelId?: string,
): Promise<{ summary: string; keywords: string; server: McpServerInfo }> {
  const res = await apiFetch(`/api/mcp/${encodeURIComponent(id)}/summarize`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ modelId }),
  });
  return jsonOrThrow<{ summary: string; keywords: string; server: McpServerInfo }>(res);
}
export async function fetchBuiltInTools(): Promise<BuiltInToolInfo[]> {
  const res = await apiFetch("/api/builtin-tools");
  return jsonOrThrow<BuiltInToolInfo[]>(res);
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
export async function uploadFile(
  file: File,
  conversationId?: string | null,
  purpose?: "attachment" | "avatar" | "icon",
): Promise<AttachmentOut> {
  const formData = new FormData();
  formData.append("file", file);
  const params = new URLSearchParams();
  if (conversationId) params.set("conversationId", conversationId);
  if (purpose) params.set("purpose", purpose);
  const qs = params.toString();
  const url = qs ? `/api/uploads?${qs}` : "/api/uploads";
  const res = await apiFetch(url, { method: "POST", body: formData });
  return jsonOrThrow<AttachmentOut>(res);
}
export async function deleteUpload(id: string): Promise<void> {
  const res = await apiFetch(`/api/uploads/${encodeURIComponent(id)}`, { method: "DELETE" });
  await jsonOrThrow<{ success: boolean }>(res);
}
export function serveUploadUrl(id: string, download = false): string {
  return `/api/uploads/${encodeURIComponent(id)}${download ? "?download=1" : ""}`;
}
export async function fetchUploadText(id: string): Promise<{
  text: string;
  isBinary: boolean;
  format: "code" | "text" | "pdf" | "docx" | "binary";
}> {
  const res = await apiFetch(`/api/uploads/${encodeURIComponent(id)}/text`);
  return jsonOrThrow(res);
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
export async function createConversation(opts?: { title?: string; model?: string; toolsEnabled?: boolean }): Promise<ConversationSummary> {
  const res = await apiFetch("/api/conversations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(opts ?? {}),
  });
  return jsonOrThrow<ConversationSummary>(res);
}
export async function updateConversation(
  id: string,
  patch: {
    title?: string;
    model?: string;
    isPinned?: boolean;
    isArchived?: boolean;
    memoryEnabled?: boolean | null;
    systemPromptOverride?: string | null;
    samplingOverrides?: ConversationSamplingOverrides | null;
  },
): Promise<ConversationSummary> {
  const res = await apiFetch(`/api/conversations/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  return jsonOrThrow<ConversationSummary>(res);
}
export async function searchConversations(
  query: string,
  includeArchived = false,
): Promise<ChatHistorySearchHit[]> {
  const params = new URLSearchParams({ q: query });
  if (includeArchived) params.set("includeArchived", "1");
  const res = await apiFetch(`/api/conversations/search?${params.toString()}`);
  return jsonOrThrow<ChatHistorySearchHit[]>(res);
}
export function exportConversationUrl(id: string, format: "md" | "json" = "md"): string {
  return `/api/conversations/${encodeURIComponent(id)}/export?format=${format}`;
}
export async function patchConversationTools(
  id: string,
  patch: {
    excludedMcps?: string[];
    excludedSkills?: string[];
    toolsEnabled?: boolean;
    memoryEnabled?: boolean | null;
    systemPromptOverride?: string | null;
    samplingOverrides?: ConversationSamplingOverrides | null;
  },
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
  if (typeof localStorage !== "undefined") {
    try {
      localStorage.removeItem(`blombrain_branches_${id}`);
    } catch { }
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
  messages: Array<Pick<ChatMessage, "role" | "content"> & { id?: string; attachments?: string[] }>;
  temperature?: number;
  conversationId?: string | null;
  userMessageId?: string;
  userParentId?: string | null;
  assistantMessageId?: string;
  isContinue?: boolean;
  isReconnect?: boolean;
  attachmentIds?: string[];
  toolsEnabled?: boolean;
  excludedMcps?: string[];
  excludedSkills?: string[];
  forcedTools?: string[];
  injectedTools?: SlashToolSelection[];
  memoryEnabled?: boolean | null;
  systemPromptOverride?: string | null;
  samplingOverrides?: ConversationSamplingOverrides | null;
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
  onContextOverflow?: (evt: { behavior: string; reason: string }) => void;
  onToolsPruned?: (evt: { prunedCount: number; remainingCount: number; droppedToolNames: string[] }) => void;
  onArtifactCreated?: (evt: { artifactId: string; conversationId: string; filename: string; title: string; language: string }) => void;
  onArtifactUpdated?: (evt: { artifactId: string; conversationId: string; filename: string; title: string; language: string }) => void;
  onScratchpadUpdated?: (evt: { conversationId: string; entries: ScratchpadEntryInfo[] }) => void;
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
    isContinue,
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
        isContinue,
        isReconnect: opts.isReconnect,
        attachments: attachmentIds,
        toolsEnabled: opts.toolsEnabled,
        excludedMcps: opts.excludedMcps,
        excludedSkills: opts.excludedSkills,
        forcedTools: opts.forcedTools,
        injectedTools: opts.injectedTools,
        memoryEnabled: opts.memoryEnabled,
        systemPromptOverride: opts.systemPromptOverride,
        samplingOverrides: opts.samplingOverrides,
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
            if (parsed?.type === "error") {
              const errPayload = parsed.error;
              const errMsg = typeof errPayload === 'string'
                ? errPayload
                : errPayload?.message;
              if (errMsg) onError(errMsg);
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
            if (parsed?.type === "context_overflow") {
              opts.onContextOverflow?.(parsed);
              continue;
            }
            if (parsed?.type === "tools_pruned") {
              opts.onToolsPruned?.(parsed);
              continue;
            }
            if (parsed?.type === "artifact_created") {
              opts.onArtifactCreated?.(parsed);
              continue;
            }
            if (parsed?.type === "artifact_Updated" || parsed?.type === "artifact_updated") {
              opts.onArtifactUpdated?.(parsed);
              continue;
            }
            if (parsed?.type === "scratchpad_updated") {
              opts.onScratchpadUpdated?.(parsed);
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

            const rawError = parsed?.error;
            let errMsg: string | undefined = undefined;
            if (typeof rawError === 'string') {
              errMsg = rawError;
            } else if (rawError && typeof rawError.message === 'string') {
              errMsg = rawError.message;
            }
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
  disabledBuiltInTools: string[];
  memoryEnabled: boolean;
  crossChatRecallEnabled: boolean;
  crossChatIncludeArchived: boolean;
  embeddingModel: string | null;
  sttProvider: SpeechProviderType;
  sttEndpoint: string | null;
  sttModel: string | null;
  sttDevice: SpeechDeviceType;
  ttsProvider: SpeechProviderType;
  ttsEndpoint: string | null;
  ttsModel: string | null;
  ttsVoice: string | null;
  ttsDevice: SpeechDeviceType;
  speechIdleTimeoutSec: number;
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
    disabledBuiltInTools: string[];
    memoryEnabled: boolean;
    crossChatRecallEnabled: boolean;
    crossChatIncludeArchived: boolean;
    embeddingModel: string | null;
    sttProvider: SpeechProviderType;
    sttEndpoint: string | null;
    sttModel: string | null;
    sttDevice: SpeechDeviceType;
    ttsProvider: SpeechProviderType;
    ttsEndpoint: string | null;
    ttsModel: string | null;
    ttsVoice: string | null;
    ttsDevice: SpeechDeviceType;
    speechIdleTimeoutSec: number;
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

export async function fetchArtifacts(conversationId: string): Promise<ArtifactInfo[]> {
  const res = await apiFetch(`/api/artifacts?conversationId=${encodeURIComponent(conversationId)}`);
  return jsonOrThrow<ArtifactInfo[]>(res);
}

export async function deleteArtifact(artifactId: string): Promise<void> {
  const res = await apiFetch(`/api/artifacts/${encodeURIComponent(artifactId)}`, {
    method: "DELETE",
  });
  await jsonOrThrow<{ success: boolean }>(res);
}

export async function fetchArtifactContent(artifactId: string): Promise<string> {
  const res = await apiFetch(
    `/api/artifacts/${encodeURIComponent(artifactId)}/content`,
    { cache: 'no-store' }
  );

  if (!res.ok) {
    throw new Error(`Failed to fetch artifact content: ${res.statusText}`);
  }
  return res.text();
}

// ---------------------------------------------------------------------------
// Memories & Scratchpad
// ---------------------------------------------------------------------------
export async function fetchMemories(query?: string): Promise<MemoryInfo[]> {
  const qs = query?.trim() ? `?q=${encodeURIComponent(query.trim())}` : "";
  const res = await apiFetch(`/api/memories${qs}`);
  return jsonOrThrow<MemoryInfo[]>(res);
}
export async function createMemoryApi(data: MemoryWriteBody): Promise<MemoryInfo> {
  const res = await apiFetch("/api/memories", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  return jsonOrThrow<MemoryInfo>(res);
}
export async function updateMemoryApi(id: string, data: Partial<MemoryWriteBody>): Promise<MemoryInfo> {
  const res = await apiFetch(`/api/memories/${encodeURIComponent(id)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  return jsonOrThrow<MemoryInfo>(res);
}
export async function deleteMemoryApi(id: string): Promise<void> {
  const res = await apiFetch(`/api/memories/${encodeURIComponent(id)}`, { method: "DELETE" });
  await jsonOrThrow<{ success: boolean }>(res);
}
export async function clearAllMemoriesApi(): Promise<void> {
  const res = await apiFetch("/api/memories", { method: "DELETE" });
  await jsonOrThrow<{ success: boolean }>(res);
}
export async function fetchScratchpad(conversationId: string): Promise<ScratchpadEntryInfo[]> {
  const res = await apiFetch(`/api/conversations/${encodeURIComponent(conversationId)}/scratchpad`);
  return jsonOrThrow<ScratchpadEntryInfo[]>(res);
}
export async function upsertScratchpadEntry(
  conversationId: string,
  key: string,
  content: string,
): Promise<ScratchpadEntryInfo[]> {
  const res = await apiFetch(`/api/conversations/${encodeURIComponent(conversationId)}/scratchpad`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key, content }),
  });
  return jsonOrThrow<ScratchpadEntryInfo[]>(res);
}
export async function deleteScratchpadEntryApi(
  conversationId: string,
  key: string,
): Promise<ScratchpadEntryInfo[]> {
  const res = await apiFetch(
    `/api/conversations/${encodeURIComponent(conversationId)}/scratchpad/${encodeURIComponent(key)}`,
    { method: "DELETE" },
  );
  return jsonOrThrow<ScratchpadEntryInfo[]>(res);
}

// ---------------------------------------------------------------------------
// Backups
// ---------------------------------------------------------------------------
export function exportBackupUrl(includeSecrets = false, includeFiles = true): string {
  const params = new URLSearchParams();
  if (includeSecrets) params.set("includeSecrets", "1");
  if (!includeFiles) params.set("includeFiles", "0");
  return `/api/backup/export?${params.toString()}`;
}
export async function importBackupBundle(
  bundle: any,
  mode: "merge" | "replace" = "merge",
): Promise<{ success: boolean; counts: Record<string, number> }> {
  const res = await apiFetch("/api/backup/import", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ bundle, mode }),
  });
  return jsonOrThrow(res);
}

// ---------------------------------------------------------------------------
// Speech (STT / TTS / VRAM Resource Manager)
// ---------------------------------------------------------------------------
export interface SpeechStatusOut {
  sttLoaded: boolean;
  ttsLoaded: boolean;
  sttLastUsed: number | null;
  ttsLastUsed: number | null;
  activeSttProcesses: number;
  activeTtsProcesses: number;
}
export async function fetchSpeechStatus(): Promise<SpeechStatusOut> {
  const res = await apiFetch("/api/speech/status");
  return jsonOrThrow<SpeechStatusOut>(res);
}
export async function ejectSpeechModelsApi(
  target: "stt" | "tts" | "all" = "all",
): Promise<{ success: boolean; status: SpeechStatusOut }> {
  const res = await apiFetch("/api/speech/eject", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ target }),
  });
  return jsonOrThrow(res);
}
export async function transcribeAudioBlob(
  blob: Blob,
  filename = "recording.wav",
  activeModelId?: string | null,
): Promise<{ text: string }> {
  const formData = new FormData();
  formData.append("file", blob, filename);
  const qs = activeModelId ? `?model=${encodeURIComponent(activeModelId)}` : "";
  const res = await apiFetch(`/api/speech/transcribe${qs}`, {
    method: "POST",
    body: formData,
  });
  return jsonOrThrow<{ text: string }>(res);
}
export async function synthesizeSpeechAudio(text: string): Promise<Blob> {
  const res = await apiFetch("/api/speech/synthesize", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`${res.status} ${res.statusText}${body ? `: ${body}` : ""}`);
  }
  return res.blob();
}

export async function fetchMcpTools(): Promise<McpToolInfo[]> {
  const res = await apiFetch("/api/mcp/tools");
  return jsonOrThrow<McpToolInfo[]>(res);
}
