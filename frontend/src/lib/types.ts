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

export type CtxOverflowBehavior = "truncate_middle" | "rolling" | "stop";
export type ReasoningInjectionMode = "all" | "latest" | "none";
export type ChatRole = "system" | "user" | "assistant" | "tool";

export interface ResponseStats {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  durationMs?: number;
  thinkingTimeMs?: number;
  tokensPerSecond?: number;
  generationMs?: number;
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
  toolCalls?: ToolCallItem[];
  toolCallId?: string | null;
  toolExecutions?: ToolExecutionEvent[];
  status?: string | null;
  routerOutput?: string;
  stats?: ResponseStats;
  model?: string;
}

export interface ConversationSamplingOverrides {
  temperature?: number | null;
  maxTokens?: number | null;
  reasoningEffort?: string | null;
}

export interface ScratchpadEntryInfo {
  conversationId: string;
  key: string;
  content: string;
  updatedAt: number;
}

export interface MemoryInfo {
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

export interface ChatHistorySearchHit {
  conversationId: string;
  conversationTitle: string;
  isArchived: boolean;
  isPinned: boolean;
  messageId: string;
  role: string;
  snippet: string;
  createdAt: number;
  score: number;
}

export interface ArtifactInfo {
  id: string;
  conversationId: string;
  filename: string;
  language: string;
  title: string;
  sizeBytes: number;
  createdAt: number;
  updatedAt: number;
}

export type SpeechProviderType = "browser" | "openai_compatible" | "local_cli";
export type SpeechDeviceType = "cpu" | "gpu";

/** A conversation list item (no messages). */
export interface ConversationSummary {
  id: string;
  title: string;
  model: string | null;
  createdAt: number;
  updatedAt: number;
  toolsEnabled?: boolean;
  isPinned?: boolean;
  isArchived?: boolean;
  memoryEnabled?: boolean | null;
  systemPromptOverride?: string | null;
  samplingOverrides?: ConversationSamplingOverrides | null;
}

/** A full conversation with its messages. */
export interface ConversationDetail extends ConversationSummary {
  messages: MessageOut[];
  excludedMcps?: string[];
  excludedSkills?: string[];
  scratchpad?: ScratchpadEntryInfo[];
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
  toolCalls?: ToolCallItem[];
  toolCallId?: string | null;
  createdAt: number;
  attachments?: AttachmentOut[];
  streaming?: boolean;
}

// ---------------------------------------------------------------------------
// MCP & Skill Types
// ---------------------------------------------------------------------------

export interface McpServerInfo {
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

export interface BuiltInToolInfo {
  name: string;
  description: string;
  category: string;
  requiresNetwork: boolean;
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

export interface SkillInfo {
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

export interface McpToolInfo {
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

export interface SessionFileItem {
  id: string;
  name: string;
  source: "pending" | "attachment" | "artifact";
  subtitle: string;
  mimeType?: string;
}
