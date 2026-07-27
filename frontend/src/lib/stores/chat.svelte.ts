import { streamChatCompletion, fetchConversation, createConversation, uploadFile, deleteUpload } from "../api";
import { encodeToWav } from "../audio";
import type { ChatMessage, ConversationSummary, AttachmentOut } from "../types";

function makeId() {
  return crypto.randomUUID();
}

/** Registered by App.svelte once the QueryClientProvider is mounted. */
let _invalidateConversations: (() => void) | null = null;
export function registerConversationsInvalidator(fn: () => void) {
  _invalidateConversations = fn;
}

class ChatStore {
  messages = $state<ChatMessage[]>([]);
  isStreaming = $state(false);
  selectedModel = $state<string | null>(null);

  /** The conversation currently shown in the main pane. null = new, unsaved chat. */
  activeConversationId = $state<string | null>(null);
  /** Title of the active conversation (kept in sync after each save). */
  activeConversationTitle = $state<string>("New conversation");

  pendingAttachments = $state<AttachmentOut[]>([]);

  private abortController: AbortController | null = null;

  setModel(modelId: string) {
    this.selectedModel = modelId;
  }

  async addAttachment(file: File) {
    let fileToUpload = file;
    if (file.type.startsWith("audio/")) {
      fileToUpload = await encodeToWav(file);
    }
    const attachment = await uploadFile(fileToUpload, this.activeConversationId);
    this.pendingAttachments.push(attachment);
  }

  async removeAttachment(id: string) {
    this.pendingAttachments = this.pendingAttachments.filter(a => a.id !== id);
    try {
      await deleteUpload(id);
    } catch (e) {
      console.warn("Failed to delete upload from backend", e);
    }
  }

  /** Load a persisted conversation into the main pane. */
  async loadConversation(summary: ConversationSummary) {
    if (this.isStreaming) return;
    try {
      const detail = await fetchConversation(summary.id);
      this.messages = detail.messages.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        error: m.error,
        attachments: m.attachments,
      }));
      this.activeConversationId = detail.id;
      this.activeConversationTitle = detail.title;
      this.pendingAttachments = [];
      if (detail.model) this.selectedModel = detail.model;
    } catch (err) {
      console.error("[chatStore] failed to load conversation:", err);
    }
  }

  /** Start a fresh, empty chat. */
  newConversation() {
    if (this.isStreaming) return;
    this.messages = [];
    this.activeConversationId = null;
    this.activeConversationTitle = "New conversation";
    this.pendingAttachments = [];
  }

  async send(content: string) {
    const trimmed = content.trim();
    if (!trimmed && this.pendingAttachments.length === 0) return;
    if (this.isStreaming) return;

    if (!this.selectedModel) {
      this.messages.push({
        id: makeId(),
        role: "assistant",
        content: "",
        error: "No model selected. Pick a backend + model above first.",
      });
      return;
    }

    const attachmentIds = this.pendingAttachments.map(a => a.id);
    const userAttachments = [...this.pendingAttachments];
    this.pendingAttachments = [];

    const userMessage: ChatMessage = { 
      id: makeId(), 
      role: "user", 
      content: trimmed,
      attachments: userAttachments.length > 0 ? userAttachments : undefined,
    };
    const assistantMessage: ChatMessage = {
      id: makeId(),
      role: "assistant",
      content: "",
      streaming: true,
    };
    this.messages.push(userMessage, assistantMessage);

    const historyForModel = this.messages
      .filter((m) => m.id !== assistantMessage.id && !m.error)
      .map((m) => ({ role: m.role, content: m.content }));

    this.isStreaming = true;
    this.abortController = new AbortController();

    // Create the conversation on the backend first if it's new, so the sidebar updates immediately.
    if (!this.activeConversationId) {
      try {
        const words = trimmed.split(/\s+/);
        let excerpt = words.slice(0, 8).join(" ");
        if (excerpt.length > 60) excerpt = excerpt.slice(0, 57) + "…";
        if (!excerpt) excerpt = "Attachment"; // fallback if only an attachment was sent
        
        const conv = await createConversation({ title: excerpt, model: this.selectedModel ?? undefined });
        this.activeConversationId = conv.id;
        this.activeConversationTitle = conv.title;
        _invalidateConversations?.();
      } catch (err) {
        console.error("[chatStore] Failed to pre-create conversation:", err);
      }
    }

    await streamChatCompletion({
      model: this.selectedModel,
      messages: historyForModel,
      conversationId: this.activeConversationId,
      attachmentIds,
      signal: this.abortController.signal,

      onToken: (delta) => {
        const msg = this.messages.find((m) => m.id === assistantMessage.id);
        if (msg) msg.content += delta;
      },

      onMeta: (meta) => {
        // Update the in-memory IDs to match what was persisted so the store
        // stays in sync if the user edits messages later.
        const userMsg = this.messages.find((m) => m.id === userMessage.id);
        if (userMsg) userMsg.id = meta.userMessageId;
        const assistantMsg = this.messages.find((m) => m.id === assistantMessage.id);
        if (assistantMsg) assistantMsg.id = meta.assistantMessageId;

        this.activeConversationId = meta.conversationId;
        this.activeConversationTitle = meta.title;

        // Tell TanStack Query the conversations list is stale.
        _invalidateConversations?.();
      },

      onDone: () => {
        const msg = this.messages.find((m) => m.id === assistantMessage.id);
        if (msg) msg.streaming = false;
        this.isStreaming = false;
      },

      onError: (message) => {
        const msg = this.messages.find((m) => m.id === assistantMessage.id);
        if (msg) {
          msg.streaming = false;
          msg.error = message;
        }
        this.isStreaming = false;
      },
    });
  }

  stop() {
    this.abortController?.abort();
  }

  clear() {
    this.messages = [];
    this.activeConversationId = null;
    this.activeConversationTitle = "New conversation";
    this.pendingAttachments = [];
  }
}

export const chatStore = new ChatStore();
