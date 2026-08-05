import {
  streamChatCompletion,
  fetchConversation,
  createConversation,
  uploadFile,
  deleteUpload,
  patchMessage,
  deleteMessage as apiDeleteMessage,
  deleteConversation,
  branchMessage as apiBranchMessage,
  autoNameConversation,
  stopChatCompletion,
  patchConversationTools,
} from "../api";
import { encodeToWav } from "../audio";
import type { ChatMessage, ConversationSummary, AttachmentOut, ResponseStats } from "../types";
import { artifactStore } from "./artifact.svelte";
import { settingsStore } from "./settings.svelte";

function makeId() {
  return crypto.randomUUID();
}

/**
 * Parse <think>...</think> from stored assistant content.
 * Returns { content, thinkingContent, thinkingDone } so loaded messages
 * display the ThinkingBlock the same as streamed ones.
 */
function parseThinking(raw: string): { content: string; thinkingContent?: string; thinkingDone?: boolean } {
  if (!raw.includes("<think>")) return { content: raw };

  const thinkBlocks: string[] = [];
  const contentParts: string[] = [];
  let currentlyThinking = false;
  let currentThinkStart = -1;
  let pos = 0;

  while (pos < raw.length) {
    if (!currentlyThinking) {
      const startTag = raw.indexOf("<think>", pos);
      if (startTag === -1) {
        contentParts.push(raw.slice(pos));
        break;
      } else {
        contentParts.push(raw.slice(pos, startTag));
        currentlyThinking = true;
        currentThinkStart = startTag + 7;
        pos = currentThinkStart;
      }
    } else {
      const endTag = raw.indexOf("</think>", pos);
      if (endTag === -1) {
        thinkBlocks.push(raw.slice(currentThinkStart));
        pos = raw.length;
        break;
      } else {
        thinkBlocks.push(raw.slice(currentThinkStart, endTag));
        currentlyThinking = false;
        pos = endTag + 8;
      }
    }
  }

  const thinkingContent = thinkBlocks.length > 0 ? thinkBlocks.join("\n\n---\n\n").trim() : undefined;
  const content = contentParts.join("").trimStart();
  return {
    content,
    thinkingContent,
    thinkingDone: !currentlyThinking,
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

  /** MCP server IDs currently excluded for this conversation. */
  conversationExcludedMcps = $state<string[]>([]);
  /** Skill IDs currently excluded for this conversation. */
  conversationExcludedSkills = $state<string[]>([]);
  /** Whether tool/skill injection is enabled for this conversation. */
  conversationToolsEnabled = $state<boolean>(true);

  /** Maps parentId ("ROOT" for root messages) to the selected child message ID */
  branchSelections = $state<Record<string, string>>({});

  private abortController: AbortController | null = null;
  private streamingConvId: string | null = null;
  private streamingAssistantId: string | null = null;
  private autoNameController: AbortController | null = null;

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
        JSON.stringify(this.branchSelections),
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
            content: m.content,
            thinkingContent: parsed.thinkingContent,
            thinkingDone: parsed.thinkingDone,
            thinkingTimeMs: m.stats?.thinkingTimeMs,
            stats: m.stats,
            model: m.model,
            error: m.error,
            createdAt: m.createdAt,
            attachments: m.attachments,
            streaming: m.streaming,
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
          streaming: m.streaming,
        };
      });

      this.activeConversationId = detail.id;
      this.activeConversationTitle = detail.title;
      this.pendingAttachments = [];
      this.conversationExcludedMcps = detail.excludedMcps ?? [];
      this.conversationExcludedSkills = detail.excludedSkills ?? [];
      this.conversationToolsEnabled = detail.toolsEnabled !== undefined ? detail.toolsEnabled : true;
      if (detail.model) this.selectedModel = detail.model;
      this.loadBranchSelections(detail.id);
      artifactStore.close();

      // Check if this conversation is actively generating on the backend
      const lastMsg = this.messages.length > 0 ? this.messages[this.messages.length - 1] : undefined;
      const isGenerating =
        (detail as any).isGenerating ||
        (lastMsg?.role === "assistant" && (lastMsg as any).streaming === true);

      if (isGenerating && lastMsg && lastMsg.role === "assistant") {
        await this.reconnectAssistantResponse(lastMsg);
      }
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
    this.conversationExcludedMcps = [];
    this.conversationExcludedSkills = [];
    this.conversationToolsEnabled = true;
    this.streamingConvId = null;
    this.streamingAssistantId = null;
    artifactStore.close();
  }

  /**
   * Toggle tool & skill injection on/off for this conversation.
   * Preserves specific MCP and skill exclusions when toggled.
   */
  async toggleToolsEnabled() {
    this.conversationToolsEnabled = !this.conversationToolsEnabled;
    if (this.activeConversationId) {
      try {
        await patchConversationTools(this.activeConversationId, { toolsEnabled: this.conversationToolsEnabled });
      } catch (err) {
        console.warn("[chatStore] failed to persist toolsEnabled:", err);
      }
    }
  }

  /**
   * Toggle a specific MCP server ID in/out of the per-conversation exclusion list.
   * Persists immediately if a conversation exists.
   */
  async toggleExcludedMcp(mcpId: string) {
    const next = this.conversationExcludedMcps.includes(mcpId)
      ? this.conversationExcludedMcps.filter((id) => id !== mcpId)
      : [...this.conversationExcludedMcps, mcpId];
    this.conversationExcludedMcps = next;
    if (this.activeConversationId) {
      try {
        await patchConversationTools(this.activeConversationId, { excludedMcps: next });
      } catch (err) {
        console.warn("[chatStore] failed to persist excludedMcps:", err);
      }
    }
  }

  /**
   * Toggle a specific skill ID in/out of the per-conversation exclusion list.
   * Persists immediately if a conversation exists.
   */
  async toggleExcludedSkill(skillId: string) {
    const next = this.conversationExcludedSkills.includes(skillId)
      ? this.conversationExcludedSkills.filter((id) => id !== skillId)
      : [...this.conversationExcludedSkills, skillId];
    this.conversationExcludedSkills = next;
    if (this.activeConversationId) {
      try {
        await patchConversationTools(this.activeConversationId, { excludedSkills: next });
      } catch (err) {
        console.warn("[chatStore] failed to persist excludedSkills:", err);
      }
    }
  }

  /** Edit a message content in place (Save option) */
  async editMessage(msgId: string, newContent: string, attachmentIds?: string[]) {
    if (!this.activeConversationId) return;
    const msg = this.messages.find((m) => m.id === msgId);
    if (!msg) return;

    msg.content = newContent;
    const contentToSave = msg.thinkingContent
      ? `<think>\n${msg.thinkingContent}\n</think>\n${newContent}`
      : newContent;

    try {
      const updated = await patchMessage(this.activeConversationId, msgId, contentToSave, attachmentIds);
      msg.attachments = updated.attachments;
      artifactStore.close();
    } catch (err) {
      console.error("[chatStore] failed to edit message:", err);
    }
  }

  /** Delete a message and reconnect the remaining conversation. */
  async deleteMessage(msgId: string) {
    if (!this.activeConversationId) return;
    const convId = this.activeConversationId;
    const target = this.messages.find((m) => m.id === msgId);
    if (!target) return;

    try {
      await apiDeleteMessage(convId, msgId);
    } catch (err) {
      console.warn("[chatStore] backend delete message call failed, removing locally anyway:", err);
    }

    try {
      const deletedIds = new Set<string>([msgId]);
      const queue = [msgId];
      while (queue.length > 0) {
        const parentId = queue.shift()!;
        for (const m of this.messages) {
          if (m.parentId === parentId && !deletedIds.has(m.id)) {
            deletedIds.add(m.id);
            queue.push(m.id);
          }
        }
      }
      this.messages = this.messages.filter((m) => !deletedIds.has(m.id));

      // Clean up branch selections pointing at deleted messages
      const updatedSelections: Record<string, string> = {};
      for (const [pKey, childId] of Object.entries(this.branchSelections)) {
        if (!deletedIds.has(childId)) {
          updatedSelections[pKey] = childId;
        }
      }
      this.branchSelections = updatedSelections;
      this.saveBranchSelections();

      if (this.messages.length === 0) {
        try {
          await deleteConversation(convId);
        } catch (e) {
          // Ignore if already deleted by backend
        }
        this.newConversation();
      }

      artifactStore.close();
      _invalidateConversations?.();
    } catch (err) {
      console.error("[chatStore] failed to process local message deletion:", err);
    }
  }

  /** Send an edited user message by creating a branch */
  async sendEditedBranch(userMsgId: string, newContent: string, attachmentIds?: string[]) {
    if (this.isStreaming || !this.activeConversationId) return;
    const targetUserMsg = this.messages.find((m) => m.id === userMsgId);
    if (!targetUserMsg) return;

    try {
      const newBranchUserMsg = await apiBranchMessage(this.activeConversationId, userMsgId, newContent, attachmentIds);
      const newMsgObj: ChatMessage = {
        id: newBranchUserMsg.id,
        parentId: newBranchUserMsg.parentId,
        role: "user",
        content: newBranchUserMsg.content,
        createdAt: newBranchUserMsg.createdAt,
        attachments: newBranchUserMsg.attachments,
      };
      this.messages.push(newMsgObj);
      this.setBranchSelection(newBranchUserMsg.parentId ?? null, newBranchUserMsg.id);
      artifactStore.close();

      const branchAttachmentIds = newBranchUserMsg.attachments?.map((a) => a.id) ?? attachmentIds;
      await this.triggerAssistantResponse(newMsgObj, branchAttachmentIds);
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

    artifactStore.close();
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
    let newConvId: string | null = null;
    let isNewConv = false;

    if (!this.activeConversationId) {
      isNewConv = true;
      try {
        const words = trimmed.split(/\s+/);
        let excerpt = words.slice(0, 8).join(" ");
        if (excerpt.length > 60) excerpt = excerpt.slice(0, 57) + "…";
        if (!excerpt) excerpt = "Attachment";
        const conv = await createConversation({ title: excerpt, model: this.selectedModel ?? undefined });
        this.activeConversationId = conv.id;
        newConvId = conv.id;
        this.activeConversationTitle = conv.title;
        _invalidateConversations?.();

        // Persist any pending per-conversation exclusions for the new conversation
        const hasPendingExclusions =
          this.conversationExcludedMcps.length > 0 || this.conversationExcludedSkills.length > 0;
        if (hasPendingExclusions) {
          patchConversationTools(conv.id, {
            excludedMcps: this.conversationExcludedMcps,
            excludedSkills: this.conversationExcludedSkills,
          }).catch(() => { });
        }
      } catch (err) {
        console.error("[chatStore] Failed to pre-create conversation:", err);
      }
    }

    // Start assistant response FIRST so the main chat completion starts streaming immediately
    const assistantPromise = this.triggerAssistantResponse(userMessage, attachmentIds);

    if (isNewConv && newConvId && this.selectedModel) {
      this.triggerAutoNaming(newConvId, trimmed, this.selectedModel);
    }

    await assistantPromise;
  }

  private triggerAutoNaming(conversationId: string, userContent: string, activeModelId: string) {
    const mode = settingsStore.autoNameMode;
    if (mode === "first_words") return;

    let targetModelId = activeModelId;
    if (mode === "designated_model" && settingsStore.autoNameModel) {
      targetModelId = settingsStore.autoNameModel;
    }

    const applyTitle = (title: string) => {
      if (title) {
        if (this.activeConversationId === conversationId) {
          this.activeConversationTitle = title;
        }
        _invalidateConversations?.();
      }
    };

    const performAutoName = async () => {
      // Small 50ms delay so the main chat completion request hits the network first
      await new Promise((r) => setTimeout(r, 50));

      // 1. Try parallel attempt first
      try {
        const res = await autoNameConversation(conversationId, userContent, targetModelId, this.autoNameController?.signal);
        applyTitle(res.title);
        return;
      } catch (err) {
        console.info("[chatStore] Parallel auto-naming failed/rejected, will retry after response completes:", err);
      }

      // 2. If parallel failed, wait for main response stream to finish, then retry sequentially
      if (this.isStreaming) {
        await new Promise<void>((resolve) => {
          const checkDone = setInterval(() => {
            if (!this.isStreaming) {
              clearInterval(checkDone);
              resolve();
            }
          }, 250);
        });
      }

      try {
        const res = await autoNameConversation(conversationId, userContent, targetModelId, this.autoNameController?.signal);
        applyTitle(res.title);
      } catch (fallbackErr) {
        console.error("[chatStore] Sequential auto-naming failed:", fallbackErr);
      }
    };

    performAutoName();
  }

  private async triggerAssistantResponse(
    userMsg: {
      id: string;
      content: string;
      role: string;
      parentId?: string | null;
      createdAt?: number;
      attachments?: AttachmentOut[];
    },
    attachmentIds?: string[],
  ) {
    if (!this.selectedModel) return;

    let currentUserId: string = userMsg.id;
    let currentAsstId: string = makeId();

    const assistantMessage: ChatMessage = {
      id: currentAsstId,
      parentId: currentUserId,
      role: "assistant",
      content: "",
      status: "routing",
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
    this.streamingConvId = this.activeConversationId;
    this.streamingAssistantId = currentAsstId;
    artifactStore.resetUserClosed();

    this.abortController = new AbortController();
    let rawBuffer = "";

    await streamChatCompletion({
      model: this.selectedModel,
      messages: historyForModel,
      conversationId: this.activeConversationId,
      userMessageId: currentUserId,
      userParentId: userMsg.parentId ?? null,
      assistantMessageId: currentAsstId,
      attachmentIds,
      toolsEnabled: this.conversationToolsEnabled,
      signal: this.abortController.signal,
      onToken: (delta) => {
        const msg = this.messages.find((m) => m.id === currentAsstId);
        if (!msg) return;
        rawBuffer += delta;
        msg.content = rawBuffer;

        // Legacy parseThinking for thinkingContent/thinkingDone
        const parsed = parseThinking(rawBuffer);
        msg.thinkingContent = parsed.thinkingContent;
        msg.thinkingDone = parsed.thinkingDone;
      },
      onStatus: (status) => {
        const msg = this.messages.find((m) => m.id === currentAsstId);
        if (msg) {
          msg.status = status as any;
        }
      },
      onRouterToken: (text) => {
        const msg = this.messages.find((m) => m.id === currentAsstId);
        if (!msg) return;
        msg.routerOutput = (msg.routerOutput || "") + text;
        rawBuffer = `<router_execution>${msg.routerOutput}</router_execution>\n`;
        msg.content = rawBuffer;
      },
      onToolExecution: (evt) => {
        const msg = this.messages.find((m) => m.id === currentAsstId);
        if (!msg) return;

        if (!msg.toolExecutions) msg.toolExecutions = [];
        const idx = msg.toolExecutions.findIndex((t) => t.callId === evt.callId);
        if (idx >= 0) {
          msg.toolExecutions[idx] = evt;
        } else {
          msg.toolExecutions.push(evt);
        }

        const thinkStartCount = (rawBuffer.match(/<think>/g) || []).length;
        const thinkEndCount = (rawBuffer.match(/<\/think>/g) || []).length;
        if (thinkStartCount > thinkEndCount) {
          rawBuffer += "\n</think>\n";
        }

        if (evt.status === "completed" || evt.status === "error") {
          rawBuffer += `\n<tool_execution>${JSON.stringify(evt)}</tool_execution>\n`;
        }

        const parsed = parseThinking(rawBuffer);
        msg.thinkingContent = parsed.thinkingContent;
        msg.thinkingDone = parsed.thinkingDone;
        msg.content = rawBuffer;
      },
      onContentReplace: (content) => {
        const msg = this.messages.find((m) => m.id === currentAsstId);
        if (!msg) return;
        rawBuffer = content;
        const parsed = parseThinking(rawBuffer);
        msg.thinkingContent = parsed.thinkingContent;
        msg.thinkingDone = parsed.thinkingDone;
        msg.content = rawBuffer;
      },
      onMeta: (meta) => {
        if (meta.isReconnect) {
          rawBuffer = "";
        }

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
        this.streamingConvId = meta.conversationId;
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
        this.streamingConvId = null;
        this.streamingAssistantId = null;
        this.abortController = null;
      },
      onError: (message) => {
        const msg = this.messages.find((m) => m.id === currentAsstId);
        if (msg) {
          msg.streaming = false;
          msg.error = message;
        }
        this.isStreaming = false;
        this.streamingConvId = null;
        this.streamingAssistantId = null;
        this.abortController = null;
      },
    });
  }

  private async reconnectAssistantResponse(asstMsg: ChatMessage) {
    if (!this.selectedModel || !this.activeConversationId) return;

    this.isStreaming = true;
    asstMsg.streaming = true;
    this.streamingConvId = this.activeConversationId;
    this.streamingAssistantId = asstMsg.id;
    this.abortController = new AbortController();

    const historyForModel = this.activePath
      .filter((m) => m.id !== asstMsg.id && !m.error)
      .map((m) => ({ role: m.role, content: m.content }));

    let rawBuffer = asstMsg.content || "";
    let insideThink = false;
    let thinkingStartMs = 0;

    await streamChatCompletion({
      model: this.selectedModel,
      messages: historyForModel,
      conversationId: this.activeConversationId,
      assistantMessageId: asstMsg.id,
      signal: this.abortController.signal,
      onToken: (delta) => {
        const msg = this.messages.find((m) => m.id === asstMsg.id);
        if (!msg) return;

        rawBuffer += delta;

        if (!insideThink && (delta.includes("<think>") || rawBuffer.includes("<think>"))) {
          insideThink = true;
          thinkingStartMs = Date.now();
        }
        if (insideThink && delta.includes("</think>")) {
          insideThink = false;
          if (thinkingStartMs > 0) {
            msg.thinkingTimeMs = Date.now() - thinkingStartMs;
          }
        }

        const parsed = parseThinking(rawBuffer);
        msg.content = rawBuffer;
        msg.thinkingContent = parsed.thinkingContent;
        msg.thinkingDone = parsed.thinkingDone;
      },
      onMeta: (meta) => {
        const msg = this.messages.find((m) => m.id === asstMsg.id);
        if (msg) msg.stats = meta.stats;
      },
      onDone: () => {
        const msg = this.messages.find((m) => m.id === asstMsg.id);
        if (msg) msg.streaming = false;
        this.isStreaming = false;
        this.streamingConvId = null;
        this.streamingAssistantId = null;
        this.abortController = null;
      },
      onError: (message) => {
        const msg = this.messages.find((m) => m.id === asstMsg.id);
        if (msg) {
          msg.streaming = false;
          msg.error = message;
        }
        this.isStreaming = false;
        this.streamingConvId = null;
        this.streamingAssistantId = null;
        this.abortController = null;
      },
    });
  }

  stop() {
    this.abortController?.abort();
    this.abortController = null;

    const convId = this.streamingConvId ?? this.activeConversationId;
    if (convId) {
      stopChatCompletion(convId).catch(() => { });
    }

    if (this.autoNameController) {
      this.autoNameController.abort();
      this.autoNameController = null;
    }

    // Mark the streaming assistant message as done so UI unblocks immediately
    const asstId = this.streamingAssistantId;
    if (asstId) {
      const msg = this.messages.find((m) => m.id === asstId);
      if (msg) msg.streaming = false;
    }

    this.isStreaming = false;
    this.streamingConvId = null;
    this.streamingAssistantId = null;
  }

  clear() {
    this.messages = [];
    this.activeConversationId = null;
    this.activeConversationTitle = "New conversation";
    this.pendingAttachments = [];
    this.branchSelections = {};
    this.streamingConvId = null;
    this.streamingAssistantId = null;
    artifactStore.close();
  }
}

export const chatStore = new ChatStore();
