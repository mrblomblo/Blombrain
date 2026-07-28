<script lang="ts">
  import { ChevronDown, ChevronRight, Brain } from "@lucide/svelte";
  import { slide } from "svelte/transition";
  import Markdown from "./Markdown.svelte";

  interface Props {
    thinkingContent?: string;
    thinkingDone?: boolean;
    streaming?: boolean;
    thinkingTimeMs?: number;
    hasMainContent?: boolean;
  }
  const {
    thinkingContent,
    thinkingDone,
    streaming,
    thinkingTimeMs,
    hasMainContent = true,
  }: Props = $props();

  let isOpen = $state(false);
  let startTime = $state(0);
  let elapsedSeconds = $state(0);

  $effect(() => {
    if (streaming && !thinkingDone) {
      isOpen = true;
      if (startTime === 0) startTime = Date.now();
      const interval = setInterval(() => {
        elapsedSeconds = (Date.now() - startTime) / 1000;
      }, 100);
      return () => clearInterval(interval);
    } else if (thinkingDone && streaming) {
      isOpen = false;
      startTime = 0;
    } else if (!streaming && (thinkingDone === false || !hasMainContent)) {
      isOpen = true;
      startTime = 0;
    } else {
      startTime = 0;
    }
  });
</script>

{#if thinkingContent !== undefined}
  <div class="mb-2 text-xs">
    <button
      type="button"
      onclick={() => (isOpen = !isOpen)}
      class="flex w-full items-center gap-1 text-fg-muted transition-colors hover:text-fg font-medium"
    >
      {#if isOpen}
        <ChevronDown size={14} class="shrink-0" />
      {:else}
        <ChevronRight size={14} class="shrink-0" />
      {/if}
      <div class="flex items-center gap-1.5">
        <Brain
          size={13}
          class={streaming && !thinkingDone
            ? "animate-pulse text-accent"
            : "text-fg-subtle"}
        />
        <span>
          {#if streaming && !thinkingDone}
            Thinking ({elapsedSeconds.toFixed(1)}s)
          {:else if thinkingTimeMs}
            Thought for {(thinkingTimeMs / 1000).toFixed(1)}s{#if thinkingDone === false} (interrupted){/if}
          {:else}
            Thought process{#if thinkingDone === false} (interrupted){/if}
          {/if}
        </span>
      </div>
    </button>

    {#if isOpen}
      <div
        transition:slide={{ duration: 200 }}
        class="mt-1.5 pl-4 text-[11px] leading-relaxed text-fg-muted opacity-90 border-l-2 border-line/50 ml-1.5 py-1"
      >
        <Markdown content={thinkingContent} class="text-[11px]" />
      </div>
    {/if}
  </div>
{/if}
