<script lang="ts">
  import { Send, Square, Paperclip, X } from "@lucide/svelte";
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
    textarea.style.height = `${Math.min(textarea.scrollHeight, 240)}px`;
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

<div class="border-t border-line bg-bg px-6 py-4">
  <div class="mx-auto flex max-w-3xl flex-col gap-2">
    {#if chatStore.pendingAttachments.length > 0}
      <div class="flex flex-wrap gap-2 px-2">
        {#each chatStore.pendingAttachments as att (att.id)}
          <div class="group relative flex h-16 w-16 items-center justify-center rounded-md border border-line bg-bg-elevated overflow-hidden">
            {#if att.mimeType.startsWith("image/") || att.mimeType.startsWith("video/")}
              <img src={serveUploadUrl(att.id)} alt={att.originalName} class="h-full w-full object-cover" />
            {:else if att.mimeType.startsWith("audio/")}
              <div class="text-[10px] text-fg-subtle">Audio</div>
            {:else}
              <div class="text-[10px] text-fg-subtle truncate max-w-full px-1">{att.originalName}</div>
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
          <div class="flex h-16 w-16 items-center justify-center rounded-md border border-line bg-bg-elevated">
            <span class="animate-spin text-fg-subtle">⟳</span>
          </div>
        {/if}
      </div>
    {/if}

    <div class="flex items-end gap-2">
      {#if allowedAccepts}
        <input 
          type="file" 
          bind:this={fileInput} 
          onchange={handleFileSelect} 
          accept={allowedAccepts} 
          multiple 
          class="hidden" 
        />
        <Button 
          variant="ghost" 
          onclick={() => fileInput?.click()} 
          disabled={chatStore.isStreaming || isUploading} 
          aria-label="Add attachment"
          class="!px-3 !py-2.5 h-auto text-fg-muted hover:text-fg"
        >
          <Paperclip size={16} />
        </Button>
      {/if}

      <textarea
        bind:this={textarea}
        bind:value={draft}
        oninput={autosize}
        onkeydown={handleKeydown}
        rows="1"
        placeholder="Message Blombrain…"
        class="max-h-60 flex-1 resize-none rounded-md border border-line bg-bg-elevated px-3 py-2.5 text-sm text-fg outline-none placeholder:text-fg-subtle focus-visible:outline-2 focus-visible:outline-accent"
      ></textarea>

      {#if chatStore.isStreaming}
        <Button variant="danger" onclick={() => chatStore.stop()} aria-label="Stop generating">
          <Square size={14} />
          Stop
        </Button>
      {:else}
        <Button 
          variant="primary" 
          onclick={handleSend} 
          disabled={(!draft.trim() && chatStore.pendingAttachments.length === 0) || isUploading} 
          aria-label="Send message"
        >
          <Send size={14} />
          Send
        </Button>
      {/if}
    </div>
  </div>
</div>
