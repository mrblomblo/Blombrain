<script lang="ts">
  import { chatStore } from "../stores/chat.svelte";
  import ChatMessage from "./ChatMessage.svelte";
  import ChatInput from "./ChatInput.svelte";
  import { fetchModels } from "../api";
  import { createQuery } from "@tanstack/svelte-query";
  import { Sparkles } from "@lucide/svelte";

  import { flip } from "svelte/animate";
  import { slide, fade, fly } from "svelte/transition";
  import { quintOut } from "svelte/easing";

  let scrollEl: HTMLDivElement | undefined = $state();

  const modelsQuery = createQuery(() => ({
    queryKey: ["models"],
    queryFn: fetchModels,
  }));

  let currentModel = $derived(
    chatStore.selectedModel && modelsQuery.data
      ? modelsQuery.data.find((m) => m.id === chatStore.selectedModel)
      : undefined
  );

  let activeMessages = $derived(chatStore.activePath);
  let lastConversationId = $state<string | null>(null);

  $effect(() => {
    const currentId = chatStore.activeConversationId;
    const isNewConversationLoaded = currentId !== lastConversationId;
    lastConversationId = currentId;

    // Re-run whenever active path length or contents change
    activeMessages.length;
    for (const m of activeMessages) {
      m.content;
      m.thinkingContent;
    }

    requestAnimationFrame(() => {
      if (!scrollEl) return;
      if (isNewConversationLoaded) {
        scrollEl.scrollTop = scrollEl.scrollHeight;
        setTimeout(() => {
          if (scrollEl) scrollEl.scrollTop = scrollEl.scrollHeight;
        }, 50);
      } else {
        const isAtBottom = scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight < 150;
        if (isAtBottom || chatStore.isStreaming) {
          scrollEl.scrollTo({ top: scrollEl.scrollHeight, behavior: chatStore.isStreaming ? "auto" : "smooth" });
        }
      }
    });
  });
</script>

<div bind:this={scrollEl} class="relative flex-1 overflow-y-auto px-4 sm:px-6 py-4">
  {#if activeMessages.length === 0}
    <div
      in:fly={{ y: 40, duration: 350, opacity: 0, easing: quintOut }}
      out:fly={{ y: 40, duration: 300, opacity: 0, easing: quintOut }}
      class="absolute inset-0 flex flex-col items-center justify-center gap-6 px-4"
    >
      <div class="flex flex-col items-center justify-center gap-3 text-center select-none">
        {#if currentModel?.icon}
          <img src={currentModel.icon} alt="Model Icon" class="h-12 w-12 rounded-xl object-cover border border-line shadow-md" />
        {:else}
          <div class="flex h-12 w-12 items-center justify-center rounded-xl border border-line bg-bg-elevated text-accent shadow-sm">
            <Sparkles size={24} />
          </div>
        {/if}
        <div>
          <h2 class="text-base font-semibold text-fg">
            {currentModel?.name || "Blombrain Assistant"}
          </h2>
          <p class="text-xs text-fg-muted mt-1 max-w-sm">
            Send a message, paste code, or attach files to begin chatting.
          </p>
        </div>
      </div>

      <!-- Floating Chat Input -->
      <div class="w-full max-w-3xl">
        <ChatInput floating={true} />
      </div>
    </div>
  {/if}

  {#if activeMessages.length > 0}
    {#key chatStore.activeConversationId}
      <div class="mx-auto flex w-full max-w-3xl flex-col gap-3 relative z-10 pb-28 sm:pb-32">
        {#each activeMessages as message, i (message.id)}
          <div animate:flip={{ duration: 400, easing: quintOut }} in:fly|local={{ y: 20, duration: 400, opacity: 0, easing: quintOut }} out:slide|local={{ duration: 300, easing: quintOut }}>
            <ChatMessage {message} isLast={i === activeMessages.length - 1} />
          </div>
        {/each}
      </div>
    {/key}
  {/if}
</div>
