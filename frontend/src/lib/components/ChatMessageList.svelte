<script lang="ts">
  import { chatStore } from "../stores/chat.svelte";
  import ChatMessage from "./ChatMessage.svelte";
  import VirtualizedMessage from "./VirtualizedMessage.svelte";
  import ChatInput from "./ChatInput.svelte";
  import { fetchModels } from "../api";
  import { createQuery } from "@tanstack/svelte-query";
  import { ArrowDown } from "@lucide/svelte";

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
  let editingMessageIds = $state<Record<string, boolean>>({});
  let lastScrollTop = 0;
  let touchStartY = 0;
  let isUserInteracting = false;
  let userInteractTimeout: ReturnType<typeof setTimeout> | undefined;
  let innerContentEl: HTMLDivElement | undefined = $state();

  function markUserInteraction() {
    isUserInteracting = true;
    clearTimeout(userInteractTimeout);
    userInteractTimeout = setTimeout(() => {
      isUserInteracting = false;
    }, 300);
  }

  function handleWheel(e: WheelEvent) {
    markUserInteraction();
    if (e.deltaY < 0) {
      if (scrollEl) {
        const distance =
          scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight;
        if (distance > 30) {
          userHasScrolledUp = true;
        }
      }
    }
  }

  function handleTouchStart(e: TouchEvent) {
    markUserInteraction();
    if (e.touches.length > 0) {
      touchStartY = e.touches[0].clientY;
    }
  }

  function handleTouchMove(e: TouchEvent) {
    markUserInteraction();
    if (e.touches.length > 0) {
      const touchY = e.touches[0].clientY;
      if (touchY - touchStartY > 5) {
        if (scrollEl) {
          const distance =
            scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight;
          if (distance > 30) {
            userHasScrolledUp = true;
          }
        }
      }
    }
  }

  function handleMouseDown() {
    markUserInteraction();
  }

  function syncScrollState() {
    if (!scrollEl) return;
    const isScrollable = scrollEl.scrollHeight > scrollEl.clientHeight + 4;
    if (!isScrollable) {
      userHasScrolledUp = false;
      lastScrollTop = 0;
      return;
    }
    const distance =
      scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight;
    if (distance <= 30) {
      userHasScrolledUp = false;
    }
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (["PageUp", "ArrowUp", "Home"].includes(e.key)) {
      if (!scrollEl) return;
      const distance =
        scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight;
      if (scrollEl.scrollHeight > scrollEl.clientHeight + 4 && distance > 30) {
        markUserInteraction();
        userHasScrolledUp = true;
      }
    }
  }

  function handleScroll() {
    if (!scrollEl) return;
    const currentScrollTop = scrollEl.scrollTop;
    const isScrollable = scrollEl.scrollHeight > scrollEl.clientHeight + 4;
    const distance =
      scrollEl.scrollHeight - currentScrollTop - scrollEl.clientHeight;

    if (
      isScrollable &&
      isUserInteracting &&
      currentScrollTop < lastScrollTop - 5 &&
      distance > 30
    ) {
      userHasScrolledUp = true;
    } else if (!isScrollable || distance <= 30) {
      userHasScrolledUp = false;
    }

    lastScrollTop = currentScrollTop;
  }

  function scrollToBottom(instant = false) {
    if (!scrollEl) return;
    if (instant || chatStore.isStreaming) {
      scrollEl.scrollTop = scrollEl.scrollHeight;
    } else {
      scrollEl.scrollTo({
        top: scrollEl.scrollHeight,
        behavior: "smooth",
      });
    }
    lastScrollTop = scrollEl.scrollTop;
  }

  // Observe both container & content resizing (streaming, thinking block collapse/expand, window resize)
  $effect(() => {
    const container = scrollEl;
    const content = innerContentEl;
    if (!container && !content) return;
    const observer = new ResizeObserver(() => {
      if (chatStore.isStreaming && !userHasScrolledUp && scrollEl) {
        scrollToBottom(true);
      } else {
        syncScrollState();
      }
    });
    if (container) observer.observe(container);
    if (content) observer.observe(content);
    return () => observer.disconnect();
  });

  $effect(() => {
    const currentId = chatStore.activeConversationId;
    const isNewConversationLoaded = currentId !== lastConversationId;
    lastConversationId = currentId;

    bottomPadding;
    activeMessages.length;
    for (const m of activeMessages) {
      m.content;
      m.thinkingContent;
    }

    requestAnimationFrame(() => {
      if (!scrollEl) return;
      if (isNewConversationLoaded) {
        userHasScrolledUp = false;
        scrollToBottom(true);
        setTimeout(() => {
          if (scrollEl) scrollToBottom(true);
        }, 50);
      } else if (!userHasScrolledUp) {
        scrollToBottom();
      }
    });
  });
</script>

<div class="relative flex-1 flex flex-col min-h-0 overflow-hidden">
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <div
    bind:this={scrollEl}
    role="region"
    tabindex="-1"
    aria-label="Chat message history"
    onscroll={handleScroll}
    onwheel={handleWheel}
    ontouchstart={handleTouchStart}
    ontouchmove={handleTouchMove}
    onmousedown={handleMouseDown}
    onkeydown={handleKeyDown}
    class="relative flex-1 overflow-y-auto overscroll-contain scrollbar-gutter-both mr-1 px-2 sm:px-6 pb-4 pt-0"
  >
    {#if activeMessages.length === 0}
      <div
        in:fly={{ y: 40, duration: 350, opacity: 0, easing: quintOut }}
        out:fly={{ y: 40, duration: 300, opacity: 0, easing: quintOut }}
        class="absolute inset-0 flex flex-col items-center justify-center gap-6 px-2 sm:px-4"
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
            <img
              src="/Blombrain.png"
              alt="Blombrain"
              class="h-12 w-12 rounded-xl object-cover border border-line shadow-md"
            />
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
          bind:this={innerContentEl}
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
              <VirtualizedMessage
                keepMounted={Boolean(
                  message.streaming || editingMessageIds[message.id],
                )}
              >
                <ChatMessage
                  {message}
                  isLast={i === activeMessages.length - 1}
                  onEditingChange={(editing) => {
                    editingMessageIds[message.id] = editing;
                  }}
                />
              </VirtualizedMessage>
            </div>
          {/each}
        </div>
      {/key}
    {/if}
  </div>

  {#if activeMessages.length > 0 && userHasScrolledUp}
    <div
      transition:fade={{ duration: 150 }}
      class="pointer-events-none absolute inset-x-0 z-30 flex justify-center"
      style="bottom: {bottomPadding + 8}px;"
    >
      <button
        type="button"
        onclick={() => {
          userHasScrolledUp = false;
          scrollToBottom(false);
        }}
        aria-label="Scroll to bottom"
        title="Jump to latest message"
        class="pointer-events-auto flex items-center gap-1.5 rounded-full border border-line bg-bg-elevated/95 px-3 py-1.5 text-xs font-medium text-fg shadow-md backdrop-blur-sm hover:border-accent hover:text-accent transition-all cursor-pointer"
      >
        <ArrowDown size={13} />
        <span>Jump to bottom</span>
      </button>
    </div>
  {/if}
</div>
