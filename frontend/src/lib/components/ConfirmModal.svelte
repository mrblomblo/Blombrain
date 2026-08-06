<script lang="ts">
  import { confirmStore, type ButtonStyle } from "../stores/confirmStore.svelte";
  import Button from "./ui/Button.svelte";
  import type { ButtonVariant } from "./ui/Button.svelte";
  import Modal from "./ui/Modal.svelte";

  function getButtonProps(
    style: ButtonStyle = "default",
    explicitOutline?: boolean,
    defaultOutline = false,
  ): {
    variant: ButtonVariant;
    outline: boolean;
  } {
    if (explicitOutline !== undefined) {
      const variant = style === "outline" ? "default" : style;
      return { variant, outline: explicitOutline };
    }
    if (style === "outline") {
      return { variant: "default", outline: true };
    }
    return { variant: style, outline: defaultOutline };
  }
</script>

<Modal
  isOpen={confirmStore.isOpen}
  title={confirmStore.options.title}
  onclose={() => confirmStore.handleResolve(false)}
>
  <p class="text-sm text-fg-muted leading-relaxed">
    {confirmStore.options.message}
  </p>

  {#snippet footer()}
    <Button
      {...getButtonProps(
        confirmStore.options.cancelStyle || "ghost",
        confirmStore.options.cancelOutline,
        false,
      )}
      onclick={() => confirmStore.handleResolve(false)}
    >
      {confirmStore.options.cancelText || "Cancel"}
    </Button>
    <Button
      {...getButtonProps(
        confirmStore.options.confirmStyle || "default",
        confirmStore.options.confirmOutline,
        false,
      )}
      onclick={() => confirmStore.handleResolve(true)}
    >
      {confirmStore.options.confirmText || "Confirm"}
    </Button>
  {/snippet}
</Modal>
