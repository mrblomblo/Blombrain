<script lang="ts">
  import { Send, Square, Paperclip, X, ChevronDown } from "@lucide/svelte";
  import { chatStore } from "../stores/chat.svelte";
  import Button from "./ui/Button.svelte";
  import { serveUploadUrl, fetchModels } from "../api";
  import { createQuery } from "@tanstack/svelte-query";


  let draft = $state("");
  let textarea: HTMLTextAreaElement | undefined = $state();
  let fileInput: HTMLInputElement | undefined = $state();
  let isUploading = $state(false);

  const modelsQuery = createQuery(() => ({
    queryKey: ["models"],
    queryFn: fetchModels,
  }));

  let selectedModelInfo = $derived(
    chatStore.selectedModel && modelsQuery.data
      ? modelsQuery.data.find((m) => m.id === chatStore.selectedModel)
      : undefined
  );

  let allowedAccepts = $derived.by(() => {
    const types: string[] = [
      ".txt", ".md", ".pdf", ".py", ".ts", ".js", ".svelte", ".html", ".css", ".json",
      ".csv", ".c", ".cpp", ".rs", ".go", ".java", ".sh", ".yaml", ".yml", ".xml", ".doc", ".docx"
    ];
    if (selectedModelInfo?.canImage) types.push("image/*");
    if (selectedModelInfo?.canAudio) types.push("audio/*");
    if (selectedModelInfo?.canVideo) types.push("video/*");
    return types.join(",");
  });

  function autosize() {
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;
  }

  async function handleSend() {
    if ((!draft.trim() && chatStore.pendingAttachments.length === 0) || chatStore.isStreaming || isUploading) return;
    const toSend = draft;
    draft = "";
    autosize();
    await chatStore.send(toSend);
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
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

<div class="border-t border-line bg-bg px-4 sm:px-6 py-3">
  <div class="mx-auto flex max-w-3xl flex-col gap-2">
    <!-- Attachment Thumbnails -->
    {#if chatStore.pendingAttachments.length > 0}
      <div class="flex flex-wrap gap-2 px-1">
        {#each chatStore.pendingAttachments as att (att.id)}
          <div class="group relative flex h-14 w-14 items-center justify-center rounded-lg border border-line bg-bg-elevated overflow-hidden shadow-xs">
            {#if att.mimeType.startsWith("image/") || att.mimeType.startsWith("video/")}
              <img src={serveUploadUrl(att.id)} alt={att.originalName} class="h-full w-full object-cover" />
            {:else if att.mimeType.startsWith("audio/")}
              <div class="text-[9px] text-fg-subtle font-mono">Audio</div>
            {:else}
              <div class="text-[9px] text-fg-subtle truncate max-w-full px-1 font-mono">{att.originalName}</div>
            {/if}
            <button
              onclick={() => chatStore.removeAttachment(att.id)}
              class="absolute right-1 top-1 flex h-4 w-4 items-center justify-center rounded-full bg-black/70 text-white opacity-0 transition-opacity group-hover:opacity-100 hover:bg-black hover:text-danger"
              aria-label="Remove attachment"
            >
              <X size={10} />
            </button>
          </div>
        {/each}
        {#if isUploading}
          <div class="flex h-14 w-14 items-center justify-center rounded-lg border border-line bg-bg-elevated">
            <span class="animate-spin text-fg-subtle text-xs">⟳</span>
          </div>
        {/if}
      </div>
    {/if}

    <!-- Main Input Box -->
    <div class="input-container relative flex items-end gap-2 rounded-xl border bg-bg-elevated p-2 shadow-sm">
      {#if allowedAccepts}
        <input
          type="file"
          bind:this={fileInput}
          onchange={handleFileSelect}
          accept={allowedAccepts}
          multiple
          class="hidden"
        />
        <button
          type="button"
          onclick={() => fileInput?.click()}
          disabled={chatStore.isStreaming || isUploading}
          aria-label="Add attachment"
          class="flex h-8 w-8 shrink-0 self-center items-center justify-center rounded-lg text-fg-muted transition-colors hover:bg-bg-hover hover:text-fg disabled:opacity-40"
        >
          <Paperclip size={16} />
        </button>
      {/if}

      <textarea
        bind:this={textarea}
        bind:value={draft}
        oninput={autosize}
        onkeydown={handleKeydown}
        rows="1"
        placeholder="Message Blombrain…"
        class="max-h-52 flex-1 resize-none self-center bg-transparent px-2 py-1.5 text-sm text-fg placeholder:text-fg-subtle"
      ></textarea>

      {#if chatStore.isStreaming}
        <Button variant="danger" onclick={() => chatStore.stop()} aria-label="Stop generating" class="!px-3 !py-1.5 h-8 text-xs font-semibold">
          <Square size={13} />
          Stop
        </Button>
      {:else}
        <Button
          variant="primary"
          onclick={handleSend}
          disabled={(!draft.trim() && chatStore.pendingAttachments.length === 0) || isUploading}
          aria-label="Send message"
          class="!px-3 !py-1.5 h-8 text-xs font-semibold"
        >
          <Send size={13} />
          Send
        </Button>
      {/if}
    </div>
  </div>
</div>

<style>
  .input-container {
    border-color: var(--line);
    transition: border-color 0.15s ease, box-shadow 0.15s ease;
  }

  .input-container:hover {
    border-color: var(--line-strong);
    box-shadow: 0 4px 12px var(--shadow);
  }

  .input-container:focus-within,
  .input-container:focus-within:hover {
    border-color: var(--accent);
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 25%, transparent);
  }

  textarea,
  textarea:focus,
  textarea:focus-visible {
    outline: none !important;
    box-shadow: none !important;
  }
</style>
