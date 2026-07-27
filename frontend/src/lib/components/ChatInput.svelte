<script lang="ts">
  import { Send, Square } from "@lucide/svelte";
  import { chatStore } from "../stores/chat.svelte";
  import Button from "./ui/Button.svelte";

  let draft = $state("");
  let textarea: HTMLTextAreaElement | undefined = $state();

  function autosize() {
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 240)}px`;
  }

  async function handleSend() {
    if (!draft.trim() || chatStore.isStreaming) return;
    const toSend = draft;
    draft = "";
    autosize();
    await chatStore.send(toSend);
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }
</script>

<div class="border-t border-line bg-bg px-6 py-4">
  <div class="mx-auto flex max-w-3xl items-end gap-2">
    <textarea
      bind:this={textarea}
      bind:value={draft}
      oninput={autosize}
      onkeydown={handleKeydown}
      rows="1"
      placeholder="Message Blombrain…"
      class="max-h-60 flex-1 resize-none rounded-md border border-line bg-bg-elevated px-3 py-2.5 text-sm text-fg outline-none placeholder:text-fg-subtle focus-visible:outline-2 focus-visible:outline-accent"
    ></textarea>

    {#if chatStore.isStreaming}
      <Button variant="danger" onclick={() => chatStore.stop()} aria-label="Stop generating">
        <Square size={14} />
        Stop
      </Button>
    {:else}
      <Button variant="primary" onclick={handleSend} disabled={!draft.trim()} aria-label="Send message">
        <Send size={14} />
        Send
      </Button>
    {/if}
  </div>
</div>
