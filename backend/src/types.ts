// ---------------------------------------------------------------------------
// Backend types
// ---------------------------------------------------------------------------

/** A backend row as stored in SQLite (api_key may be undefined). */
export interface BackendRow {
  id: string;
  name: string;
  base_url: string;
  prefix: string;
  api_key: string | null;
}

/** A backend after loading from DB with snake_case mapped to camelCase. */
export interface ResolvedBackend {
  id: string;
  name: string;
  baseUrl: string;
  prefix: string;
  apiKey?: string;
}

/** Public shape sent to the frontend -- never includes the API key. */
export interface BackendInfo {
  id: string;
  name: string;
  prefix: string;
  baseUrl: string;
  hasApiKey: boolean;
  status: "online" | "offline" | "unknown";
}

/** Body accepted by POST /api/backends and PUT /api/backends/:id */
export interface BackendWriteBody {
  id?: string;   // required on POST, ignored on PUT (taken from URL)
  name: string;
  baseUrl: string;
  prefix: string;
  apiKey?: string;
}

export interface ModelInfo {
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
  thinking?: boolean;
  maxTokens?: number;
  topK?: number;
  topP?: number;
  minP?: number;
  presencePenalty?: number;
  frequencyPenalty?: number;
  repeatPenalty?: number;
  ctxLength?: number;
  isHidden?: boolean;
  sortOrder?: number;
  isDefault?: boolean;
}

// ---------------------------------------------------------------------------
// Conversation / message types
// ---------------------------------------------------------------------------

export interface ConversationRow {
  id: string;
  title: string;
  model: string | null;
  created_at: number;
  updated_at: number;
}

export interface MessageRow {
  id: string;
  conversation_id: string;
  parent_id: string | null;
  role: "system" | "user" | "assistant";
  content: string;
  error: string | null;
  stats: string | null;
  created_at: number;
}

/** Summary sent in list responses (no messages). */
export interface ConversationSummary {
  id: string;
  title: string;
  model: string | null;
  createdAt: number;
  updatedAt: number;
}

/** Full conversation with messages, sent on GET /api/conversations/:id */
export interface ConversationDetail extends ConversationSummary {
  messages: MessageOut[];
}

/** Message shape sent to the frontend. */
export interface MessageOut {
  id: string;
  conversationId: string;
  parentId: string | null;
  role: "system" | "user" | "assistant";
  content: string;
  error: string | null;
  stats?: any;
  createdAt: number;
  attachments?: AttachmentOut[];
}

/** Body accepted by PATCH /api/conversations/:id */
export interface ConversationPatchBody {
  title?: string;
  model?: string;
}

// ---------------------------------------------------------------------------
// Model Settings & Presets
// ---------------------------------------------------------------------------

export interface ModelSettingRow {
  id: string;
  is_preset: number;
  name: string | null;
  base_model_id: string | null;
  system_prompt: string | null;
  can_image: number;
  can_audio: number;
  can_video: number;
  temperature: number | null;
  icon: string | null;
  seed: number | null;
  reasoning_effort: string | null;
  thinking: number;
  max_tokens: number | null;
  top_k: number | null;
  top_p: number | null;
  min_p: number | null;
  presence_penalty: number | null;
  frequency_penalty: number | null;
  repeat_penalty: number | null;
  ctx_length: number | null;
  is_hidden: number;
  sort_order: number;
  is_default: number;
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
  icon?: string;
  seed?: number;
  reasoningEffort?: string;
  thinking?: boolean;
  maxTokens?: number;
  topK?: number;
  topP?: number;
  minP?: number;
  presencePenalty?: number;
  frequencyPenalty?: number;
  repeatPenalty?: number;
  ctxLength?: number;
  isHidden?: boolean;
  sortOrder?: number;
  isDefault?: boolean;
}

export interface AttachmentRow {
  id: string;
  conversation_id: string;
  message_id: string | null;
  original_name: string;
  mime_type: string;
  disk_path: string;
  size_bytes: number;
  created_at: number;
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
