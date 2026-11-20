<script lang="ts">
  import { onMount } from "svelte";
  import { createQuery, useQueryClient } from "@tanstack/svelte-query";
  import {
    PanelLeftClose,
    SquarePen,
    Trash2,
    Settings,
    X,
    ChevronUp,
    ChevronDown,
    ChevronRight,
    Plus,
    MoreHorizontal,
    Pencil,
    Search,
    Pin,
    Archive,
    Download,
    Folder,
    CheckSquare,
    Check,
  } from "@lucide/svelte";
  import {
    fetchBackends,
    fetchConversations,
    fetchFolders,
    createFolder,
    updateFolder,
    deleteFolder,
    deleteConversation,
    updateConversation,
    batchUpdateConversations,
    searchConversations,
    exportConversationUrl,
    triggerDownload,
  } from "../api";
  import { chatStore } from "../stores/chat.svelte";
  import { confirmStore } from "../stores/confirmStore.svelte";
  import { desktopWindow } from "../stores/window.svelte";
  import type { ConversationSummary, FolderInfo } from "../types";
  import Dropdown from "./ui/Dropdown.svelte";
  import TextInputModal from "./ui/TextInputModal.svelte";
  import FolderModal from "./FolderModal.svelte";
  import MoveToFolderModal from "./MoveToFolderModal.svelte";
  import Logo from "./Logo.svelte";
  import { slide } from "svelte/transition";

  interface Props {
    onOpenSettings: () => void;
    onCloseMobile?: () => void;
    onToggleSidebar?: () => void;
    collapsed?: boolean;
  }
  const {
    onOpenSettings,
    onCloseMobile,
    onToggleSidebar,
    collapsed = false,
  }: Props = $props();

  const queryClient = useQueryClient();

  const backendsQuery = createQuery(() => ({
    queryKey: ["backends"],
    queryFn: fetchBackends,
    refetchInterval: 10_000,
  }));

  const convsQuery = createQuery(() => ({
    queryKey: ["conversations"],
    queryFn: fetchConversations,
    refetchInterval: 30_000,
  }));

  const foldersQuery = createQuery(() => ({
    queryKey: ["folders"],
    queryFn: fetchFolders,
    refetchInterval: 30_000,
  }));

  let deletingId = $state<string | null>(null);
  let showBackends = $state(false);
  let foldersSectionOpen = $state(true);
  let chatsSectionOpen = $state(true);
  let renameConv = $state<ConversationSummary | null>(null);
  let renameInputValue = $state("");
  let openDropdownId = $state<string | null>(null);
  let searchQuery = $state("");
  let showArchived = $state(false);
  let selectionMode = $state(false);
  let selectedIds = $state<Record<string, boolean>>({});
  let moveTargetIds = $state<string[] | null>(null);
  let moveCurrentFolderId = $state<string | null>(null);
  let folderModalMode = $state<"create" | "edit" | null>(null);
  let editingFolder = $state<FolderInfo | null>(null);
  let folderFormName = $state("");
  let folderFormDesc = $state("");
  let isSavingFolder = $state(false);
  let dragOverTarget = $state<string | null>(null);
  let isBatchWorking = $state(false);
  let visibleLimit = $state(40);
  let sidebarError = $state<string | null>(null);

  const searchHitsQuery = createQuery(() => ({
    queryKey: ["conversationSearch", searchQuery.trim(), showArchived],
    queryFn: () => searchConversations(searchQuery.trim(), showArchived),
    enabled: searchQuery.trim().length >= 2,
    staleTime: 5_000,
  }));

  let snippetByConvId = $derived.by(() => {
    const map = new Map<string, string>();
    for (const hit of searchHitsQuery.data ?? []) {
      if (!map.has(hit.conversationId) && hit.snippet) {
        map.set(hit.conversationId, hit.snippet);
      }
    }
    return map;
  });

  let archivedCount = $derived(
    (convsQuery.data ?? []).filter((c) => c.isArchived).length,
  );

  let folders = $derived(foldersQuery.data ?? []);

  let filteredAllConversations = $derived.by(() => {
    const list = (convsQuery.data ?? []).filter((c) =>
      showArchived ? Boolean(c.isArchived) : !c.isArchived,
    );
    const q = searchQuery.trim().toLowerCase();
    if (!q) return list;
    const hitConvIds = new Set(
      (searchHitsQuery.data ?? []).map((h) => h.conversationId),
    );
    return list.filter(
      (c) => c.title.toLowerCase().includes(q) || hitConvIds.has(c.id),
    );
  });

  let folderConversationsMap = $derived.by(() => {
    const map = new Map<string, ConversationSummary[]>();
    for (const c of filteredAllConversations) {
      if (!showArchived && c.folderId) {
        const arr = map.get(c.folderId);
        if (arr) arr.push(c);
        else map.set(c.folderId, [c]);
      }
    }
    return map;
  });

  let rootConversations = $derived.by(() => {
    if (showArchived) return filteredAllConversations;
    return filteredAllConversations.filter((c) => !c.folderId);
  });

  let visibleRootConversations = $derived(
    rootConversations.slice(0, visibleLimit),
  );

  let selectedIdList = $derived(
    Object.keys(selectedIds).filter((id) => selectedIds[id]),
  );

  let longPressTimer: ReturnType<typeof setTimeout> | null = null;
  let longPressOrigin: { x: number; y: number } | null = null;
  let suppressNextClickId = $state<string | null>(null);

  function clearLongPress() {
    if (longPressTimer) {
      clearTimeout(longPressTimer);
      longPressTimer = null;
    }
    longPressOrigin = null;
  }

  function handleConvPointerDown(
    e: PointerEvent,
    conv: ConversationSummary,
    isDisabled: boolean,
  ) {
    if (isDisabled || selectionMode || e.button !== 0) return;
    if ((e.target as HTMLElement | null)?.closest("button, a, input, [role='menu']")) {
      return;
    }
    clearLongPress();
    longPressOrigin = { x: e.clientX, y: e.clientY };
    longPressTimer = setTimeout(() => {
      longPressTimer = null;
      longPressOrigin = null;
      suppressNextClickId = conv.id;
      selectionMode = true;
      selectedIds = { [conv.id]: true };
    }, 480);
  }

  function handleConvPointerMove(e: PointerEvent) {
    if (!longPressOrigin) return;
    if (Math.hypot(e.clientX - longPressOrigin.x, e.clientY - longPressOrigin.y) > 8) {
      clearLongPress();
    }
  }

  function toggleSelectConv(id: string) {
    const next = {
      ...selectedIds,
      [id]: !selectedIds[id],
    };
    selectedIds = next;
    if (selectionMode && !Object.values(next).some(Boolean)) {
      selectionMode = false;
    }
  }

  function selectAllFiltered() {
    const next: Record<string, boolean> = {};
    for (const c of filteredAllConversations) {
      next[c.id] = true;
    }
    selectedIds = next;
  }

  function openCreateFolderModal() {
    if (chatStore.isStreaming) return;
    editingFolder = null;
    folderFormName = "";
    folderFormDesc = "";
    folderModalMode = "create";
  }

  function openEditFolderModal(folder: FolderInfo) {
    if (chatStore.isStreaming) return;
    editingFolder = folder;
    folderFormName = folder.name;
    folderFormDesc = folder.description || "";
    folderModalMode = "edit";
  }

  async function submitFolderModal(name: string, description: string) {
    isSavingFolder = true;
    try {
      sidebarError = null;
      if (folderModalMode === "create") {
        const created = await createFolder({ name, description });
        foldersSectionOpen = true;
        await queryClient.invalidateQueries({ queryKey: ["folders"] });
        chatStore.openFolder(created.id);
        onCloseMobile?.();
      } else if (folderModalMode === "edit" && editingFolder) {
        await updateFolder(editingFolder.id, { name, description });
        await queryClient.invalidateQueries({ queryKey: ["folders"] });
        await queryClient.invalidateQueries({ queryKey: ["conversations"] });
      }
      folderModalMode = null;
      editingFolder = null;
    } catch (err) {
      sidebarError = `Failed to save folder: ${(err as Error).message || "Unknown error"}`;
    } finally {
      isSavingFolder = false;
    }
  }

  async function handleToggleFolderExpand(folder: FolderInfo) {
    try {
      await updateFolder(folder.id, { isExpanded: !folder.isExpanded });
      await queryClient.invalidateQueries({ queryKey: ["folders"] });
    } catch (err) {
      sidebarError = `Failed to toggle folder: ${(err as Error).message || "Unknown error"}`;
    }
  }

  async function handleDeleteFolder(folder: FolderInfo) {
    if (chatStore.isStreaming) return;
    const confirmed = await confirmStore.confirm({
      title: "Delete Folder",
      message: `Delete folder "${folder.name}"? Conversations inside will be kept in Chats.`,
      confirmText: "Delete",
      confirmStyle: "danger",
      cancelText: "Cancel",
      cancelStyle: "ghost",
      cancelOutline: true,
    });
    if (!confirmed) return;
    try {
      sidebarError = null;
      await deleteFolder(folder.id);
      if (chatStore.activeFolderId === folder.id) {
        chatStore.newConversation();
      }
      await queryClient.invalidateQueries({ queryKey: ["folders"] });
      await queryClient.invalidateQueries({ queryKey: ["conversations"] });
    } catch (err) {
      sidebarError = `Failed to delete folder: ${(err as Error).message || "Unknown error"}`;
    }
  }

  function openMoveModal(ids: string[], currentFolderId: string | null = null) {
    if (chatStore.isStreaming || ids.length === 0) return;
    moveTargetIds = ids;
    moveCurrentFolderId = currentFolderId;
  }

  async function moveConversationsToFolder(ids: string[], folderId: string | null) {
    try {
      sidebarError = null;
      if (ids.length === 1) {
        await updateConversation(ids[0], { folderId });
      } else {
        await batchUpdateConversations(ids, "set_folder", folderId);
      }
      if (folderId) {
        const target = folders.find((f) => f.id === folderId);
        if (target && !target.isExpanded) {
          await updateFolder(folderId, { isExpanded: true });
          await queryClient.invalidateQueries({ queryKey: ["folders"] });
        }
      }
      await queryClient.invalidateQueries({ queryKey: ["conversations"] });
    } catch (err) {
      sidebarError = `Failed to move conversation: ${(err as Error).message || "Unknown error"}`;
    }
  }

  async function submitMoveModal(folderId: string | null) {
    const ids = moveTargetIds;
    moveTargetIds = null;
    if (!ids || ids.length === 0) return;
    await moveConversationsToFolder(ids, folderId);
    if (selectionMode) {
      selectedIds = {};
      selectionMode = false;
    }
  }

  async function handleQuickCreateFolderFromMove(name: string): Promise<FolderInfo | null> {
    try {
      const created = await createFolder({ name, description: "" });
      foldersSectionOpen = true;
      await queryClient.invalidateQueries({ queryKey: ["folders"] });
      return created;
    } catch (err) {
      sidebarError = `Failed to create folder: ${(err as Error).message || "Unknown error"}`;
      return null;
    }
  }

  function handleConvDragStart(e: DragEvent, conv: ConversationSummary) {
    if (chatStore.isStreaming || !e.dataTransfer) return;
    const idsToDrag =
      selectionMode && selectedIds[conv.id] && selectedIdList.length > 0
        ? selectedIdList
        : [conv.id];
    e.dataTransfer.setData("application/x-blombrain-conv", JSON.stringify(idsToDrag));
    e.dataTransfer.effectAllowed = "move";
  }

  function handleFolderDragOver(e: DragEvent, targetKey: string) {
    if (!e.dataTransfer?.types?.includes("application/x-blombrain-conv")) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    dragOverTarget = targetKey;
  }

  function handleFolderDragLeave(targetKey: string) {
    if (dragOverTarget === targetKey) {
      dragOverTarget = null;
    }
  }

  async function handleFolderDrop(e: DragEvent, folderId: string | null) {
    dragOverTarget = null;
    const raw = e.dataTransfer?.getData("application/x-blombrain-conv");
    if (!raw) return;
    e.preventDefault();
    try {
      const ids = JSON.parse(raw);
      if (Array.isArray(ids) && ids.length > 0) {
        await moveConversationsToFolder(ids, folderId);
        if (selectionMode) {
          selectedIds = {};
          selectionMode = false;
        }
      }
    } catch { }
  }

  async function handleBatchAction(action: "archive" | "unarchive" | "delete") {
    const ids = selectedIdList;
    if (ids.length === 0 || isBatchWorking || chatStore.isStreaming) return;
    if (action === "delete") {
      const confirmed = await confirmStore.confirm({
        title: `Delete ${ids.length} Conversation${ids.length === 1 ? "" : "s"}`,
        message: `Are you sure you want to permanently delete ${ids.length} selected conversation${ids.length === 1 ? "" : "s"}?`,
        confirmText: "Delete",
        confirmStyle: "danger",
        cancelText: "Cancel",
        cancelStyle: "ghost",
        cancelOutline: true,
      });
      if (!confirmed) return;
    }

    isBatchWorking = true;
    try {
      sidebarError = null;
      await batchUpdateConversations(ids, action);
      if (action === "delete") {
        for (const id of ids) {
          chatStore.clearDraft(id);
          chatStore.clearQueuedMessages(id);
        }
        if (chatStore.activeConversationId && ids.includes(chatStore.activeConversationId)) {
          chatStore.newConversation();
        }
      }
      selectedIds = {};
      selectionMode = false;
      await queryClient.invalidateQueries({ queryKey: ["conversations"] });
    } catch (err) {
      sidebarError = `Batch action failed: ${(err as Error).message || "Unknown error"}`;
    } finally {
      isBatchWorking = false;
    }
  }

  async function handleTogglePin(conv: ConversationSummary) {
    try {
      sidebarError = null;
      await updateConversation(conv.id, { isPinned: !conv.isPinned });
      await queryClient.invalidateQueries({ queryKey: ["conversations"] });
    } catch (err) {
      sidebarError = `Failed to pin conversation: ${(err as Error).message}`;
    }
  }

  async function handleToggleArchive(conv: ConversationSummary) {
    try {
      sidebarError = null;
      await updateConversation(conv.id, { isArchived: !conv.isArchived });
      await queryClient.invalidateQueries({ queryKey: ["conversations"] });
    } catch (err) {
      sidebarError = `Failed to archive conversation: ${(err as Error).message}`;
    }
  }

  async function handleExportConversation(conv: ConversationSummary, format: "md" | "json") {
    try {
      sidebarError = null;
      const base = (conv.title || "conversation")
        .trim()
        .replace(/[^a-zA-Z0-9._-]+/g, "-")
        .replace(/^-+|-+$/g, "") || "conversation";
      await triggerDownload(exportConversationUrl(conv.id, format), `${base}.${format}`);
    } catch (err) {
      sidebarError = `Failed to export conversation: ${(err as Error).message}`;
    }
  }

  function handleSelectConv(conv: ConversationSummary) {
    if (chatStore.isStreaming) return;
    chatStore.loadConversation(conv);
    onCloseMobile?.();
  }

  function handleNewChat() {
    if (chatStore.isStreaming) return;
    chatStore.newConversation();
    onCloseMobile?.();
  }

  function openRenameModal(conv: ConversationSummary) {
    if (chatStore.isStreaming) return;
    renameConv = conv;
    renameInputValue = conv.title;
  }

  async function submitRename(newTitle: string) {
    if (!renameConv) return;
    const conv = renameConv;
    renameConv = null;

    const trimmed = newTitle.trim();
    if (trimmed && trimmed !== conv.title) {
      try {
        sidebarError = null;
        await updateConversation(conv.id, { title: trimmed });
        if (chatStore.activeConversationId === conv.id) {
          chatStore.activeConversationTitle = trimmed;
        }
        await queryClient.invalidateQueries({ queryKey: ["conversations"] });
      } catch (err) {
        console.error("Failed to rename conversation", err);
        sidebarError = `Failed to rename conversation: ${(err as Error).message || "Unknown error"}`;
      }
    }
  }

  async function handleDelete(conv: ConversationSummary) {
    if (deletingId || chatStore.isStreaming) return;
    const confirmed = await confirmStore.confirm({
      title: "Delete Conversation",
      message: `Are you sure you want to delete "${conv.title}"?`,
      confirmText: "Delete",
      confirmStyle: "danger",
      cancelText: "Cancel",
      cancelStyle: "ghost",
      cancelOutline: true,
    });
    if (!confirmed) return;
    deletingId = conv.id;
    try {
      await deleteConversation(conv.id);
      chatStore.clearDraft(conv.id);
      if (chatStore.activeConversationId === conv.id) {
        chatStore.newConversation();
      }
      await queryClient.invalidateQueries({ queryKey: ["conversations"] });
    } finally {
      deletingId = null;
    }
  }

  let now = $state(Date.now());

  onMount(() => {
    const interval = setInterval(() => {
      now = Date.now();
    }, 10_000);
    return () => clearInterval(interval);
  });

  function formatAge(ts: number): string {
    const diffMs = now - ts;
    const mins = Math.floor(diffMs / 60_000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    return `${days}d ago`;
  }
</script>

<aside
  class="relative flex h-full shrink-0 flex-col border-r border-line bg-bg-inset transition-all duration-300 ease-in-out overflow-hidden {collapsed
    ? 'w-14'
    : 'w-64'}"
>
  <!-- Header -->
  <div
    data-tauri-drag-region={desktopWindow.isTauri ? "deep" : undefined}
    class="flex items-center h-14 shrink-0 px-3 justify-between overflow-hidden"
  >
    <div class="flex items-center overflow-hidden">
      {#if onToggleSidebar && collapsed}
        <button
          onclick={onToggleSidebar}
          aria-label="Expand sidebar"
          title="Expand sidebar"
          class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-fg-muted transition-colors cursor-pointer hover:bg-bg-elevated hover:text-fg"
        >
          <Logo class="h-5 w-5" />
        </button>
      {:else}
        <div
          class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-fg-muted"
        >
          <Logo class="h-5 w-5" />
        </div>
      {/if}
      <div
        class="overflow-hidden transition-all duration-300 ease-in-out {collapsed
          ? 'max-w-0 opacity-0'
          : 'max-w-30 opacity-100'}"
      >
        <span class="text-md font-semibold text-fg whitespace-nowrap pl-1">
          Blombrain
        </span>
      </div>
    </div>

    <div
      class="flex items-center transition-all duration-300 ease-in-out overflow-hidden {collapsed
        ? 'max-w-0 opacity-0'
        : 'max-w-10 opacity-100'}"
    >
      {#if onToggleSidebar}
        <button
          onclick={onToggleSidebar}
          aria-label="Collapse sidebar"
          class="hidden md:flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-fg-muted cursor-pointer hover:bg-bg-elevated hover:text-fg ml-1"
        >
          <PanelLeftClose size={16} />
        </button>
      {/if}
      {#if onCloseMobile}
        <button
          onclick={onCloseMobile}
          aria-label="Close sidebar"
          class="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-fg-muted md:hidden cursor-pointer hover:bg-bg-elevated hover:text-fg ml-1"
        >
          <X size={15} />
        </button>
      {/if}
    </div>
  </div>

  <!-- New Chat Button -->
  <div class="px-3 mt-1 mb-3 shrink-0">
    <button
      onclick={handleNewChat}
      disabled={chatStore.isStreaming}
      class="flex items-center h-9 w-full rounded-lg transition-all duration-300 cursor-pointer disabled:pointer-events-none disabled:opacity-40 overflow-hidden {collapsed
        ? 'border border-transparent bg-transparent shadow-none'
        : 'border border-line bg-bg-elevated shadow-xs hover:bg-bg-hover hover:border-line-strong'}"
    >
      <div class="w-8 h-full shrink-0 flex items-center justify-center">
        <SquarePen
          size={16}
          class="transition-colors duration-300 {collapsed
            ? 'text-fg hover:text-accent'
            : 'text-accent'}"
        />
      </div>
      <div
        class="overflow-hidden transition-all duration-300 ease-in-out {collapsed
          ? 'max-w-0 opacity-0'
          : 'max-w-30 opacity-100'}"
      >
        <span class="text-xs font-medium text-fg whitespace-nowrap pr-3"
          >New Chat</span
        >
      </div>
    </button>
  </div>

  <!-- Middle Content: Conversations & Backends -->
  <div
    class="flex-1 flex flex-col overflow-hidden transition-opacity duration-300 {collapsed
      ? 'opacity-0 pointer-events-none'
      : 'opacity-100 pointer-events-auto'}"
  >
    <!-- Conversations & Folders -->
    <div class="flex-1 overflow-y-auto overscroll-contain px-2 py-1 w-64">
      {#if sidebarError}
        <div
          role="alert"
          class="mx-1 mb-2 flex items-center justify-between gap-1.5 rounded-md border border-danger/40 bg-danger/10 px-2 py-1 text-[11px] text-danger"
        >
          <span class="truncate">{sidebarError}</span>
          <button
            type="button"
            onclick={() => (sidebarError = null)}
            aria-label="Dismiss error"
            class="shrink-0 hover:opacity-80 cursor-pointer"
          >
            <X size={11} />
          </button>
        </div>
      {/if}

      {#if archivedCount > 0 || showArchived || (convsQuery.data ?? []).length > 0 || searchQuery.trim() !== ""}
        <div class="mx-1 mb-2.5 flex items-center gap-1.5">
          {#if archivedCount > 0 || showArchived}
            <button
              type="button"
              onclick={() => (showArchived = !showArchived)}
              aria-label={showArchived ? "Show active conversations" : "Show archived conversations"}
              aria-pressed={showArchived}
              title={showArchived ? "Show active conversations" : "Show archived conversations"}
              class="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border transition-colors cursor-pointer {showArchived
                ? 'border-accent bg-accent/15 text-accent'
                : 'border-line bg-bg text-fg-muted hover:bg-bg-hover hover:text-fg'}"
            >
              <Archive size={13} />
            </button>
          {/if}
          {#if (convsQuery.data ?? []).length > 0 || searchQuery.trim() !== ""}
            <div class="flex flex-1 min-w-0 items-center gap-1.5 rounded-lg border border-line bg-bg px-2.5 py-1 h-7">
              <Search size={12} class="text-fg-subtle shrink-0" />
              <input
                type="text"
                bind:value={searchQuery}
                placeholder="Filter conversations…"
                aria-label="Filter conversations"
                class="w-full bg-transparent text-xs text-fg placeholder:text-fg-subtle focus:outline-none"
              />
              {#if searchQuery}
                <button
                  type="button"
                  onclick={() => (searchQuery = "")}
                  aria-label="Clear filter"
                  class="text-fg-subtle hover:text-fg cursor-pointer"
                >
                  <X size={11} />
                </button>
              {/if}
            </div>
          {:else}
            <div class="flex-1"></div>
          {/if}
        </div>
      {/if}

      {#if selectionMode}
        <div
          class="mx-1 mb-2 flex items-center justify-between gap-1 rounded-lg border border-accent/35 bg-accent/10 px-2 py-1.5 text-[11px]"
        >
          <div class="flex items-center gap-1.5 min-w-0">
            <span class="font-semibold text-fg tabular-nums">
              {selectedIdList.length} selected
            </span>
            <button
              type="button"
              onclick={selectAllFiltered}
              class="text-[10px] text-accent hover:underline cursor-pointer"
            >
              All
            </button>
            {#if selectedIdList.length > 0}
              <button
                type="button"
                onclick={() => {
                  selectedIds = {};
                  selectionMode = false;
                }}
                class="text-[10px] text-fg-muted hover:underline cursor-pointer"
              >
                Clear
              </button>
            {/if}
          </div>
          <div class="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onclick={() => openMoveModal(selectedIdList)}
              disabled={selectedIdList.length === 0 || isBatchWorking}
              aria-label="Move selected to folder"
              title="Move selected to folder"
              class="rounded p-1 text-fg-muted hover:bg-bg-elevated hover:text-fg disabled:opacity-35 disabled:pointer-events-none cursor-pointer"
            >
              <Folder size={12} />
            </button>
            <button
              type="button"
              onclick={() => handleBatchAction(showArchived ? "unarchive" : "archive")}
              disabled={selectedIdList.length === 0 || isBatchWorking}
              aria-label={showArchived ? "Unarchive selected" : "Archive selected"}
              title={showArchived ? "Unarchive selected" : "Archive selected"}
              class="rounded p-1 text-fg-muted hover:bg-bg-elevated hover:text-fg disabled:opacity-35 disabled:pointer-events-none cursor-pointer"
            >
              <Archive size={12} />
            </button>
            <button
              type="button"
              onclick={() => handleBatchAction("delete")}
              disabled={selectedIdList.length === 0 || isBatchWorking}
              aria-label="Delete selected"
              title="Delete selected"
              class="rounded p-1 text-fg-muted hover:bg-danger/15 hover:text-danger disabled:opacity-35 disabled:pointer-events-none cursor-pointer"
            >
              <Trash2 size={12} />
            </button>
          </div>
        </div>
      {/if}

      {#snippet conversationRow(conv: ConversationSummary)}
        {@const isActive = chatStore.activeConversationId === conv.id}
        {@const isMenuOpen = openDropdownId === conv.id}
        {@const isDisabled = chatStore.isStreaming && !isActive}
        {@const isChecked = Boolean(selectedIds[conv.id])}
        <li class="list-none">
          <div
            draggable={!chatStore.isStreaming}
            ondragstart={(e) => {
              clearLongPress();
              handleConvDragStart(e, conv);
            }}
            onpointerdown={(e) => handleConvPointerDown(e, conv, isDisabled)}
            onpointermove={handleConvPointerMove}
            onpointerup={clearLongPress}
            onpointercancel={clearLongPress}
            class="group relative flex items-center gap-2 rounded-lg px-2.5 py-2 text-xs transition-all duration-200"
            class:cursor-pointer={!isDisabled}
            class:cursor-not-allowed={isDisabled}
            class:opacity-40={isDisabled}
            class:pointer-events-none={isDisabled}
            class:bg-bg-elevated={(isActive && !selectionMode) || isMenuOpen || (selectionMode && isChecked)}
            class:text-fg={isActive || isMenuOpen || (selectionMode && isChecked)}
            class:font-medium={isActive}
            class:text-fg-muted={!isActive && !isDisabled && !(selectionMode && isChecked)}
            class:bg-bg={!isActive && !isDisabled && !(selectionMode && isChecked)}
            class:hover:bg-bg-elevated={!isActive && !isDisabled}
            onclick={() => {
              if (suppressNextClickId === conv.id) {
                suppressNextClickId = null;
                return;
              }
              if (isDisabled) return;
              if (selectionMode) toggleSelectConv(conv.id);
              else handleSelectConv(conv);
            }}
            tabindex={isDisabled ? -1 : 0}
            role="button"
            onkeydown={(e) => {
              if (isDisabled || e.key !== "Enter") return;
              if (selectionMode) toggleSelectConv(conv.id);
              else handleSelectConv(conv);
            }}
          >
            {#if selectionMode}
              <span
                class="flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors {isChecked
                  ? 'border-accent bg-accent text-accent-fg'
                  : 'border-line bg-bg-inset text-transparent'}"
              >
                <Check size={11} />
              </span>
            {/if}
            <div class="flex flex-col min-w-0 w-full">
              <div class="flex items-center gap-1.5 min-w-0">
                {#if conv.isPinned}
                  <Pin size={11} class="shrink-0 text-accent" />
                {/if}
                <span class="w-full truncate">{conv.title}</span>
              </div>
              {#if searchQuery.trim().length >= 2 && snippetByConvId.has(conv.id)}
                <span class="truncate text-[10px] text-fg-subtle mt-0.5">
                  {snippetByConvId.get(conv.id)}
                </span>
              {/if}
            </div>
            {#if !selectionMode}
              <div
                class="absolute right-0 top-0 bottom-0 flex items-center gap-1.5 pl-1.5 pr-2.5 rounded-r-lg transition-all duration-200 {isActive ||
                isMenuOpen
                  ? 'bg-bg-elevated'
                  : 'bg-bg group-hover:bg-bg-elevated'} {isMenuOpen ||
                onCloseMobile
                  ? 'opacity-100 pointer-events-auto'
                  : 'opacity-0 pointer-events-none [@media(hover:none)]:opacity-100 [@media(hover:none)]:pointer-events-auto [@media(pointer:coarse)]:opacity-100 [@media(pointer:coarse)]:pointer-events-auto group-hover:opacity-100 group-hover:pointer-events-auto'}"
                onclick={(e) => e.stopPropagation()}
                onkeydown={(e) => e.stopPropagation()}
                role="presentation"
              >
                <!-- Gradient for bg-bg (idle unselected) -->
                <div
                  class="absolute -left-4 top-0 bottom-0 w-4 bg-gradient-to-r from-transparent to-bg pointer-events-none transition-opacity duration-200 {isActive ||
                  isMenuOpen
                    ? 'opacity-0'
                    : 'opacity-100 group-hover:opacity-0'}"
                ></div>
                <!-- Gradient for bg-bg-elevated (hovered / active) -->
                <div
                  class="absolute -left-4 top-0 bottom-0 w-4 bg-gradient-to-r from-transparent to-bg-elevated pointer-events-none transition-opacity duration-200 {isActive ||
                  isMenuOpen
                    ? 'opacity-100'
                    : 'opacity-0 group-hover:opacity-100'}"
                ></div>
                <span class="shrink-0 text-[10px] font-mono text-fg-subtle">
                  {formatAge(conv.updatedAt)}
                </span>
                <Dropdown
                  onopenchange={(open) => {
                    if (open) openDropdownId = conv.id;
                    else if (openDropdownId === conv.id)
                      openDropdownId = null;
                  }}
                  options={[
                    {
                      label: "Select",
                      value: "select",
                      icon: CheckSquare,
                    },
                    {
                      label: conv.isPinned ? "Unpin" : "Pin to Top",
                      value: "pin",
                      icon: Pin,
                    },
                    { label: "Rename", value: "rename", icon: Pencil },
                    {
                      label: "Move to Folder…",
                      value: "folder",
                      icon: Folder,
                    },
                    {
                      label: conv.isArchived ? "Unarchive" : "Archive",
                      value: "archive",
                      icon: Archive,
                    },
                    {
                      label: "Export Markdown",
                      value: "export_md",
                      icon: Download,
                    },
                    {
                      label: "Export JSON",
                      value: "export_json",
                      icon: Download,
                    },
                    {
                      label: "Delete",
                      value: "delete",
                      icon: Trash2,
                      iconClass: "text-danger",
                    },
                  ]}
                  onchange={(val) => {
                    if (val === "select") {
                      selectionMode = true;
                      selectedIds = { [conv.id]: true };
                    } else if (val === "pin") handleTogglePin(conv);
                    else if (val === "rename") openRenameModal(conv);
                    else if (val === "folder") openMoveModal([conv.id], conv.folderId ?? null);
                    else if (val === "archive") handleToggleArchive(conv);
                    else if (val === "export_md") handleExportConversation(conv, "md");
                    else if (val === "export_json") handleExportConversation(conv, "json");
                    else if (val === "delete") handleDelete(conv);
                  }}
                  align="right"
                  resetOnSelect={true}
                  showCheckmark={false}
                  unstyledTrigger={true}
                  ariaLabel="Actions for {conv.title}"
                  buttonClass="rounded p-0.5 text-fg-subtle transition-all cursor-pointer hover:text-fg disabled:pointer-events-none disabled:opacity-50"
                  disabled={deletingId === conv.id || chatStore.isStreaming}
                >
                  {#snippet trigger()}
                    <MoreHorizontal size={14} />
                  {/snippet}
                </Dropdown>
              </div>
            {/if}
          </div>
        </li>
      {/snippet}

      <!-- Collapsible Folders Section -->
      {#if !showArchived}
        <div class="mb-2.5">
          <div class="mb-1 flex items-center justify-between gap-1 px-2">
            <button
              type="button"
              onclick={() => (foldersSectionOpen = !foldersSectionOpen)}
              class="flex items-center gap-1 text-[11px] font-semibold tracking-wider text-fg-subtle uppercase hover:text-fg transition-colors cursor-pointer"
            >
              {#if foldersSectionOpen}
                <ChevronDown size={11} />
              {:else}
                <ChevronRight size={11} />
              {/if}
              <span>Folders</span>
              {#if folders.length > 0}
                <span class="ml-0.5 font-mono text-[10px] font-normal">
                  {folders.length}
                </span>
              {/if}
            </button>
            <button
              type="button"
              onclick={openCreateFolderModal}
              disabled={chatStore.isStreaming}
              aria-label="Create folder"
              title="Create Folder"
              class="flex h-5 w-5 items-center justify-center rounded text-fg-subtle hover:bg-bg-elevated hover:text-fg disabled:opacity-40 disabled:pointer-events-none cursor-pointer"
            >
              <Plus size={13} />
            </button>
          </div>

          {#if foldersSectionOpen && folders.length > 0}
            <ul class="flex flex-col gap-0.5">
              {#each folders as folder (folder.id)}
                {@const folderConvs = folderConversationsMap.get(folder.id) ?? []}
                {@const isFolderViewActive =
                  chatStore.activeConversationId === null &&
                  chatStore.activeFolderId === folder.id}
                {@const isDropHover = dragOverTarget === folder.id}
                <li
                  class="list-none"
                  ondragover={(e) => handleFolderDragOver(e, folder.id)}
                  ondragleave={() => handleFolderDragLeave(folder.id)}
                  ondrop={(e) => handleFolderDrop(e, folder.id)}
                >
                  <div
                    class="group relative flex items-center gap-1 rounded-lg px-1.5 py-1.5 text-xs transition-all border {isDropHover
                      ? 'border-accent bg-accent/15 text-fg'
                      : isFolderViewActive
                        ? 'border-transparent bg-bg-elevated text-fg font-medium'
                        : 'border-transparent bg-bg text-fg-muted hover:bg-bg-elevated hover:text-fg'}"
                  >
                    <button
                      type="button"
                      onclick={(e) => {
                        e.stopPropagation();
                        handleToggleFolderExpand(folder);
                      }}
                      aria-label={folder.isExpanded ? `Collapse ${folder.name}` : `Expand ${folder.name}`}
                      class="flex h-5 w-5 shrink-0 items-center justify-center rounded text-fg-subtle hover:text-fg cursor-pointer"
                    >
                      {#if folder.isExpanded}
                        <ChevronDown size={12} />
                      {:else}
                        <ChevronRight size={12} />
                      {/if}
                    </button>
                    <button
                      type="button"
                      onclick={() => {
                        if (chatStore.isStreaming) return;
                        chatStore.openFolder(folder.id);
                        onCloseMobile?.();
                      }}
                      disabled={chatStore.isStreaming}
                      class="flex min-w-0 flex-1 items-center gap-1.5 text-left cursor-pointer disabled:pointer-events-none disabled:opacity-50"
                    >
                      <Folder size={13} class="shrink-0 text-accent/85" />
                      <span class="truncate">{folder.name}</span>
                    </button>
                    <div
                      class="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 focus-within:opacity-100 [@media(hover:none)]:opacity-100 transition-opacity"
                      onclick={(e) => e.stopPropagation()}
                      onkeydown={(e) => e.stopPropagation()}
                      role="presentation"
                    >
                      <Dropdown
                        options={[
                          {
                            label: "New Chat in Folder",
                            value: "new_chat",
                            icon: SquarePen,
                          },
                          {
                            label: "Edit Folder",
                            value: "edit",
                            icon: Pencil,
                          },
                          {
                            label: "Delete Folder",
                            value: "delete",
                            icon: Trash2,
                            iconClass: "text-danger",
                          },
                        ]}
                        onchange={(val) => {
                          if (val === "new_chat") {
                            chatStore.openFolder(folder.id);
                            onCloseMobile?.();
                          } else if (val === "edit") {
                            openEditFolderModal(folder);
                          } else if (val === "delete") {
                            handleDeleteFolder(folder);
                          }
                        }}
                        align="right"
                        resetOnSelect={true}
                        showCheckmark={false}
                        unstyledTrigger={true}
                        ariaLabel="Actions for folder {folder.name}"
                        buttonClass="rounded p-0.5 text-fg-subtle hover:text-fg cursor-pointer"
                        disabled={chatStore.isStreaming}
                      >
                        {#snippet trigger()}
                          <MoreHorizontal size={14} />
                        {/snippet}
                      </Dropdown>
                    </div>
                  </div>

                  {#if folder.isExpanded || searchQuery.trim().length > 0}
                    <div class="ml-3.5 mt-0.5 border-l border-line/50 pl-1.5">
                      {#if folderConvs.length === 0}
                        <p class="px-2 py-1 text-[11px] text-fg-subtle/75 select-none">
                          {searchQuery.trim() ? "No matching chats" : "No chats"}
                        </p>
                      {:else}
                        <ul class="flex flex-col gap-0.5">
                          {#each folderConvs as conv (conv.id)}
                            {@render conversationRow(conv)}
                          {/each}
                        </ul>
                      {/if}
                    </div>
                  {/if}
                </li>
              {/each}
            </ul>
          {/if}
        </div>
      {/if}

      <!-- Collapsible Chats Section -->
      <div
        ondragover={(e) => !showArchived && handleFolderDragOver(e, "__unfiled__")}
        ondragleave={() => handleFolderDragLeave("__unfiled__")}
        ondrop={(e) => !showArchived && handleFolderDrop(e, null)}
        role="region"
        aria-label={showArchived ? "Archived Chats" : "Chats"}
        class="rounded-lg transition-colors {dragOverTarget === '__unfiled__'
          ? 'ring-1 ring-accent bg-accent/10'
          : ''}"
      >
        <div class="mb-1 flex items-center justify-between gap-2 px-2">
          <button
            type="button"
            onclick={() => (chatsSectionOpen = !chatsSectionOpen)}
            class="flex items-center gap-1 text-[11px] font-semibold tracking-wider text-fg-subtle uppercase hover:text-fg transition-colors cursor-pointer truncate"
          >
            {#if chatsSectionOpen}
              <ChevronDown size={11} />
            {:else}
              <ChevronRight size={11} />
            {/if}
            <span class="truncate">
              {showArchived ? "Archived Chats" : "Chats"}
            </span>
          </button>
          {#if rootConversations.length > 0}
            <span class="text-[10px] font-mono tabular-nums text-fg-subtle shrink-0">
              {rootConversations.length.toLocaleString()}
            </span>
          {/if}
        </div>

        {#if chatsSectionOpen}
          {#if convsQuery.isLoading}
            <p class="px-2 text-xs text-fg-muted">Loading…</p>
          {:else if convsQuery.isError}
            <p class="px-2 text-xs text-danger">Couldn't load conversations.</p>
          {:else if (convsQuery.data ?? []).length === 0}
            <p
              class="rounded-lg border border-dashed border-line px-3 py-3 text-xs text-fg-muted mx-1"
            >
              No conversations yet. Send a message to start one.
            </p>
          {:else if rootConversations.length === 0}
            <p class="px-2 py-2 text-xs text-fg-subtle">
              {searchQuery.trim()
                ? `No matching chats for "${searchQuery}".`
                : showArchived
                  ? "No archived chats."
                  : "All chats are filed in folders."}
            </p>
          {:else}
            <ul class="flex flex-col gap-0.5">
              {#each visibleRootConversations as conv (conv.id)}
                {@render conversationRow(conv)}
              {/each}
            </ul>
            {#if rootConversations.length > visibleLimit}
              <button
                type="button"
                onclick={() => (visibleLimit += 40)}
                class="mt-1.5 w-full rounded-lg border border-line bg-bg py-1.5 text-center text-[11px] font-medium text-fg-muted hover:bg-bg-elevated hover:text-fg transition-colors cursor-pointer"
              >
                Show more ({rootConversations.length - visibleLimit} remaining)
              </button>
            {/if}
          {/if}
        {/if}
      </div>
    </div>

    <!-- Collapsible Backends section -->
    <div class="border-t border-line/60 px-3 py-2 w-64 shrink-0">
      <button
        type="button"
        onclick={() => (showBackends = !showBackends)}
        class="flex w-full items-center justify-between py-1 text-[11px] font-semibold uppercase tracking-wider text-fg-subtle cursor-pointer hover:text-fg transition-colors duration-200"
      >
        <span>Backends ({backendsQuery.data?.length ?? 0})</span>
        <ChevronUp
          size={12}
          class="shrink-0 transition-transform duration-200 {showBackends
            ? 'rotate-180'
            : ''}"
        />
      </button>

      {#if showBackends}
        <div
          transition:slide={{ duration: 150 }}
          class="mt-1 flex flex-col gap-1 max-h-36 overflow-y-auto"
        >
          {#if backendsQuery.isLoading}
            <p class="text-xs text-fg-muted">Loading…</p>
          {:else if backendsQuery.isError}
            <p class="text-xs text-danger">Can't reach backend API.</p>
          {:else if (backendsQuery.data ?? []).length === 0}
            <p class="text-xs text-fg-muted">No backends configured.</p>
          {:else}
            {#each backendsQuery.data ?? [] as backend (backend.id)}
              <div
                class="flex items-center gap-2 rounded-md px-2 py-1 text-xs"
                class:opacity-55={!backend.isEnabled}
                title={backend.status === "disabled" ? "Disabled" : backend.status}
              >
                <span
                  class="h-1.5 w-1.5 shrink-0 rounded-full"
                  class:bg-success={backend.status === "online"}
                  class:bg-danger={backend.status === "offline"}
                  class:bg-fg-subtle={backend.status === "unknown" || backend.status === "disabled"}
                ></span>
                <span class="flex-1 truncate text-fg-muted">{backend.name}</span>
                {#if !backend.isEnabled}
                  <span class="shrink-0 font-mono text-[9px] text-fg-subtle">off</span>
                {:else if backend.process?.state === "running"}
                  <span class="shrink-0 font-mono text-[9px] text-accent">proc</span>
                {/if}
                <span class="shrink-0 font-mono text-[10px] text-fg-subtle"
                  >{backend.prefix}</span
                >
              </div>
            {/each}
          {/if}
        </div>
      {/if}
    </div>
  </div>

  <!-- Footer -->
  <div class="border-t border-line px-3 py-2.5 shrink-0">
    <button
      onclick={onOpenSettings}
      aria-label="Settings"
      title="Settings"
      class="flex items-center h-8 w-full rounded-md text-xs text-fg-muted transition-colors cursor-pointer hover:bg-bg-elevated hover:text-fg overflow-hidden"
    >
      <div class="w-8 h-full shrink-0 flex items-center justify-center">
        <Settings size={16} />
      </div>
      <div
        class="overflow-hidden transition-all duration-300 ease-in-out {collapsed
          ? 'max-w-0 opacity-0'
          : 'max-w-[120px] opacity-100'}"
      >
        <span class="font-medium whitespace-nowrap pr-2">Settings</span>
      </div>
    </button>
  </div>
</aside>

<TextInputModal
  isOpen={renameConv !== null}
  title="Rename Conversation"
  label="Conversation Name"
  bind:value={renameInputValue}
  onsubmit={submitRename}
  onclose={() => (renameConv = null)}
/>

<FolderModal
  isOpen={folderModalMode !== null}
  mode={folderModalMode ?? "create"}
  bind:name={folderFormName}
  bind:description={folderFormDesc}
  isSaving={isSavingFolder}
  onsubmit={submitFolderModal}
  onclose={() => {
    folderModalMode = null;
    editingFolder = null;
  }}
/>

<MoveToFolderModal
  isOpen={moveTargetIds !== null}
  {folders}
  currentFolderId={moveCurrentFolderId}
  targetCount={moveTargetIds?.length ?? 0}
  onselect={submitMoveModal}
  oncreatefolder={handleQuickCreateFolderFromMove}
  onclose={() => (moveTargetIds = null)}
/>
