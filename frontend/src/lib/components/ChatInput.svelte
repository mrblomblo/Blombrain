<script lang="ts">
  import { Send, Square, Paperclip, X, ChevronDown } from "@lucide/svelte";
  import { fade } from "svelte/transition";
  import { chatStore } from "../stores/chat.svelte";
  import Button from "./ui/Button.svelte";
  import { serveUploadUrl, fetchModels } from "../api";
  import { createQuery } from "@tanstack/svelte-query";

  import MarkdownInput from "./MarkdownInput.svelte";

  let draft = $state("");
  let fileInput: HTMLInputElement | undefined = $state();
  let isUploading = $state(false);
  let markdownInputRef: { focus: () => void } | undefined = $state();

  function handleContainerClick(e: MouseEvent) {
    const target = e.target as HTMLElement | null;
    if (!target) return;
    if (
      target.closest(
        "button, input, select, textarea, a, label, [role='button'], .markdown-input-editor",
      )
    ) {
      return;
    }
    markdownInputRef?.focus();
  }

  interface Props {
    floating?: boolean;
  }

  let { floating = false }: Props = $props();

  const modelsQuery = createQuery(() => ({
    queryKey: ["models"],
    queryFn: fetchModels,
  }));

  let selectedModelInfo = $derived(
    chatStore.selectedModel && modelsQuery.data
      ? modelsQuery.data.find((m) => m.id === chatStore.selectedModel)
      : undefined,
  );

  let allowedAccepts = $derived.by(() => {
    const types: string[] = [
      ".txt",
      ".md",
      ".pdf",
      ".py",
      ".ts",
      ".js",
      ".svelte",
      ".html",
      ".css",
      ".json",
      ".csv",
      ".c",
      ".cpp",
      ".rs",
      ".go",
      ".java",
      ".sh",
      ".yaml",
      ".yml",
      ".xml",
      ".doc",
      ".docx",
    ];
    if (selectedModelInfo?.canImage) types.push("image/*");
    if (selectedModelInfo?.canAudio) types.push("audio/*");
    if (selectedModelInfo?.canVideo) types.push("video/*");
    return types.join(",");
  });

  async function handleSend() {
    if (
      (!draft.trim() && chatStore.pendingAttachments.length === 0) ||
      chatStore.isStreaming ||
      isUploading
    )
      return;
    const toSend = draft;
    draft = "";
    await chatStore.send(toSend);
  }

  let isDragging = $state(false);
  let dragCounter = 0;

  function isFileAllowed(file: File): boolean {
    if (!allowedAccepts) return false;
    const rules = allowedAccepts.split(",").map((r) => r.trim().toLowerCase());
    const fileName = file.name.toLowerCase();
    const mimeType = file.type.toLowerCase();

    return rules.some((rule) => {
      if (rule.endsWith("/*")) {
        const prefix = rule.slice(0, -1);
        return mimeType.startsWith(prefix);
      } else if (rule.startsWith(".")) {
        return fileName.endsWith(rule);
      } else {
        return mimeType === rule;
      }
    });
  }

  function handleDragEnter(e: DragEvent) {
    e.preventDefault();
    if (isUploading) return;
    dragCounter++;
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = "copy";
    }
    isDragging = true;
  }

  function handleDragOver(e: DragEvent) {
    e.preventDefault();
    if (isUploading) return;
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = "copy";
    }
  }

  function handleDragLeave(e: DragEvent) {
    e.preventDefault();
    dragCounter--;
    if (dragCounter <= 0) {
      dragCounter = 0;
      isDragging = false;
    }
  }

  async function handleDrop(e: DragEvent) {
    e.preventDefault();
    dragCounter = 0;
    isDragging = false;
    if (isUploading) return;
    if (!e.dataTransfer?.files || e.dataTransfer.files.length === 0) return;

    const files = Array.from(e.dataTransfer.files).filter(isFileAllowed);
    if (files.length === 0) return;

    isUploading = true;
    for (const file of files) {
      try {
        await chatStore.addAttachment(file);
      } catch (err) {
        alert("Failed to upload " + file.name);
      }
    }
    isUploading = false;
  }

  async function handleFileSelect(e: Event) {
    const input = e.target as HTMLInputElement;
    if (!input.files || input.files.length === 0) return;

    isUploading = true;
    for (const file of Array.from(input.files)) {
      try {
        await chatStore.addAttachment(file);
      } catch (err) {
        alert("Failed to upload " + file.name);
      }
    }
    isUploading = false;
    input.value = "";
  }
</script>

<div class="relative {floating ? 'w-full px-2 sm:px-6' : 'px-2 sm:px-6 pb-3'}">
  {#if !floating}
    <div
      class="pointer-events-none absolute inset-x-0 bottom-0 top-20 z-0 bg-linear-to-t from-bg-inset via-bg-inset/85 to-transparent"
    ></div>
  {/if}
  <div
    class="relative z-10 mx-auto flex max-w-3xl lg:max-w-4xl xl:max-w-5xl flex-col gap-2"
  >
    <!-- Attachment Thumbnails -->
    {#if chatStore.pendingAttachments.length > 0}
      <div class="flex flex-wrap gap-2 px-1">
        {#each chatStore.pendingAttachments as att (att.id)}
          <div
            class="group relative flex h-14 w-14 items-center justify-center rounded-lg border border-line bg-bg-elevated overflow-hidden shadow-xs"
          >
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div
              onclick={() => (chatStore.selectedAttachment = att)}
              class="h-full w-full flex items-center justify-center cursor-pointer hover:opacity-90 transition-opacity"
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
            </div>
            <button
              type="button"
              onclick={(e) => {
                e.stopPropagation();
                chatStore.removeAttachment(att.id);
              }}
              class="absolute right-0.5 top-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-black/75 text-white/90 opacity-0 transition-all duration-150 group-hover:opacity-100 hover:bg-danger hover:text-white z-10 cursor-pointer shadow-xs"
              aria-label="Remove attachment"
              title="Remove attachment"
            >
              <X size={11} />
            </button>
          </div>
        {/each}
        {#if isUploading}
          <div
            class="flex h-14 w-14 items-center justify-center rounded-lg border border-line bg-bg-elevated"
          >
            <span class="animate-spin text-fg-subtle text-xs">⟳</span>
          </div>
        {/if}
      </div>
    {/if}

    <!-- Main Input Box -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <div
      ondragenter={handleDragEnter}
      ondragover={handleDragOver}
      ondragleave={handleDragLeave}
      ondrop={handleDrop}
      onclick={handleContainerClick}
      class="input-container relative flex flex-col rounded-xl border bg-bg-elevated p-2.5 cursor-text hover:border-accent transition-all duration-150 {isDragging
        ? 'border-accent!'
        : ''} {floating ? 'shadow-lg' : 'shadow-sm'}"
    >
      {#if isDragging}
        <div
          transition:fade={{ duration: 150 }}
          class="absolute inset-0 z-30 flex flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed border-accent bg-bg-elevated text-accent shadow-md"
        >
          <Paperclip size={22} class="animate-bounce" />
          <span class="text-xs font-semibold text-fg"
            >Drop file to add as an attachment</span
          >
        </div>
      {/if}
      {#if allowedAccepts}
        <input
          type="file"
          bind:this={fileInput}
          onchange={handleFileSelect}
          accept={allowedAccepts}
          multiple
          class="hidden"
        />
      {/if}

      <!-- Textarea Row replaced with MarkdownInput -->
      <MarkdownInput
        bind:this={markdownInputRef}
        bind:value={draft}
        onSubmit={handleSend}
        disabled={isUploading}
        disableSubmit={chatStore.isStreaming}
        placeholder={chatStore.isStreaming
          ? "Typing next message..."
          : "Message Blombrain…"}
      />

      <!-- Bottom Action Bar Row -->
      <div class="flex items-center justify-between pt-1.5">
        <!-- Left Side Tools (Attachments, future MCP/Skills) -->
        <div class="flex items-center gap-1">
          {#if allowedAccepts}
            <Button
              variant="default"
              outline
              size="icon"
              onclick={() => fileInput?.click()}
              disabled={isUploading}
              aria-label="Add attachment"
              title="Add attachment"
            >
              <Paperclip size={16} />
            </Button>
          {/if}
        </div>

        <!-- Right Side Actions (Send / Stop) -->
        <div class="flex items-center gap-2">
          {#if chatStore.isStreaming}
            <Button
              variant="danger"
              onclick={() => chatStore.stop()}
              aria-label="Stop generating"
              class="px-3! py-1.5! h-8 text-xs font-semibold"
            >
              <Square size={13} />
              Stop
            </Button>
          {:else}
            <Button
              variant="primary"
              onclick={handleSend}
              disabled={(!draft.trim() &&
                chatStore.pendingAttachments.length === 0) ||
                isUploading}
              aria-label="Send message"
              class="px-3! py-1.5! h-8 text-xs font-semibold"
            >
              <Send size={13} />
              Send
            </Button>
          {/if}
        </div>
      </div>
    </div>
  </div>
</div>

<style>
  .input-container:focus-within,
  .input-container:focus-within:hover {
    border-color: var(--accent) !important;
    box-shadow: none !important;
  }
</style>
