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
  updateConversation,
  fetchConversationWorkspaceFiles,
  fetchConversationWorkspaceFile,
  fetchWorkspaceFilesByPath,
  fetchWorkspaceFileByPath,
  fetchConversationGitStatus,
  fetchWorkspaceGitStatusByPath,
  revertWorkspaceCheckpoint,
  fetchFolders,
} from "../api";
import { encodeToWav } from "../audio";
import type {
  ChatMessage,
  ConversationSummary,
  AttachmentOut,
  ConversationSamplingOverrides,
  ScratchpadEntryInfo,
  SlashToolSelection,
  WorkspaceApprovalMode,
  WorkspaceGitStatusResponse,
  WorkspaceSource,
} from "../types";
import { artifactStore } from "./artifact.svelte";
import { settingsStore } from "./settings.svelte";
import { getRandomUUID } from "../utils/uuid";
import { THINK_TAG_NAMES, reconstructEditedMessageContent } from "../utils/segmentParser";
import { registerArtifact, clearArtifactRegistry } from "../markdown";

const OPEN_TAGS = THINK_TAG_NAMES.map((t) => `<${t}>`);
const CLOSE_TAGS = THINK_TAG_NAMES.map((t) => `</${t}>`);

export interface ChatDraft {
  text: string;
  attachments: AttachmentOut[];
  slashTools: SlashToolSelection[];
}

export interface QueuedMessage {
  id: string;
  text: string;
  attachments: AttachmentOut[];
  injectedTools?: SlashToolSelection[];
  createdAt: number;
  isEditing?: boolean;
}

const NEW_DRAFT_KEY = "__new__";
const DRAFT_STORAGE_PREFIX = "blombrain_draft_";
const MAX_CACHED_ATTACHMENT_AGE_MS = 23 * 60 * 60 * 1000;
const EMPTY_ATTACHMENTS: AttachmentOut[] = [];
const EMPTY_SLASH_TOOLS: SlashToolSelection[] = [];
const EMPTY_QUEUED: QueuedMessage[] = [];

function isDraftEmpty(draft: ChatDraft | undefined): boolean {
  if (!draft) return true;
  return (
    draft.text.length === 0 &&
    draft.attachments.length === 0 &&
    draft.slashTools.length === 0
  );
}

function makeId(): string {
  return getRandomUUID();
}

/**
 * Parse thinking blocks from stored assistant content.
 * Supports all tag variants in THINK_TAG_NAMES (think, thought, reason, reasoning).
 * Returns { content, thinkingContent, thinkingDone } so loaded messages
 * display the ThinkingBlock the same as streamed ones.
 */
function parseThinking(raw: string): { content: string; thinkingContent?: string; thinkingDone?: boolean } {
  const toolExecBlocks: string[] = [];
  const sanitizedRaw = raw.replace(/<tool_execution>[\s\S]*?<\/tool_execution>/g, (match) => {
    const idx = toolExecBlocks.length;
    toolExecBlocks.push(match);
    return `__TOOL_EXEC_${idx}__`;
  });

  const hasOpenTag = OPEN_TAGS.some((open) => sanitizedRaw.includes(open));
  if (!hasOpenTag) {
    let content = sanitizedRaw;
    toolExecBlocks.forEach((te, i) => {
      content = content.replace(`__TOOL_EXEC_${i}__`, te);
    });
    return { content };
  }

  const thinkBlocks: string[] = [];
  const contentParts: string[] = [];
  let currentlyThinking = false;
  let currentThinkStart = -1;
  let pos = 0;

  const findNextOpen = (startPos: number) => {
    let earliest: { pos: number; len: number } | null = null;
    for (const open of OPEN_TAGS) {
      const p = sanitizedRaw.indexOf(open, startPos);
      if (p !== -1 && (!earliest || p < earliest.pos)) {
        earliest = { pos: p, len: open.length };
      }
    }
    return earliest;
  };

  const findNextClose = (startPos: number) => {
    let earliest: { pos: number; len: number } | null = null;
    for (const close of CLOSE_TAGS) {
      const p = sanitizedRaw.indexOf(close, startPos);
      if (p !== -1 && (!earliest || p < earliest.pos)) {
        earliest = { pos: p, len: close.length };
      }
    }
    return earliest;
  };

  while (pos < sanitizedRaw.length) {
    if (!currentlyThinking) {
      const openInfo = findNextOpen(pos);
      if (!openInfo) {
        contentParts.push(sanitizedRaw.slice(pos));
        break;
      } else {
        contentParts.push(sanitizedRaw.slice(pos, openInfo.pos));
        currentlyThinking = true;
        currentThinkStart = openInfo.pos + openInfo.len;
        pos = currentThinkStart;
      }
    } else {
      const closeInfo = findNextClose(pos);
      if (!closeInfo) {
        thinkBlocks.push(sanitizedRaw.slice(currentThinkStart));
        pos = sanitizedRaw.length;
        break;
      } else {
        thinkBlocks.push(sanitizedRaw.slice(currentThinkStart, closeInfo.pos));
        currentlyThinking = false;
        pos = closeInfo.pos + closeInfo.len;
      }
    }
  }

  const thinkingContent = thinkBlocks.length > 0 ? thinkBlocks.join("\n\n---\n\n").trim() : undefined;
  let content = contentParts.join("").trimStart();

  // Restore tool execution blocks
  toolExecBlocks.forEach((te, i) => {
    content = content.replace(`__TOOL_EXEC_${i}__`, te);
  });

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
  /** Folder currently opened in the main pane (when activeConversationId is null). */
  activeFolderId = $state<string | null>(null);
  /** Title of the active conversation (kept in sync after each save). */
  activeConversationTitle = $state<string>("New conversation");

  private drafts = $state<Record<string, ChatDraft>>({});
  private queuedByChat = $state<Record<string, QueuedMessage[]>>({});
  editingQueuedSlot = $state<{
    convKey: string;
    id: string;
    index: number;
    previousDraft?: ChatDraft;
  } | null>(null);
  private uploadingCounts = $state<Record<string, number>>({});
  selectedAttachment = $state<AttachmentOut | null>(null);
  inChatSearchOpen = $state(false);
  inChatSearchFocusNonce = $state(0);
  private wasAborted = false;

  openInChatSearch() {
    this.inChatSearchOpen = true;
    this.inChatSearchFocusNonce += 1;
  }

  closeInChatSearch() {
    this.inChatSearchOpen = false;
  }

  constructor() {
    this.loadDraftsFromStorage();
  }

  private loadDraftsFromStorage() {
    if (typeof localStorage === "undefined") return;
    try {
      const now = Date.now();
      const loaded: Record<string, ChatDraft> = {};
      const keysToRemove: string[] = [];

      for (let i = 0; i < localStorage.length; i++) {
        const storageKey = localStorage.key(i);
        if (!storageKey || !storageKey.startsWith(DRAFT_STORAGE_PREFIX)) continue;
        const draftKey = storageKey.slice(DRAFT_STORAGE_PREFIX.length);
        if (!draftKey) continue;

        try {
          const raw = localStorage.getItem(storageKey);
          if (!raw) {
            keysToRemove.push(storageKey);
            continue;
          }
          const parsed = JSON.parse(raw) as Partial<ChatDraft>;
          const text = typeof parsed.text === "string" ? parsed.text : "";
          const attachments = Array.isArray(parsed.attachments)
            ? parsed.attachments.filter(
                (att): att is AttachmentOut =>
                  Boolean(att && typeof att.id === "string" && typeof att.createdAt === "number") &&
                  now - att.createdAt < MAX_CACHED_ATTACHMENT_AGE_MS,
              )
            : [];
          const slashTools = Array.isArray(parsed.slashTools)
            ? parsed.slashTools.filter(
                (t): t is SlashToolSelection =>
                  Boolean(t && typeof t.id === "string" && typeof t.name === "string" && typeof t.kind === "string"),
              )
            : [];

          const draft: ChatDraft = { text, attachments, slashTools };
          if (isDraftEmpty(draft)) {
            keysToRemove.push(storageKey);
          } else {
            loaded[draftKey] = draft;
          }
        } catch {
          keysToRemove.push(storageKey);
        }
      }

      for (const k of keysToRemove) {
        try {
          localStorage.removeItem(k);
        } catch { }
      }

      this.drafts = loaded;
    } catch { }
  }

  private saveDraftToStorage(key: string, draft: ChatDraft) {
    if (typeof localStorage === "undefined") return;
    try {
      localStorage.setItem(`${DRAFT_STORAGE_PREFIX}${key}`, JSON.stringify(draft));
    } catch { }
  }

  private removeDraftFromStorage(key: string) {
    if (typeof localStorage === "undefined") return;
    try {
      localStorage.removeItem(`${DRAFT_STORAGE_PREFIX}${key}`);
    } catch { }
  }

  private updateDraft(key: string, next: ChatDraft) {
    if (isDraftEmpty(next)) {
      if (this.drafts[key] !== undefined) {
        const copy = { ...this.drafts };
        delete copy[key];
        this.drafts = copy;
      }
      this.removeDraftFromStorage(key);
    } else {
      this.drafts = {
        ...this.drafts,
        [key]: next,
      };
      this.saveDraftToStorage(key, next);
    }
  }

  get currentDraftKey(): string {
    return this.activeConversationId ?? NEW_DRAFT_KEY;
  }

  get draftText(): string {
    return this.drafts[this.currentDraftKey]?.text ?? "";
  }

  set draftText(value: string) {
    const key = this.currentDraftKey;
    const existing = this.drafts[key];
    if ((existing?.text ?? "") === value) return;
    this.updateDraft(key, {
      text: value,
      attachments: existing?.attachments ?? [],
      slashTools: existing?.slashTools ?? [],
    });
  }

  get pendingAttachments(): AttachmentOut[] {
    return this.drafts[this.currentDraftKey]?.attachments ?? EMPTY_ATTACHMENTS;
  }

  get draftSlashTools(): SlashToolSelection[] {
    return this.drafts[this.currentDraftKey]?.slashTools ?? EMPTY_SLASH_TOOLS;
  }

  set draftSlashTools(value: SlashToolSelection[]) {
    const key = this.currentDraftKey;
    const existing = this.drafts[key];
    this.updateDraft(key, {
      text: existing?.text ?? "",
      attachments: existing?.attachments ?? [],
      slashTools: value,
    });
  }

  get isUploadingDraft(): boolean {
    return (this.uploadingCounts[this.currentDraftKey] ?? 0) > 0;
  }

  appendDraftText(targetKey: string, textToAppend: string) {
    const trimmed = textToAppend.trim();
    if (!trimmed) return;
    const existing = this.drafts[targetKey];
    const current = existing?.text ?? "";
    const nextText = (current ? current.trimEnd() + " " : "") + trimmed;
    this.updateDraft(targetKey, {
      text: nextText,
      attachments: existing?.attachments ?? [],
      slashTools: existing?.slashTools ?? [],
    });
  }

  clearDraft(convId?: string | null) {
    const key = convId === undefined ? this.currentDraftKey : (convId ?? NEW_DRAFT_KEY);
    if (this.drafts[key] !== undefined) {
      const copy = { ...this.drafts };
      delete copy[key];
      this.drafts = copy;
    }
    this.removeDraftFromStorage(key);
  }

  get queuedMessages(): QueuedMessage[] {
    return this.queuedByChat[this.currentDraftKey] ?? EMPTY_QUEUED;
  }

  get activeEditingQueuedItem(): { id: string; index: number } | null {
    const slot = this.editingQueuedSlot;
    if (!slot || slot.convKey !== this.currentDraftKey) return null;
    const list = this.queuedByChat[slot.convKey] ?? [];
    const currentIdx = list.findIndex((m) => m.id === slot.id);
    if (currentIdx === -1) return null;
    return { id: slot.id, index: currentIdx };
  }

  enqueueMessage(content: string, injectedTools?: SlashToolSelection[]) {
    const trimmed = content.trim();
    const key = this.currentDraftKey;
    const currentAttachments = this.pendingAttachments;
    if (!trimmed && currentAttachments.length === 0) return;

    const editingSlot =
      this.editingQueuedSlot?.convKey === key ? this.editingQueuedSlot : null;

    if (editingSlot) {
      const list = this.queuedByChat[key] ?? [];
      const idx = list.findIndex((m) => m.id === editingSlot.id);
      if (idx !== -1) {
        const updatedList = [...list];
        updatedList[idx] = {
          ...updatedList[idx],
          text: trimmed,
          attachments: [...currentAttachments],
          injectedTools:
            injectedTools && injectedTools.length > 0
              ? [...injectedTools]
              : undefined,
          isEditing: false,
        };
        this.queuedByChat = {
          ...this.queuedByChat,
          [key]: updatedList,
        };
        this.editingQueuedSlot = null;
        if (editingSlot.previousDraft) {
          this.updateDraft(key, editingSlot.previousDraft);
        } else {
          this.clearDraft(key);
        }
        if (!this.isStreaming && idx === 0 && !this.wasAborted) {
          this.flushNextQueued(key);
        }
        return;
      }
      this.editingQueuedSlot = null;
    }

    const item: QueuedMessage = {
      id: makeId(),
      text: trimmed,
      attachments: [...currentAttachments],
      injectedTools: injectedTools && injectedTools.length > 0 ? [...injectedTools] : undefined,
      createdAt: Date.now(),
    };
    this.clearDraft(key);
    this.queuedByChat = {
      ...this.queuedByChat,
      [key]: [...(this.queuedByChat[key] ?? []), item],
    };
  }

  async removeQueuedMessage(id: string) {
    const key = this.currentDraftKey;
    const existing = this.queuedByChat[key] ?? [];
    const target = existing.find((m) => m.id === id);
    const next = existing.filter((m) => m.id !== id);
    const copy = { ...this.queuedByChat };
    if (next.length === 0) delete copy[key];
    else copy[key] = next;
    this.queuedByChat = copy;

    if (this.editingQueuedSlot?.convKey === key && this.editingQueuedSlot.id === id) {
      const prevDraft = this.editingQueuedSlot.previousDraft;
      this.editingQueuedSlot = null;
      if (prevDraft) {
        this.updateDraft(key, prevDraft);
      } else {
        this.clearDraft(key);
      }
    }

    if (target?.attachments) {
      for (const att of target.attachments) {
        try {
          await deleteUpload(att.id);
        } catch { }
      }
    }
  }

  editQueuedMessage(id: string) {
    const key = this.currentDraftKey;
    const existing = this.queuedByChat[key] ?? [];
    const targetIdx = existing.findIndex((m) => m.id === id);
    if (targetIdx === -1) return;
    const target = existing[targetIdx];

    // If already editing another item in the same chat, revert its isEditing flag first
    let previousDraft =
      this.editingQueuedSlot?.convKey === key
        ? this.editingQueuedSlot.previousDraft
        : undefined;
    if (!this.editingQueuedSlot || this.editingQueuedSlot.convKey !== key) {
      const cur = this.drafts[key];
      if (cur && !isDraftEmpty(cur)) {
        previousDraft = {
          text: cur.text,
          attachments: [...cur.attachments],
          slashTools: [...cur.slashTools],
        };
      }
    }

    const updatedList = existing.map((m) => ({
      ...m,
      isEditing: m.id === id,
    }));
    this.queuedByChat = {
      ...this.queuedByChat,
      [key]: updatedList,
    };
    this.editingQueuedSlot = {
      convKey: key,
      id,
      index: targetIdx,
      previousDraft,
    };

    this.updateDraft(key, {
      text: target.text,
      attachments: [...target.attachments],
      slashTools: target.injectedTools ? [...target.injectedTools] : [],
    });
  }

  cancelEditQueuedMessage() {
    const slot = this.editingQueuedSlot;
    if (!slot) return;
    const key = slot.convKey;
    const existing = this.queuedByChat[key];
    if (existing) {
      this.queuedByChat = {
        ...this.queuedByChat,
        [key]: existing.map((m) =>
          m.id === slot.id ? { ...m, isEditing: false } : m,
        ),
      };
    }
    this.editingQueuedSlot = null;
    if (slot.previousDraft) {
      this.updateDraft(key, slot.previousDraft);
    } else {
      this.clearDraft(key);
    }
  }

  clearQueuedMessages(convId?: string | null) {
    const key = convId === undefined ? this.currentDraftKey : (convId ?? NEW_DRAFT_KEY);
    if (this.queuedByChat[key] !== undefined) {
      const copy = { ...this.queuedByChat };
      delete copy[key];
      this.queuedByChat = copy;
    }
    if (this.editingQueuedSlot?.convKey === key) {
      this.editingQueuedSlot = null;
    }
  }

  private flushNextQueued(convKey: string) {
    if (this.isStreaming || this.wasAborted) return;
    if (this.currentDraftKey !== convKey) return;
    const list = this.queuedByChat[convKey];
    if (!list || list.length === 0) return;
    if (list[0].isEditing) return;

    const [nextItem, ...rest] = list;
    const copy = { ...this.queuedByChat };
    if (rest.length === 0) delete copy[convKey];
    else copy[convKey] = rest;
    this.queuedByChat = copy;

    void this.dispatchMessage(nextItem.text, nextItem.attachments, nextItem.injectedTools);
  }

  /** MCP server IDs currently excluded for this conversation. */
  conversationExcludedMcps = $state<string[]>([]);
  /** Skill IDs currently excluded for this conversation. */
  conversationExcludedSkills = $state<string[]>([]);
  /** Tool/Skill names explicitly pinned/forced by the user for routing. */
  conversationForcedTools = $state<string[]>([]);
  /** Whether tool/skill injection is enabled for this conversation. */
  conversationToolsEnabled = $state<boolean>(true);
  /** Per-conversation memory override (null = inherit global setting). */
  conversationMemoryEnabled = $state<boolean | null>(null);
  /** Per-conversation system prompt override/addition. */
  conversationSystemPromptOverride = $state<string | null>(null);
  /** Per-conversation sampling overrides. */
  conversationSamplingOverrides = $state<ConversationSamplingOverrides | null>(null);
  /** Ephemeral conversation scratchpad entries. */
  scratchpadEntries = $state<ScratchpadEntryInfo[]>([]);
  /** Folder ID of the active conversation (if filed). */
  conversationFolderId = $state<string | null>(null);
  /** Conversation's own attached workspace directory path (null if none or inheriting from folder). */
  conversationWorkspacePath = $state<string | null>(null);
  /** Whether write tools are enabled on the conversation's own workspace. */
  conversationWorkspaceWriteEnabled = $state<boolean>(false);
  /** Approval mode ("auto" | "ask") for write tools on the conversation's own workspace. */
  conversationWorkspaceApprovalMode = $state<WorkspaceApprovalMode>("auto");
  /** Effective workspace path for this conversation (own override or inherited from folder). */
  effectiveWorkspacePath = $state<string | null>(null);
  /** Effective write access flag for this conversation's workspace. */
  effectiveWorkspaceWriteEnabled = $state<boolean>(false);
  /** Effective write approval mode ("auto" | "ask") for this conversation's workspace. */
  effectiveWorkspaceApprovalMode = $state<WorkspaceApprovalMode>("auto");
  /** Source of the effective workspace ("conversation" | "folder" | null). */
  workspaceSource = $state<WorkspaceSource>(null);
  /** Filtered relative file paths inside the effective workspace for @ autocomplete. */
  workspaceFiles = $state<string[]>([]);
  /** Git status for the effective workspace (null if none or not a git repository). */
  workspaceGitStatus = $state<WorkspaceGitStatusResponse | null>(null);

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

  async addAttachment(
    file: File,
    targetKey: string = this.currentDraftKey,
    targetConvId: string | null = this.activeConversationId,
  ) {
    this.uploadingCounts = {
      ...this.uploadingCounts,
      [targetKey]: (this.uploadingCounts[targetKey] ?? 0) + 1,
    };
    try {
      let fileToUpload = file;
      if (file.type.startsWith("audio/")) {
        fileToUpload = await encodeToWav(file);
      }
      const attachment = await uploadFile(fileToUpload, targetConvId);
      const existing = this.drafts[targetKey];
      this.updateDraft(targetKey, {
        text: existing?.text ?? "",
        attachments: [...(existing?.attachments ?? []), attachment],
        slashTools: existing?.slashTools ?? [],
      });
    } finally {
      const nextCount = Math.max(0, (this.uploadingCounts[targetKey] ?? 1) - 1);
      const nextCounts = { ...this.uploadingCounts };
      if (nextCount === 0) {
        delete nextCounts[targetKey];
      } else {
        nextCounts[targetKey] = nextCount;
      }
      this.uploadingCounts = nextCounts;
    }
  }

  async removeAttachment(id: string, targetKey: string = this.currentDraftKey) {
    const existing = this.drafts[targetKey];
    if (existing) {
      this.updateDraft(targetKey, {
        text: existing.text,
        attachments: existing.attachments.filter((a) => a.id !== id),
        slashTools: existing.slashTools,
      });
    }
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
      this.activeFolderId = null;
      this.activeConversationTitle = detail.title;
      this.selectedAttachment = null;
      this.inChatSearchOpen = false;
      this.conversationExcludedMcps = detail.excludedMcps ?? [];
      this.conversationExcludedSkills = detail.excludedSkills ?? [];
      this.conversationForcedTools = [];
      this.conversationToolsEnabled = detail.toolsEnabled !== undefined ? detail.toolsEnabled : true;
      this.conversationMemoryEnabled = detail.memoryEnabled ?? null;
      this.conversationSystemPromptOverride = detail.systemPromptOverride ?? null;
      this.conversationSamplingOverrides = detail.samplingOverrides ?? null;
      this.scratchpadEntries = detail.scratchpad ?? [];
      this.conversationFolderId = detail.folderId ?? null;
      this.conversationWorkspacePath = detail.workspacePath ?? null;
      this.conversationWorkspaceWriteEnabled = Boolean(detail.workspaceWriteEnabled);
      this.conversationWorkspaceApprovalMode = detail.workspaceApprovalMode ?? "auto";
      this.effectiveWorkspacePath = detail.effectiveWorkspacePath ?? null;
      this.effectiveWorkspaceWriteEnabled = Boolean(detail.effectiveWorkspaceWriteEnabled);
      this.effectiveWorkspaceApprovalMode = detail.effectiveWorkspaceApprovalMode ?? "auto";
      this.workspaceSource = detail.workspaceSource ?? null;
      this.workspaceFiles = [];
      void this.refreshWorkspaceFiles(detail.id);
      if (detail.model) this.selectedModel = detail.model;
      this.loadBranchSelections(detail.id);
      artifactStore.close();
      artifactStore.loadConversationArtifacts(detail.id);

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

  /** Start a fresh, empty chat (optionally scoped inside a folder). */
  newConversation(folderId: string | null = null) {
    if (this.isStreaming) return;
    this.messages = [];
    this.activeConversationId = null;
    this.activeFolderId = folderId;
    this.activeConversationTitle = "New conversation";
    this.selectedAttachment = null;
    this.inChatSearchOpen = false;
    this.branchSelections = {};
    this.selectedModel = null;
    this.conversationExcludedMcps = [];
    this.conversationExcludedSkills = [];
    this.conversationForcedTools = [];
    this.conversationToolsEnabled = true;
    this.conversationMemoryEnabled = null;
    this.conversationSystemPromptOverride = null;
    this.conversationSamplingOverrides = null;
    this.scratchpadEntries = [];
    this.conversationFolderId = folderId;
    this.conversationWorkspacePath = null;
    this.conversationWorkspaceWriteEnabled = false;
    this.conversationWorkspaceApprovalMode = "auto";
    this.effectiveWorkspacePath = null;
    this.effectiveWorkspaceWriteEnabled = false;
    this.effectiveWorkspaceApprovalMode = "auto";
    this.workspaceSource = null;
    this.workspaceFiles = [];
    this.streamingConvId = null;
    this.streamingAssistantId = null;
    artifactStore.close();
    artifactStore.loadConversationArtifacts(null);
    if (folderId) {
      void this.syncUnsavedFolderWorkspace(folderId);
    }
  }

  async syncUnsavedFolderWorkspace(folderId: string | null) {
    if (!folderId) return;
    try {
      const folders = await fetchFolders();
      if (this.activeConversationId !== null || this.activeFolderId !== folderId) return;
      if (this.conversationWorkspacePath) return;
      const folder = folders.find((f) => f.id === folderId);
      if (folder?.workspacePath) {
        this.effectiveWorkspacePath = folder.workspacePath;
        this.effectiveWorkspaceWriteEnabled = Boolean(folder.workspaceWriteEnabled);
        this.effectiveWorkspaceApprovalMode = folder.workspaceApprovalMode ?? "auto";
        this.workspaceSource = "folder";
        try {
          const res = await fetchWorkspaceFilesByPath(folder.workspacePath);
          if (this.activeConversationId === null && this.effectiveWorkspacePath === folder.workspacePath) {
            this.workspaceFiles = res.files ?? [];
          }
        } catch {
          this.workspaceFiles = [];
        }
      } else {
        this.effectiveWorkspacePath = null;
        this.effectiveWorkspaceWriteEnabled = false;
        this.effectiveWorkspaceApprovalMode = "auto";
        this.workspaceSource = null;
        this.workspaceFiles = [];
      }
    } catch { }
  }

  async refreshWorkspaceFiles(convId: string | null = this.activeConversationId) {
    if (!convId) {
      if (this.conversationWorkspacePath) {
        try {
          const res = await fetchWorkspaceFilesByPath(this.conversationWorkspacePath);
          if (this.activeConversationId === null) {
            this.workspaceFiles = res.files ?? [];
            if (res.effectiveWorkspacePath) {
              this.conversationWorkspacePath = res.effectiveWorkspacePath;
              this.effectiveWorkspacePath = res.effectiveWorkspacePath;
            }
            fetchWorkspaceGitStatusByPath(this.effectiveWorkspacePath ?? this.conversationWorkspacePath)
              .then((gs) => {
                if (this.activeConversationId === null) this.workspaceGitStatus = gs;
              })
              .catch(() => {
                this.workspaceGitStatus = null;
              });
          }
        } catch (err) {
          console.warn("[chatStore] failed to refresh unsaved workspace files:", err);
          this.workspaceFiles = [];
          this.workspaceGitStatus = null;
        }
      } else if (this.activeFolderId) {
        await this.syncUnsavedFolderWorkspace(this.activeFolderId);
      } else {
        this.workspaceFiles = [];
        this.workspaceGitStatus = null;
      }
      return;
    }
    try {
      const res = await fetchConversationWorkspaceFiles(convId);
      if (this.activeConversationId !== convId) return;
      this.workspaceFiles = res.files ?? [];
      this.effectiveWorkspacePath = res.effectiveWorkspacePath ?? null;
      this.effectiveWorkspaceWriteEnabled = Boolean(res.workspaceWriteEnabled);
      this.workspaceSource = res.workspaceSource ?? null;
      if (this.effectiveWorkspacePath) {
        fetchConversationGitStatus(convId)
          .then((gs) => {
            if (this.activeConversationId === convId) this.workspaceGitStatus = gs;
          })
          .catch(() => {
            if (this.activeConversationId === convId) this.workspaceGitStatus = null;
          });
      } else {
        this.workspaceGitStatus = null;
      }
    } catch (err) {
      console.warn("[chatStore] failed to refresh workspace files:", err);
    }
  }

  /** Called on window focus / visibility return to pick up external workspace edits cleanly. */
  async refreshExternalWorkspaceChanges() {
    if (!this.effectiveWorkspacePath) return;
    await this.refreshWorkspaceFiles(this.activeConversationId);
    if (artifactStore.isOpen && artifactStore.activeId) {
      if (artifactStore.activeId.startsWith("workspace:")) {
        const relPath = artifactStore.activeId.slice("workspace:".length);
        try {
          const preview = this.activeConversationId
            ? await fetchConversationWorkspaceFile(this.activeConversationId, relPath)
            : await fetchWorkspaceFileByPath(this.effectiveWorkspacePath, relPath);
          if (artifactStore.activeId === `workspace:${relPath}`) {
            artifactStore.code = preview.content;
          }
        } catch { }
      } else {
        await artifactStore.refreshArtifactContent(artifactStore.activeId);
      }
    }
  }

  async setConversationWorkspace(
    workspacePath: string | null,
    workspaceWriteEnabled: boolean = false,
    workspaceApprovalMode: WorkspaceApprovalMode = this.effectiveWorkspaceApprovalMode,
  ) {
    const cleanPath = workspacePath?.trim() || null;
    if (this.activeConversationId) {
      const updated = await updateConversation(this.activeConversationId, {
        workspacePath: cleanPath,
        workspaceWriteEnabled: cleanPath ? workspaceWriteEnabled : false,
        workspaceApprovalMode: cleanPath ? workspaceApprovalMode : "auto",
      });
      this.conversationWorkspacePath = updated.workspacePath ?? null;
      this.conversationWorkspaceWriteEnabled = Boolean(updated.workspaceWriteEnabled);
      this.conversationWorkspaceApprovalMode = updated.workspaceApprovalMode ?? "auto";
      this.effectiveWorkspacePath = updated.effectiveWorkspacePath ?? null;
      this.effectiveWorkspaceWriteEnabled = Boolean(updated.effectiveWorkspaceWriteEnabled);
      this.effectiveWorkspaceApprovalMode = updated.effectiveWorkspaceApprovalMode ?? "auto";
      this.workspaceSource = updated.workspaceSource ?? null;
      await this.refreshWorkspaceFiles(this.activeConversationId);
      _invalidateConversations?.();
    } else {
      if (cleanPath) {
        // Validate directory & fetch file index immediately even on an unsaved new chat
        const res = await fetchWorkspaceFilesByPath(cleanPath);
        const resolvedPath = res.effectiveWorkspacePath || cleanPath;
        this.conversationWorkspacePath = resolvedPath;
        this.conversationWorkspaceWriteEnabled = Boolean(workspaceWriteEnabled);
        this.conversationWorkspaceApprovalMode = workspaceApprovalMode;
        this.effectiveWorkspacePath = resolvedPath;
        this.effectiveWorkspaceWriteEnabled = Boolean(workspaceWriteEnabled);
        this.effectiveWorkspaceApprovalMode = workspaceApprovalMode;
        this.workspaceSource = "conversation";
        this.workspaceFiles = res.files ?? [];
      } else {
        this.conversationWorkspacePath = null;
        this.conversationWorkspaceWriteEnabled = false;
        this.conversationWorkspaceApprovalMode = "auto";
        this.workspaceFiles = [];
        if (this.activeFolderId) {
          await this.syncUnsavedFolderWorkspace(this.activeFolderId);
        } else {
          this.effectiveWorkspacePath = null;
          this.effectiveWorkspaceWriteEnabled = false;
          this.effectiveWorkspaceApprovalMode = "auto";
          this.workspaceSource = null;
        }
      }
    }
  }

  async setConversationWorkspaceWriteEnabled(
    writeEnabled: boolean,
    approvalMode: WorkspaceApprovalMode = this.effectiveWorkspaceApprovalMode,
  ) {
    if (this.activeConversationId) {
      const patch =
        !this.conversationWorkspacePath &&
        this.workspaceSource === "folder" &&
        this.effectiveWorkspacePath
          ? {
              workspacePath: this.effectiveWorkspacePath,
              workspaceWriteEnabled: writeEnabled,
              workspaceApprovalMode: approvalMode,
            }
          : {
              workspaceWriteEnabled: writeEnabled,
              workspaceApprovalMode: approvalMode,
            };
      const updated = await updateConversation(this.activeConversationId, patch);
      this.conversationWorkspacePath = updated.workspacePath ?? null;
      this.conversationWorkspaceWriteEnabled = Boolean(updated.workspaceWriteEnabled);
      this.conversationWorkspaceApprovalMode = updated.workspaceApprovalMode ?? "auto";
      this.effectiveWorkspacePath = updated.effectiveWorkspacePath ?? null;
      this.effectiveWorkspaceWriteEnabled = Boolean(updated.effectiveWorkspaceWriteEnabled);
      this.effectiveWorkspaceApprovalMode = updated.effectiveWorkspaceApprovalMode ?? "auto";
      this.workspaceSource = updated.workspaceSource ?? null;
      _invalidateConversations?.();
    } else if (this.effectiveWorkspacePath) {
      if (!this.conversationWorkspacePath) {
        this.conversationWorkspacePath = this.effectiveWorkspacePath;
        this.workspaceSource = "conversation";
      }
      this.conversationWorkspaceWriteEnabled = writeEnabled;
      this.conversationWorkspaceApprovalMode = approvalMode;
      this.effectiveWorkspaceWriteEnabled = writeEnabled;
      this.effectiveWorkspaceApprovalMode = approvalMode;
    }
  }

  async revertCheckpoint(checkpointId: string, callId?: string | null) {
    if (!this.activeConversationId) return;
    await revertWorkspaceCheckpoint(this.activeConversationId, checkpointId);
    for (const msg of this.messages) {
      if (msg.toolExecutions) {
        for (const te of msg.toolExecutions) {
          if (te.checkpointId === checkpointId || (callId && te.callId === callId)) {
            te.reverted = true;
          }
        }
      }
      if (msg.content && msg.content.includes("<tool_execution>")) {
        msg.content = msg.content.replace(
          /<tool_execution>([\s\S]*?)<\/tool_execution>/g,
          (full, jsonStr) => {
            try {
              const parsed = JSON.parse(jsonStr);
              if (parsed.checkpointId === checkpointId || (callId && parsed.callId === callId)) {
                parsed.reverted = true;
                return `<tool_execution>${JSON.stringify(parsed)}</tool_execution>`;
              }
            } catch { }
            return full;
          },
        );
      }
    }
    await this.refreshWorkspaceFiles(this.activeConversationId);
    await artifactStore.loadConversationArtifacts(this.activeConversationId);
    if (artifactStore.isOpen && artifactStore.activeId && !artifactStore.activeId.startsWith("workspace:")) {
      await artifactStore.refreshArtifactContent(artifactStore.activeId);
    }
  }

  openFolder(folderId: string) {
    this.newConversation(folderId);
  }

  async setConversationMemoryEnabled(enabled: boolean | null) {
    this.conversationMemoryEnabled = enabled;
    if (this.activeConversationId) {
      try {
        await patchConversationTools(this.activeConversationId, { memoryEnabled: enabled });
      } catch (err) {
        console.warn("[chatStore] failed to persist memoryEnabled:", err);
      }
    }
  }

  async updateSessionOverrides(patch: {
    systemPromptOverride?: string | null;
    samplingOverrides?: ConversationSamplingOverrides | null;
  }) {
    if (patch.systemPromptOverride !== undefined) {
      this.conversationSystemPromptOverride = patch.systemPromptOverride;
    }
    if (patch.samplingOverrides !== undefined) {
      this.conversationSamplingOverrides = patch.samplingOverrides;
    }
    if (this.activeConversationId) {
      try {
        await patchConversationTools(this.activeConversationId, patch);
      } catch (err) {
        console.warn("[chatStore] failed to persist session overrides:", err);
      }
    }
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

  /**
   * Toggle a specific tool or skill name in/out of the forced/pinned tools list for routing.
   */
  toggleForcedTool(toolOrSkillName: string) {
    this.conversationForcedTools = this.conversationForcedTools.includes(toolOrSkillName)
      ? this.conversationForcedTools.filter((n) => n !== toolOrSkillName)
      : [...this.conversationForcedTools, toolOrSkillName];
  }

  /** Edit a message content in place (Save option) */
  async editMessage(msgId: string, newContent: string, attachmentIds?: string[]) {
    if (!this.activeConversationId) return;
    const msg = this.messages.find((m) => m.id === msgId);
    if (!msg) return;

    const contentToSave =
      msg.role === "assistant"
        ? reconstructEditedMessageContent(msg.content, newContent, msg.thinkingContent)
        : newContent;

    msg.content = contentToSave;
    if (msg.role === "assistant") {
      const parsed = parseThinking(contentToSave);
      msg.thinkingContent = parsed.thinkingContent;
      msg.thinkingDone = parsed.thinkingDone;
    }

    try {
      const updated = await patchMessage(this.activeConversationId, msgId, contentToSave, attachmentIds);
      msg.attachments = updated.attachments;
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

    // Snapshot active continuation survivor before deleting/reparenting
    const priorActivePath = this.activePath;
    const targetIdxInPath = priorActivePath.findIndex((m) => m.id === msgId);
    let activeContinuationSurvivorId: string | undefined;
    if (target.role === "user" && targetIdxInPath !== -1) {
      const nextInPath = priorActivePath[targetIdxInPath + 1];
      if (nextInPath?.role === "assistant") {
        activeContinuationSurvivorId = priorActivePath[targetIdxInPath + 2]?.id;
      } else if (nextInPath) {
        activeContinuationSurvivorId = nextInPath.id;
      }
    }

    try {
      await apiDeleteMessage(convId, msgId);
    } catch (err) {
      console.warn("[chatStore] backend delete message call failed, removing locally anyway:", err);
    }

    try {
      const deletedIds = new Set<string>();

      if (target.role === "user") {
        const newParentId = target.parentId ?? null;
        const childAssts = this.messages.filter(
          (m) => m.parentId === msgId && m.role === "assistant",
        );

        deletedIds.add(msgId);

        if (childAssts.length > 0) {
          // Each assistant branch: lift its children up to the user msg's parent,
          // then mark the assistant itself for deletion.
          for (const asst of childAssts) {
            for (const m of this.messages) {
              if (m.parentId === asst.id) {
                m.parentId = newParentId;
              }
            }
            deletedIds.add(asst.id);
          }
        } else {
          // No assistant branches: reparent any direct children up to the user's parent.
          for (const m of this.messages) {
            if (m.parentId === msgId) {
              m.parentId = newParentId;
            }
          }
        }
      } else {
        // Assistant message: delete it and ALL descendants (full subtree),
        // matching the backend's recursive CTE delete.
        deletedIds.add(msgId);
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
      }

      this.messages = this.messages.filter((m) => !deletedIds.has(m.id));

      // Clean up branch selections pointing at deleted messages OR keyed by
      // deleted parents (e.g. the deleted user msg id, or deleted assistant ids).
      const updatedSelections: Record<string, string> = {};
      for (const [pKey, childId] of Object.entries(this.branchSelections)) {
        if (!deletedIds.has(childId) && !deletedIds.has(pKey)) {
          updatedSelections[pKey] = childId;
        }
      }

      // Preserve the active branch continuation for reparented children
      if (
        target.role === "user" &&
        activeContinuationSurvivorId &&
        !deletedIds.has(activeContinuationSurvivorId)
      ) {
        const pKey = target.parentId ?? "ROOT";
        updatedSelections[pKey] = activeContinuationSurvivorId;
      }

      this.branchSelections = updatedSelections;
      this.saveBranchSelections();

      if (this.messages.length === 0) {
        try {
          await deleteConversation(convId);
        } catch (e) {
          // Ignore if already deleted by backend
        }
        this.clearDraft(convId);
        this.clearQueuedMessages(convId);
        this.newConversation();
      }

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

      const branchAttachmentIds = newBranchUserMsg.attachments?.map((a) => a.id) ?? attachmentIds;
      await this.triggerAssistantResponse(newMsgObj, branchAttachmentIds);
    } catch (err) {
      console.error("[chatStore] failed to branch message:", err);
    }
  }

  /** Regenerate an assistant response (optionally using a specific model override) */
  async regenerate(assistantMsgId: string, modelOverride?: string) {
    if (this.isStreaming || !this.activeConversationId) return;
    const asstMsg = this.messages.find((m) => m.id === assistantMsgId);
    if (!asstMsg || asstMsg.role !== "assistant") return;

    const userParentMsg = this.messages.find((m) => m.id === asstMsg.parentId);
    if (!userParentMsg) return;

    if (modelOverride) {
      this.setModel(modelOverride);
    }
    const attachmentIds = userParentMsg.attachments?.map((a) => a.id);
    await this.triggerAssistantResponse(userParentMsg, attachmentIds);
  }

  async continueResponse(assistantMsgId?: string) {
    if (this.isStreaming) return;
    if (!this.activeConversationId) return;

    const currentActivePath = this.activePath;
    const targetMsg = assistantMsgId
      ? currentActivePath.find((m) => m.id === assistantMsgId) ??
        this.messages.find((m) => m.id === assistantMsgId)
      : currentActivePath[currentActivePath.length - 1];
    if (!targetMsg || targetMsg.role !== "assistant") return;

    if (targetMsg.streaming) return;

    await this.triggerAssistantResponse(targetMsg, undefined, { isContinue: true });
  }

  async send(content: string, injectedTools?: SlashToolSelection[]) {
    const trimmed = content.trim();
    const draftKey = this.currentDraftKey;
    const currentAttachments = this.pendingAttachments;
    if (!trimmed && currentAttachments.length === 0) return;
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

    const userAttachments = [...currentAttachments];
    this.clearDraft(draftKey);
    await this.dispatchMessage(trimmed, userAttachments, injectedTools);
  }

  private async dispatchMessage(
    trimmed: string,
    userAttachments: AttachmentOut[],
    injectedTools?: SlashToolSelection[],
  ) {
    if (!this.selectedModel) return;
    const attachmentIds = userAttachments.map((a) => a.id);

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
        const targetFolderId = this.activeFolderId;
        const conv = await createConversation({
          title: excerpt,
          model: this.selectedModel ?? undefined,
          toolsEnabled: this.conversationToolsEnabled,
          folderId: targetFolderId ?? undefined,
          workspacePath: this.conversationWorkspacePath ?? undefined,
          workspaceWriteEnabled: this.conversationWorkspaceWriteEnabled,
          workspaceApprovalMode: this.conversationWorkspaceApprovalMode,
        });
        this.activeConversationId = conv.id;
        this.activeFolderId = null;
        this.conversationFolderId = conv.folderId ?? null;
        this.conversationWorkspacePath = conv.workspacePath ?? null;
        this.conversationWorkspaceWriteEnabled = Boolean(conv.workspaceWriteEnabled);
        this.conversationWorkspaceApprovalMode = conv.workspaceApprovalMode ?? "auto";
        this.effectiveWorkspacePath = conv.effectiveWorkspacePath ?? null;
        this.effectiveWorkspaceWriteEnabled = Boolean(conv.effectiveWorkspaceWriteEnabled);
        this.effectiveWorkspaceApprovalMode = conv.effectiveWorkspaceApprovalMode ?? "auto";
        this.workspaceSource = conv.workspaceSource ?? null;
        void this.refreshWorkspaceFiles(conv.id);
        newConvId = conv.id;
        this.activeConversationTitle = conv.title;
        _invalidateConversations?.();

        // Persist any pending per-conversation exclusions for the new conversation
        const hasPendingExclusions =
          this.conversationExcludedMcps.length > 0 || this.conversationExcludedSkills.length > 0;
        if (hasPendingExclusions) {
          try {
            await patchConversationTools(conv.id, {
              excludedMcps: this.conversationExcludedMcps,
              excludedSkills: this.conversationExcludedSkills,
            });
          } catch { }
        }
      } catch (err) {
        console.error("[chatStore] Failed to pre-create conversation:", err);
      }
    }

    // Start assistant response FIRST so the main chat completion starts streaming immediately
    const assistantPromise = this.triggerAssistantResponse(userMessage, attachmentIds, {
      injectedTools,
    });

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

    if (this.autoNameController) {
      this.autoNameController.abort();
    }
    const controller = new AbortController();
    this.autoNameController = controller;

    const applyTitle = (title: string) => {
      if (title) {
        if (this.activeConversationId === conversationId) {
          this.activeConversationTitle = title;
        }
        _invalidateConversations?.();
      }
    };

    const sameBackend = targetModelId.split(":")[0] === activeModelId.split(":")[0];

    const waitForStreamFinish = async () => {
      if (!this.isStreaming) return;
      await new Promise<void>((resolve) => {
        const checkDone = setInterval(() => {
          if (!this.isStreaming || controller.signal.aborted) {
            clearInterval(checkDone);
            resolve();
          }
        }, 250);
      });
    };

    const performAutoName = async () => {
      // When targeting the same backend as the active chat stream, wait for the main
      // response to finish first so local single-model servers don't queue or thrash KV cache.
      if (sameBackend) {
        await waitForStreamFinish();
        if (controller.signal.aborted) return;
        try {
          const res = await autoNameConversation(conversationId, userContent, targetModelId, controller.signal);
          applyTitle(res.title);
        } catch (err) {
          if (!controller.signal.aborted) {
            console.error("[chatStore] Auto-naming failed:", err);
          }
        }
        return;
      }

      // Separate designated backend: try parallel attempt after a 50ms head-start
      await new Promise((r) => setTimeout(r, 50));
      if (controller.signal.aborted) return;

      try {
        const res = await autoNameConversation(conversationId, userContent, targetModelId, controller.signal);
        applyTitle(res.title);
        return;
      } catch (err) {
        if (controller.signal.aborted) return;
        console.info("[chatStore] Parallel auto-naming failed/rejected, will retry after response completes:", err);
      }

      await waitForStreamFinish();
      if (controller.signal.aborted) return;

      try {
        const res = await autoNameConversation(conversationId, userContent, targetModelId, controller.signal);
        applyTitle(res.title);
      } catch (fallbackErr) {
        if (!controller.signal.aborted) {
          console.error("[chatStore] Sequential auto-naming failed:", fallbackErr);
        }
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
    options?: { isContinue?: boolean; injectedTools?: SlashToolSelection[] }
  ) {
    if (!this.selectedModel) return;

    let currentUserId: string;
    let currentAsstId: string;
    let assistantMessage: ChatMessage | undefined;
    let initialContent = "";

    if (options?.isContinue) {
      // Resume existing assistant message
      currentAsstId = userMsg.id;
      assistantMessage = userMsg as ChatMessage;
      currentUserId = assistantMessage.parentId ?? "";
      assistantMessage.model = this.selectedModel;
      initialContent = assistantMessage.content || "";
    } else {
      // Create new assistant message
      currentUserId = userMsg.id;
      currentAsstId = makeId();
      assistantMessage = {
        id: currentAsstId,
        parentId: currentUserId,
        role: "assistant",
        content: "",
        status: options?.injectedTools && options.injectedTools.length > 0 ? "generating" : "routing",
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
    }

    if (!assistantMessage) return;

    // Build model history along active path leading to userMsg (or target assistant message on continue)
    const activePath = this.activePath;
    const asstIdxInPath = activePath.findIndex((m) => m.id === currentAsstId);
    const relevantPath =
      options?.isContinue && asstIdxInPath !== -1
        ? activePath.slice(0, asstIdxInPath + 1)
        : activePath;

    const historyForModel = relevantPath
      .filter((m) => (options?.isContinue ? !m.error : m.id !== currentAsstId && !m.error))
      .map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        attachments: m.attachments?.map((a) => a.id),
      }));

    this.isStreaming = true;
    this.wasAborted = false;
    this.streamingConvId = this.activeConversationId;
    this.streamingAssistantId = currentAsstId;
    artifactStore.resetUserClosed();
    clearArtifactRegistry();
    this.abortController = new AbortController();
    let rawBuffer = "";

    if (options?.isContinue) {
      rawBuffer = assistantMessage.content || "";
      assistantMessage.streaming = true;
      assistantMessage.error = undefined;
      assistantMessage.status = "generating";
      const parsed = parseThinking(rawBuffer);
      assistantMessage.thinkingContent = parsed.thinkingContent;
      assistantMessage.thinkingDone = parsed.thinkingDone;
    }

    await streamChatCompletion({
      model: this.selectedModel,
      messages: historyForModel,
      conversationId: this.activeConversationId,
      userMessageId: options?.isContinue ? undefined : currentUserId,
      userParentId: options?.isContinue ? undefined : userMsg.parentId ?? null,
      assistantMessageId: currentAsstId,
      isContinue: options?.isContinue,
      attachmentIds,
      toolsEnabled: this.conversationToolsEnabled,
      excludedMcps: this.conversationExcludedMcps,
      excludedSkills: this.conversationExcludedSkills,
      forcedTools: this.conversationForcedTools,
      injectedTools: options?.injectedTools,
      memoryEnabled: this.conversationMemoryEnabled,
      systemPromptOverride: this.conversationSystemPromptOverride,
      samplingOverrides: this.conversationSamplingOverrides,
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
        const routerBlock = `<router_execution>${msg.routerOutput}</router_execution>\n`;
        rawBuffer = routerBlock + (options?.isContinue ? initialContent : "");
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

        const sanitizedBuffer = rawBuffer.replace(/<tool_execution>[\s\S]*?<\/tool_execution>/g, "");
        let thinkStartCount = 0;
        let thinkEndCount = 0;
        for (const tag of THINK_TAG_NAMES) {
          thinkStartCount += (sanitizedBuffer.match(new RegExp(`<${tag}>`, "gi")) || []).length;
          thinkEndCount += (sanitizedBuffer.match(new RegExp(`</${tag}>`, "gi")) || []).length;
        }
        if (thinkStartCount > thinkEndCount) {
          rawBuffer += "\n</think>\n";
        }

        if (evt.status === "completed" || evt.status === "error" || evt.status === "cancelled") {
          rawBuffer += `\n<tool_execution>${JSON.stringify(evt)}</tool_execution>\n`;
          if (
            evt.status === "completed" &&
            (evt.toolName === "workspace_write" ||
              evt.toolName === "workspace_edit" ||
              evt.toolName === "workspace_delete" ||
              evt.toolName === "workspace_rename")
          ) {
            void this.refreshWorkspaceFiles();
          }
        }

        const parsed = parseThinking(rawBuffer);
        msg.thinkingContent = parsed.thinkingContent;
        msg.thinkingDone = parsed.thinkingDone;
        msg.content = rawBuffer;
      },
      onToolProgress: (evt) => {
        const msg = this.messages.find((m) => m.id === currentAsstId);
        if (!msg) return;

        if (!msg.toolExecutions) msg.toolExecutions = [];
        const idx = msg.toolExecutions.findIndex((t) => t.callId === evt.callId);

        if (idx >= 0) {
          msg.toolExecutions[idx] = {
            ...msg.toolExecutions[idx],
            status: "polling",
            progress: evt.progress,
            total: evt.total,
            message: evt.message,
            jobId: evt.jobId,
            elapsedMs: evt.elapsedMs,
            attempts: evt.attempts,
          };
        } else {
          msg.toolExecutions.push({
            callId: evt.callId,
            toolName: evt.toolName ?? "",
            args: (evt as any).args ?? {},
            status: "polling",
            progress: evt.progress,
            total: evt.total,
            message: evt.message,
            jobId: evt.jobId,
            elapsedMs: evt.elapsedMs,
            attempts: evt.attempts,
          });
        }
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
      onContextTrimmed: (evt) => {
        const msg = this.messages.find((m) => m.id === currentAsstId);
        if (!msg) return;
        const notice = `<context_notice>${JSON.stringify({
          kind: "trimmed",
          message: `Trimmed ${evt.droppedMessageCount} older message(s) (${evt.behavior}) to fit context window.`,
        })}</context_notice>\n\n`;
        if (!rawBuffer.includes(notice)) {
          rawBuffer = notice + rawBuffer;
          msg.content = rawBuffer;
        }
      },
      onContextOverflow: (evt) => {
        const msg = this.messages.find((m) => m.id === currentAsstId);
        if (msg) {
          msg.error = `Context Overflow: ${evt.reason}`;
        }
      },
      onToolsPruned: (evt) => {
        const msg = this.messages.find((m) => m.id === currentAsstId);
        if (!msg) return;
        const notice = `<context_notice>${JSON.stringify({
          kind: "tools_pruned",
          message: `Pruned ${evt.prunedCount} tool(s) to fit context window: ${evt.droppedToolNames.join(", ")}.`,
        })}</context_notice>\n\n`;
        if (!rawBuffer.includes(notice)) {
          rawBuffer = notice + rawBuffer;
          msg.content = rawBuffer;
        }
      },
      onArtifactCreated: (evt) => {
        registerArtifact(evt.filename, {
          id: evt.artifactId,
          title: evt.title,
          lang: evt.language,
        });
        artifactStore.loadArtifact(evt.artifactId, evt.conversationId, evt.filename, evt.title, evt.language);
        artifactStore.loadConversationArtifacts(evt.conversationId);
      },
      onArtifactUpdated: (evt) => {
        registerArtifact(evt.filename, {
          id: evt.artifactId,
          title: evt.title,
          lang: evt.language,
        });
        artifactStore.refreshArtifactContent(evt.artifactId);
        artifactStore.loadConversationArtifacts(evt.conversationId);
      },
      onScratchpadUpdated: (evt) => {
        if (evt.conversationId === this.activeConversationId || !this.activeConversationId) {
          this.scratchpadEntries = evt.entries;
        }
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
        const finishedKey = this.streamingConvId ?? this.currentDraftKey;
        this.isStreaming = false;
        this.streamingConvId = null;
        this.streamingAssistantId = null;
        this.abortController = null;
        this.flushNextQueued(finishedKey);
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
    this.wasAborted = false;
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
      isReconnect: true,
      toolsEnabled: this.conversationToolsEnabled,
      excludedMcps: this.conversationExcludedMcps,
      excludedSkills: this.conversationExcludedSkills,
      forcedTools: this.conversationForcedTools,
      memoryEnabled: this.conversationMemoryEnabled,
      systemPromptOverride: this.conversationSystemPromptOverride,
      samplingOverrides: this.conversationSamplingOverrides,
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
      onToolExecution: (evt) => {
        const msg = this.messages.find((m) => m.id === asstMsg.id);
        if (!msg) return;
        if (!msg.toolExecutions) msg.toolExecutions = [];
        const idx = msg.toolExecutions.findIndex((t) => t.callId === evt.callId);
        if (idx >= 0) {
          msg.toolExecutions[idx] = evt;
        } else {
          msg.toolExecutions.push(evt);
        }
        if (evt.status === "completed" || evt.status === "error" || evt.status === "cancelled") {
          rawBuffer += `\n<tool_execution>${JSON.stringify(evt)}</tool_execution>\n`;
          if (
            evt.status === "completed" &&
            (evt.toolName === "workspace_write" ||
              evt.toolName === "workspace_edit" ||
              evt.toolName === "workspace_delete" ||
              evt.toolName === "workspace_rename")
          ) {
            void this.refreshWorkspaceFiles();
          }
        }
        const parsed = parseThinking(rawBuffer);
        msg.thinkingContent = parsed.thinkingContent;
        msg.thinkingDone = parsed.thinkingDone;
        msg.content = rawBuffer;
      },
      onToolProgress: (evt) => {
        const msg = this.messages.find((m) => m.id === asstMsg.id);
        if (!msg) return;
        if (!msg.toolExecutions) msg.toolExecutions = [];
        const idx = msg.toolExecutions.findIndex((t) => t.callId === evt.callId);
        if (idx >= 0) {
          msg.toolExecutions[idx] = {
            ...msg.toolExecutions[idx],
            status: "polling",
            progress: evt.progress,
            total: evt.total,
            message: evt.message,
            jobId: evt.jobId,
            elapsedMs: evt.elapsedMs,
            attempts: evt.attempts,
          };
        } else {
          msg.toolExecutions.push({
            callId: evt.callId,
            toolName: evt.toolName ?? "",
            args: (evt as any).args ?? {},
            status: "polling",
            progress: evt.progress,
            total: evt.total,
            message: evt.message,
            jobId: evt.jobId,
            elapsedMs: evt.elapsedMs,
            attempts: evt.attempts,
          });
        }
      },
      onContentReplace: (content) => {
        const msg = this.messages.find((m) => m.id === asstMsg.id);
        if (!msg) return;
        rawBuffer = content;
        const parsed = parseThinking(rawBuffer);
        msg.thinkingContent = parsed.thinkingContent;
        msg.thinkingDone = parsed.thinkingDone;
        msg.content = rawBuffer;
      },
      onContextTrimmed: (evt) => {
        const msg = this.messages.find((m) => m.id === asstMsg.id);
        if (!msg) return;
        const notice = `<context_notice>${JSON.stringify({
          kind: "trimmed",
          message: `Trimmed ${evt.droppedMessageCount} older message(s) (${evt.behavior}) to fit context window.`,
        })}</context_notice>\n\n`;
        if (!rawBuffer.includes(notice)) {
          rawBuffer = notice + rawBuffer;
          msg.content = rawBuffer;
        }
      },
      onContextOverflow: (evt) => {
        const msg = this.messages.find((m) => m.id === asstMsg.id);
        if (msg) {
          msg.streaming = false;
          msg.error = `Context Overflow: ${evt.reason}`;
        }
        this.isStreaming = false;
        this.streamingConvId = null;
        this.streamingAssistantId = null;
        this.abortController = null;
      },
      onToolsPruned: (evt) => {
        const msg = this.messages.find((m) => m.id === asstMsg.id);
        if (!msg) return;
        const notice = `<context_notice>${JSON.stringify({
          kind: "tools_pruned",
          message: `Pruned ${evt.prunedCount} tool(s) to fit context window: ${evt.droppedToolNames.join(", ")}.`,
        })}</context_notice>\n\n`;
        if (!rawBuffer.includes(notice)) {
          rawBuffer = notice + rawBuffer;
          msg.content = rawBuffer;
        }
      },
      onArtifactCreated: (evt) => {
        registerArtifact(evt.filename, {
          id: evt.artifactId,
          title: evt.title,
          lang: evt.language,
        });
        artifactStore.loadArtifact(evt.artifactId, evt.conversationId, evt.filename, evt.title, evt.language);
        artifactStore.loadConversationArtifacts(evt.conversationId);
      },
      onArtifactUpdated: (evt) => {
        registerArtifact(evt.filename, {
          id: evt.artifactId,
          title: evt.title,
          lang: evt.language,
        });
        artifactStore.refreshArtifactContent(evt.artifactId);
        artifactStore.loadConversationArtifacts(evt.conversationId);
      },
      onScratchpadUpdated: (evt) => {
        if (evt.conversationId === this.activeConversationId || !this.activeConversationId) {
          this.scratchpadEntries = evt.entries;
        }
      },
      onDone: () => {
        const msg = this.messages.find((m) => m.id === asstMsg.id);
        if (msg) msg.streaming = false;
        const finishedKey = this.streamingConvId ?? this.currentDraftKey;
        this.isStreaming = false;
        this.streamingConvId = null;
        this.streamingAssistantId = null;
        this.abortController = null;
        this.flushNextQueued(finishedKey);
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
    this.wasAborted = true;
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
      if (msg) {
        msg.streaming = false;
        if (msg.toolExecutions) {
          for (let i = 0; i < msg.toolExecutions.length; i++) {
            const t = msg.toolExecutions[i];
            if (t.status === "executing" || t.status === "polling") {
              msg.toolExecutions[i] = {
                ...t,
                status: "cancelled",
              };
              const cancelTag = `<tool_execution>${JSON.stringify(msg.toolExecutions[i])}</tool_execution>`;
              if (!msg.content.includes(t.callId)) {
                msg.content += `\n${cancelTag}\n`;
              }
            }
          }
        }
      }
    }

    this.isStreaming = false;
    this.streamingConvId = null;
    this.streamingAssistantId = null;
  }

  clear() {
    this.messages = [];
    this.activeConversationId = null;
    this.activeConversationTitle = "New conversation";
    this.clearDraft(NEW_DRAFT_KEY);
    this.clearQueuedMessages(NEW_DRAFT_KEY);
    this.selectedAttachment = null;
    this.branchSelections = {};
    this.conversationForcedTools = [];
    this.streamingConvId = null;
    this.streamingAssistantId = null;
    artifactStore.close();
  }
}

export const chatStore = new ChatStore();
