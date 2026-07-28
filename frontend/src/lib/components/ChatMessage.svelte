<script lang="ts">
  import { createQuery } from "@tanstack/svelte-query";
  import type { ChatMessage as ChatMessageType } from "../types";
  import { serveUploadUrl, fetchModels } from "../api";
  import { chatStore } from "../stores/chat.svelte";
  import { settingsStore } from "../stores/settings.svelte";
  import { Paperclip, Check, Send as SendIcon, X, Info } from "@lucide/svelte";
  import ThinkingBlock from "./ThinkingBlock.svelte";
  import MessageTimestamp from "./MessageTimestamp.svelte";
  import BranchNavigator from "./BranchNavigator.svelte";
  import MessageActions from "./MessageActions.svelte";
  import Markdown from "./Markdown.svelte";
  import { fly, fade } from "svelte/transition";

  interface Props {
    message: ChatMessageType;
    isLast?: boolean;
  }
  const { message, isLast = false }: Props = $props();

  const modelsQuery = createQuery(() => ({
    queryKey: ["models"],
    queryFn: fetchModels,
  }));

  let currentModelInfo = $derived(
    modelsQuery.data
      ? modelsQuery.data.find(
          (m) => m.id === (message.model || chatStore.selectedModel),
        )
      : undefined,
  );

  // Compute siblings for branch navigation
  let siblings = $derived.by(() => {
    const parentId = message.parentId ?? null;
    const matches = chatStore.messages.filter(
      (m) => (m.parentId ?? null) === parentId,
    );
    return matches.map((m) => m.id);
  });

  // Edit Mode state
  let isEditing = $state(false);
  let editDraft = $state("");
  let isSaving = $state(false);
  let showStats = $state(false);

  function startEdit() {
    editDraft = message.content;
    isEditing = true;
  }

  function cancelEdit() {
    isEditing = false;
    editDraft = "";
  }

  async function handleSaveOnly() {
    if (!editDraft.trim() || isSaving) return;
    isSaving = true;
    try {
      await chatStore.editMessage(message.id, editDraft.trim());
      isEditing = false;
    } finally {
      isSaving = false;
    }
  }

  async function handleSendBranch() {
    if (!editDraft.trim() || isSaving) return;
    isSaving = true;
    try {
      isEditing = false;
      await chatStore.sendEditedBranch(message.id, editDraft.trim());
    } finally {
      isSaving = false;
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      cancelEdit();
    } else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      if (message.role === "user") {
        handleSendBranch();
      } else {
        handleSaveOnly();
      }
    }
  }
</script>

<div
  class="group relative flex gap-3 py-2 px-1 transition-colors rounded-xl hover:bg-bg-elevated/40 {message.role ===
  'user'
    ? 'flex-row-reverse'
    : ''}"
>
  <!-- Avatar / Icon -->
  <div
    class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg overflow-hidden border border-line bg-bg-elevated shadow-xs select-none"
  >
    {#if message.role === "user"}
      {#if settingsStore.userAvatar}
        <img
          src={settingsStore.userAvatar}
          alt={settingsStore.userName || "User"}
          class="h-full w-full object-cover"
        />
      {:else}
        <div
          class="flex h-full w-full items-center justify-center bg-accent text-accent-fg font-semibold text-xs uppercase"
        >
          {settingsStore.userName ? settingsStore.userName.slice(0, 2) : "YOU"}
        </div>
      {/if}
    {:else if currentModelInfo?.icon}
      <img
        src={currentModelInfo.icon}
        alt={currentModelInfo.name || "AI"}
        class="h-full w-full object-cover"
      />
    {:else}
      <div
        class="flex h-full w-full items-center justify-center bg-bg-inset text-fg-muted font-semibold text-xs"
      >
        AI
      </div>
    {/if}
  </div>

  <div
    class="flex min-w-0 flex-1 flex-col gap-1.5 {message.role === 'user'
      ? 'items-end'
      : 'items-start'}"
  >
    <!-- Header: Sender Name, Timestamp, Info, Branch Navigator -->
    <div class="flex flex-wrap items-center gap-2 text-xs">
      {#if message.role === "user"}
        <!-- Branch Navigator -->
        <BranchNavigator
          parentId={message.parentId ?? null}
          {siblings}
          currentId={message.id}
        />

        <!-- Timestamp -->
        <MessageTimestamp timestamp={message.createdAt} />

        <span class="font-medium text-fg">
          {settingsStore.userName || "You"}
        </span>
      {:else}
        <span class="font-medium text-fg">
          {currentModelInfo?.name || "Assistant"}
        </span>

        <!-- Timestamp -->
        <MessageTimestamp timestamp={message.createdAt} />

        <!-- Inline stats icon for assistant messages -->
        {#if message.stats}
          {@const s = message.stats}
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div
            class="relative"
            onmouseenter={() => (showStats = true)}
            onmouseleave={() => (showStats = false)}
          >
            <button
              type="button"
              aria-label="Response stats"
              onclick={(e) => {
                e.stopPropagation();
                showStats = !showStats;
              }}
              class="flex items-center justify-center text-fg-subtle hover:text-fg-muted transition-colors cursor-pointer"
            >
              <Info size={12} />
            </button>
            <!-- Stats tooltip -->
            {#if showStats}
              <div
                transition:fly={{ y: 6, duration: 150 }}
                class="absolute bottom-full right-0 mb-1.5 z-20 flex flex-col gap-1 whitespace-nowrap rounded-lg border border-line bg-bg-elevated px-3 py-2 shadow-lg text-[11px] font-mono text-fg-muted"
              >
                {#if s.promptTokens !== undefined}
                  <span>Prompt: {s.promptTokens.toLocaleString()} tok</span>
                {/if}
                {#if s.completionTokens !== undefined}
                  <span>Output: {s.completionTokens.toLocaleString()} tok</span>
                {/if}
                {#if s.totalTokens !== undefined}
                  <span>Total: {s.totalTokens.toLocaleString()} tok</span>
                {/if}
                {#if s.durationMs !== undefined}
                  <span>Time: {(s.durationMs / 1000).toFixed(1)}s</span>
                {/if}
                {#if s.completionTokens !== undefined && s.durationMs !== undefined && s.durationMs > 0}
                  <span
                    >Speed: {(
                      s.completionTokens /
                      (s.durationMs / 1000)
                    ).toFixed(1)} tok/s</span
                  >
                {/if}
              </div>
            {/if}
          </div>
        {/if}

        <!-- Branch Navigator (right of Info icon) -->
        <BranchNavigator
          parentId={message.parentId ?? null}
          {siblings}
          currentId={message.id}
        />
      {/if}
    </div>

    <!-- Attachments -->
    {#if message.attachments && message.attachments.length > 0}
      <div
        class="flex flex-wrap gap-2 {message.role === 'user'
          ? 'justify-end'
          : 'justify-start'}"
      >
        {#each message.attachments as att (att.id)}
          {#if att.mimeType.startsWith("image/")}
            <button
              type="button"
              onclick={() => (chatStore.selectedAttachment = att)}
              class="cursor-pointer overflow-hidden rounded-lg border border-line bg-bg-elevated transition-transform hover:scale-[1.01]"
            >
              <img
                src={serveUploadUrl(att.id)}
                alt={att.originalName}
                class="max-h-64 rounded-lg object-contain"
              />
            </button>
          {:else if att.mimeType.startsWith("video/")}
            <button
              type="button"
              onclick={() => (chatStore.selectedAttachment = att)}
              class="cursor-pointer overflow-hidden rounded-lg border border-line bg-bg-elevated transition-transform hover:scale-[1.01]"
            >
              <!-- svelte-ignore a11y_media_has_caption -->
              <video
                src={serveUploadUrl(att.id)}
                class="max-h-64 rounded-lg pointer-events-none"
              ></video>
            </button>
          {:else if att.mimeType.startsWith("audio/")}
            <button
              type="button"
              onclick={() => (chatStore.selectedAttachment = att)}
              class="flex items-center gap-2 rounded-lg border border-line bg-bg-elevated px-3 py-2 text-xs hover:bg-bg-hover transition-colors cursor-pointer"
            >
              <Paperclip size={14} class="text-fg-muted" />
              <span class="font-medium text-fg">{att.originalName}</span>
            </button>
          {:else}
            <button
              type="button"
              onclick={() => (chatStore.selectedAttachment = att)}
              class="flex items-center gap-2 rounded-lg border border-line bg-bg-elevated px-3 py-2 text-xs hover:bg-bg-hover transition-colors cursor-pointer"
            >
              <Paperclip size={14} class="text-fg-muted" />
              <span class="font-medium text-fg">{att.originalName}</span>
            </button>
          {/if}
        {/each}
      </div>
    {/if}

    <!-- Message Content or Edit Input -->
    {#if isEditing}
      <div
        class="edit-container w-full max-w-2xl flex flex-col gap-2 rounded-lg border bg-bg p-3 shadow-md"
      >
        <textarea
          bind:value={editDraft}
          onkeydown={handleKeydown}
          rows="3"
          class="edit-textarea w-full resize-y rounded-md bg-bg-elevated px-3 py-2 text-sm text-fg"
        ></textarea>
        <div class="flex items-center justify-between text-xs text-fg-subtle">
          <span
            >Press <kbd
              class="px-1 py-0.5 rounded bg-bg-elevated border border-line font-mono text-[10px]"
              >Ctrl+Enter</kbd
            > to confirm</span
          >
          <div class="flex items-center gap-2">
            <button
              type="button"
              onclick={cancelEdit}
              disabled={isSaving}
              class="h-7 rounded-md border border-line px-2.5 text-xs text-fg-muted transition-colors hover:bg-bg-elevated"
            >
              Cancel
            </button>

            <button
              type="button"
              onclick={handleSaveOnly}
              disabled={isSaving || !editDraft.trim()}
              class="flex h-7 items-center gap-1 rounded-md border border-line bg-bg-elevated px-3 text-xs font-medium text-fg transition-colors hover:bg-bg-hover disabled:opacity-50"
            >
              <Check size={12} />
              Save
            </button>

            {#if message.role === "user"}
              <button
                type="button"
                onclick={handleSendBranch}
                disabled={isSaving || !editDraft.trim()}
                class="flex h-7 items-center gap-1 rounded-md bg-accent px-3 text-xs font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                <SendIcon size={12} />
                Send
              </button>
            {/if}
          </div>
        </div>
      </div>
    {:else if message.content || message.error || message.streaming}
      <div
        class="relative rounded-2xl px-4 py-3 text-sm leading-relaxed max-w-full break-words
          {message.role === 'user'
          ? 'bg-accent-muted/90 text-fg rounded-tr-xs'
          : 'bg-bg-elevated border border-line/60 text-fg rounded-tl-xs shadow-xs'}"
      >
        {#if message.role === "assistant"}
          <ThinkingBlock
            thinkingContent={message.thinkingContent}
            thinkingDone={message.thinkingDone}
            streaming={message.streaming}
            thinkingTimeMs={message.thinkingTimeMs}
          />
        {/if}
        {#if message.error}
          <p class="font-medium text-danger">{message.error}</p>
        {:else if message.content}
          <Markdown content={message.content} />{#if message.streaming}<span
              class="ml-0.5 inline-block h-3.5 w-1.5 translate-y-0.5 animate-pulse bg-accent"
            ></span>{/if}
        {:else if message.streaming && (message.thinkingContent === undefined || message.thinkingDone)}
          <span class="inline-flex gap-1 py-1">
            <span
              class="h-1.5 w-1.5 animate-bounce rounded-full bg-fg-subtle [animation-delay:-0.3s]"
            ></span>
            <span
              class="h-1.5 w-1.5 animate-bounce rounded-full bg-fg-subtle [animation-delay:-0.15s]"
            ></span>
            <span class="h-1.5 w-1.5 animate-bounce rounded-full bg-fg-subtle"
            ></span>
          </span>
        {/if}
      </div>
    {/if}

    <!-- Hover Actions Toolbar -->
    {#if !isEditing}
      <div
        class="mt-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100"
      >
        <MessageActions {message} {isLast} onStartEdit={startEdit} />
      </div>
    {/if}
  </div>

  <!-- Spacer to balance hover background padding on the opposite side of avatar -->
  <div class="w-8 shrink-0 invisible"></div>
</div>

<style>
  .edit-container {
    border-color: var(--line);
    transition:
      border-color 0.15s ease,
      box-shadow 0.15s ease;
  }

  .edit-container:hover {
    border-color: var(--line-strong);
    box-shadow: 0 4px 12px var(--shadow);
  }

  .edit-container:focus-within,
  .edit-container:focus-within:hover {
    border-color: var(--accent);
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 25%, transparent);
  }

  .edit-textarea,
  .edit-textarea:focus,
  .edit-textarea:focus-visible {
    outline: none !important;
    box-shadow: none !important;
    border-color: var(--line);
  }
</style>
