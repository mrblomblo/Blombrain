<script lang="ts">
  import type { ToolExecutionEvent } from "../types";
  import { Wrench, ChevronRight } from "@lucide/svelte";
  import { slide } from "svelte/transition";

  let { execution }: { execution: ToolExecutionEvent } = $props();
  let isExpanded = $state(false);
</script>

{#if execution}
  <div class="my-1.5 rounded-md border border-line/60 bg-bg-muted/40 p-2 text-xs font-mono">
    <button
      type="button"
      onclick={() => (isExpanded = !isExpanded)}
      class="flex w-full items-center justify-between font-medium text-fg-muted hover:text-fg transition-colors"
    >
      <div class="flex items-center gap-1.5">
        <ChevronRight
          size={13}
          class="shrink-0 transition-transform duration-200 {isExpanded ? 'rotate-90' : ''}"
        />
        <Wrench size={12} class="text-accent shrink-0" />
        <span class="font-semibold text-fg-subtle">{execution.toolName}</span>
      </div>
      <span class="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-bg-elevated text-fg-subtle border border-line/40">
        {execution.status}
      </span>
    </button>

    {#if isExpanded}
      <div transition:slide={{ duration: 200 }} class="mt-2 space-y-1.5 border-t border-line/40 pt-2 text-[11px]">
        <div>
          <span class="font-semibold text-fg-subtle">Args:</span>
          <pre class="mt-1 max-h-28 overflow-x-auto whitespace-pre-wrap rounded bg-bg-elevated p-1.5 text-fg-muted border border-line/30">{JSON.stringify(execution.args, null, 2)}</pre>
        </div>
        {#if execution.result}
          <div>
            <span class="font-semibold text-fg-subtle">Result:</span>
            <pre class="mt-1 max-h-40 overflow-x-auto whitespace-pre-wrap rounded bg-bg-elevated p-1.5 text-fg border border-line/30">{execution.result}</pre>
          </div>
        {/if}
        {#if execution.error}
          <div class="text-danger">
            <span class="font-semibold">Error:</span>
            <pre class="mt-1 max-h-28 overflow-x-auto whitespace-pre-wrap rounded bg-danger-muted/20 p-1.5 text-danger border border-danger/30">{execution.error}</pre>
          </div>
        {/if}
      </div>
    {/if}
  </div>
{/if}
