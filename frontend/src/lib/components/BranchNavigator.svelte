<script lang="ts">
  import { ChevronLeft, ChevronRight } from "@lucide/svelte";
  import { chatStore } from "../stores/chat.svelte";

  interface Props {
    parentId: string | null;
    siblings: string[];
    currentId: string;
  }
  const { parentId, siblings, currentId }: Props = $props();

  let currentIndex = $derived(siblings.indexOf(currentId));

  function handlePrev() {
    if (currentIndex > 0) {
      const prevId = siblings[currentIndex - 1];
      chatStore.setBranchSelection(parentId, prevId);
    }
  }

  function handleNext() {
    if (currentIndex < siblings.length - 1) {
      const nextId = siblings[currentIndex + 1];
      chatStore.setBranchSelection(parentId, nextId);
    }
  }
</script>

{#if siblings.length > 1}
  <div class="inline-flex items-center gap-0.5 rounded-md border border-line bg-bg-inset px-1 py-0.5 text-[11px] font-mono text-fg-subtle select-none">
    <button
      type="button"
      onclick={handlePrev}
      disabled={currentIndex <= 0}
      aria-label="Previous branch version"
      class="flex h-4 w-4 items-center justify-center rounded text-fg-muted transition-colors hover:bg-bg-hover hover:text-fg disabled:opacity-30 disabled:pointer-events-none"
    >
      <ChevronLeft size={12} />
    </button>
    <span class="px-1 text-[10px] text-fg-muted">
      {currentIndex + 1} / {siblings.length}
    </span>
    <button
      type="button"
      onclick={handleNext}
      disabled={currentIndex >= siblings.length - 1}
      aria-label="Next branch version"
      class="flex h-4 w-4 items-center justify-center rounded text-fg-muted transition-colors hover:bg-bg-hover hover:text-fg disabled:opacity-30 disabled:pointer-events-none"
    >
      <ChevronRight size={12} />
    </button>
  </div>
{/if}
