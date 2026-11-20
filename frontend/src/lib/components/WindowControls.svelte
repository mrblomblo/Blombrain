<script lang="ts">
  import { Minus, Square, Copy, X } from "@lucide/svelte";
  import { desktopWindow } from "../stores/window.svelte";

  interface Props {
    standalone?: boolean;
  }

  let { standalone = false }: Props = $props();
</script>

{#if desktopWindow.isTauri}
  <div
    class="flex items-center gap-0.5 shrink-0 {standalone
      ? ''
      : 'pl-1.5 ml-0.5 border-l border-line'}"
    aria-label="Window controls"
  >
    <button
      type="button"
      onclick={() => desktopWindow.minimize()}
      aria-label="Minimize window"
      title="Minimize"
      class="flex h-7 w-7 items-center justify-center rounded-md text-fg-muted hover:bg-bg-elevated hover:text-fg transition-colors cursor-pointer"
    >
      <Minus size={13} />
    </button>
    <button
      type="button"
      onclick={() => desktopWindow.toggleMaximize()}
      aria-label={desktopWindow.isMaximized ? "Restore window" : "Maximize window"}
      title={desktopWindow.isMaximized ? "Restore" : "Maximize"}
      class="flex h-7 w-7 items-center justify-center rounded-md text-fg-muted hover:bg-bg-elevated hover:text-fg transition-colors cursor-pointer"
    >
      {#if desktopWindow.isMaximized}
        <Copy size={11} />
      {:else}
        <Square size={11} />
      {/if}
    </button>
    <button
      type="button"
      onclick={() => desktopWindow.close()}
      aria-label="Close window"
      title="Close"
      class="flex h-7 w-7 items-center justify-center rounded-md text-fg-muted hover:bg-danger/15 hover:text-danger transition-colors cursor-pointer"
    >
      <X size={13} />
    </button>
  </div>
{/if}
