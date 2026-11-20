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
  is_enabled?: number;
  launch_command?: string | null;
  launch_cwd?: string | null;
}

/** A backend after loading from DB with snake_case mapped to camelCase. */
export interface ResolvedBackend {
  id: string;
  name: string;
  baseUrl: string;
  prefix: string;
  apiKey?: string;
  apiType?: "openai" | "ollama" | "lmstudio";
  /** Disabled backends are never contacted and their managed process (if any) is stopped. */
  isEnabled: boolean;
  /** Shell command started with the app and stopped when the backend is disabled. */
  launchCommand: string | null;
  launchCwd: string | null;
}

export type BackendProcessState = "stopped" | "running" | "stopping" | "exited" | "failed";

/** Runtime state of a backend's managed launch command. */
export interface BackendProcessInfo {
  state: BackendProcessState;
  pid: number | null;
  startedAt: number | null;
  exitCode: number | null;
  signal: string | null;
  error: string | null;
}

/** Public shape sent to the frontend -- never includes the API key. */
export interface BackendInfo {
  id: string;
  name: string;
  prefix: string;
  baseUrl: string;
  hasApiKey: boolean;
  status: "online" | "offline" | "unknown" | "disabled";
  apiType: "openai" | "ollama" | "lmstudio";
  isEnabled: boolean;
  launchCommand: string | null;
  launchCwd: string | null;
  /** Null when the backend has no launch command configured. */
  process: BackendProcessInfo | null;
}

/** Body accepted by POST /api/backends and PUT /api/backends/:id */
export interface BackendWriteBody {
  id?: string;   // required on POST, ignored on PUT (taken from URL)
  name: string;
  baseUrl: string;
  prefix: string;
  apiKey?: string;
  apiType?: "openai" | "ollama" | "lmstudio";
  /** undefined keeps the current value; null or "" clears it. */
  launchCommand?: string | null;
  launchCwd?: string | null;
  isEnabled?: boolean;
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

export interface ConversationSummaryOverrides {
  temperature?: number | null;
  maxTokens?: number | null;
  reasoningEffort?: string | null;
}

export interface FolderRow {
  id: string;
  name: string;
  description: string;
  is_expanded: number;
  created_at: number;
  updated_at: number;
}

export interface FolderOut {
  id: string;
  name: string;
  description: string;
  isExpanded: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface ConversationRow {
  id: string;
  title: string;
  model: string | null;
  created_at: number;
  updated_at: number;
  tools_enabled?: number;
  is_pinned?: number;
  is_archived?: number;
  folder?: string | null;
  folder_id?: string | null;
  memory_enabled?: number | null;
  system_prompt_override?: string | null;
  sampling_overrides?: string | null;
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
  isPinned?: boolean;
  isArchived?: boolean;
  folder?: string | null;
  folderId?: string | null;
  memoryEnabled?: boolean | null;
  systemPromptOverride?: string | null;
  samplingOverrides?: ConversationSummaryOverrides | null;
}

/** Full conversation with messages, sent on GET /api/conversations/:id */
export interface ConversationDetail extends ConversationSummary {
  messages: MessageOut[];
  excludedMcps?: string[];
  excludedSkills?: string[];
  scratchpad?: ScratchpadEntryOut[];
}

export interface ScratchpadEntryRow {
  conversation_id: string;
  key: string;
  content: string;
  updated_at: number;
}

export interface ScratchpadEntryOut {
  conversationId: string;
  key: string;
  content: string;
  updatedAt: number;
}

export interface MemoryRow {
  id: string;
  content: string;
  category: string;
  tags: string; // JSON string[]
  source_conversation_id: string | null;
  embedding: Buffer | null;
  is_enabled: number;
  created_at: number;
  updated_at: number;
}

export interface MemoryOut {
  id: string;
  content: string;
  category: string;
  tags: string[];
  sourceConversationId: string | null;
  hasEmbedding: boolean;
  isEnabled: boolean;
  createdAt: number;
  updatedAt: number;
  score?: number;
}

export interface MemoryWriteBody {
  content: string;
  category?: string;
  tags?: string[];
  sourceConversationId?: string | null;
  isEnabled?: boolean;
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
  cacheable?: boolean;
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
  isPinned?: boolean;
  isArchived?: boolean;
  folder?: string | null;
  folderId?: string | null;
  memoryEnabled?: boolean | null;
  systemPromptOverride?: string | null;
  samplingOverrides?: ConversationSummaryOverrides | null;
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
  summary?: string | null;
  keywords?: string | null;
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
  summary?: string | null;
  keywords?: string | null;
  status?: "connected" | "connecting" | "error" | "stopped" | "disabled";
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
  summary?: string | null;
  keywords?: string | null;
}

export interface McpToolOut {
  serverId: string;
  serverName: string;
  name: string;
  description?: string;
}

export interface SlashToolSelection {
  kind: "builtin_tool" | "skill" | "mcp_server" | "mcp_tool";
  id: string;
  name: string;
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
  summary?: string | null;
  keywords?: string | null;
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
  summary?: string | null;
  keywords?: string | null;
}

export interface SkillWriteBody {
  id?: string;
  name: string;
  description: string;
  instructions: string;
  dirPath?: string;
  sourceUrl?: string;
  isEnabled?: boolean;
  summary?: string | null;
  keywords?: string | null;
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
  conversation_id: string | null;
  message_id: string | null;
  original_name: string;
  mime_type: string;
  disk_path: string;
  size_bytes: number;
  created_at: number;
  purpose?: string;
}

export interface AttachmentOut {
  id: string;
  conversationId: string | null;
  messageId: string | null;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: number;
  purpose?: string;
}

export interface ArtifactRow {
  id: string;
  conversation_id: string;
  filename: string;
  language: string;
  title: string;
  disk_path: string;
  size_bytes: number;
  created_at: number;
  updated_at: number;
}

export interface ArtifactOut {
  id: string;
  conversationId: string;
  filename: string;
  language: string;
  title: string;
  sizeBytes: number;
  createdAt: number;
  updatedAt: number;
}

// ---------------------------------------------------------------------------
// Global Settings / User Profile
// ---------------------------------------------------------------------------

export type AutoNameMode = "first_words" | "active_model" | "designated_model";
export type ToolRoutingMode = "off" | "active_model" | "designated_model";
export type CtxOverflowBehavior = "truncate_middle" | "rolling" | "stop";
export type ReasoningInjectionMode = "all" | "latest" | "none";
export type SpeechProviderType = "browser" | "openai_compatible" | "local_cli";
export type SpeechDeviceType = "cpu" | "gpu";

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
  network_tools_enabled?: number;
  artifact_network_enabled?: number;
  disabled_builtin_tools?: string;
  memory_enabled?: number;
  cross_chat_recall_enabled?: number;
  cross_chat_include_archived?: number;
  embedding_model?: string | null;
  stt_provider?: string;
  stt_endpoint?: string | null;
  stt_model?: string | null;
  stt_device?: string;
  tts_provider?: string;
  tts_endpoint?: string | null;
  tts_model?: string | null;
  tts_voice?: string | null;
  tts_device?: string;
  speech_idle_timeout_sec?: number;
  web_enabled?: number;
  web_host?: string;
  web_port?: number;
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
  webEnabled: boolean;
  webHost: string;
  webPort: number;
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
  networkToolsEnabled?: boolean;
  artifactNetworkEnabled?: boolean;
  disabledBuiltInTools?: string[];
  memoryEnabled?: boolean;
  crossChatRecallEnabled?: boolean;
  crossChatIncludeArchived?: boolean;
  embeddingModel?: string | null;
  sttProvider?: SpeechProviderType;
  sttEndpoint?: string | null;
  sttModel?: string | null;
  sttDevice?: SpeechDeviceType;
  ttsProvider?: SpeechProviderType;
  ttsEndpoint?: string | null;
  ttsModel?: string | null;
  ttsVoice?: string | null;
  ttsDevice?: SpeechDeviceType;
  speechIdleTimeoutSec?: number;
  webEnabled?: boolean;
  webHost?: string;
  webPort?: number;
  password?: string;
}
