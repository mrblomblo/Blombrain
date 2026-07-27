<script lang="ts">
  import type { ChatMessage } from "../types";
  import { serveUploadUrl } from "../api";
  import { Paperclip } from "@lucide/svelte";

  let { message }: { message: ChatMessage } = $props();
</script>

<div class="flex gap-3 {message.role === 'user' ? 'flex-row-reverse' : ''}">
  <div
    class="flex h-7 w-7 shrink-0 items-center justify-center rounded-md font-mono text-[10px] font-semibold uppercase
      {message.role === 'user' ? 'bg-accent text-accent-fg' : 'bg-bg-inset text-fg-muted'}"
  >
    {message.role === "user" ? "you" : "ai"}
  </div>

  <div class="flex flex-col gap-2 {message.role === 'user' ? 'items-end' : 'items-start'} max-w-[75ch]">
    <!-- Attachments -->
    {#if message.attachments && message.attachments.length > 0}
      <div class="flex flex-wrap gap-2 {message.role === 'user' ? 'justify-end' : 'justify-start'}">
        {#each message.attachments as att (att.id)}
          {#if att.mimeType.startsWith("image/")}
            <a href={serveUploadUrl(att.id)} target="_blank" rel="noopener noreferrer">
              <img src={serveUploadUrl(att.id)} alt={att.originalName} class="max-h-64 rounded-md object-contain border border-line bg-bg-elevated" />
            </a>
          {:else if att.mimeType.startsWith("video/")}
            <!-- svelte-ignore a11y_media_has_caption -->
            <video controls src={serveUploadUrl(att.id)} class="max-h-64 rounded-md border border-line bg-bg-elevated"></video>
          {:else if att.mimeType.startsWith("audio/")}
            <audio controls src={serveUploadUrl(att.id)} class="rounded-md border border-line bg-bg-elevated h-10"></audio>
          {:else}
            <a href={serveUploadUrl(att.id)} target="_blank" rel="noopener noreferrer" class="flex items-center gap-2 rounded-md border border-line bg-bg-elevated px-3 py-2 text-sm hover:bg-bg-inset transition-colors">
              <Paperclip size={14} class="text-fg-muted" />
              {att.originalName}
            </a>
          {/if}
        {/each}
      </div>
    {/if}

    {#if message.content || message.error || message.streaming}
      <div
        class="rounded-lg px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-wrap
          {message.role === 'user' ? 'bg-accent-muted text-fg' : 'bg-bg-elevated text-fg'}"
      >
        {#if message.error}
          <p class="font-medium text-danger">{message.error}</p>
        {:else if message.content}
          {message.content}{#if message.streaming}<span
              class="ml-0.5 inline-block h-3.5 w-1.5 translate-y-0.5 animate-pulse bg-accent"
            ></span>{/if}
        {:else if message.streaming}
          <span class="inline-flex gap-1 py-1">
            <span class="h-1.5 w-1.5 animate-bounce rounded-full bg-fg-subtle [animation-delay:-0.3s]"
            ></span>
            <span class="h-1.5 w-1.5 animate-bounce rounded-full bg-fg-subtle [animation-delay:-0.15s]"
            ></span>
            <span class="h-1.5 w-1.5 animate-bounce rounded-full bg-fg-subtle"></span>
          </span>
        {/if}
      </div>
    {/if}
  </div>
</div>
