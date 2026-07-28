<script lang="ts">
  import { X, Layers, Server, Sliders } from "@lucide/svelte";
  import { fade, fly } from "svelte/transition";
  import BackendsTab from "./settings/BackendsTab.svelte";
  import ModelsTab from "./settings/ModelsTab.svelte";
  import GeneralTab from "./settings/GeneralTab.svelte";

  type Tab = "general" | "models" | "backends";

  interface Props {
    open: boolean;
    onClose: () => void;
  }
  const { open, onClose }: Props = $props();

  let activeTab = $state<Tab>("general");
  let previousTab = $state<Tab>("general");
  const TABS: Tab[] = ["general", "models", "backends"];

  function setTab(tab: Tab) {
    if (tab === activeTab) return;
    previousTab = activeTab;
    activeTab = tab;
  }

  function getFlyParams(isIncoming: boolean) {
    const currentIndex = TABS.indexOf(activeTab);
    const previousIndex = TABS.indexOf(previousTab);
    const isMovingRight = currentIndex > previousIndex;
    const distance = 40;

    let x = isMovingRight ? distance : -distance;
    if (!isIncoming) x = -x;

    return { x, duration: 300, opacity: 0 };
  }

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
    transition:fade={{ duration: 150 }}
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
    onclick={handleBackdropClick}
    onkeydown={handleKeydown}
  >
    <div
      transition:fly={{ y: 15, duration: 200 }}
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
            onclick={() => setTab("general")}
            class="flex items-center gap-2 border-b-2 px-3 py-2 text-xs font-semibold transition-colors {activeTab ===
            'general'
              ? 'border-accent text-accent'
              : 'border-transparent text-fg-muted hover:text-fg'}"
          >
            <Sliders size={14} />
            <span>General</span>
          </button>

          <button
            type="button"
            onclick={() => setTab("models")}
            class="flex items-center gap-2 border-b-2 px-3 py-2 text-xs font-semibold transition-colors {activeTab ===
            'models'
              ? 'border-accent text-accent'
              : 'border-transparent text-fg-muted hover:text-fg'}"
          >
            <Layers size={14} />
            <span>Models & Presets</span>
          </button>

          <button
            type="button"
            onclick={() => setTab("backends")}
            class="flex items-center gap-2 border-b-2 px-3 py-2 text-xs font-semibold transition-colors {activeTab ===
            'backends'
              ? 'border-accent text-accent'
              : 'border-transparent text-fg-muted hover:text-fg'}"
          >
            <Server size={14} />
            <span>Backends</span>
          </button>
        </div>
      </div>

      <!-- Body Content Area -->
      <div class="flex-1 grid overflow-x-hidden relative">
        {#if activeTab === "general"}
          <div
            class="col-start-1 row-start-1 overflow-y-auto p-5"
            in:fly={getFlyParams(true)}
            out:fly={getFlyParams(false)}
          >
            <GeneralTab />
          </div>
        {:else if activeTab === "models"}
          <div
            class="col-start-1 row-start-1 overflow-y-auto p-5"
            in:fly={getFlyParams(true)}
            out:fly={getFlyParams(false)}
          >
            <ModelsTab />
          </div>
        {:else if activeTab === "backends"}
          <div
            class="col-start-1 row-start-1 overflow-y-auto p-5"
            in:fly={getFlyParams(true)}
            out:fly={getFlyParams(false)}
          >
            <BackendsTab />
          </div>
        {/if}
      </div>
    </div>
  </div>
{/if}
