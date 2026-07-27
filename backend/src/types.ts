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
  role: "system" | "user" | "assistant";
  content: string;
  error: string | null;
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
  role: "system" | "user" | "assistant";
  content: string;
  error: string | null;
  createdAt: number;
  attachments?: AttachmentOut[];
}

/** Body accepted by PATCH /api/conversations/:id */
export interface ConversationPatchBody {
  title?: string;
  model?: string;
}

// ---------------------------------------------------------------------------
// Model Config & Multimodal attachments
// ---------------------------------------------------------------------------

export interface ModelConfigRow {
  model_id: string;
  can_image: number;
  can_audio: number;
  can_video: number;
}

export interface ModelCapabilities {
  canImage: boolean;
  canAudio: boolean;
  canVideo: boolean;
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
