<script lang="ts">
  import { ChevronDown, ChevronRight, Brain } from "@lucide/svelte";

  interface Props {
    thinkingContent?: string;
    thinkingDone?: boolean;
    streaming?: boolean;
  }
  const { thinkingContent, thinkingDone, streaming }: Props = $props();

  let isOpen = $state(false);

  // Auto-open when streaming thinking content, auto-close when thinking finishes
  $effect(() => {
    if (streaming && !thinkingDone) {
      isOpen = true;
    } else if (thinkingDone) {
      isOpen = false;
    }
  });
</script>

{#if thinkingContent}
  <div class="mb-2 rounded-lg border border-line bg-bg-inset/60 overflow-hidden text-xs">
    <button
      type="button"
      onclick={() => (isOpen = !isOpen)}
      class="flex w-full items-center justify-between px-3 py-2 text-fg-muted transition-colors hover:bg-bg-hover hover:text-fg"
    >
      <div class="flex items-center gap-2 font-mono text-[11px]">
        <Brain size={13} class={streaming && !thinkingDone ? "animate-pulse text-accent" : "text-fg-subtle"} />
        <span>
          {#if streaming && !thinkingDone}
            Thinking…
          {:else}
            Thinking process ({thinkingContent.length} chars)
          {/if}
        </span>
      </div>
      {#if isOpen}
        <ChevronDown size={14} />
      {:else}
        <ChevronRight size={14} />
      {/if}
    </button>

    {#if isOpen}
      <div class="border-t border-line/50 px-3 py-2.5 font-mono text-[11px] leading-relaxed text-fg-muted whitespace-pre-wrap max-h-60 overflow-y-auto bg-bg-inset">
        {thinkingContent}
      </div>
    {/if}
  </div>
{/if}
