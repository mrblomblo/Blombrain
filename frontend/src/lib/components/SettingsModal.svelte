<script lang="ts">
  import { X } from "@lucide/svelte";
  import BackendsTab from "./settings/BackendsTab.svelte";
  import ModelConfigsTab from "./settings/ModelConfigsTab.svelte";

  interface Props {
    open: boolean;
    onClose: () => void;
  }
  const { open, onClose }: Props = $props();

  let activeTab = $state<"backends" | "models">("backends");

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
        <h2 class="text-sm font-semibold">Settings</h2>
        <button
          onclick={onClose}
          aria-label="Close"
          class="flex h-7 w-7 items-center justify-center rounded-md text-fg-muted transition-colors hover:bg-bg-elevated hover:text-fg"
        >
          <X size={15} />
        </button>
      </div>

      <!-- Tabs -->
      <div class="flex border-b border-line px-5 gap-4">
        <button
          class="py-2 text-sm font-medium transition-colors border-b-2"
          class:border-accent={activeTab === "backends"}
          class:text-fg={activeTab === "backends"}
          class:border-transparent={activeTab !== "backends"}
          class:text-fg-muted={activeTab !== "backends"}
          onclick={() => (activeTab = "backends")}
        >
          Backends
        </button>
        <button
          class="py-2 text-sm font-medium transition-colors border-b-2"
          class:border-accent={activeTab === "models"}
          class:text-fg={activeTab === "models"}
          class:border-transparent={activeTab !== "models"}
          class:text-fg-muted={activeTab !== "models"}
          onclick={() => (activeTab = "models")}
        >
          Model Configurations
        </button>
      </div>

      <!-- Body -->
      <div class="flex-1 overflow-y-auto p-5">
        {#if activeTab === "backends"}
          <BackendsTab />
        {:else if activeTab === "models"}
          <ModelConfigsTab />
        {/if}
      </div>
    </div>
  </div>
{/if}
