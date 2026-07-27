<script lang="ts">
  import type { ChatMessage } from "../types";

  let { message }: { message: ChatMessage } = $props();
</script>

<div class="flex gap-3 {message.role === 'user' ? 'flex-row-reverse' : ''}">
  <div
    class="flex h-7 w-7 shrink-0 items-center justify-center rounded-md font-mono text-[10px] font-semibold uppercase
      {message.role === 'user' ? 'bg-accent text-accent-fg' : 'bg-bg-inset text-fg-muted'}"
  >
    {message.role === "user" ? "you" : "ai"}
  </div>

  <div
    class="max-w-[75ch] rounded-lg px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-wrap
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
</div>
