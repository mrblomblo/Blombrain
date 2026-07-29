<script lang="ts">
  import { ChevronLeft, ChevronRight } from "@lucide/svelte";
  import { chatStore } from "../stores/chat.svelte";
  import { artifactStore } from "../stores/artifact.svelte";

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
      artifactStore.close();
    }
  }

  function handleNext() {
    if (currentIndex < siblings.length - 1) {
      const nextId = siblings[currentIndex + 1];
      chatStore.setBranchSelection(parentId, nextId);
      artifactStore.close();
    }
  }
</script>

{#if siblings.length > 1}
  <div
    class="flex items-center gap-0.5 rounded-md border border-line bg-bg-elevated/90 p-0.75 shadow-sm backdrop-blur-sm select-none"
  >
    <button
      type="button"
      onclick={handlePrev}
      disabled={currentIndex <= 0 || chatStore.isStreaming}
      aria-label="Previous branch version"
      title="Previous version"
      class="flex h-5 w-5 items-center justify-center rounded-md text-fg-muted transition-colors cursor-pointer hover:bg-bg-hover hover:text-fg disabled:opacity-30 disabled:pointer-events-none"
    >
      <ChevronLeft size={13} class="shrink-0 -translate-x-[1px]" />
    </button>
    <span
      class="px-0.5 text-[10px] font-mono text-fg-muted font-medium select-none"
    >
      {currentIndex + 1}/{siblings.length}
    </span>
    <button
      type="button"
      onclick={handleNext}
      disabled={currentIndex >= siblings.length - 1 || chatStore.isStreaming}
      aria-label="Next branch version"
      title="Next version"
      class="flex h-5 w-5 items-center justify-center rounded-md text-fg-muted transition-colors cursor-pointer hover:bg-bg-hover hover:text-fg disabled:opacity-30 disabled:pointer-events-none"
    >
      <ChevronRight size={13} class="shrink-0" />
    </button>
  </div>
{/if}
