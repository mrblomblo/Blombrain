<script lang="ts">
  import type { ToolExecutionEvent } from "../types";
  import {
    Wrench,
    ChevronRight,
    Loader2,
    Check,
    XCircle,
    Ban,
  } from "@lucide/svelte";
  import { slide } from "svelte/transition";

  let { execution }: { execution: ToolExecutionEvent } = $props();
  let isExpanded = $state(false);

  let displayName = $derived.by(() => {
    if (!execution?.toolName) return "";
    const parts = execution.toolName.split("__");
    return parts.length > 1 ? parts.slice(1).join("__") : execution.toolName;
  });

  let statusColorClass = $derived.by(() => {
    if (execution?.status === "completed") return "text-accent";
    if (execution?.status === "error") return "text-danger";
    if (execution?.status === "cancelled") return "text-fg-muted";
    if (execution?.status === "polling" || execution?.status === "executing") {
      return "text-accent";
    }
    return "text-fg-subtle";
  });
</script>

{#if execution}
  <div
    class="my-1.5 rounded-md border border-line/60 bg-bg-muted/40 p-2 text-xs font-mono"
  >
    <button
      type="button"
      onclick={() => (isExpanded = !isExpanded)}
      class="flex w-full items-center justify-between font-medium text-fg-muted hover:text-fg transition-colors"
    >
      <div class="flex items-center gap-1.5 min-w-0">
        <ChevronRight
          size={13}
          class="shrink-0 transition-transform duration-200 {isExpanded
            ? 'rotate-90'
            : ''}"
        />
        {#if execution.status === "polling"}
          <Loader2
            size={12}
            class="animate-spin shrink-0 text-accent"
          />
        {:else}
          <Wrench size={12} class="text-accent shrink-0" />
        {/if}
        <span class="font-semibold text-fg-subtle truncate">{displayName}</span>
      </div>
      <span
        class="shrink-0 text-[10px] uppercase tracking-wider px-0.5 sm:px-1.5 py-0.5 rounded bg-bg-elevated border border-line/40 {statusColorClass} {(execution.status === 'polling' || execution.status === 'executing') ? 'hidden sm:flex items-center gap-1' : 'flex items-center gap-1'}"
        title={execution.status}
      >
        {#if execution.status === "completed"}
          <Check size={11} class="shrink-0 sm:hidden" />
        {:else if execution.status === "error"}
          <XCircle size={11} class="shrink-0 sm:hidden" />
        {:else if execution.status === "cancelled"}
          <Ban size={11} class="shrink-0 sm:hidden" />
        {:else if execution.status === "polling" || execution.status === "executing"}
          <Loader2
            size={11}
            class="animate-spin shrink-0 sm:hidden"
          />
        {/if}
        <span class="hidden sm:inline">{execution.status}</span>
      </span>
    </button>

    {#if execution.status === "polling"}
      <div
        class="mt-1.5 pl-5 flex flex-col sm:flex-row sm:items-center gap-0.5 sm:gap-2 text-[11px] text-fg-muted"
      >
        <span class="truncate"
          >{execution.message ||
            `Polling job ${execution.jobId ?? ""}...`}</span
        >
        {#if execution.attempts || execution.elapsedMs}
          <div
            class="flex items-center gap-1.5 opacity-70 text-[10px] sm:text-[11px]"
          >
            <span class="hidden sm:inline">·</span>
            {#if execution.attempts}
              <span>attempt {execution.attempts}</span>
            {/if}
            {#if execution.attempts && execution.elapsedMs}
              <span>·</span>
            {/if}
            {#if execution.elapsedMs}
              <span>{Math.round(execution.elapsedMs / 1000)}s elapsed</span>
            {/if}
          </div>
        {/if}
      </div>
    {/if}

    {#if isExpanded}
      <div
        transition:slide={{ duration: 200 }}
        class="mt-2 space-y-1.5 border-t border-line/40 pt-2 text-[11px]"
      >
        <div>
          <span class="font-semibold text-fg-subtle">Args:</span>
          <pre
            class="mt-1 max-h-28 overflow-x-auto whitespace-pre-wrap rounded bg-bg-elevated p-1.5 text-fg-muted border border-line/30">{JSON.stringify(
              execution.args,
              null,
              2,
            )}</pre>
        </div>
        {#if execution.result}
          <div>
            <span class="font-semibold text-fg-subtle">Result:</span>
            <pre
              class="mt-1 max-h-40 overflow-x-auto whitespace-pre-wrap rounded bg-bg-elevated p-1.5 text-fg border border-line/30">{execution.result}</pre>
          </div>
        {/if}
        {#if execution.error}
          <div class="text-danger">
            <span class="font-semibold">Error:</span>
            <pre
              class="mt-1 max-h-28 overflow-x-auto whitespace-pre-wrap rounded bg-danger-muted/20 p-1.5 text-danger border border-danger/30">{execution.error}</pre>
          </div>
        {/if}
      </div>
    {/if}
  </div>
{/if}
