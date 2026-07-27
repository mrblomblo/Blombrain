export interface BackendInfo {
  id: string;
  name: string;
  prefix: string;
  baseUrl: string;
  hasApiKey: boolean;
  status: "online" | "offline" | "unknown";
}

export interface ModelInfo {
  /** Prefixed id, e.g. "local:llama-3.1-8b-instruct" -- what the UI/chat API deals in. */
  id: string;
  /** Raw id as reported by the backend itself, e.g. "llama-3.1-8b-instruct". */
  rawId: string;
  backendId: string;
  backendName: string;
}

export type ChatRole = "system" | "user" | "assistant";

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  /** Set while a streaming assistant response is still arriving. */
  streaming?: boolean;
  error?: string;
}
