<script lang="ts">
  import { createQuery, useQueryClient } from "@tanstack/svelte-query";
  import { Plus, Trash2, Settings, Layers } from "@lucide/svelte";
  import { fetchBackends, fetchConversations, deleteConversation } from "../api";
  import { chatStore } from "../stores/chat.svelte";
  import type { ConversationSummary } from "../types";
  import ThemeSwitcher from "./ThemeSwitcher.svelte";

  interface Props {
    onOpenSettings: () => void;
    onOpenModelEditor: () => void;
  }
  const { onOpenSettings, onOpenModelEditor }: Props = $props();

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

  async function handleDelete(e: MouseEvent, conv: ConversationSummary) {
    e.stopPropagation();
    if (deletingId) return;
    if (!confirm(`Delete "${conv.title}"?`)) return;
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

<aside class="flex w-64 shrink-0 flex-col border-r border-line bg-bg-inset">
  <!-- Logo + new chat -->
  <div class="flex items-center justify-between px-4 py-4">
    <div class="flex items-center gap-2">
      <div class="h-3.5 w-3.5 rotate-45 bg-accent"></div>
      <span class="text-sm font-semibold tracking-wide">Blombrain</span>
    </div>
    <button
      onclick={() => chatStore.newConversation()}
      disabled={chatStore.isStreaming}
      aria-label="New conversation"
      class="flex h-7 w-7 items-center justify-center rounded-md text-fg-muted transition-colors hover:bg-bg-elevated hover:text-fg disabled:pointer-events-none disabled:opacity-40"
    >
      <Plus size={15} />
    </button>
  </div>

  <div class="flex-1 overflow-y-auto px-2 py-1">
    <!-- Conversations -->
    <p class="mb-1 px-2 text-[11px] font-medium tracking-wide text-fg-subtle uppercase">
      Conversations
    </p>

    {#if convsQuery.isLoading}
      <p class="px-2 text-xs text-fg-muted">Loading…</p>
    {:else if convsQuery.isError}
      <p class="px-2 text-xs text-danger">Couldn't load conversations.</p>
    {:else if (convsQuery.data ?? []).length === 0}
      <p class="rounded-md border border-dashed border-line px-3 py-3 text-xs text-fg-muted">
        No conversations yet. Send a message to start one.
      </p>
    {:else}
      <ul class="flex flex-col gap-0.5">
        {#each convsQuery.data ?? [] as conv (conv.id)}
          {@const isActive = chatStore.activeConversationId === conv.id}
          <li class="list-none">
            <div
              class="group relative flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-xs transition-colors"
              class:bg-bg-elevated={isActive}
              class:text-fg={isActive}
              class:text-fg-muted={!isActive}
              class:hover:bg-bg-elevated={!isActive}
              onclick={() => chatStore.loadConversation(conv)}
              tabindex="0"
              role="button"
              onkeydown={(e) => e.key === "Enter" && chatStore.loadConversation(conv)}
            >
              <span class="min-w-0 flex-1 truncate">{conv.title}</span>
              <span class="shrink-0 text-[10px] text-fg-subtle opacity-0 transition-opacity group-hover:opacity-100">
                {formatAge(conv.updatedAt)}
              </span>
              <button
                onclick={(e) => handleDelete(e, conv)}
                disabled={deletingId === conv.id}
                aria-label="Delete conversation"
                class="shrink-0 rounded p-0.5 text-fg-subtle opacity-0 transition-all hover:text-danger group-hover:opacity-100 disabled:pointer-events-none"
              >
                <Trash2 size={12} />
              </button>
            </div>
          </li>
        {/each}
      </ul>
    {/if}

    <!-- Backends section -->
    <p class="mt-5 mb-1 px-2 text-[11px] font-medium tracking-wide text-fg-subtle uppercase">
      Backends
    </p>
    {#if backendsQuery.isLoading}
      <p class="px-2 text-xs text-fg-muted">Loading…</p>
    {:else if backendsQuery.isError}
      <p class="px-2 text-xs text-danger">Can't reach the backend API.</p>
    {:else if (backendsQuery.data ?? []).length === 0}
      <p class="rounded-md border border-dashed border-line px-3 py-2 text-xs text-fg-muted">
        No backends configured.
      </p>
    {:else}
      <ul class="flex flex-col gap-1">
        {#each backendsQuery.data ?? [] as backend (backend.id)}
          <li class="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs">
            <span
              class="h-1.5 w-1.5 shrink-0 rounded-full"
              class:bg-success={backend.status === "online"}
              class:bg-danger={backend.status === "offline"}
              class:bg-fg-subtle={backend.status === "unknown"}
              aria-hidden="true"
            ></span>
            <span class="flex-1 truncate text-fg">{backend.name}</span>
            <span class="shrink-0 font-mono text-[10px] text-fg-subtle">{backend.prefix}</span>
          </li>
        {/each}
      </ul>
    {/if}
  </div>

  <!-- Footer -->
  <div class="flex items-center justify-between border-t border-line px-4 py-3">
    <div class="flex items-center gap-2">
      <button
        onclick={onOpenModelEditor}
        aria-label="Models & Presets"
        title="Models & Presets"
        class="flex h-6 w-6 items-center justify-center rounded text-fg-muted transition-colors hover:bg-bg-elevated hover:text-fg"
      >
        <Layers size={13} />
      </button>
      <button
        onclick={onOpenSettings}
        aria-label="Settings"
        title="Backends Settings"
        class="flex h-6 w-6 items-center justify-center rounded text-fg-muted transition-colors hover:bg-bg-elevated hover:text-fg"
      >
        <Settings size={13} />
      </button>
      <ThemeSwitcher />
    </div>
  </div>
</aside>
