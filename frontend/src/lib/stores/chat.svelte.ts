import { streamChatCompletion } from "../api";
import type { ChatMessage } from "../types";

function makeId() {
  return crypto.randomUUID();
}

class ChatStore {
  messages = $state<ChatMessage[]>([]);
  isStreaming = $state(false);
  selectedModel = $state<string | null>(null);

  private abortController: AbortController | null = null;

  setModel(modelId: string) {
    this.selectedModel = modelId;
  }

  async send(content: string) {
    const trimmed = content.trim();
    if (!trimmed || this.isStreaming) return;

    if (!this.selectedModel) {
      this.messages.push({
        id: makeId(),
        role: "assistant",
        content: "",
        error: "No model selected. Pick a backend + model above first.",
      });
      return;
    }

    const userMessage: ChatMessage = { id: makeId(), role: "user", content: trimmed };
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

    await streamChatCompletion({
      model: this.selectedModel,
      messages: historyForModel,
      signal: this.abortController.signal,
      onToken: (delta) => {
        const msg = this.messages.find((m) => m.id === assistantMessage.id);
        if (msg) msg.content += delta;
      },
      onDone: () => {
        const msg = this.messages.find((m) => m.id === assistantMessage.id);
        if (msg) msg.streaming = false;
        this.isStreaming = false;
      },
      onError: (message) => {
        const msg = this.messages.find((m) => m.id === assistantMessage.id);
        if (msg) { msg.streaming = false; msg.error = message; }
        this.isStreaming = false;
      },
    });
  }

  stop() {
    this.abortController?.abort();
  }

  clear() {
    this.messages = [];
  }
}

export const chatStore = new ChatStore();
