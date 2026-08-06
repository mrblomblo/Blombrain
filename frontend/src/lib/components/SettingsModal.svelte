<script lang="ts">
  import {
    X,
    Layers,
    Server,
    Sliders,
    Cpu,
    BookOpen,
    User,
    ChevronRight,
    ChevronLeft,
  } from "@lucide/svelte";
  import { fade, fly } from "svelte/transition";
  import GeneralTab from "./settings/GeneralTab.svelte";
  import ModelsTab from "./settings/ModelsTab.svelte";
  import McpTab from "./settings/McpTab.svelte";
  import SkillsTab from "./settings/SkillsTab.svelte";
  import BackendsTab from "./settings/BackendsTab.svelte";
  import UserTab from "./settings/UserTab.svelte";
  import Button from "./ui/Button.svelte";

  type Tab = "general" | "models" | "mcp" | "skills" | "backends" | "user";

  interface Props {
    open: boolean;
    onClose: () => void;
  }
  const { open, onClose }: Props = $props();

  let activeTab = $state<Tab>("general");
  let previousTab = $state<Tab>("general");
  const TABS: Tab[] = [
    "general",
    "models",
    "mcp",
    "skills",
    "backends",
    "user",
  ];

  let tabsEl = $state<HTMLDivElement | undefined>();
  let canScrollRight = $state(false);
  let canScrollLeft = $state(false);

  function checkScroll() {
    if (!tabsEl) return;
    const { scrollLeft, scrollWidth, clientWidth } = tabsEl;
    canScrollLeft = scrollLeft > 2;
    canScrollRight = scrollLeft + clientWidth < scrollWidth - 2;
  }

  function scrollRight() {
    tabsEl?.scrollBy({ left: 120, behavior: "smooth" });
  }

  function scrollLeft() {
    tabsEl?.scrollBy({ left: -120, behavior: "smooth" });
  }

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

  let modalEl: HTMLDivElement | undefined = $state();

  $effect(() => {
    if (open) {
      const prevActive = document.activeElement as HTMLElement | null;
      setTimeout(() => {
        modalEl?.focus();
        checkScroll();
      }, 50);

      window.addEventListener("resize", checkScroll);

      return () => {
        prevActive?.focus();
        window.removeEventListener("resize", checkScroll);
      };
    }
  });

  $effect(() => {
    if (activeTab && open) {
      setTimeout(checkScroll, 50);
    }
  });

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      e.stopPropagation();
      onClose();
    }
  }
</script>

{#if open}
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <div
    bind:this={modalEl}
    role="dialog"
    aria-modal="true"
    aria-label="Settings"
    tabindex="-1"
    transition:fade={{ duration: 150 }}
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm focus:outline-hidden"
    onkeydown={handleKeydown}
  >
    <div
      transition:fly={{ y: 15, duration: 200 }}
      class="relative flex h-full w-full sm:h-[min(92vh,760px)] max-w-3xl flex-col sm:rounded-xl border-0 sm:border border-line bg-bg shadow-2xl overflow-hidden"
    >
      <!-- Integrated Header & Navigation Tabs -->
      <div
        class="flex flex-col border-b border-line bg-bg pt-4 shrink-0 min-w-0"
      >
        <div class="flex items-center justify-between px-4 sm:px-5">
          <h2 class="text-base font-semibold text-fg">Settings</h2>
          <Button
            variant="ghost"
            size="icon"
            onclick={onClose}
            aria-label="Close"
          >
            <X size={16} />
          </Button>
        </div>

        <div class="relative flex items-center min-w-0 w-full -mb-px">
          {#if canScrollLeft}
            <button
              type="button"
              onclick={scrollLeft}
              aria-label="Scroll left"
              transition:fly={{ x: -12, duration: 200 }}
              class="absolute left-0 z-10 flex h-full items-center pl-2 pr-4 bg-gradient-to-r from-bg via-bg/90 to-transparent text-fg-muted hover:text-fg cursor-pointer"
            >
              <ChevronLeft size={16} />
            </button>
          {/if}

          <div
            bind:this={tabsEl}
            onscroll={checkScroll}
            class="flex items-center gap-1 sm:gap-2 overflow-x-auto min-w-0 w-full px-4 sm:px-5 no-scrollbar"
          >
            <button
              type="button"
              onclick={() => setTab("general")}
              class="flex cursor-pointer items-center gap-2 border-b-2 px-3 py-2 text-xs font-semibold transition-colors shrink-0 whitespace-nowrap {activeTab ===
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
              class="flex cursor-pointer items-center gap-2 border-b-2 px-3 py-2 text-xs font-semibold transition-colors shrink-0 whitespace-nowrap {activeTab ===
              'models'
                ? 'border-accent text-accent'
                : 'border-transparent text-fg-muted hover:text-fg'}"
            >
              <Layers size={14} />
              <span>Models & Presets</span>
            </button>

            <button
              type="button"
              onclick={() => setTab("mcp")}
              class="flex cursor-pointer items-center gap-2 border-b-2 px-3 py-2 text-xs font-semibold transition-colors shrink-0 whitespace-nowrap {activeTab ===
              'mcp'
                ? 'border-accent text-accent'
                : 'border-transparent text-fg-muted hover:text-fg'}"
            >
              <Cpu size={14} />
              <span>MCP Servers</span>
            </button>

            <button
              type="button"
              onclick={() => setTab("skills")}
              class="flex cursor-pointer items-center gap-2 border-b-2 px-3 py-2 text-xs font-semibold transition-colors shrink-0 whitespace-nowrap {activeTab ===
              'skills'
                ? 'border-accent text-accent'
                : 'border-transparent text-fg-muted hover:text-fg'}"
            >
              <BookOpen size={14} />
              <span>Skills</span>
            </button>

            <button
              type="button"
              onclick={() => setTab("backends")}
              class="flex cursor-pointer items-center gap-2 border-b-2 px-3 py-2 text-xs font-semibold transition-colors shrink-0 whitespace-nowrap {activeTab ===
              'backends'
                ? 'border-accent text-accent'
                : 'border-transparent text-fg-muted hover:text-fg'}"
            >
              <Server size={14} />
              <span>Backends</span>
            </button>

            <button
              type="button"
              onclick={() => setTab("user")}
              class="flex cursor-pointer items-center gap-2 border-b-2 px-3 py-2 text-xs font-semibold transition-colors shrink-0 whitespace-nowrap {activeTab ===
              'user'
                ? 'border-accent text-accent'
                : 'border-transparent text-fg-muted hover:text-fg'}"
            >
              <User size={14} />
              <span>User</span>
            </button>
          </div>

          {#if canScrollRight}
            <button
              type="button"
              onclick={scrollRight}
              aria-label="Scroll right"
              transition:fly={{ x: 12, duration: 200 }}
              class="absolute right-0 z-10 flex h-full items-center pr-2 pl-4 bg-gradient-to-l from-bg via-bg/90 to-transparent text-fg-muted hover:text-fg transition-all duration-200 cursor-pointer"
            >
              <ChevronRight size={16} />
            </button>
          {/if}
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
        {:else if activeTab === "mcp"}
          <div
            class="col-start-1 row-start-1 overflow-y-auto p-5"
            in:fly={getFlyParams(true)}
            out:fly={getFlyParams(false)}
          >
            <McpTab />
          </div>
        {:else if activeTab === "skills"}
          <div
            class="col-start-1 row-start-1 overflow-y-auto p-5"
            in:fly={getFlyParams(true)}
            out:fly={getFlyParams(false)}
          >
            <SkillsTab />
          </div>
        {:else if activeTab === "backends"}
          <div
            class="col-start-1 row-start-1 overflow-y-auto p-5"
            in:fly={getFlyParams(true)}
            out:fly={getFlyParams(false)}
          >
            <BackendsTab />
          </div>
        {:else if activeTab === "user"}
          <div
            class="col-start-1 row-start-1 overflow-y-auto p-5"
            in:fly={getFlyParams(true)}
            out:fly={getFlyParams(false)}
          >
            <UserTab />
          </div>
        {/if}
      </div>
    </div>
  </div>
{/if}
