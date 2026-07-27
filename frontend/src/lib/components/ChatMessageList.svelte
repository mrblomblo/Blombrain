<script lang="ts">
  import { chatStore } from "../stores/chat.svelte";
  import ChatMessage from "./ChatMessage.svelte";

  let scrollEl: HTMLDivElement | undefined = $state();

  $effect(() => {
    // Re-run whenever the message list (or streamed content) changes.
    chatStore.messages.length;
    for (const m of chatStore.messages) m.content;
    requestAnimationFrame(() => {
      scrollEl?.scrollTo({ top: scrollEl.scrollHeight, behavior: "smooth" });
    });
  });
</script>

<div bind:this={scrollEl} class="flex-1 overflow-y-auto px-6 py-6">
  {#if chatStore.messages.length === 0}
    <div class="flex h-full flex-col items-center justify-center gap-2 text-center">
      <div class="h-3 w-3 rotate-45 bg-accent"></div>
      <p class="text-sm text-fg-muted">
        Pick a model above and send a message to test the chat loop.
      </p>
    </div>
  {:else}
    <div class="mx-auto flex max-w-3xl flex-col gap-5">
      {#each chatStore.messages as message (message.id)}
        <ChatMessage {message} />
      {/each}
    </div>
  {/if}
</div>
