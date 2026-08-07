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
    MoreHorizontal,
    Pencil,
  } from "@lucide/svelte";
  import {
    fetchBackends,
    fetchConversations,
    deleteConversation,
    updateConversation,
  } from "../api";
  import { chatStore } from "../stores/chat.svelte";
  import { confirmStore } from "../stores/confirmStore.svelte";
  import type { ConversationSummary } from "../types";
  import Dropdown from "./ui/Dropdown.svelte";
  import TextInputModal from "./ui/TextInputModal.svelte";
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

  let deletingId = $state<string | null>(null);
  let showBackends = $state(false);
  let renameConv = $state<ConversationSummary | null>(null);
  let renameInputValue = $state("");
  let openDropdownId = $state<string | null>(null);

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

    if (newTitle && newTitle.trim() !== "" && newTitle !== conv.title) {
      try {
        await updateConversation(conv.id, { title: newTitle.trim() });
        await queryClient.invalidateQueries({ queryKey: ["conversations"] });
      } catch (err) {
        console.error("Failed to rename conversation", err);
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
    <!-- Conversations -->
    <div class="flex-1 overflow-y-auto overscroll-contain px-2 py-1 w-64">
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
          class="rounded-lg border border-dashed border-line px-3 py-3 text-xs text-fg-muted mx-1"
        >
          No conversations yet. Send a message to start one.
        </p>
      {:else}
        <ul class="flex flex-col gap-0.5">
          {#each convsQuery.data ?? [] as conv (conv.id)}
            {@const isActive = chatStore.activeConversationId === conv.id}
            {@const isMenuOpen = openDropdownId === conv.id}
            {@const isDisabled = chatStore.isStreaming && !isActive}
            <li class="list-none">
              <div
                class="group relative flex items-center rounded-lg px-2.5 py-2 text-xs transition-all duration-200"
                class:cursor-pointer={!isDisabled}
                class:cursor-not-allowed={isDisabled}
                class:opacity-40={isDisabled}
                class:pointer-events-none={isDisabled}
                class:bg-bg-elevated={isActive || isMenuOpen}
                class:text-fg={isActive || isMenuOpen}
                class:font-medium={isActive}
                class:text-fg-muted={!isActive && !isDisabled}
                class:bg-bg={!isActive && !isDisabled}
                class:hover:bg-bg-elevated={!isActive && !isDisabled}
                onclick={() => !isDisabled && handleSelectConv(conv)}
                tabindex={isDisabled ? -1 : 0}
                role="button"
                onkeydown={(e) =>
                  !isDisabled && e.key === "Enter" && handleSelectConv(conv)}
              >
                <span class="w-full truncate">{conv.title}</span>
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
                      { label: "Rename", value: "rename", icon: Pencil },
                      {
                        label: "Delete",
                        value: "delete",
                        icon: Trash2,
                        iconClass: "text-danger",
                      },
                    ]}
                    onchange={(val) => {
                      if (val === "rename") openRenameModal(conv);
                      else if (val === "delete") handleDelete(conv);
                    }}
                    align="right"
                    resetOnSelect={true}
                    showCheckmark={false}
                    unstyledTrigger={true}
                    buttonClass="rounded p-0.5 text-fg-subtle transition-all cursor-pointer hover:text-fg disabled:pointer-events-none disabled:opacity-50"
                    disabled={deletingId === conv.id || chatStore.isStreaming}
                  >
                    {#snippet trigger()}
                      <MoreHorizontal size={14} />
                    {/snippet}
                  </Dropdown>
                </div>
              </div>
            </li>
          {/each}
        </ul>
      {/if}
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
