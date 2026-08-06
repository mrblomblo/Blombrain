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
  api_type: "openai" | "ollama" | "lmstudio";
}

/** A backend after loading from DB with snake_case mapped to camelCase. */
export interface ResolvedBackend {
  id: string;
  name: string;
  baseUrl: string;
  prefix: string;
  apiKey?: string;
  apiType?: "openai" | "ollama" | "lmstudio";
}

/** Public shape sent to the frontend -- never includes the API key. */
export interface BackendInfo {
  id: string;
  name: string;
  prefix: string;
  baseUrl: string;
  hasApiKey: boolean;
  status: "online" | "offline" | "unknown";
  apiType: "openai" | "ollama" | "lmstudio";
}

/** Body accepted by POST /api/backends and PUT /api/backends/:id */
export interface BackendWriteBody {
  id?: string;   // required on POST, ignored on PUT (taken from URL)
  name: string;
  baseUrl: string;
  prefix: string;
  apiKey?: string;
  apiType?: "openai" | "ollama" | "lmstudio";
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
  maxTokens?: number;
  topK?: number;
  topP?: number;
  minP?: number;
  presencePenalty?: number;
  frequencyPenalty?: number;
  repeatPenalty?: number;
  ctxLength?: number;
  ctxOverflowBehavior?: CtxOverflowBehavior | null;
  effectiveCtxOverflowBehavior?: CtxOverflowBehavior;
  reasoningInjectionMode?: ReasoningInjectionMode | null;
  effectiveReasoningInjectionMode?: ReasoningInjectionMode;
  isHidden?: boolean;
  isOffline?: boolean;
  sortOrder?: number;
  isDefault?: boolean;
  isOrphaned?: boolean;
}

export interface CachedModelRow {
  id: string;
  backend_id: string;
  raw_id: string;
  is_online: number;
  last_synced: number;
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
  tools_enabled?: number;
}

export interface MessageRow {
  id: string;
  conversation_id: string;
  parent_id: string | null;
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  error: string | null;
  stats: string | null;
  model: string | null;
  tool_calls: string | null;
  tool_call_id: string | null;
  created_at: number;
}

/** Summary sent in list responses (no messages). */
export interface ConversationSummary {
  id: string;
  title: string;
  model: string | null;
  createdAt: number;
  updatedAt: number;
  toolsEnabled?: boolean;
}

/** Full conversation with messages, sent on GET /api/conversations/:id */
export interface ConversationDetail extends ConversationSummary {
  messages: MessageOut[];
  excludedMcps?: string[];
  excludedSkills?: string[];
}

export interface ToolCallItem {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

export interface ToolExecutionEvent {
  callId: string;
  toolName: string;
  args: Record<string, any>;
  result?: string;
  error?: string;
  status: "executing" | "completed" | "error" | "polling" | "cancelled";
  progress?: number;
  total?: number;
  message?: string;
  jobId?: string;
  elapsedMs?: number;
  attempts?: number;
}

/** Message shape sent to the frontend. */
export interface MessageOut {
  id: string;
  conversationId: string;
  parentId: string | null;
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  error: string | null;
  stats?: any;
  model?: string;
  toolCalls?: ToolCallItem[];
  toolCallId?: string | null;
  createdAt: number;
  attachments?: AttachmentOut[];
  streaming?: boolean;
}

/** Body accepted by PATCH /api/conversations/:id */
export interface ConversationPatchBody {
  title?: string;
  model?: string;
  excludedMcps?: string[];
  excludedSkills?: string[];
  toolsEnabled?: boolean;
}

// ---------------------------------------------------------------------------
// MCP & Skill types
// ---------------------------------------------------------------------------

export interface McpServerRow {
  id: string;
  name: string;
  type: "stdio" | "http";
  command_or_url: string;
  args: string; // JSON array
  env: string;  // JSON object
  headers: string; // JSON object
  is_enabled: number;
}

export interface McpServerOut {
  id: string;
  name: string;
  type: "stdio" | "http";
  commandOrUrl: string;
  args: string[];
  env: Record<string, string>;
  headers: Record<string, string>;
  isEnabled: boolean;
  status?: "connected" | "connecting" | "error" | "stopped";
  error?: string;
}

export interface McpServerWriteBody {
  id?: string;
  name: string;
  type: "stdio" | "http";
  commandOrUrl: string;
  args?: string[];
  env?: Record<string, string>;
  headers?: Record<string, string>;
  isEnabled?: boolean;
}

export interface SkillRow {
  id: string;
  name: string;
  description: string;
  instructions: string;
  dir_path: string | null;
  source_url: string | null;
  content_hash: string;
  is_enabled: number;
  created_at: number;
}

export interface SkillOut {
  id: string;
  name: string;
  description: string;
  instructions: string;
  dirPath: string | null;
  sourceUrl: string | null;
  contentHash: string;
  isEnabled: boolean;
  createdAt: number;
}

export interface SkillWriteBody {
  id?: string;
  name: string;
  description: string;
  instructions: string;
  dirPath?: string;
  sourceUrl?: string;
  isEnabled?: boolean;
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
  max_tokens: number | null;
  top_k: number | null;
  top_p: number | null;
  min_p: number | null;
  presence_penalty: number | null;
  frequency_penalty: number | null;
  repeat_penalty: number | null;
  ctx_length: number | null;
  ctx_overflow_behavior: string | null;
  reasoning_injection_mode: string | null;
  is_hidden: number;
  sort_order: number;
  is_default: number;
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
  ctxOverflowBehavior?: CtxOverflowBehavior | null;
  reasoningInjectionMode?: ReasoningInjectionMode | null;
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

// ---------------------------------------------------------------------------
// Global Settings / User Profile
// ---------------------------------------------------------------------------

export type AutoNameMode = "first_words" | "active_model" | "designated_model";
export type ToolRoutingMode = "off" | "active_model" | "designated_model";
export type CtxOverflowBehavior = "truncate_middle" | "rolling" | "stop";
export type ReasoningInjectionMode = "all" | "latest" | "none";

export interface GlobalSettingsRow {
  id: string;
  user_name: string;
  user_avatar: string | null;
  theme: string;
  auto_name_mode: string;
  auto_name_model: string | null;
  tool_routing_mode: string;
  tool_routing_model: string | null;
  ctx_overflow_behavior: string;
  reasoning_injection_mode: string;
}

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
}

export interface GlobalSettingsWriteBody {
  userName?: string;
  userAvatar?: string | null;
  theme?: string;
  autoNameMode?: AutoNameMode;
  autoNameModel?: string | null;
  toolRoutingMode?: ToolRoutingMode;
  toolRoutingModel?: string | null;
  ctxOverflowBehavior?: CtxOverflowBehavior;
  reasoningInjectionMode?: ReasoningInjectionMode;
  password?: string;
}
