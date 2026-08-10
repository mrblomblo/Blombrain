<script lang="ts">
  import { createQuery } from "@tanstack/svelte-query";
  import type { ChatMessage as ChatMessageType } from "../types";
  import { serveUploadUrl, fetchModels, uploadFile } from "../api";
  import { chatStore } from "../stores/chat.svelte";
  import { settingsStore } from "../stores/settings.svelte";
  import { Paperclip, Check, Send as SendIcon, X, Info } from "@lucide/svelte";
  import ThinkingBlock from "./ThinkingBlock.svelte";
  import ToolTranscriptBlock from "./ToolTranscriptBlock.svelte";
  import MessageTimestamp from "./MessageTimestamp.svelte";
  import BranchNavigator from "./BranchNavigator.svelte";
  import MessageActions from "./MessageActions.svelte";
  import Markdown from "./Markdown.svelte";
  import Button from "./ui/Button.svelte";
  import { fly, fade } from "svelte/transition";
  import type { AttachmentOut } from "../types";
  import { parseMessageSegments } from "../utils/segmentParser";

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

  let parsedSegments = $derived(
    parseMessageSegments(
      message.content,
      message.thinkingContent,
      message.toolExecutions,
    ),
  );

  let hasCodeBlock = $derived(
    !!(
      message.content &&
      (message.content.includes("```") || message.content.includes("<pre>"))
    ),
  );

  // Edit Mode state
  let isEditing = $state(false);
  let editDraft = $state("");
  let editAttachments = $state<AttachmentOut[]>([]);
  let editFileInput: HTMLInputElement | undefined = $state();
  let editTextarea: HTMLTextAreaElement | undefined = $state();
  let isUploadingEdit = $state(false);
  let isSaving = $state(false);
  let showStats = $state(false);

  $effect(() => {
    if (isEditing && editTextarea) {
      editTextarea.focus();
      editTextarea.selectionStart = editTextarea.selectionEnd =
        editTextarea.value.length;
    }
  });

  // Compute tokens per second with fallbacks
  let tps = $derived.by(() => {
    const stats = message.stats;
    if (!stats) return null;

    const tps =
      stats?.tokensPerSecond ??
      (stats?.generationMs && stats?.completionTokens
        ? stats.completionTokens / (stats.generationMs / 1000)
        : stats?.completionTokens && stats?.durationMs && stats.durationMs > 0
          ? stats.completionTokens / (stats.durationMs / 1000)
          : null);

    return tps ? tps.toFixed(1) : null;
  });

  function startEdit() {
    editDraft = message.content;
    editAttachments = message.attachments ? [...message.attachments] : [];
    isEditing = true;
  }

  function cancelEdit() {
    isEditing = false;
    editDraft = "";
    editAttachments = [];
  }

  function removeEditAttachment(id: string) {
    editAttachments = editAttachments.filter((a) => a.id !== id);
  }

  async function handleEditFileSelect(e: Event) {
    const input = e.target as HTMLInputElement;
    if (!input.files || input.files.length === 0) return;
    isUploadingEdit = true;
    for (const file of Array.from(input.files)) {
      try {
        let fileToUpload = file;
        if (file.type.startsWith("audio/")) {
          const { encodeToWav } = await import("../audio");
          fileToUpload = await encodeToWav(file);
        }
        const uploaded = await uploadFile(
          fileToUpload,
          chatStore.activeConversationId,
        );
        editAttachments.push(uploaded);
      } catch (err) {
        alert("Failed to upload " + file.name);
      }
    }
    isUploadingEdit = false;
    input.value = "";
  }

  async function handleSaveOnly() {
    if (
      (!editDraft.trim() && editAttachments.length === 0) ||
      isSaving ||
      isUploadingEdit
    )
      return;
    isSaving = true;
    try {
      const attIds = editAttachments.map((a) => a.id);
      await chatStore.editMessage(message.id, editDraft.trim(), attIds);
      isEditing = false;
    } finally {
      isSaving = false;
    }
  }

  async function handleSendBranch() {
    if (
      (!editDraft.trim() && editAttachments.length === 0) ||
      isSaving ||
      isUploadingEdit
    )
      return;
    isSaving = true;
    try {
      isEditing = false;
      const attIds = editAttachments.map((a) => a.id);
      await chatStore.sendEditedBranch(message.id, editDraft.trim(), attIds);
    } finally {
      isSaving = false;
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      cancelEdit();
    }
  }
</script>

{#snippet avatarContent(sizeClass = "h-8 w-8 rounded-lg")}
  <div
    class="flex shrink-0 items-center justify-center overflow-hidden border border-line bg-bg-elevated shadow-xs select-none {sizeClass}"
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
          class="flex h-full w-full items-center justify-center bg-accent text-accent-fg font-semibold text-[9px] sm:text-xs uppercase"
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
      <img
        src="/Blombrain.png"
        alt={currentModelInfo?.name || "Blombrain"}
        class="h-full w-full object-cover"
      />
    {/if}
  </div>
{/snippet}

<div
  class="group relative flex gap-2 sm:gap-3 py-2 px-1 transition-colors rounded-xl hover:bg-bg-elevated/40 {message.role ===
  'user'
    ? 'sm:flex-row-reverse'
    : ''}"
>
  <!-- Avatar / Icon (Desktop / Tablet side avatar) -->
  <div class="hidden sm:flex">
    {@render avatarContent("h-8 w-8 rounded-lg")}
  </div>

  <div
    class="flex min-w-0 flex-1 flex-col gap-1.5 {message.role === 'user'
      ? 'items-end'
      : 'items-start'}"
  >
    <!-- Header: Sender Name, Timestamp, Info -->
    <div class="flex flex-wrap items-center gap-1.5 sm:gap-2 text-xs">
      {#if message.role === "user"}
        <!-- Timestamp -->
        <MessageTimestamp timestamp={message.createdAt} />

        <span class="font-medium text-fg">
          {settingsStore.userName || "You"}
        </span>

        <!-- Mobile Inline Avatar -->
        <div class="flex sm:hidden">
          {@render avatarContent("h-5 w-5 rounded-md")}
        </div>
      {:else}
        <!-- Mobile Inline Avatar -->
        <div class="flex sm:hidden">
          {@render avatarContent("h-5 w-5 rounded-md")}
        </div>

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
                  <span>Input: {s.promptTokens.toLocaleString()} tok</span>
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
                {#if tps}
                  <span>Speed: {tps} tok/s</span>
                {/if}
              </div>
            {/if}
          </div>
        {/if}
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
        class="edit-container w-full flex flex-col gap-2 rounded-lg border bg-bg p-3 shadow-md"
      >
        <!-- Existing & New Attachments Thumbnails -->
        {#if editAttachments.length > 0}
          <div class="flex flex-wrap gap-2 pb-1">
            {#each editAttachments as att (att.id)}
              <div
                class="group relative flex h-12 w-12 items-center justify-center rounded-lg border border-line bg-bg-elevated overflow-hidden shadow-xs"
              >
                {#if att.mimeType.startsWith("image/") || att.mimeType.startsWith("video/")}
                  <img
                    src={serveUploadUrl(att.id)}
                    alt={att.originalName}
                    class="h-full w-full object-cover"
                  />
                {:else if att.mimeType.startsWith("audio/")}
                  <div class="text-[9px] text-fg-subtle font-mono">Audio</div>
                {:else}
                  <div
                    class="text-[9px] text-fg-subtle truncate max-w-full px-1 font-mono"
                  >
                    {att.originalName}
                  </div>
                {/if}
                <button
                  type="button"
                  onclick={() => removeEditAttachment(att.id)}
                  class="absolute right-0.5 top-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-black/75 text-white/90 opacity-0 transition-all duration-150 group-hover:opacity-100 [@media(hover:none)]:opacity-100 [@media(pointer:coarse)]:opacity-100 hover:bg-danger hover:text-white z-10 cursor-pointer shadow-xs"
                  aria-label="Remove attachment"
                  title="Remove attachment"
                >
                  <X size={11} />
                </button>
              </div>
            {/each}
            {#if isUploadingEdit}
              <div
                class="flex h-12 w-12 items-center justify-center rounded-lg border border-line bg-bg-elevated"
              >
                <span class="animate-spin text-fg-subtle text-xs">⟳</span>
              </div>
            {/if}
          </div>
        {/if}

        <input
          type="file"
          bind:this={editFileInput}
          onchange={handleEditFileSelect}
          multiple
          class="hidden"
        />

        <textarea
          bind:this={editTextarea}
          bind:value={editDraft}
          onkeydown={(e) => {
            if (e.key === "Escape") {
              cancelEdit();
            } else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              if (message.role === "user") {
                handleSendBranch();
              } else {
                handleSaveOnly();
              }
            }
          }}
          disabled={isSaving || isUploadingEdit}
          placeholder="Edit message…"
          rows={4}
          class="w-full rounded-md bg-bg-elevated border border-line p-2.5 text-sm text-fg font-mono focus:outline-hidden focus:border-accent resize-y min-h-24 leading-relaxed"
        ></textarea>
        <div class="flex items-center justify-between text-xs text-fg-subtle">
          <div class="flex items-center gap-2">
            {#if message.role === "user"}
              <Button
                variant="default"
                outline
                size="icon"
                onclick={() => editFileInput?.click()}
                disabled={isSaving || isUploadingEdit}
                aria-label="Add attachment"
                title="Add attachment"
              >
                <Paperclip size={16} />
              </Button>
            {/if}
          </div>
          <div class="flex items-center gap-2">
            <Button
              variant="ghost"
              outline
              size="sm"
              type="button"
              onclick={cancelEdit}
              disabled={isSaving}
            >
              Cancel
            </Button>

            <Button
              variant="default"
              size="sm"
              type="button"
              onclick={handleSaveOnly}
              disabled={isSaving ||
                isUploadingEdit ||
                (!editDraft.trim() && editAttachments.length === 0)}
            >
              <Check size={12} />
              Save
            </Button>

            {#if message.role === "user"}
              <Button
                variant="accent"
                size="sm"
                type="button"
                onclick={handleSendBranch}
                disabled={isSaving ||
                  isUploadingEdit ||
                  (!editDraft.trim() && editAttachments.length === 0)}
              >
                <SendIcon size={12} />
                Send
              </Button>
            {/if}
          </div>
        </div>
      </div>
    {:else if message.content || message.thinkingContent || message.error || message.streaming}
      <div
        class="relative rounded-2xl p-3 text-sm leading-relaxed max-w-full break-words
          {message.role === 'user'
          ? 'bg-accent-muted/90 text-fg rounded-tr-xs'
          : 'bg-bg-elevated border border-line/60 text-fg rounded-tl-xs shadow-xs'}
          {hasCodeBlock ? 'w-full' : ''}"
      >
        {#if message.role === "assistant" && message.status === "routing" && !parsedSegments.some((s) => s.type === "router")}
          <ThinkingBlock status="routing" routerOutput={message.routerOutput} />
        {/if}
        {#if message.error}
          <p class="font-medium text-danger">{message.error}</p>
        {:else if parsedSegments.length > 0}
          {#each parsedSegments as seg (seg.id)}
            {#if seg.type === "router"}
              <ThinkingBlock
                isRouter={true}
                status={message.status}
                routerOutput={seg.content}
              />
            {:else if seg.type === "think"}
              <ThinkingBlock
                thinkingContent={seg.content}
                thinkingDone={seg.isDone}
                streaming={message.streaming}
                hasMainContent={true}
              />
            {:else if seg.type === "tool" && seg.execution}
              <ToolTranscriptBlock execution={seg.execution} />
            {:else if seg.type === "text" && seg.content}
              <Markdown content={seg.content} streaming={message.streaming} />
            {/if}
          {/each}
        {:else if message.streaming && message.status !== "routing"}
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

    <!-- Hover Actions Toolbar & Branch Navigator -->
    {#if !isEditing}
      <div
        class="mt-0.5 flex items-center gap-1.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100 [@media(hover:none)]:opacity-100 [@media(pointer:coarse)]:opacity-100"
      >
        {#if message.role === "user"}
          <BranchNavigator
            parentId={message.parentId ?? null}
            {siblings}
            currentId={message.id}
          />
          <MessageActions {message} {isLast} onStartEdit={startEdit} />
        {:else}
          <MessageActions {message} {isLast} onStartEdit={startEdit} />
          <BranchNavigator
            parentId={message.parentId ?? null}
            {siblings}
            currentId={message.id}
          />
        {/if}
      </div>
    {/if}
  </div>

  <!-- Spacer to balance hover background padding on the opposite side of avatar -->
  <div class="hidden sm:block w-8 shrink-0 invisible"></div>
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
    border-color: var(--accent) !important;
    box-shadow: none !important;
  }
</style>
