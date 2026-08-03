export interface BackendInfo {
  id: string;
  name: string;
  prefix: string;
  baseUrl: string;
  hasApiKey: boolean;
  status: "online" | "offline" | "unknown";
  apiType?: string;
}

export interface BackendProtocolInfo {
  id: string;
  name: string;
  badgeLabel: string;
}

/** Body for POST /api/backends */
export interface BackendCreateBody {
  id: string;
  name: string;
  baseUrl: string;
  prefix: string;
  apiKey?: string;
  apiType?: string;
}

/** Body for PUT /api/backends/:id */
export interface BackendUpdateBody {
  name: string;
  baseUrl: string;
  prefix: string;
  apiKey?: string;
  apiType?: string;
}

export interface ModelInfo {
  /** Prefixed id, e.g. "local:llama-3.1-8b-instruct" or "preset_123" */
  id: string;
  rawId: string;
  backendId: string;
  backendName: string;
  isPreset?: boolean;
  baseModelId?: string;
  name?: string;
  systemPrompt?: string;
  canImage?: boolean;
  canAudio?: boolean;
  canVideo?: boolean;
  temperature?: number;
  icon?: string;
  seed?: number;
  reasoningEffort?: string;
  maxTokens?: number;
  topK?: number;
  topP?: number;
  minP?: number;
  presencePenalty?: number;
  frequencyPenalty?: number;
  repeatPenalty?: number;
  ctxLength?: number;
  isHidden?: boolean;
  isOffline?: boolean;
  sortOrder?: number;
  isDefault?: boolean;
  isOrphaned?: boolean;
}

export interface ModelSettingWriteBody {
  id?: string;
  isPreset?: boolean;
  name?: string;
  baseModelId?: string;
  systemPrompt?: string | null;
  canImage?: boolean;
  canAudio?: boolean;
  canVideo?: boolean;
  temperature?: number | null;
  icon?: string | null;
  seed?: number | null;
  reasoningEffort?: string | null;
  maxTokens?: number | null;
  topK?: number | null;
  topP?: number | null;
  minP?: number | null;
  presencePenalty?: number | null;
  frequencyPenalty?: number | null;
  repeatPenalty?: number | null;
  ctxLength?: number | null;
  isHidden?: boolean;
  sortOrder?: number;
  isDefault?: boolean;
}

export type ChatRole = "system" | "user" | "assistant";

export interface ResponseStats {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  durationMs?: number;
  thinkingTimeMs?: number;
}

export interface AttachmentOut {
  id: string;
  conversationId: string;
  messageId: string | null;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: number;
}

export interface ChatMessage {
  id: string;
  parentId?: string | null;
  role: ChatRole;
  content: string;
  /** Set while a streaming assistant response is still arriving. */
  streaming?: boolean;
  error?: string | null;
  attachments?: AttachmentOut[];
  createdAt?: number;
  thinkingContent?: string;
  thinkingDone?: boolean;
  thinkingTimeMs?: number;
  stats?: ResponseStats;
  model?: string;
}

/** A conversation list item (no messages). */
export interface ConversationSummary {
  id: string;
  title: string;
  model: string | null;
  createdAt: number;
  updatedAt: number;
}

/** A full conversation with its messages. */
export interface ConversationDetail extends ConversationSummary {
  messages: MessageOut[];
}

/** Message shape returned from the API. */
export interface MessageOut {
  id: string;
  conversationId: string;
  parentId: string | null;
  role: ChatRole;
  content: string;
  error: string | null;
  stats?: ResponseStats;
  model?: string;
  createdAt: number;
  attachments?: AttachmentOut[];
}
