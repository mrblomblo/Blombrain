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
    if (execution?.status === "completed") return "text-success";
    if (execution?.status === "error") return "text-danger";
    if (execution?.status === "cancelled") return "text-fg-muted";
    if (execution?.status === "polling") return "text-info";
    if (execution?.status === "executing") return "text-accent";
    return "text-fg-subtle";
  });
</script>

{#if execution}
  <div class="my-1 text-xs">
    <button
      type="button"
      onclick={() => (isExpanded = !isExpanded)}
      class="flex w-full items-center gap-1 text-fg-muted transition-colors hover:text-fg font-medium"
    >
      <ChevronRight
        size={14}
        class="shrink-0 transition-transform duration-200 {isExpanded
          ? 'rotate-90'
          : ''}"
      />
      <div class="flex items-center gap-1.5 min-w-0">
        <Wrench
          size={13}
          class="shrink-0 {execution.status === 'polling' ||
          execution.status === 'executing'
            ? 'animate-pulse text-accent'
            : 'text-fg-subtle'}"
        />
        <span class="truncate">{displayName}</span>
      </div>

      <span
        class="ml-auto shrink-0 flex items-center gap-1 text-[10px] uppercase tracking-wider text-fg-subtle"
      >
        {#if execution.status === "completed"}
          <Check size={11} class="shrink-0 {statusColorClass}" />
          <span class="hidden sm:inline">Done</span>
        {:else if execution.status === "error"}
          <XCircle size={11} class="shrink-0 {statusColorClass}" />
          <span class="hidden sm:inline">Error</span>
        {:else if execution.status === "cancelled"}
          <Ban size={11} class="shrink-0 {statusColorClass}" />
          <span class="hidden sm:inline">Cancelled</span>
        {:else if execution.status === "polling" || execution.status === "executing"}
          <Loader2 size={11} class="animate-spin shrink-0 {statusColorClass}" />
          <span class="hidden sm:inline"
            >{execution.status === "polling" ? "Polling" : "Running"}</span
          >
        {/if}
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
        class="mt-1.5 pl-4 text-[11px] leading-relaxed text-fg-muted opacity-90 border-l-2 border-line/50 ml-1.5 py-1 space-y-1.5"
      >
        <div>
          <span class="font-semibold text-fg-subtle">Args:</span>
          <pre
            class="mt-1 max-h-28 overflow-x-auto whitespace-pre-wrap rounded bg-bg p-1.5 text-fg font-mono">{JSON.stringify(
              execution.args,
              null,
              2,
            )}</pre>
        </div>
        {#if execution.result}
          <div>
            <span class="font-semibold text-fg-subtle">Result:</span>
            <pre
              class="mt-1 max-h-40 overflow-x-auto whitespace-pre-wrap rounded bg-bg p-1.5 text-fg font-mono">{execution.result}</pre>
          </div>
        {/if}
        {#if execution.error}
          <div class="text-danger">
            <span class="font-semibold">Error:</span>
            <pre
              class="mt-1 max-h-28 overflow-x-auto whitespace-pre-wrap rounded bg-danger/10 p-1.5 text-danger font-mono">{execution.error}</pre>
          </div>
        {/if}
      </div>
    {/if}
  </div>
{/if}
