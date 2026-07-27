<script lang="ts">
  import { X } from "@lucide/svelte";
  import BackendsTab from "./settings/BackendsTab.svelte";

  interface Props {
    open: boolean;
    onClose: () => void;
  }
  const { open, onClose }: Props = $props();

  function handleBackdropClick(e: MouseEvent) {
    if (e.target === e.currentTarget) onClose();
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Escape") onClose();
  }
</script>

{#if open}
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <div
    role="dialog"
    aria-modal="true"
    aria-label="Settings"
    tabindex="-1"
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
    onclick={handleBackdropClick}
    onkeydown={handleKeydown}
  >
    <div
      class="relative flex w-full max-w-xl flex-col rounded-xl border border-line bg-bg shadow-2xl"
      style="max-height: min(90vh, 640px); height: min(90vh, 640px);"
    >
      <!-- Header -->
      <div class="flex items-center justify-between border-b border-line px-5 py-4">
        <h2 class="text-sm font-semibold">Settings - Backends</h2>
        <button
          onclick={onClose}
          aria-label="Close"
          class="flex h-7 w-7 items-center justify-center rounded-md text-fg-muted transition-colors hover:bg-bg-elevated hover:text-fg"
        >
          <X size={15} />
        </button>
      </div>

      <!-- Body -->
      <div class="flex-1 overflow-y-auto p-5">
        <BackendsTab />
      </div>
    </div>
  </div>
{/if}
