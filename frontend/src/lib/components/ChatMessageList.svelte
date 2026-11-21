<script lang="ts">
  import { chatStore } from "../stores/chat.svelte";
  import ChatMessage from "./ChatMessage.svelte";
  import VirtualizedMessage from "./VirtualizedMessage.svelte";
  import ChatInput from "./ChatInput.svelte";
  import { fetchModels, fetchFolders, fetchConversations, updateFolder } from "../api";
  import { createQuery, useQueryClient } from "@tanstack/svelte-query";
  import {
    ArrowDown,
    Search,
    ChevronUp,
    ChevronDown,
    X,
    Folder,
    Pencil,
    MessageSquare,
  } from "@lucide/svelte";
  import FolderModal from "./FolderModal.svelte";
  import { getCleanVisibleText } from "../utils/segmentParser";

  import { flip } from "svelte/animate";
  import { slide, fade, fly } from "svelte/transition";
  import { quintOut } from "svelte/easing";

  interface Props {
    bottomPadding?: number;
  }
  const { bottomPadding = 112 }: Props = $props();

  let scrollEl: HTMLDivElement | undefined = $state();

  const queryClient = useQueryClient();

  const modelsQuery = createQuery(() => ({
    queryKey: ["models"],
    queryFn: fetchModels,
  }));

  const foldersQuery = createQuery(() => ({
    queryKey: ["folders"],
    queryFn: fetchFolders,
  }));

  const convsQuery = createQuery(() => ({
    queryKey: ["conversations"],
    queryFn: fetchConversations,
  }));

  let activeFolder = $derived(
    chatStore.activeFolderId && foldersQuery.data
      ? foldersQuery.data.find((f) => f.id === chatStore.activeFolderId) ?? null
      : null,
  );

  let folderConversations = $derived.by(() => {
    if (!activeFolder || !convsQuery.data) return [];
    return convsQuery.data.filter(
      (c) => !c.isArchived && c.folderId === activeFolder.id,
    );
  });

  let editingFolderOpen = $state(false);
  let editingFolderName = $state("");
  let editingFolderDesc = $state("");
  let isSavingFolder = $state(false);

  function openEditActiveFolder() {
    if (!activeFolder) return;
    editingFolderName = activeFolder.name;
    editingFolderDesc = activeFolder.description || "";
    editingFolderOpen = true;
  }

  async function submitEditActiveFolder(name: string, description: string) {
    if (!activeFolder) return;
    isSavingFolder = true;
    try {
      await updateFolder(activeFolder.id, { name, description });
      await queryClient.invalidateQueries({ queryKey: ["folders"] });
      await queryClient.invalidateQueries({ queryKey: ["conversations"] });
      editingFolderOpen = false;
    } finally {
      isSavingFolder = false;
    }
  }

  let currentModel = $derived(
    chatStore.selectedModel && modelsQuery.data
      ? modelsQuery.data.find((m) => m.id === chatStore.selectedModel)
      : undefined,
  );

  let activeMessages = $derived(chatStore.activePath);
  let lastConversationId = $state<string | null>(null);
  let userHasScrolledUp = $state(false);
  let editingMessageIds = $state<Record<string, boolean>>({});
  let searchQuery = $state("");
  let searchMatchIndex = $state(0);
  let searchInputEl = $state<HTMLInputElement | undefined>();
  let lastSearchFocusNonce = -1;
  let lastScrollTop = 0;

  let searchMatchedMessageIds = $derived.by(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!chatStore.inChatSearchOpen || !q) return [] as string[];
    const ids: string[] = [];
    for (const m of activeMessages) {
      const visible =
        m.role === "assistant"
          ? getCleanVisibleText(m.content, m.thinkingContent)
          : m.content;
      const haystack = [visible, m.thinkingContent || ""].join("\n").toLowerCase();
      if (haystack.includes(q)) {
        ids.push(m.id);
      }
    }
    return ids;
  });

  let activeSearchMessageId = $derived(
    searchMatchedMessageIds.length > 0
      ? searchMatchedMessageIds[
          Math.min(searchMatchIndex, searchMatchedMessageIds.length - 1)
        ]
      : null,
  );

  $effect(() => {
    if (chatStore.inChatSearchOpen) {
      const nonce = chatStore.inChatSearchFocusNonce;
      if (nonce !== lastSearchFocusNonce) {
        lastSearchFocusNonce = nonce;
        requestAnimationFrame(() => {
          searchInputEl?.focus();
          searchInputEl?.select();
        });
      }
    } else {
      lastSearchFocusNonce = -1;
      searchQuery = "";
      searchMatchIndex = 0;
    }
  });

  $effect(() => {
    const len = searchMatchedMessageIds.length;
    if (len === 0) {
      searchMatchIndex = 0;
    } else if (searchMatchIndex >= len) {
      searchMatchIndex = 0;
    }
  });

  $effect(() => {
    const targetId = activeSearchMessageId;
    if (!chatStore.inChatSearchOpen || !targetId) return;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (!scrollEl) return;
        const targetEl = scrollEl.querySelector<HTMLElement>(
          `[data-message-id="${CSS.escape(targetId)}"]`,
        );
        if (targetEl) {
          userHasScrolledUp = true;
          targetEl.scrollIntoView({ behavior: "smooth", block: "center" });
        }
      });
    });
  });

  function stepSearchMatch(delta: 1 | -1) {
    const len = searchMatchedMessageIds.length;
    if (len === 0) return;
    searchMatchIndex = (searchMatchIndex + delta + len) % len;
  }

  function handleSearchKeydown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      chatStore.closeInChatSearch();
    } else if (e.key === "Enter") {
      e.preventDefault();
      stepSearchMatch(e.shiftKey ? -1 : 1);
    }
  }
  let touchStartY = 0;
  let isUserInteracting = false;
  let userInteractTimeout: ReturnType<typeof setTimeout> | undefined;
  let innerContentEl: HTMLDivElement | undefined = $state();

  function markUserInteraction() {
    isUserInteracting = true;
    clearTimeout(userInteractTimeout);
    userInteractTimeout = setTimeout(() => {
      isUserInteracting = false;
    }, 300);
  }

  function handleWheel(e: WheelEvent) {
    markUserInteraction();
    if (e.deltaY < 0) {
      if (scrollEl) {
        const distance =
          scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight;
        if (distance > 30) {
          userHasScrolledUp = true;
        }
      }
    }
  }

  function handleTouchStart(e: TouchEvent) {
    markUserInteraction();
    if (e.touches.length > 0) {
      touchStartY = e.touches[0].clientY;
    }
  }

  function handleTouchMove(e: TouchEvent) {
    markUserInteraction();
    if (e.touches.length > 0) {
      const touchY = e.touches[0].clientY;
      if (touchY - touchStartY > 5) {
        if (scrollEl) {
          const distance =
            scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight;
          if (distance > 30) {
            userHasScrolledUp = true;
          }
        }
      }
    }
  }

  function handleMouseDown() {
    markUserInteraction();
  }

  function syncScrollState() {
    if (!scrollEl) return;
    const isScrollable = scrollEl.scrollHeight > scrollEl.clientHeight + 4;
    if (!isScrollable) {
      userHasScrolledUp = false;
      lastScrollTop = 0;
      return;
    }
    const distance =
      scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight;
    if (distance <= 30) {
      userHasScrolledUp = false;
    }
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (["PageUp", "ArrowUp", "Home"].includes(e.key)) {
      if (!scrollEl) return;
      const distance =
        scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight;
      if (scrollEl.scrollHeight > scrollEl.clientHeight + 4 && distance > 30) {
        markUserInteraction();
        userHasScrolledUp = true;
      }
    }
  }

  function handleScroll() {
    if (!scrollEl) return;
    const currentScrollTop = scrollEl.scrollTop;
    const isScrollable = scrollEl.scrollHeight > scrollEl.clientHeight + 4;
    const distance =
      scrollEl.scrollHeight - currentScrollTop - scrollEl.clientHeight;

    if (
      isScrollable &&
      isUserInteracting &&
      currentScrollTop < lastScrollTop - 5 &&
      distance > 30
    ) {
      userHasScrolledUp = true;
    } else if (!isScrollable || distance <= 30) {
      userHasScrolledUp = false;
    }

    lastScrollTop = currentScrollTop;
  }

  function scrollToBottom(instant = false) {
    if (!scrollEl) return;
    if (instant || chatStore.isStreaming) {
      scrollEl.scrollTop = scrollEl.scrollHeight;
    } else {
      scrollEl.scrollTo({
        top: scrollEl.scrollHeight,
        behavior: "smooth",
      });
    }
    lastScrollTop = scrollEl.scrollTop;
  }

  // Observe both container & content resizing (streaming, thinking block collapse/expand, window resize)
  $effect(() => {
    const container = scrollEl;
    const content = innerContentEl;
    if (!container && !content) return;
    const observer = new ResizeObserver(() => {
      if (chatStore.isStreaming && !userHasScrolledUp && scrollEl) {
        scrollToBottom(true);
      } else {
        syncScrollState();
      }
    });
    if (container) observer.observe(container);
    if (content) observer.observe(content);
    return () => observer.disconnect();
  });

  $effect(() => {
    const currentId = chatStore.activeConversationId;
    const isNewConversationLoaded = currentId !== lastConversationId;
    lastConversationId = currentId;

    bottomPadding;
    activeMessages.length;
    for (const m of activeMessages) {
      m.content;
      m.thinkingContent;
    }

    requestAnimationFrame(() => {
      if (!scrollEl) return;
      if (isNewConversationLoaded) {
        userHasScrolledUp = false;
        scrollToBottom(true);
        setTimeout(() => {
          if (scrollEl) scrollToBottom(true);
        }, 50);
      } else if (!userHasScrolledUp) {
        scrollToBottom();
      }
    });
  });
</script>

<div class="relative flex-1 flex flex-col min-h-0 overflow-hidden">
  {#if chatStore.inChatSearchOpen && activeMessages.length > 0}
    <div
      transition:fly={{ y: -10, duration: 150 }}
      class="absolute top-2 right-3 left-3 sm:left-auto z-30 flex items-center gap-1.5 rounded-xl border border-line bg-bg-elevated/95 px-2.5 py-1.5 shadow-lg backdrop-blur-md sm:w-80"
    >
      <Search size={13} class="shrink-0 text-fg-subtle" />
      <input
        bind:this={searchInputEl}
        type="text"
        bind:value={searchQuery}
        onkeydown={handleSearchKeydown}
        placeholder="Find in conversation…"
        aria-label="Find in conversation"
        class="min-w-0 flex-1 bg-transparent text-xs text-fg placeholder:text-fg-subtle focus:outline-none"
      />
      {#if searchQuery.trim()}
        <span class="shrink-0 font-mono text-[10px] tabular-nums text-fg-subtle">
          {searchMatchedMessageIds.length > 0
            ? `${searchMatchIndex + 1}/${searchMatchedMessageIds.length}`
            : "0/0"}
        </span>
      {/if}
      <button
        type="button"
        onclick={() => stepSearchMatch(-1)}
        disabled={searchMatchedMessageIds.length === 0}
        aria-label="Previous match"
        title="Previous match (Shift+Enter)"
        class="flex h-6 w-6 shrink-0 items-center justify-center rounded text-fg-muted hover:bg-bg-hover hover:text-fg disabled:opacity-35 disabled:pointer-events-none cursor-pointer"
      >
        <ChevronUp size={13} />
      </button>
      <button
        type="button"
        onclick={() => stepSearchMatch(1)}
        disabled={searchMatchedMessageIds.length === 0}
        aria-label="Next match"
        title="Next match (Enter)"
        class="flex h-6 w-6 shrink-0 items-center justify-center rounded text-fg-muted hover:bg-bg-hover hover:text-fg disabled:opacity-35 disabled:pointer-events-none cursor-pointer"
      >
        <ChevronDown size={13} />
      </button>
      <button
        type="button"
        onclick={() => chatStore.closeInChatSearch()}
        aria-label="Close find bar"
        title="Close (Escape)"
        class="flex h-6 w-6 shrink-0 items-center justify-center rounded text-fg-muted hover:bg-bg-hover hover:text-fg cursor-pointer"
      >
        <X size={13} />
      </button>
    </div>
  {/if}

  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <div
    bind:this={scrollEl}
    role="region"
    tabindex="-1"
    aria-label="Chat message history"
    onscroll={handleScroll}
    onwheel={handleWheel}
    ontouchstart={handleTouchStart}
    ontouchmove={handleTouchMove}
    onmousedown={handleMouseDown}
    onkeydown={handleKeyDown}
    class="relative flex-1 overflow-y-auto overscroll-contain scrollbar-gutter-both px-2 sm:px-6 pb-4 pt-0"
  >
    {#if activeMessages.length === 0}
      <div
        in:fly={{ y: 40, duration: 350, opacity: 0, easing: quintOut }}
        out:fly={{ y: 40, duration: 300, opacity: 0, easing: quintOut }}
        class="absolute inset-0 flex flex-col items-center justify-center gap-6 px-2 sm:px-6 overflow-y-auto scrollbar-gutter-both py-8"
      >
        {#if activeFolder}
          <div class="w-full max-w-3xl lg:max-w-4xl xl:max-w-5xl flex flex-col gap-5">
            <div class="flex items-start justify-between gap-3 px-1">
              <div class="flex items-start gap-3 min-w-0">
                <div class="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-line bg-bg-elevated text-accent shadow-xs">
                  <Folder size={22} />
                </div>
                <div class="min-w-0">
                  <h2 class="text-lg font-semibold text-fg truncate">
                    {activeFolder.name}
                  </h2>
                  {#if activeFolder.description}
                    <p class="text-xs text-fg-muted mt-0.5 whitespace-pre-wrap break-words">
                      {activeFolder.description}
                    </p>
                  {:else}
                    <p class="text-xs text-fg-subtle mt-0.5">
                      Start a new chat inside this folder or open one below.
                    </p>
                  {/if}
                </div>
              </div>
              <button
                type="button"
                onclick={openEditActiveFolder}
                aria-label="Edit folder"
                title="Edit folder"
                class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-line bg-bg-elevated text-fg-muted hover:bg-bg-hover hover:text-fg transition-colors cursor-pointer"
              >
                <Pencil size={13} />
              </button>
            </div>

            <ChatInput floating={true} />

            <div class="flex flex-col gap-1.5 px-1">
              {#if folderConversations.length === 0}
                <p class="text-center text-xs text-fg-subtle py-4">
                  No chats in this folder yet.
                </p>
              {:else}
                <div class="text-[11px] font-semibold uppercase tracking-wider text-fg-subtle px-1">
                  Chats in folder ({folderConversations.length})
                </div>
                <div class="max-h-52 overflow-y-auto flex flex-col gap-1 pr-0.5">
                  {#each folderConversations as fconv (fconv.id)}
                    <button
                      type="button"
                      onclick={() => chatStore.loadConversation(fconv)}
                      class="flex items-center justify-between gap-2 rounded-lg border border-line bg-bg-elevated/70 px-3 py-2 text-left text-xs text-fg hover:border-accent/50 hover:bg-bg-elevated transition-colors cursor-pointer"
                    >
                      <span class="flex items-center gap-2 min-w-0">
                        <MessageSquare size={13} class="shrink-0 text-fg-subtle" />
                        <span class="truncate font-medium">{fconv.title}</span>
                      </span>
                      <span class="shrink-0 font-mono text-[10px] text-fg-subtle">
                        {new Date(fconv.updatedAt).toLocaleDateString()}
                      </span>
                    </button>
                  {/each}
                </div>
              {/if}
            </div>
          </div>
        {:else}
          <div
            class="flex flex-col items-center justify-center gap-3 text-center select-none"
          >
            {#if currentModel?.icon}
              <img
                src={currentModel.icon}
                alt="Model Icon"
                class="h-12 w-12 rounded-xl object-cover border border-line shadow-md"
              />
            {:else}
              <img
                src="/Blombrain.png"
                alt="Blombrain"
                class="h-12 w-12 rounded-xl object-cover border border-line shadow-md"
              />
            {/if}
            <div>
              <h2 class="text-base font-semibold text-fg">
                {currentModel?.name || "Blombrain Assistant"}
              </h2>
              <p class="text-xs text-fg-muted mt-1 max-w-sm">
                Send a message, paste code, or attach files to begin chatting.
              </p>
            </div>
          </div>

          <!-- Floating Chat Input -->
          <div class="w-full max-w-3xl lg:max-w-4xl xl:max-w-5xl">
            <ChatInput floating={true} />
          </div>
        {/if}
      </div>
    {/if}

    {#if activeMessages.length > 0}
      {#key chatStore.activeConversationId}
        <div
          bind:this={innerContentEl}
          class="mx-auto flex w-full max-w-3xl lg:max-w-4xl xl:max-w-5xl flex-col gap-3 relative z-10"
          style="padding-bottom: {bottomPadding + 16}px;"
        >
          {#each activeMessages as message, i (message.id)}
            <div
              data-message-id={message.id}
              class="rounded-xl transition-shadow duration-200 {activeSearchMessageId === message.id
                ? 'ring-2 ring-accent/70 bg-accent/5'
                : ''}"
              animate:flip={{ duration: 400, easing: quintOut }}
              in:fly|local={{
                y: 20,
                duration: 400,
                opacity: 0,
                easing: quintOut,
              }}
              out:slide|local={{ duration: 300, easing: quintOut }}
            >
              <VirtualizedMessage
                keepMounted={Boolean(
                  message.streaming ||
                    editingMessageIds[message.id] ||
                    activeSearchMessageId === message.id,
                )}
              >
                <ChatMessage
                  {message}
                  isLast={i === activeMessages.length - 1}
                  onEditingChange={(editing) => {
                    editingMessageIds[message.id] = editing;
                  }}
                />
              </VirtualizedMessage>
            </div>
          {/each}
        </div>
      {/key}
    {/if}
  </div>

  {#if activeMessages.length > 0 && userHasScrolledUp}
    <div
      transition:fade={{ duration: 150 }}
      class="pointer-events-none absolute inset-x-0 z-30 flex justify-center"
      style="bottom: {bottomPadding + 8}px;"
    >
      <button
        type="button"
        onclick={() => {
          userHasScrolledUp = false;
          scrollToBottom(false);
        }}
        aria-label="Scroll to bottom"
        title="Jump to latest message"
        class="pointer-events-auto flex items-center gap-1.5 rounded-full border border-line bg-bg-elevated/95 px-3 py-1.5 text-xs font-medium text-fg shadow-md backdrop-blur-sm hover:border-accent hover:text-accent transition-all cursor-pointer"
      >
        <ArrowDown size={13} />
        <span>Jump to bottom</span>
      </button>
    </div>
  {/if}
</div>

<FolderModal
  isOpen={editingFolderOpen}
  mode="edit"
  bind:name={editingFolderName}
  bind:description={editingFolderDesc}
  isSaving={isSavingFolder}
  onsubmit={submitEditActiveFolder}
  onclose={() => (editingFolderOpen = false)}
/>
