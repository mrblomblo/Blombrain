<script lang="ts">
  import { chatStore } from "../stores/chat.svelte";
  import ChatMessage from "./ChatMessage.svelte";
  import ChatInput from "./ChatInput.svelte";
  import { fetchModels } from "../api";
  import { createQuery } from "@tanstack/svelte-query";

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

  function handleKeyDown(e: KeyboardEvent) {
    if (["PageUp", "ArrowUp", "Home"].includes(e.key)) {
      markUserInteraction();
      userHasScrolledUp = true;
    }
  }

  function handleScroll() {
    if (!scrollEl) return;
    const currentScrollTop = scrollEl.scrollTop;
    const distance =
      scrollEl.scrollHeight - currentScrollTop - scrollEl.clientHeight;

    if (
      isUserInteracting &&
      currentScrollTop < lastScrollTop - 5 &&
      distance > 30
    ) {
      userHasScrolledUp = true;
    } else if (distance <= 30) {
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

  // Observe element resizing (Markdown parsing, code blocks, artifacts) to prevent scroll detachment
  $effect(() => {
    if (!innerContentEl) return;
    const observer = new ResizeObserver(() => {
      if (!userHasScrolledUp && scrollEl) {
        scrollToBottom(true);
      }
    });
    observer.observe(innerContentEl);
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
            <ChatMessage {message} isLast={i === activeMessages.length - 1} />
          </div>
        {/each}
      </div>
    {/key}
  {/if}
</div>
