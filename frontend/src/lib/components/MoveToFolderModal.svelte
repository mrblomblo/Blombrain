<script lang="ts">
  import { Folder, FolderX, Plus, Check } from "@lucide/svelte";
  import Modal from "./ui/Modal.svelte";
  import Button from "./ui/Button.svelte";
  import type { FolderInfo } from "../types";

  interface Props {
    isOpen: boolean;
    folders: FolderInfo[];
    currentFolderId: string | null;
    targetCount: number;
    onselect: (folderId: string | null) => void | Promise<void>;
    oncreatefolder: (name: string) => Promise<FolderInfo | null>;
    onclose: () => void;
  }

  let {
    isOpen,
    folders,
    currentFolderId,
    targetCount,
    onselect,
    oncreatefolder,
    onclose,
  }: Props = $props();

  let newFolderName = $state("");
  let isCreating = $state(false);
  let isMoving = $state(false);

  $effect(() => {
    if (!isOpen) {
      newFolderName = "";
      isCreating = false;
      isMoving = false;
    }
  });

  async function handleChoose(folderId: string | null) {
    if (isMoving) return;
    isMoving = true;
    try {
      await onselect(folderId);
    } finally {
      isMoving = false;
    }
  }

  async function handleQuickCreate(e: SubmitEvent) {
    e.preventDefault();
    const trimmed = newFolderName.trim();
    if (!trimmed || isCreating || isMoving) return;
    isCreating = true;
    try {
      const created = await oncreatefolder(trimmed);
      if (created) {
        newFolderName = "";
        await handleChoose(created.id);
      }
    } finally {
      isCreating = false;
    }
  }
</script>

<Modal
  {isOpen}
  title={targetCount > 1
    ? `Move ${targetCount} Chats to Folder`
    : "Move Chat to Folder"}
  {onclose}
  maxWidth="max-w-sm"
>
  <div class="flex flex-col gap-2.5 pt-1">
    <div class="max-h-56 overflow-y-auto flex flex-col gap-1 pr-0.5">
      <button
        type="button"
        onclick={() => handleChoose(null)}
        disabled={isMoving}
        class="flex w-full items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left text-xs transition-colors cursor-pointer {currentFolderId ===
        null
          ? 'border-accent bg-accent/15 text-fg font-medium'
          : 'border-line bg-bg-elevated text-fg-muted hover:bg-bg-hover hover:text-fg'}"
      >
        <span class="flex items-center gap-2 min-w-0">
          <FolderX size={14} class="shrink-0 text-fg-subtle" />
          <span class="truncate">Unfiled (Chats)</span>
        </span>
        {#if currentFolderId === null}
          <Check size={13} class="shrink-0 text-accent" />
        {/if}
      </button>

      {#each folders as f (f.id)}
        <button
          type="button"
          onclick={() => handleChoose(f.id)}
          disabled={isMoving}
          class="flex w-full items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left text-xs transition-colors cursor-pointer {currentFolderId ===
          f.id
            ? 'border-accent bg-accent/15 text-fg font-medium'
            : 'border-line bg-bg-elevated text-fg-muted hover:bg-bg-hover hover:text-fg'}"
        >
          <span class="flex items-center gap-2 min-w-0">
            <Folder size={14} class="shrink-0 text-accent" />
            <span class="truncate">{f.name}</span>
          </span>
          {#if currentFolderId === f.id}
            <Check size={13} class="shrink-0 text-accent" />
          {/if}
        </button>
      {/each}
    </div>

    <form
      onsubmit={handleQuickCreate}
      class="flex items-center gap-1.5 border-t border-line pt-2.5"
    >
      <input
        type="text"
        bind:value={newFolderName}
        placeholder="Or create new folder…"
        aria-label="New folder name"
        class="min-w-0 flex-1 rounded-lg border border-line bg-bg-inset px-2.5 py-1.5 text-xs text-fg placeholder:text-fg-subtle focus:border-accent focus:outline-none"
      />
      <Button
        type="submit"
        variant="default"
        outline
        size="sm"
        disabled={!newFolderName.trim() || isCreating || isMoving}
        class="shrink-0"
      >
        <Plus size={12} />
        Create
      </Button>
    </form>
  </div>

  {#snippet footer()}
    <Button variant="ghost" outline onclick={onclose} disabled={isMoving}>
      Cancel
    </Button>
  {/snippet}
</Modal>
