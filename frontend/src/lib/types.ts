export interface BackendInfo {
  id: string;
  name: string;
  prefix: string;
  baseUrl: string;
  hasApiKey: boolean;
  status: "online" | "offline" | "unknown";
}

/** Body for POST /api/backends */
export interface BackendCreateBody {
  id: string;
  name: string;
  baseUrl: string;
  prefix: string;
  apiKey?: string;
}

/** Body for PUT /api/backends/:id */
export interface BackendUpdateBody {
  name: string;
  baseUrl: string;
  prefix: string;
  apiKey?: string;
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
}

export interface ModelSettingWriteBody {
  id?: string;
  isPreset?: boolean;
  name?: string;
  baseModelId?: string;
  systemPrompt?: string;
  canImage?: boolean;
  canAudio?: boolean;
  canVideo?: boolean;
  temperature?: number;
}

export type ChatRole = "system" | "user" | "assistant";

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
  role: ChatRole;
  content: string;
  /** Set while a streaming assistant response is still arriving. */
  streaming?: boolean;
  error?: string | null;
  attachments?: AttachmentOut[];
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
  role: ChatRole;
  content: string;
  error: string | null;
  createdAt: number;
  attachments?: AttachmentOut[];
}
