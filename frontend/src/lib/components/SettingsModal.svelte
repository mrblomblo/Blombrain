<script lang="ts">
  import { X, Layers, Server } from "@lucide/svelte";
  import BackendsTab from "./settings/BackendsTab.svelte";
  import ModelsTab from "./settings/ModelsTab.svelte";

  type Tab = "models" | "backends";

  interface Props {
    open: boolean;
    onClose: () => void;
  }
  const { open, onClose }: Props = $props();

  let activeTab = $state<Tab>("models");

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
      class="relative flex w-full max-w-3xl flex-col rounded-xl border border-line bg-bg shadow-2xl overflow-hidden"
      style="max-height: min(92vh, 760px); height: min(92vh, 760px);"
    >
      <!-- Integrated Header & Navigation Tabs -->
      <div class="flex flex-col border-b border-line bg-bg px-5 pt-4">
        <div class="flex items-center justify-between">
          <h2 class="text-base font-semibold text-fg">Settings</h2>
          <button
            onclick={onClose}
            aria-label="Close"
            class="flex h-7 w-7 items-center justify-center rounded-md text-fg-muted transition-colors hover:bg-bg-elevated hover:text-fg"
          >
            <X size={16} />
          </button>
        </div>

        <div class="flex items-center gap-2 mt-3 -mb-px">
          <button
            type="button"
            onclick={() => (activeTab = "models")}
            class="flex items-center gap-2 border-b-2 px-3 py-2 text-xs font-semibold transition-colors {activeTab === 'models'
              ? 'border-accent text-accent'
              : 'border-transparent text-fg-muted hover:text-fg'}"
          >
            <Layers size={14} />
            <span>Models & Presets</span>
          </button>

          <button
            type="button"
            onclick={() => (activeTab = "backends")}
            class="flex items-center gap-2 border-b-2 px-3 py-2 text-xs font-semibold transition-colors {activeTab === 'backends'
              ? 'border-accent text-accent'
              : 'border-transparent text-fg-muted hover:text-fg'}"
          >
            <Server size={14} />
            <span>Inference Backends</span>
          </button>
        </div>
      </div>

      <!-- Body Content Area -->
      <div class="flex-1 overflow-y-auto p-5">
        {#if activeTab === "models"}
          <ModelsTab />
        {:else if activeTab === "backends"}
          <BackendsTab />
        {/if}
      </div>
    </div>
  </div>
{/if}
