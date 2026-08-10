<script lang="ts">
  import { Info } from "@lucide/svelte";
  import type { ResponseStats as ResponseStatsType } from "../types";

  interface Props {
    stats?: ResponseStatsType;
  }
  const { stats }: Props = $props();

  let showPopover = $state(false);

  let tokensPerSec = $derived.by(() => {
    const tps =
      stats?.tokensPerSecond ??
      (stats?.generationMs && stats?.completionTokens
        ? stats.completionTokens / (stats.generationMs / 1000)
        : stats?.completionTokens && stats?.durationMs && stats.durationMs > 0
          ? stats.completionTokens / (stats.durationMs / 1000)
          : null);

    return tps ? tps.toFixed(1) : undefined;
  });
</script>

{#if stats && (stats.totalTokens || stats.durationMs)}
  <div class="relative inline-block">
    <button
      type="button"
      onclick={() => (showPopover = !showPopover)}
      onmouseenter={() => (showPopover = true)}
      onmouseleave={() => (showPopover = false)}
      aria-label="Generation details and statistics"
      class="flex h-6 w-6 items-center justify-center rounded text-fg-subtle transition-colors hover:bg-bg-hover hover:text-fg"
    >
      <Info size={13} />
    </button>

    {#if showPopover}
      <div
        class="absolute bottom-full left-1/2 mb-1.5 -translate-x-1/2 z-30 min-w-44 rounded-lg border border-line bg-bg-elevated p-2.5 shadow-xl text-[11px] font-mono text-fg font-normal whitespace-nowrap pointer-events-none"
      >
        <div class="flex items-center justify-between gap-4 py-0.5">
          <span class="text-fg-muted">Prompt tokens:</span>
          <span>{stats.promptTokens ?? "-"}</span>
        </div>
        <div class="flex items-center justify-between gap-4 py-0.5">
          <span class="text-fg-muted">Response tokens:</span>
          <span>{stats.completionTokens ?? "-"}</span>
        </div>
        <div class="flex items-center justify-between gap-4 py-0.5">
          <span class="text-fg-muted">Total tokens:</span>
          <span class="font-semibold text-accent"
            >{stats.totalTokens ?? "-"}</span
          >
        </div>
        {#if tokensPerSec}
          <div
            class="flex items-center justify-between gap-4 py-0.5 border-t border-line/60 mt-1 pt-1"
          >
            <span class="text-fg-muted">Generation speed:</span>
            <span class="font-semibold text-success">{tokensPerSec} t/s</span>
          </div>
        {/if}
        {#if stats.durationMs}
          <div class="flex items-center justify-between gap-4 py-0.5">
            <span class="text-fg-muted">Duration:</span>
            <span>{(stats.durationMs / 1000).toFixed(2)}s</span>
          </div>
        {/if}
      </div>
    {/if}
  </div>
{/if}
