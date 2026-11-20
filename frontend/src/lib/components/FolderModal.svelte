<script lang="ts">
  import Modal from "./ui/Modal.svelte";
  import Button from "./ui/Button.svelte";

  interface Props {
    isOpen: boolean;
    mode: "create" | "edit";
    name?: string;
    description?: string;
    isSaving?: boolean;
    onsubmit: (name: string, description: string) => void | Promise<void>;
    onclose: () => void;
  }

  let {
    isOpen,
    mode,
    name = $bindable(""),
    description = $bindable(""),
    isSaving = false,
    onsubmit,
    onclose,
  }: Props = $props();

  function focusAndSelect(node: HTMLInputElement) {
    requestAnimationFrame(() => {
      node.focus();
      node.select();
    });
  }

  function handleSubmit(e?: SubmitEvent | MouseEvent) {
    e?.preventDefault();
    if (!name.trim() || isSaving) return;
    void onsubmit(name.trim(), description.trim());
  }
</script>

<Modal
  {isOpen}
  title={mode === "create" ? "Create Folder" : "Edit Folder"}
  {onclose}
  maxWidth="max-w-lg"
>
  <form onsubmit={handleSubmit} class="flex flex-col gap-3.5 pt-1">
    <div class="flex flex-col gap-1.5">
      <label for="folder-name-input" class="text-xs font-medium text-fg-muted">
        Folder Name
      </label>
      <input
        id="folder-name-input"
        use:focusAndSelect
        type="text"
        bind:value={name}
        placeholder="Enter folder name…"
        class="w-full rounded-lg border border-line bg-bg-inset px-3 py-2 text-sm text-fg placeholder:text-fg-subtle focus:border-accent focus:outline-none transition-colors"
      />
    </div>

    <div class="flex flex-col gap-1.5">
      <label for="folder-desc-input" class="text-xs font-medium text-fg-muted">
        Description
      </label>
      <textarea
        id="folder-desc-input"
        bind:value={description}
        rows={3}
        placeholder="Enter description"
        class="w-full resize-y rounded-lg border border-line bg-bg-inset px-3 py-2 text-sm text-fg placeholder:text-fg-subtle focus:border-accent focus:outline-none transition-colors min-h-20"
      ></textarea>
    </div>
  </form>

  {#snippet footer()}
    <Button variant="ghost" outline onclick={onclose} disabled={isSaving}>
      Cancel
    </Button>
    <Button
      variant="accent"
      onclick={() => handleSubmit()}
      disabled={!name.trim() || isSaving}
    >
      {isSaving ? "Saving..." : "Save"}
    </Button>
  {/snippet}
</Modal>
