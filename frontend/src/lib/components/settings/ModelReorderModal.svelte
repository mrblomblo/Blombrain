<script lang="ts">
  import {
    X,
    GripVertical,
    ArrowUp,
    ArrowDown,
    Check,
    Star,
    EyeOff,
  } from "@lucide/svelte";
  import { fade, fly } from "svelte/transition";
  import { flip } from "svelte/animate";
  import { quintOut } from "svelte/easing";
  import { updateModelOrder } from "../../api";
  import type { ModelInfo } from "../../types";
  import { useQueryClient } from "@tanstack/svelte-query";

  interface Props {
    open: boolean;
    models: ModelInfo[];
    onClose: () => void;
  }

  const { open, models, onClose }: Props = $props();
  const queryClient = useQueryClient();

  let items = $state<ModelInfo[]>([]);
  let isSaving = $state(false);
  let errorMsg = $state<string | null>(null);

  // Sync internal state when opened or models change
  $effect(() => {
    if (open) {
      items = [...models].sort(
        (a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0),
      );
    }
  });

  // Drag and drop state
  let draggedIndex = $state<number | null>(null);

  function handleDragStart(index: number, e: DragEvent) {
    draggedIndex = index;
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = "move";
    }
  }

  function handleDragOver(index: number, e: DragEvent) {
    e.preventDefault();
    if (draggedIndex === null || draggedIndex === index) return;

    const updated = [...items];
    const [moved] = updated.splice(draggedIndex, 1);
    updated.splice(index, 0, moved);
    draggedIndex = index;
    items = updated;
  }

  function handleDragEnd() {
    draggedIndex = null;
  }

  function moveItem(index: number, direction: "up" | "down") {
    const targetIndex = direction === "up" ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= items.length) return;

    const updated = [...items];
    const [moved] = updated.splice(index, 1);
    updated.splice(targetIndex, 0, moved);
    items = updated;
  }

  async function handleSave() {
    isSaving = true;
    errorMsg = null;

    const payload = items.map((item, index) => ({
      id: item.id,
      sortOrder: index,
      isPreset: item.isPreset,
    }));

    try {
      await updateModelOrder(payload);
      await queryClient.invalidateQueries({ queryKey: ["models"] });
      onClose();
    } catch (err) {
      errorMsg =
        err instanceof Error ? err.message : "Failed to save model order.";
    } finally {
      isSaving = false;
    }
  }

  function handleBackdropClick(e: MouseEvent) {
    if (e.target === e.currentTarget) {
      e.stopPropagation();
      onClose();
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      e.stopPropagation();
      onClose();
    }
  }
</script>

{#if open}
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <div
    role="dialog"
    aria-modal="true"
    aria-label="Reorder Models"
    tabindex="-1"
    transition:fade={{ duration: 150 }}
    class="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-xs"
    onclick={handleBackdropClick}
    onkeydown={handleKeydown}
  >
    <div
      role="presentation"
      transition:fly={{ y: 15, duration: 200 }}
      class="relative flex w-full max-w-lg flex-col rounded-xl border border-line bg-bg shadow-2xl overflow-hidden"
      style="max-height: min(85vh, 600px); height: min(85vh, 600px);"
      onclick={(e) => e.stopPropagation()}
    >
      <!-- Header -->
      <div
        class="flex items-center justify-between border-b border-line px-5 py-3.5 bg-bg"
      >
        <div>
          <h2 class="text-sm font-semibold text-fg">
            Reorder Models & Presets
          </h2>
          <p class="text-xs text-fg-subtle">
            Drag items or use arrows to change model order
          </p>
        </div>
        <button
          type="button"
          onclick={onClose}
          aria-label="Close"
          class="flex h-7 w-7 items-center justify-center rounded-md text-fg-muted transition-colors hover:bg-bg-elevated hover:text-fg"
        >
          <X size={16} />
        </button>
      </div>

      <!-- Item List -->
      <div class="flex-1 overflow-y-auto p-4 space-y-2">
        {#each items as model, index (model.id)}
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div
            animate:flip={{ duration: 250, easing: quintOut }}
            draggable="true"
            ondragstart={(e) => handleDragStart(index, e)}
            ondragover={(e) => handleDragOver(index, e)}
            ondragend={handleDragEnd}
            class="flex items-center justify-between gap-3 rounded-lg border border-line bg-bg-elevated px-3 py-2 text-sm transition-colors hover:border-line-strong select-none {draggedIndex ===
            index
              ? 'opacity-40 border-dashed border-accent'
              : ''} {model.isHidden ? 'opacity-50 bg-bg/50' : ''}"
          >
            <div class="flex items-center gap-3 min-w-0 flex-1">
              <!-- Drag Handle Icon -->
              <div
                class="cursor-grab text-fg-subtle hover:text-fg active:cursor-grabbing"
              >
                <GripVertical size={16} />
              </div>

              <!-- Model Icon -->
              {#if model.icon}
                <img
                  src={model.icon}
                  alt="Icon"
                  class="h-6 w-6 rounded-md object-cover border border-line"
                />
              {:else}
                <div
                  class="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-bg-inset font-semibold text-[10px] text-fg-muted"
                >
                  AI
                </div>
              {/if}

              <!-- Details -->
              <div class="min-w-0 flex-1">
                <div class="flex items-center gap-2">
                  <span class="font-medium text-fg text-xs truncate"
                    >{model.name || model.id}</span
                  >
                  {#if model.isPreset}
                    <span
                      class="rounded bg-accent/20 px-1.5 py-0.5 text-[9px] font-mono text-accent"
                      >Preset</span
                    >
                  {/if}
                  {#if model.isDefault}
                    <Star size={11} class="text-amber-400 fill-amber-400" />
                  {/if}
                  {#if model.isHidden}
                    <EyeOff size={11} class="text-fg-subtle" />
                  {/if}
                </div>
              </div>
            </div>

            <!-- Up / Down Quick Buttons -->
            <div class="flex items-center gap-1">
              <button
                type="button"
                disabled={index === 0}
                onclick={() => moveItem(index, "up")}
                class="flex h-6 w-6 items-center justify-center rounded text-fg-subtle transition-colors hover:bg-bg hover:text-fg disabled:opacity-30"
                title="Move Up"
              >
                <ArrowUp size={13} />
              </button>
              <button
                type="button"
                disabled={index === items.length - 1}
                onclick={() => moveItem(index, "down")}
                class="flex h-6 w-6 items-center justify-center rounded text-fg-subtle transition-colors hover:bg-bg hover:text-fg disabled:opacity-30"
                title="Move Down"
              >
                <ArrowDown size={13} />
              </button>
            </div>
          </div>
        {/each}
      </div>

      <!-- Footer Actions -->
      {#if errorMsg}
        <div class="px-4 text-xs text-danger">{errorMsg}</div>
      {/if}

      <div class="flex justify-end gap-2 border-t border-line px-4 py-3 bg-bg">
        <button
          type="button"
          onclick={onClose}
          disabled={isSaving}
          class="h-8 rounded-md border border-line px-3 text-xs text-fg-muted transition-colors hover:bg-bg-elevated"
        >
          Cancel
        </button>
        <button
          type="button"
          onclick={handleSave}
          disabled={isSaving}
          class="flex h-8 items-center gap-1.5 rounded-md bg-accent px-4 text-xs font-semibold text-accent-fg transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          <Check size={13} />
          {isSaving ? "Saving..." : "Save Order"}
        </button>
      </div>
    </div>
  </div>
{/if}
