<script lang="ts">
  import Modal from "./Modal.svelte";
  import Button from "./Button.svelte";

  interface Props {
    isOpen: boolean;
    title?: string;
    label?: string;
    value?: string;
    placeholder?: string;
    confirmText?: string;
    cancelText?: string;
    onsubmit: (value: string) => void;
    onclose: () => void;
  }

  let {
    isOpen,
    title = "Edit Text",
    label,
    value = $bindable(""),
    placeholder = "",
    confirmText = "Save",
    cancelText = "Cancel",
    onsubmit,
    onclose,
  }: Props = $props();

  let inputEl = $state<HTMLInputElement | null>(null);

  $effect(() => {
    if (isOpen) {
      setTimeout(() => {
        inputEl?.focus();
        inputEl?.select();
      }, 50);
    }
  });

  function handleSubmit(e?: SubmitEvent | MouseEvent) {
    e?.preventDefault();
    onsubmit(value);
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Enter") {
      handleSubmit();
    }
  }
</script>

<Modal {isOpen} {title} {onclose}>
  <form onsubmit={handleSubmit} class="flex flex-col gap-3">
    {#if label}
      <label
        for="text-input-modal-field"
        class="text-xs font-medium text-fg-muted"
      >
        {label}
      </label>
    {/if}
    <input
      id="text-input-modal-field"
      bind:this={inputEl}
      type="text"
      bind:value
      {placeholder}
      onkeydown={handleKeydown}
      class="w-full rounded-lg border border-line bg-bg-inset px-3 py-2 text-xs text-fg placeholder:text-fg-subtle focus:border-accent focus:outline-none transition-colors"
    />
  </form>

  {#snippet footer()}
    <Button variant="ghost" outline onclick={onclose}>
      {cancelText}
    </Button>
    <Button variant="primary" onclick={() => handleSubmit()}>
      {confirmText}
    </Button>
  {/snippet}
</Modal>
