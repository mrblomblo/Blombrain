<script lang="ts">
  import { createQuery, useQueryClient } from "@tanstack/svelte-query";
  import {
    PanelLeftClose,
    PanelLeftOpen,
    SquarePen,
    Trash2,
    Settings,
    X,
    ChevronDown,
    ChevronUp,
  } from "@lucide/svelte";
  import {
    fetchBackends,
    fetchConversations,
    deleteConversation,
  } from "../api";
  import { chatStore } from "../stores/chat.svelte";
  import { confirmStore } from "../stores/confirmStore.svelte";
  import type { ConversationSummary } from "../types";
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

  let deletingId = $state<string | null>(null);
  let showBackends = $state(false);

  function handleSelectConv(conv: ConversationSummary) {
    chatStore.loadConversation(conv);
    onCloseMobile?.();
  }

  function handleNewChat() {
    chatStore.newConversation();
    onCloseMobile?.();
  }

  async function handleDelete(e: MouseEvent, conv: ConversationSummary) {
    e.stopPropagation();
    if (deletingId) return;
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
      if (chatStore.activeConversationId === conv.id) {
        chatStore.newConversation();
      }
      await queryClient.invalidateQueries({ queryKey: ["conversations"] });
    } finally {
      deletingId = null;
    }
  }

  function formatAge(ts: number): string {
    const diffMs = Date.now() - ts;
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
  class="hidden md:flex h-full shrink-0 flex-col border-r border-line bg-bg-inset transition-all duration-200 ease-in-out {collapsed
    ? 'w-14 py-3 items-center justify-between'
    : 'w-64'}"
>
  {#if collapsed}
    <!-- Top header icon (Expand sidebar) -->
    <div class="flex items-center justify-center py-1">
      {#if onToggleSidebar}
        <button
          onclick={onToggleSidebar}
          aria-label="Expand sidebar"
          title="Expand sidebar"
          class="flex h-8 w-8 items-center justify-center rounded-lg text-fg-muted transition-colors cursor-pointer hover:bg-bg-elevated hover:text-fg"
        >
          <PanelLeftOpen size={18} />
        </button>
      {/if}
    </div>

    <!-- Body icon (New Chat, positioned at top of body) -->
    <div class="mt-4 flex flex-1 flex-col items-center">
      <button
        onclick={handleNewChat}
        disabled={chatStore.isStreaming}
        aria-label="New Chat"
        title="New Chat"
        class="flex h-9 w-9 items-center justify-center rounded-lg border border-line bg-bg-elevated text-accent transition-colors cursor-pointer hover:bg-bg-hover disabled:pointer-events-none disabled:opacity-40"
      >
        <SquarePen size={16} />
      </button>
    </div>

    <!-- Footer icon (Settings) -->
    <div class="flex flex-col items-center gap-2 w-full">
      <button
        onclick={onOpenSettings}
        aria-label="Settings"
        title="Backends Settings"
        class="flex h-8 w-8 items-center justify-center rounded-lg text-fg-muted transition-colors cursor-pointer hover:bg-bg-elevated hover:text-fg"
      >
        <Settings size={16} />
      </button>
    </div>
  {:else}
    <!-- Logo + new chat + mobile close -->
    <div class="flex items-center justify-between px-4 py-4">
      <div class="flex items-center gap-2">
        <div class="h-3.5 w-3.5 rotate-45 bg-accent"></div>
        <span class="text-sm font-semibold tracking-wide text-fg"
          >Blombrain</span
        >
      </div>
      <div class="flex items-center gap-1">
        {#if onToggleSidebar}
          <button
            onclick={onToggleSidebar}
            aria-label="Collapse sidebar"
            title="Collapse sidebar"
            class="hidden md:flex h-7 w-7 items-center justify-center rounded-md text-fg-muted transition-colors cursor-pointer hover:bg-bg-elevated hover:text-fg"
          >
            <PanelLeftClose size={16} />
          </button>
        {/if}

        {#if onCloseMobile}
          <button
            onclick={onCloseMobile}
            aria-label="Close sidebar"
            class="flex h-7 w-7 items-center justify-center rounded-md text-fg-muted md:hidden cursor-pointer hover:bg-bg-elevated hover:text-fg"
          >
            <X size={15} />
          </button>
        {/if}
      </div>
    </div>

    <div class="flex-1 overflow-y-auto px-2 py-1">
      <!-- New Chat Button -->
      <div class="mb-3 px-1">
        <button
          onclick={handleNewChat}
          disabled={chatStore.isStreaming}
          class="flex w-full items-center gap-2 rounded-lg border border-line bg-bg-elevated px-3 py-2 text-xs font-medium text-fg shadow-xs transition-colors cursor-pointer hover:bg-bg-hover hover:border-line-strong disabled:pointer-events-none disabled:opacity-40"
        >
          <SquarePen size={15} class="text-accent" />
          <span>New Chat</span>
        </button>
      </div>

      <!-- Conversations -->
      <p
        class="mb-1.5 px-2 text-[11px] font-semibold tracking-wider text-fg-subtle uppercase"
      >
        Conversations
      </p>

      {#if convsQuery.isLoading}
        <p class="px-2 text-xs text-fg-muted">Loading…</p>
      {:else if convsQuery.isError}
        <p class="px-2 text-xs text-danger">Couldn't load conversations.</p>
      {:else if (convsQuery.data ?? []).length === 0}
        <p
          class="rounded-lg border border-dashed border-line px-3 py-3 text-xs text-fg-muted"
        >
          No conversations yet. Send a message to start one.
        </p>
      {:else}
        <ul class="flex flex-col gap-0.5">
          {#each convsQuery.data ?? [] as conv (conv.id)}
            {@const isActive = chatStore.activeConversationId === conv.id}
            <li class="list-none">
              <div
                class="group relative flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-xs transition-colors"
                class:bg-bg-elevated={isActive}
                class:text-fg={isActive}
                class:font-medium={isActive}
                class:text-fg-muted={!isActive}
                class:hover:bg-bg-elevated={!isActive}
                onclick={() => handleSelectConv(conv)}
                tabindex="0"
                role="button"
                onkeydown={(e) => e.key === "Enter" && handleSelectConv(conv)}
              >
                <span class="min-w-0 flex-1 truncate">{conv.title}</span>
                <span
                  class="shrink-0 text-[10px] font-mono text-fg-subtle opacity-0 transition-opacity group-hover:opacity-100"
                >
                  {formatAge(conv.updatedAt)}
                </span>
                <button
                  onclick={(e) => handleDelete(e, conv)}
                  disabled={deletingId === conv.id}
                  aria-label="Delete conversation"
                  class="shrink-0 rounded p-0.5 text-fg-subtle opacity-0 transition-all cursor-pointer hover:text-danger group-hover:opacity-100 disabled:pointer-events-none"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            </li>
          {/each}
        </ul>
      {/if}
    </div>

    <!-- Collapsible Backends section -->
    <div class="border-t border-line/60 px-3 py-2">
      <button
        type="button"
        onclick={() => (showBackends = !showBackends)}
        class="flex w-full items-center justify-between py-1 text-[11px] font-semibold uppercase tracking-wider text-fg-subtle cursor-pointer hover:text-fg transition-colors duration-200"
      >
        <span>Backends ({backendsQuery.data?.length ?? 0})</span>
        <ChevronUp
          size={12}
          class="shrink-0 transition-transform duration-200 {showBackends ? 'rotate-180' : ''}"
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
              <div class="flex items-center gap-2 rounded-md px-2 py-1 text-xs">
                <span
                  class="h-1.5 w-1.5 shrink-0 rounded-full"
                  class:bg-success={backend.status === "online"}
                  class:bg-danger={backend.status === "offline"}
                  class:bg-fg-subtle={backend.status === "unknown"}
                ></span>
                <span class="flex-1 truncate text-fg-muted">{backend.name}</span
                >
                <span class="shrink-0 font-mono text-[10px] text-fg-subtle"
                  >{backend.prefix}</span
                >
              </div>
            {/each}
          {/if}
        </div>
      {/if}
    </div>

    <!-- Footer -->
    <div
      class="flex items-center justify-between border-t border-line px-3 py-2.5"
    >
      <button
        onclick={onOpenSettings}
        aria-label="Settings"
        title="Settings"
        class="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs text-fg-muted transition-colors cursor-pointer hover:bg-bg-elevated hover:text-fg"
      >
        <Settings size={15} />
        <span class="font-medium">Settings</span>
      </button>
    </div>
  {/if}
</aside>
