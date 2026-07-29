import type { ResolvedBackend } from "../types.js";

export interface StreamUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

export interface StreamEvent {
  delta?: string;
  reasoning?: string;
  error?: string;
  usage?: StreamUsage;
  isDone?: boolean;
}

export interface BuildRequestParams {
  backend: ResolvedBackend;
  modelId: string;
  messages: any[];
  extraParams: Record<string, any>;
  temperature?: number;
}

export interface RequestConfig {
  url: string;
  init: RequestInit;
}

export interface ApiAdapter {
  id: string;        // Unique key stored in SQLite (e.g. "openai", "ollama")
  name: string;      // Full display name (e.g. "OpenAI Compatible")
  badgeLabel: string;// Short badge name (e.g. "OpenAI", "Ollama")

  buildRequest(params: BuildRequestParams): RequestConfig;

  /**
   * Returns a stateful parser function that consumes raw incoming stream chunks
   * (string or Buffer) and returns zero or more parsed StreamEvents.
   */
  createStreamParser(): (chunk: Buffer | string) => StreamEvent[];
}
