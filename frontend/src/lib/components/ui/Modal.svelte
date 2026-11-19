<script lang="ts">
  import { fade, fly } from "svelte/transition";
  import type { Snippet } from "svelte";

  interface Props {
    isOpen: boolean;
    title?: string;
    onclose: () => void;
    children?: Snippet;
    footer?: Snippet;
    maxWidth?: string;
  }

  let {
    isOpen,
    title,
    onclose,
    children,
    footer,
    maxWidth = "max-w-md",
  }: Props = $props();

  let dialogEl: HTMLDivElement | undefined = $state();
  let previousFocusedElement: HTMLElement | null = null;

  $effect(() => {
    if (isOpen) {
      if (typeof document !== "undefined") {
        previousFocusedElement = document.activeElement as HTMLElement | null;
      }
      requestAnimationFrame(() => {
        if (
          dialogEl &&
          typeof document !== "undefined" &&
          !dialogEl.contains(document.activeElement)
        ) {
          dialogEl.focus();
        }
      });
    } else if (previousFocusedElement) {
      const toRestore = previousFocusedElement;
      previousFocusedElement = null;
      requestAnimationFrame(() => {
        toRestore?.focus?.();
      });
    }
  });

  function handleBackdropClick(e: MouseEvent) {
    if (e.target === e.currentTarget) {
      onclose();
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      onclose();
    }
  }
</script>

{#if isOpen}
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <div
    bind:this={dialogEl}
    role="dialog"
    aria-modal="true"
    aria-label={title || "Modal"}
    tabindex="-1"
    transition:fade={{ duration: 150 }}
    class="fixed inset-0 z-50 flex items-center justify-center bg-overlay backdrop-blur-sm p-4"
    onclick={handleBackdropClick}
    onkeydown={handleKeydown}
  >
    <div
      transition:fly={{ y: 15, duration: 200 }}
      class="relative flex w-full {maxWidth} flex-col rounded-xl border border-line bg-bg shadow-2xl overflow-hidden p-6 gap-5"
    >
      {#if title || children}
        <div class="flex flex-col gap-1.5">
          {#if title}
            <h2 class="text-base font-semibold text-fg">
              {title}
            </h2>
          {/if}
          {#if children}
            {@render children()}
          {/if}
        </div>
      {/if}

      {#if footer}
        <div class="flex items-center justify-end gap-3 pt-2">
          {@render footer()}
        </div>
      {/if}
    </div>
  </div>
{/if}
