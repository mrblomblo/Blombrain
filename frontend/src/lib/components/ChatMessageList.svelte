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

  interface Props {
    bottomPadding?: number;
  }
  const { bottomPadding = 112 }: Props = $props();

  let scrollEl: HTMLDivElement | undefined = $state();

  const modelsQuery = createQuery(() => ({
    queryKey: ["models"],
    queryFn: fetchModels,
  }));

  let currentModel = $derived(
    chatStore.selectedModel && modelsQuery.data
      ? modelsQuery.data.find((m) => m.id === chatStore.selectedModel)
      : undefined,
  );

  let activeMessages = $derived(chatStore.activePath);
  let lastConversationId = $state<string | null>(null);
  let userHasScrolledUp = $state(false);
  let lastScrollTop = 0;
  let touchStartY = 0;

  function handleWheel(e: WheelEvent) {
    if (e.deltaY < 0) {
      userHasScrolledUp = true;
    }
  }

  function handleTouchStart(e: TouchEvent) {
    if (e.touches.length > 0) {
      touchStartY = e.touches[0].clientY;
    }
  }

  function handleTouchMove(e: TouchEvent) {
    if (e.touches.length > 0) {
      const touchY = e.touches[0].clientY;
      // Swiping finger downward (touchY > touchStartY) scrolls container UP
      if (touchY - touchStartY > 3) {
        userHasScrolledUp = true;
      }
    }
  }

  function handleScroll() {
    if (!scrollEl) return;
    const currentScrollTop = scrollEl.scrollTop;
    const distance =
      scrollEl.scrollHeight - currentScrollTop - scrollEl.clientHeight;

    if (currentScrollTop < lastScrollTop - 2) {
      userHasScrolledUp = true;
    } else if (distance <= 15) {
      userHasScrolledUp = false;
    }

    lastScrollTop = currentScrollTop;
  }

  $effect(() => {
    const currentId = chatStore.activeConversationId;
    const isNewConversationLoaded = currentId !== lastConversationId;
    lastConversationId = currentId;

    bottomPadding;
    // Re-run whenever active path length or contents change
    activeMessages.length;
    for (const m of activeMessages) {
      m.content;
      m.thinkingContent;
    }

    requestAnimationFrame(() => {
      if (!scrollEl) return;
      if (isNewConversationLoaded) {
        userHasScrolledUp = false;
        scrollEl.scrollTop = scrollEl.scrollHeight;
        lastScrollTop = scrollEl.scrollTop;
        setTimeout(() => {
          if (scrollEl) {
            scrollEl.scrollTop = scrollEl.scrollHeight;
            lastScrollTop = scrollEl.scrollTop;
          }
        }, 50);
      } else if (!userHasScrolledUp) {
        scrollEl.scrollTo({
          top: scrollEl.scrollHeight,
          behavior: chatStore.isStreaming ? "auto" : "smooth",
        });
        lastScrollTop = scrollEl.scrollTop;
      }
    });
  });
</script>

<div
  bind:this={scrollEl}
  role="region"
  aria-label="Chat message history"
  onscroll={handleScroll}
  onwheel={handleWheel}
  ontouchstart={handleTouchStart}
  ontouchmove={handleTouchMove}
  class="relative flex-1 overflow-y-auto scrollbar-gutter-both px-2 sm:px-6 pb-4 pt-0"
>
  {#if activeMessages.length === 0}
    <div
      in:fly={{ y: 40, duration: 350, opacity: 0, easing: quintOut }}
      out:fly={{ y: 40, duration: 300, opacity: 0, easing: quintOut }}
      class="absolute inset-0 flex flex-col items-center justify-center gap-6 px-4"
    >
      <div
        class="flex flex-col items-center justify-center gap-3 text-center select-none"
      >
        {#if currentModel?.icon}
          <img
            src={currentModel.icon}
            alt="Model Icon"
            class="h-12 w-12 rounded-xl object-cover border border-line shadow-md"
          />
        {:else}
          <div
            class="flex h-12 w-12 items-center justify-center rounded-xl border border-line bg-bg-elevated text-accent shadow-sm"
          >
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
      <div class="w-full max-w-3xl lg:max-w-4xl xl:max-w-5xl">
        <ChatInput floating={true} />
      </div>
    </div>
  {/if}

  {#if activeMessages.length > 0}
    {#key chatStore.activeConversationId}
      <div
        class="mx-auto flex w-full max-w-3xl lg:max-w-4xl xl:max-w-5xl flex-col gap-3 relative z-10"
        style="padding-bottom: {bottomPadding + 16}px;"
      >
        {#each activeMessages as message, i (message.id)}
          <div
            animate:flip={{ duration: 400, easing: quintOut }}
            in:fly|local={{
              y: 20,
              duration: 400,
              opacity: 0,
              easing: quintOut,
            }}
            out:slide|local={{ duration: 300, easing: quintOut }}
          >
            <ChatMessage {message} isLast={i === activeMessages.length - 1} />
          </div>
        {/each}
      </div>
    {/key}
  {/if}
</div>
