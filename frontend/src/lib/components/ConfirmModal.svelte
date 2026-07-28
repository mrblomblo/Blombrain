<script lang="ts">
  import { fade, fly } from "svelte/transition";
  import { confirmStore, type ButtonStyle } from "../stores/confirmStore.svelte";
  import Button from "./ui/Button.svelte";
  import type { ButtonVariant } from "./ui/Button.svelte";

  function getButtonProps(
    style: ButtonStyle = "default",
    explicitOutline?: boolean,
    defaultOutline = false,
  ): {
    variant: ButtonVariant;
    outline: boolean;
  } {
    if (explicitOutline !== undefined) {
      const variant = style === "outline" ? "default" : style;
      return { variant, outline: explicitOutline };
    }
    if (style === "outline") {
      return { variant: "default", outline: true };
    }
    return { variant: style, outline: defaultOutline };
  }

  function handleBackdropClick(e: MouseEvent) {
    if (e.target === e.currentTarget) {
      confirmStore.handleResolve(false);
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      confirmStore.handleResolve(false);
    }
  }
</script>

{#if confirmStore.isOpen}
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <div
    role="dialog"
    aria-modal="true"
    aria-label={confirmStore.options.title || "Confirm"}
    tabindex="-1"
    transition:fade={{ duration: 150 }}
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
    onclick={handleBackdropClick}
    onkeydown={handleKeydown}
  >
    <div
      transition:fly={{ y: 15, duration: 200 }}
      class="relative flex w-full max-w-md flex-col rounded-xl border border-line bg-bg shadow-2xl overflow-hidden p-6 gap-5"
    >
      <div class="flex flex-col gap-1.5">
        {#if confirmStore.options.title}
          <h2 class="text-base font-semibold text-fg">
            {confirmStore.options.title}
          </h2>
        {/if}
        <p class="text-sm text-fg-muted leading-relaxed">
          {confirmStore.options.message}
        </p>
      </div>

      <div class="flex items-center justify-end gap-3 pt-2">
        <Button
          {...getButtonProps(
            confirmStore.options.cancelStyle || "ghost",
            confirmStore.options.cancelOutline,
            false,
          )}
          onclick={() => confirmStore.handleResolve(false)}
        >
          {confirmStore.options.cancelText || "Cancel"}
        </Button>
        <Button
          {...getButtonProps(
            confirmStore.options.confirmStyle || "default",
            confirmStore.options.confirmOutline,
            false,
          )}
          onclick={() => confirmStore.handleResolve(true)}
        >
          {confirmStore.options.confirmText || "Confirm"}
        </Button>
      </div>
    </div>
  </div>
{/if}
