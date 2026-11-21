<script lang="ts">
  import type { ToolExecutionEvent } from "../types";
  import {
    Wrench,
    ChevronRight,
    Loader2,
    Check,
    XCircle,
    Ban,
    ShieldAlert,
    RotateCcw,
    Terminal,
  } from "@lucide/svelte";
  import { slide } from "svelte/transition";
  import { submitToolApproval } from "../api";
  import { chatStore } from "../stores/chat.svelte";

  let { execution }: { execution: ToolExecutionEvent } = $props();
  let isExpanded = $state(false);
  let isSubmittingDecision = $state(false);
  let approvalError = $state<string | null>(null);
  let isReverting = $state(false);
  let revertError = $state<string | null>(null);

  let displayName = $derived.by(() => {
    if (!execution?.toolName) return "";
    const parts = execution.toolName.split("__");
    return parts.length > 1 ? parts.slice(1).join("__") : execution.toolName;
  });

  let statusColorClass = $derived.by(() => {
    if (execution?.status === "completed") return "text-success";
    if (execution?.status === "error") return "text-danger";
    if (execution?.status === "cancelled") return "text-fg-muted";
    if (execution?.status === "awaiting_approval") return "text-warning";
    if (execution?.status === "polling") return "text-info";
    if (execution?.status === "executing") return "text-accent";
    return "text-fg-subtle";
  });

  let extractedDiffLines = $derived.by(() => {
    if (execution?.diffPreview) {
      return execution.diffPreview.split("\n");
    }
    const res = execution?.result || "";
    const match = res.match(/```diff\n([\s\S]*?)\n```/);
    if (match?.[1]) {
      return match[1].split("\n");
    }
    return null;
  });

  let cleanResultText = $derived.by(() => {
    const res = execution?.result || "";
    if (!res) return "";
    return res.replace(/\n```diff\n[\s\S]*?\n```$/, "").trim();
  });

  async function handleApprovalDecision(approved: boolean, approveAllInTurn = false) {
    if (!execution?.callId || isSubmittingDecision) return;
    isSubmittingDecision = true;
    approvalError = null;
    try {
      const res = await submitToolApproval(
        execution.callId,
        approved,
        chatStore.activeConversationId,
        approveAllInTurn,
      );
      if (res && res.resolved === false) {
        approvalError = "Approval request expired or was already resolved.";
      }
    } catch (err) {
      console.error("Failed to submit tool approval:", err);
      approvalError = (err as Error).message || "Failed to submit approval decision.";
    } finally {
      isSubmittingDecision = false;
    }
  }

  async function handleRevert(e: MouseEvent) {
    e.stopPropagation();
    if (!execution?.checkpointId || execution.reverted || isReverting) return;
    isReverting = true;
    revertError = null;
    try {
      await chatStore.revertCheckpoint(execution.checkpointId, execution.callId);
    } catch (err) {
      revertError = (err as Error).message || "Failed to revert edit.";
    } finally {
      isReverting = false;
    }
  }
</script>

{#if execution}
  <div class="my-1 text-xs">
    <div class="flex w-full items-center gap-1">
      <button
        type="button"
        onclick={() => (isExpanded = !isExpanded)}
        class="flex flex-1 min-w-0 items-center gap-1 text-fg-muted transition-colors hover:text-fg font-medium cursor-pointer"
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
            execution.status === 'executing' ||
            execution.status === 'awaiting_approval'
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
          {:else if execution.status === "awaiting_approval"}
            <ShieldAlert size={11} class="shrink-0 {statusColorClass}" />
            <span class="text-warning font-semibold">Approval Required</span>
          {:else if execution.status === "polling" || execution.status === "executing"}
            <Loader2 size={11} class="animate-spin shrink-0 {statusColorClass}" />
            <span class="hidden sm:inline"
              >{execution.status === "polling" ? "Polling" : "Running"}</span
            >
          {/if}
        </span>
      </button>

      {#if execution.status === "completed" && execution.checkpointId}
        {#if execution.reverted}
          <span
            class="ml-1.5 shrink-0 rounded bg-bg-inset border border-line px-1.5 py-0.5 font-mono text-[10px] text-fg-subtle"
          >
            Reverted
          </span>
        {:else}
          <button
            type="button"
            onclick={handleRevert}
            disabled={isReverting}
            title="Revert this workspace file change"
            aria-label="Revert workspace change"
            class="ml-1.5 shrink-0 inline-flex items-center gap-1 rounded border border-line bg-bg-elevated px-1.5 py-0.5 text-[10px] font-medium text-fg-muted hover:border-accent hover:text-fg transition-colors cursor-pointer disabled:opacity-40"
          >
            <RotateCcw size={10} />
            <span>{isReverting ? "Reverting..." : "Revert"}</span>
          </button>
        {/if}
      {/if}
    </div>

    {#if revertError}
      <div class="mt-1 pl-5 text-[11px] text-danger">{revertError}</div>
    {/if}

    {#if execution.status === "awaiting_approval"}
      <div
        transition:slide={{ duration: 180 }}
        class="mt-2 ml-4 rounded-xl border border-warning/40 bg-bg-elevated p-3 space-y-2.5 shadow-md"
      >
        <div class="flex flex-wrap items-center justify-between gap-2">
          <div class="flex items-center gap-1.5 text-xs font-semibold text-fg min-w-0">
            <ShieldAlert size={14} class="text-warning shrink-0" />
            <span class="truncate">{execution.message || `Approve ${displayName}?`}</span>
          </div>
          <div class="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onclick={() => handleApprovalDecision(false, false)}
              disabled={isSubmittingDecision}
              class="rounded-lg border border-line bg-bg-inset px-2.5 py-1 text-xs font-medium text-fg-muted hover:bg-danger/15 hover:border-danger/50 hover:text-danger transition-colors cursor-pointer disabled:opacity-40"
            >
              Reject
            </button>
            {#if !execution.commandPreview}
              <button
                type="button"
                onclick={() => handleApprovalDecision(true, true)}
                disabled={isSubmittingDecision}
                title="Approve this edit and automatically approve remaining file edits in this turn"
                class="rounded-lg border border-accent/40 bg-accent/10 px-2.5 py-1 text-xs font-medium text-accent hover:bg-accent/20 transition-colors cursor-pointer disabled:opacity-40"
              >
                Approve All (Turn)
              </button>
            {/if}
            <button
              type="button"
              onclick={() => handleApprovalDecision(true, false)}
              disabled={isSubmittingDecision}
              class="rounded-lg bg-accent px-3 py-1 text-xs font-semibold text-accent-fg hover:opacity-90 transition-opacity cursor-pointer disabled:opacity-40"
            >
              {execution.commandPreview ? "Approve & Run" : "Approve"}
            </button>
          </div>
        </div>

        {#if approvalError}
          <div class="rounded-md border border-danger/40 bg-danger/10 px-2 py-1 text-[11px] text-danger">
            {approvalError}
          </div>
        {/if}

        {#if execution.commandPreview}
          <div class="rounded-lg border border-line bg-bg-inset p-2 font-mono text-[11px] space-y-1">
            <div class="flex items-center gap-1.5 text-fg-subtle text-[10px]">
              <Terminal size={11} class="text-accent" />
              <span>Working directory: {execution.cwd || "."}</span>
            </div>
            <div class="text-fg break-all select-all">$ {execution.commandPreview}</div>
          </div>
        {/if}

        {#if extractedDiffLines}
          <div class="max-h-56 overflow-auto rounded-lg border border-line bg-bg font-mono text-[11px] p-1.5">
            {#each extractedDiffLines as dLine}
              <div
                class="whitespace-pre-wrap break-all px-1.5 py-0.2 rounded-xs {dLine.startsWith('+') &&
                !dLine.startsWith('+++')
                  ? 'bg-success/15 text-success'
                  : dLine.startsWith('-') && !dLine.startsWith('---')
                    ? 'bg-danger/15 text-danger'
                    : dLine.startsWith('@@')
                      ? 'text-accent font-semibold'
                      : 'text-fg-muted'}"
              >
                {dLine || " "}
              </div>
            {/each}
          </div>
        {/if}
      </div>
    {/if}

    {#if execution.status === "executing" && execution.message}
      <div class="mt-1 pl-5 text-[11px] font-mono text-fg-subtle truncate">
        {execution.message}
      </div>
    {/if}

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
        {#if cleanResultText}
          <div>
            <span class="font-semibold text-fg-subtle">Result:</span>
            <pre
              class="mt-1 max-h-40 overflow-x-auto whitespace-pre-wrap rounded bg-bg p-1.5 text-fg font-mono">{cleanResultText}</pre>
          </div>
        {/if}
        {#if extractedDiffLines}
          <div>
            <span class="font-semibold text-fg-subtle">Diff Preview:</span>
            <div class="mt-1 max-h-56 overflow-auto rounded bg-bg font-mono text-[11px] p-1.5 border border-line/60">
              {#each extractedDiffLines as dLine}
                <div
                  class="whitespace-pre-wrap break-all px-1.5 py-0.2 rounded-xs {dLine.startsWith('+') &&
                  !dLine.startsWith('+++')
                    ? 'bg-success/15 text-success'
                    : dLine.startsWith('-') && !dLine.startsWith('---')
                      ? 'bg-danger/15 text-danger'
                      : dLine.startsWith('@@')
                        ? 'text-accent font-semibold'
                        : 'text-fg-muted'}"
                >
                  {dLine || " "}
                </div>
              {/each}
            </div>
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
