<script lang="ts">
  import { chatStore } from "../stores/chat.svelte";
  import ChatMessage from "./ChatMessage.svelte";
  import { fetchModels } from "../api";
  import { createQuery } from "@tanstack/svelte-query";
  import { Sparkles } from "@lucide/svelte";

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

  $effect(() => {
    // Re-run whenever active path length or contents change
    activeMessages.length;
    for (const m of activeMessages) {
      m.content;
      m.thinkingContent;
    }
    requestAnimationFrame(() => {
      scrollEl?.scrollTo({ top: scrollEl.scrollHeight, behavior: "smooth" });
    });
  });
</script>

<div bind:this={scrollEl} class="flex-1 overflow-y-auto px-4 sm:px-6 py-4">
  {#if activeMessages.length === 0}
    <div class="flex h-full flex-col items-center justify-center gap-3 text-center px-4 select-none">
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
  {:else}
    <div class="mx-auto flex max-w-3xl flex-col gap-3">
      {#each activeMessages as message, i (message.id)}
        <ChatMessage {message} isLast={i === activeMessages.length - 1} />
      {/each}
    </div>
  {/if}
</div>
