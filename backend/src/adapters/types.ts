import type { ResolvedBackend } from "../types.js";

/** A single function/tool call the assistant asked to invoke. */
export interface ToolCall {
  function: {
    name: string;
    description?: string;
    arguments?: Record<string, any>;
  };
  /** Result returned from the tool, when the backend reports it alongside the call (e.g. LM Studio native API). */
  output?: string;
  /** Info about which plugin/MCP server served this tool call, when the backend reports it (e.g. LM Studio native API). */
  providerInfo?: {
    type: "plugin" | "ephemeral_mcp";
    pluginId?: string;
    serverLabel?: string;
  };
}

/** Log-probability info for one alternative token at a position. */
export interface TokenLogprob {
  token: string;
  logprob: number;
  bytes?: number[];
}

/** Log-probability info for a single generated token. */
export interface Logprob {
  token: string;
  logprob: number;
  bytes?: number[];
  topLogprobs?: TokenLogprob[];
}

export interface StreamUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  /** Tokens spent on reasoning/thinking content, when the backend reports it separately (e.g. LM Studio native API). */
  reasoningTokens?: number;
  /** Generation speed in tokens/sec, when the backend reports it (e.g. LM Studio native API). */
  tokensPerSecond?: number;
  /** Time to first token, in seconds, when the backend reports it (e.g. LM Studio native API). */
  timeToFirstTokenSeconds?: number;
  /** Time spent loading the model for this request, in seconds, when the backend reports it (e.g. LM Studio native API, only present if the model wasn't already loaded). */
  modelLoadTimeSeconds?: number;
  /** Wall-clock timings some backends report, in nanoseconds (e.g. Ollama). */
  totalDurationNs?: number;
  loadDurationNs?: number;
  promptEvalDurationNs?: number;
  evalDurationNs?: number;
}

export interface StreamEvent {
  delta?: string;
  reasoning?: string;
  error?: string;
  usage?: StreamUsage;
  isDone?: boolean;
  /** Function/tool calls requested by the assistant, if any. Not all backends support this. */
  toolCalls?: ToolCall[];
  /** Base64-encoded images returned by multimodal models, if any. */
  images?: string[];
  /** Why generation stopped (e.g. "stop", "length"), when the backend reports it. */
  doneReason?: string;
  /** Per-token log-probability info, when requested and supported by the backend. */
  logprobs?: Logprob[];
  /** Message role for this chunk (usually "assistant"), when the backend reports it per-chunk. */
  role?: string;
  /** Model name that generated this chunk, when the backend reports it per-chunk. */
  model?: string;
  /** ISO-8601 timestamp of this chunk, when the backend reports it per-chunk. */
  createdAt?: string;
  /** Unique identifier for the completion this chunk belongs to, when the backend reports it (e.g. OpenAI's per-chunk `id`, shared across all chunks of one completion). */
  id?: string;
}

/** A previously-installed plugin (e.g. an MCP server bundled via `mcp.json`) referenced by id. */
export interface PluginIntegration {
  type: "plugin";
  /** Unique identifier of the plugin, e.g. "mcp/playwright". */
  id: string;
  /** Restrict which tools from the plugin the model may call. If omitted, all tools are allowed. */
  allowed_tools?: string[];
}

/** An MCP server defined inline for this request only, without needing to pre-configure it in `mcp.json`. */
export interface EphemeralMcpIntegration {
  type: "ephemeral_mcp";
  /** Label to identify the MCP server. */
  server_label: string;
  /** URL of the MCP server. */
  server_url: string;
  /** Restrict which tools from the server the model may call. If omitted, all tools are allowed. */
  allowed_tools?: string[];
  /** Custom HTTP headers to send with requests to the server. */
  headers?: Record<string, string>;
}

/**
 * An integration entry for LM Studio's native API `integrations` field.
 * A bare string is shorthand for `{ type: "plugin", id: <string> }`.
 */
export type Integration = string | PluginIntegration | EphemeralMcpIntegration;

export interface BuildRequestParams {
  backend: ResolvedBackend;
  modelId: string;
  messages: any[];
  extraParams: Record<string, any>;
  temperature?: number;
  onConfigFix?: (fixes: Record<string, any>) => void;
}

export interface RequestConfig {
  url: string;
  init: RequestInit;
}

export interface ApiAdapter {
  id: string;        // Unique key stored in SQLite (e.g. "openai", "ollama")
  name: string;      // Full display name (e.g. "OpenAI Compatible")
  badgeLabel: string;// Short badge name (e.g. "OpenAI", "Ollama")

  buildRequest(params: BuildRequestParams): RequestConfig | Promise<RequestConfig>;

  /**
   * Returns a stateful parser function that consumes raw incoming stream chunks
   * (string or Buffer) and returns zero or more parsed StreamEvents.
   */
  createStreamParser(params?: BuildRequestParams): (chunk: Buffer | string) => StreamEvent[];
}
