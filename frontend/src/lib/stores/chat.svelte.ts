import {
  streamChatCompletion,
  fetchConversation,
  createConversation,
  uploadFile,
  deleteUpload,
  patchMessage,
  deleteMessage as apiDeleteMessage,
  branchMessage as apiBranchMessage,
} from "../api";
import { encodeToWav } from "../audio";
import type { ChatMessage, ConversationSummary, AttachmentOut, ResponseStats } from "../types";

function makeId() {
  return crypto.randomUUID();
}

/**
 * Parse <think>...</think> from stored assistant content.
 * Returns { content, thinkingContent, thinkingDone } so loaded messages
 * display the ThinkingBlock the same as streamed ones.
 */
function parseThinking(raw: string): { content: string; thinkingContent?: string; thinkingDone?: boolean } {
  const start = raw.indexOf("<think>");
  if (start === -1) return { content: raw };
  const end = raw.indexOf("</think>", start);
  if (end === -1) {
    // Unterminated think block (e.g. response was cut off)
    return {
      content: "",
      thinkingContent: raw.slice(start + 7).trim(),
      thinkingDone: false,
    };
  }
  return {
    content: raw.slice(end + 8).trimStart(),
    thinkingContent: raw.slice(start + 7, end).trim(),
    thinkingDone: true,
  };
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
  selectedAttachment = $state<AttachmentOut | null>(null);

  /** Maps parentId ("ROOT" for root messages) to the selected child message ID */
  branchSelections = $state<Record<string, string>>({});

  private abortController: AbortController | null = null;

  private loadBranchSelections(convId: string) {
    try {
      const stored = localStorage.getItem(`blombrain_branches_${convId}`);
      if (stored) {
        this.branchSelections = JSON.parse(stored);
        return;
      }
    } catch (e) { }
    this.branchSelections = {};
  }

  private saveBranchSelections() {
    if (!this.activeConversationId) return;
    try {
      localStorage.setItem(
        `blombrain_branches_${this.activeConversationId}`,
        JSON.stringify(this.branchSelections)
      );
    } catch (e) { }
  }

  setBranchSelection(parentId: string | null, childId: string) {
    const pKey = parentId ?? "ROOT";
    this.branchSelections = {
      ...this.branchSelections,
      [pKey]: childId,
    };
    this.saveBranchSelections();
  }

  /**
   * Returns the list of messages forming the active conversation path
   * by walking from root to leaf according to branchSelections.
   */
  get activePath(): ChatMessage[] {
    if (this.messages.length === 0) return [];

    const result: ChatMessage[] = [];
    let currentParent: string | null = null;

    // Safety limit to avoid infinite loops if the conversation tree is malformed
    let safetyCounter = 0;
    while (safetyCounter < 1000) {
      safetyCounter++;
      // Find all children of currentParent
      const children = this.messages.filter((m) => (m.parentId ?? null) === currentParent);
      if (children.length === 0) break;

      const pKey: string = currentParent ?? "ROOT";
      const selectedId: string | undefined = this.branchSelections[pKey];
      // Pick selected child or fallback to most recent (highest createdAt / last in array)
      let selectedChild: ChatMessage | undefined = children.find((c) => c.id === selectedId);
      if (!selectedChild) {
        selectedChild = children[children.length - 1];
      }

      result.push(selectedChild);
      currentParent = selectedChild.id;
    }

    return result;
  }

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
    this.pendingAttachments = this.pendingAttachments.filter((a) => a.id !== id);
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
      this.messages = detail.messages.map((m) => {
        if (m.role === "assistant" && m.content) {
          const parsed = parseThinking(m.content);
          return {
            id: m.id,
            parentId: m.parentId ?? null,
            role: m.role,
            content: parsed.content,
            thinkingContent: parsed.thinkingContent,
            thinkingDone: parsed.thinkingDone,
            thinkingTimeMs: m.stats?.thinkingTimeMs,
            stats: m.stats,
            model: m.model,
            error: m.error,
            createdAt: m.createdAt,
            attachments: m.attachments,
          };
        }
        return {
          id: m.id,
          parentId: m.parentId ?? null,
          role: m.role,
          content: m.content,
          error: m.error,
          model: m.model,
          createdAt: m.createdAt,
          attachments: m.attachments,
        };
      });
      this.activeConversationId = detail.id;
      this.activeConversationTitle = detail.title;
      this.pendingAttachments = [];
      if (detail.model) this.selectedModel = detail.model;
      this.loadBranchSelections(detail.id);
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
    this.branchSelections = {};
    this.selectedModel = null;
  }

  /** Edit a message content in place (Save option) */
  async editMessage(msgId: string, newContent: string) {
    if (!this.activeConversationId) return;
    const msg = this.messages.find((m) => m.id === msgId);
    if (!msg) return;

    msg.content = newContent;
    const contentToSave = msg.thinkingContent
      ? `<think>\n${msg.thinkingContent}\n</think>\n${newContent}`
      : newContent;

    try {
      await patchMessage(this.activeConversationId, msgId, contentToSave);
    } catch (err) {
      console.error("[chatStore] failed to edit message:", err);
    }
  }

  /** Delete a message and reconnect the remaining conversation. */
  async deleteMessage(msgId: string) {
    if (!this.activeConversationId) return;
    const target = this.messages.find((m) => m.id === msgId);
    if (!target) return;

    try {
      await apiDeleteMessage(this.activeConversationId, msgId);

      if (target.role === "user") {
        // Find only the *direct* assistant child of this user message.
        const childAsst = this.messages.find(
          (m) => m.role === "assistant" && m.parentId === msgId
        );
        const idsToDelete = new Set([msgId, ...(childAsst ? [childAsst.id] : [])]);

        // Re-parent any messages that pointed to the deleted assistant so the
        // deeper conversation thread stays connected after the deletion.
        if (childAsst) {
          this.messages = this.messages.map((m) =>
            m.parentId === childAsst.id ? { ...m, parentId: target.parentId ?? null } : m
          );
        } else {
          // If no assistant response existed, reparent the user message's direct children
          this.messages = this.messages.map((m) =>
            m.parentId === msgId ? { ...m, parentId: target.parentId ?? null } : m
          );
        }

        this.messages = this.messages.filter((m) => !idsToDelete.has(m.id));
      } else {
        // Assistant message: Delete this message and ALL its descendants
        const toDelete = new Set<string>([msgId]);
        const queue = [msgId];
        while (queue.length > 0) {
          const parentId = queue.shift()!;
          for (const m of this.messages) {
            if (m.parentId === parentId && !toDelete.has(m.id)) {
              toDelete.add(m.id);
              queue.push(m.id);
            }
          }
        }
        this.messages = this.messages.filter((m) => !toDelete.has(m.id));
      }

      _invalidateConversations?.();
    } catch (err) {
      console.error("[chatStore] failed to delete message:", err);
    }
  }

  /** Send an edited user message by creating a branch */
  async sendEditedBranch(userMsgId: string, newContent: string) {
    if (this.isStreaming || !this.activeConversationId) return;
    const targetUserMsg = this.messages.find((m) => m.id === userMsgId);
    if (!targetUserMsg) return;

    try {
      const newBranchUserMsg = await apiBranchMessage(this.activeConversationId, userMsgId, newContent);
      const newMsgObj: ChatMessage = {
        id: newBranchUserMsg.id,
        parentId: newBranchUserMsg.parentId,
        role: "user",
        content: newBranchUserMsg.content,
        createdAt: newBranchUserMsg.createdAt,
      };
      this.messages.push(newMsgObj);
      this.setBranchSelection(newBranchUserMsg.parentId, newBranchUserMsg.id);

      await this.triggerAssistantResponse(newBranchUserMsg);
    } catch (err) {
      console.error("[chatStore] failed to branch message:", err);
    }
  }

  /** Regenerate an assistant response */
  async regenerate(assistantMsgId: string) {
    if (this.isStreaming || !this.activeConversationId) return;
    const asstMsg = this.messages.find((m) => m.id === assistantMsgId);
    if (!asstMsg || asstMsg.role !== "assistant") return;

    const userParentMsg = this.messages.find((m) => m.id === asstMsg.parentId);
    if (!userParentMsg) return;

    const attachmentIds = userParentMsg.attachments?.map((a) => a.id);
    await this.triggerAssistantResponse(userParentMsg, attachmentIds);
  }

  /** Continue response */
  async continueResponse() {
    if (this.isStreaming) return;
    await this.send("Continue");
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

    const attachmentIds = this.pendingAttachments.map((a) => a.id);
    const userAttachments = [...this.pendingAttachments];
    this.pendingAttachments = [];

    // Find current active leaf to set as parentId for the new user message
    const currentActivePath = this.activePath;
    const lastActiveMsg = currentActivePath.length > 0 ? currentActivePath[currentActivePath.length - 1] : undefined;
    const parentId = lastActiveMsg ? lastActiveMsg.id : null;

    const userMessageId = makeId();
    const userMessage: ChatMessage = {
      id: userMessageId,
      parentId,
      role: "user",
      content: trimmed,
      createdAt: Date.now(),
      attachments: userAttachments.length > 0 ? userAttachments : undefined,
    };

    this.messages.push(userMessage);
    this.setBranchSelection(parentId, userMessageId);

    // Create conversation on backend first if needed
    if (!this.activeConversationId) {
      try {
        const words = trimmed.split(/\s+/);
        let excerpt = words.slice(0, 8).join(" ");
        if (excerpt.length > 60) excerpt = excerpt.slice(0, 57) + "…";
        if (!excerpt) excerpt = "Attachment";

        const conv = await createConversation({ title: excerpt, model: this.selectedModel ?? undefined });
        this.activeConversationId = conv.id;
        this.activeConversationTitle = conv.title;
        _invalidateConversations?.();
      } catch (err) {
        console.error("[chatStore] Failed to pre-create conversation:", err);
      }
    }

    await this.triggerAssistantResponse(userMessage, attachmentIds);
  }

  private async triggerAssistantResponse(userMsg: { id: string; content: string; role: string; parentId?: string | null; createdAt?: number; attachments?: AttachmentOut[] }, attachmentIds?: string[]) {
    if (!this.selectedModel) return;

    let currentUserId: string = userMsg.id;
    let currentAsstId: string = makeId();

    const assistantMessage: ChatMessage = {
      id: currentAsstId,
      parentId: currentUserId,
      role: "assistant",
      content: "",
      createdAt: Date.now(),
      streaming: true,
      thinkingContent: undefined,
      thinkingDone: false,
      thinkingTimeMs: undefined,
      stats: undefined,
      model: this.selectedModel,
    };
    this.messages.push(assistantMessage);
    this.setBranchSelection(currentUserId, currentAsstId);

    // Build model history along active path leading to userMsg
    const activePath = this.activePath;
    const historyForModel = activePath
      .filter((m) => m.id !== currentAsstId && !m.error)
      .map((m) => ({ role: m.role, content: m.content }));

    this.isStreaming = true;
    this.abortController = new AbortController();

    let rawBuffer = "";
    let insideThink = false;
    let thinkingStartMs = 0;

    await streamChatCompletion({
      model: this.selectedModel,
      messages: historyForModel,
      conversationId: this.activeConversationId,
      userMessageId: currentUserId,
      userParentId: userMsg.parentId ?? null,
      assistantMessageId: currentAsstId,
      attachmentIds,
      signal: this.abortController.signal,

      onToken: (delta) => {
        const msg = this.messages.find((m) => m.id === currentAsstId);
        if (!msg) return;

        rawBuffer += delta;

        // Parsing <think>...</think> tags dynamically
        if (!insideThink && rawBuffer.includes("<think>")) {
          insideThink = true;
          thinkingStartMs = Date.now();
        }

        if (insideThink) {
          if (rawBuffer.includes("</think>")) {
            insideThink = false;
            const endIdx = rawBuffer.indexOf("</think>");
            const thinkStr = rawBuffer.slice(rawBuffer.indexOf("<think>") + 7, endIdx);
            const mainStr = rawBuffer.slice(endIdx + 8).trimStart();

            if (thinkingStartMs > 0 && !msg.thinkingTimeMs) {
              msg.thinkingTimeMs = Date.now() - thinkingStartMs;
            }

            msg.thinkingContent = thinkStr.trim();
            msg.thinkingDone = true;
            msg.content = mainStr;
          } else {
            const thinkStr = rawBuffer.slice(rawBuffer.indexOf("<think>") + 7);
            msg.thinkingContent = thinkStr;
            msg.thinkingDone = false;
            msg.content = "";
          }
        } else {
          msg.content = rawBuffer;
        }
      },

      onMeta: (meta) => {
        // Update user message ID in reactive state array if it changed
        const uMsg = this.messages.find((m) => m.id === currentUserId);
        if (uMsg && uMsg.id !== meta.userMessageId) {
          const oldUserId = currentUserId;
          uMsg.id = meta.userMessageId;
          currentUserId = meta.userMessageId;

          // Re-map branch selections for user ID change
          if (this.branchSelections[oldUserId] !== undefined) {
            const val = this.branchSelections[oldUserId];
            const updated = { ...this.branchSelections, [meta.userMessageId]: val };
            delete updated[oldUserId];
            this.branchSelections = updated;
          }
          // Update parentId references on children (e.g. assistant)
          for (const m of this.messages) {
            if ((m.parentId ?? null) === oldUserId) {
              m.parentId = meta.userMessageId;
            }
          }
        }

        // Update assistant message ID in reactive state array if it changed
        const aMsg = this.messages.find((m) => m.id === currentAsstId);
        if (aMsg) {
          const oldAsstId = currentAsstId;
          if (aMsg.id !== meta.assistantMessageId) {
            aMsg.id = meta.assistantMessageId;
            currentAsstId = meta.assistantMessageId;

            const pKey = aMsg.parentId ?? "ROOT";
            if (this.branchSelections[pKey] === oldAsstId) {
              this.branchSelections = {
                ...this.branchSelections,
                [pKey]: meta.assistantMessageId,
              };
            }
          }
          if (meta.stats) aMsg.stats = meta.stats;
        }

        this.activeConversationId = meta.conversationId;
        this.activeConversationTitle = meta.title;
        this.saveBranchSelections();
        _invalidateConversations?.();
      },

      onDone: () => {
        const msg = this.messages.find((m) => m.id === currentAsstId);
        if (msg) {
          msg.streaming = false;
          if (msg.thinkingContent && !msg.thinkingDone) {
            msg.thinkingDone = true;
          }
        }
        this.isStreaming = false;
      },

      onError: (message) => {
        const msg = this.messages.find((m) => m.id === currentAsstId);
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
    this.branchSelections = {};
  }
}

export const chatStore = new ChatStore();
