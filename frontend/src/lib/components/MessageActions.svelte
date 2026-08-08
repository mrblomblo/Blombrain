<script lang="ts">
  import { Copy, Pencil, Trash2, RotateCw, Play, Check } from "@lucide/svelte";
  import type { ChatMessage } from "../types";
  import { chatStore } from "../stores/chat.svelte";
  import { copyToClipboard } from "../utils/clipboard";
  import { confirmStore } from "../stores/confirmStore.svelte";

  interface Props {
    message: ChatMessage;
    isLast: boolean;
    onStartEdit: () => void;
  }
  const { message, isLast, onStartEdit }: Props = $props();

  let copied = $state(false);

  let canDelete = $derived.by(() => {
    if (message.role === "user") return true;
    // For assistant messages, only allow deletion if there are alternative branches
    const siblings = chatStore.messages.filter(
      (m) => m.parentId === message.parentId && m.role === "assistant",
    );
    return siblings.length >= 2;
  });

  async function handleCopy() {
    try {
      await copyToClipboard(message.content);
      copied = true;
      setTimeout(() => (copied = false), 2000);
    } catch (e) {
      console.error("Failed to copy text:", e);
    }
  }

  async function handleDelete() {
    if (
      await confirmStore.confirm({
        title: "Delete Message",
        message: "Are you sure you want to delete this message?",
        confirmText: "Delete",
        confirmStyle: "danger",
        cancelText: "Cancel",
        cancelStyle: "ghost",
        cancelOutline: true,
      })
    ) {
      chatStore.deleteMessage(message.id);
    }
  }

  function handleRegenerate() {
    chatStore.regenerate(message.id);
  }

  function handleContinue() {
    chatStore.continueResponse();
  }
</script>

<div
  class="flex items-center gap-0.5 rounded-md border border-line bg-bg-elevated/90 p-0.75 shadow-sm backdrop-blur-sm"
>
  <!-- Copy -->
  <button
    type="button"
    onclick={handleCopy}
    disabled={chatStore.isStreaming}
    aria-label="Copy text"
    title="Copy"
    class="flex h-5 w-5 items-center justify-center rounded-md text-fg-muted transition-colors cursor-pointer hover:bg-bg-hover hover:text-fg disabled:opacity-30 disabled:pointer-events-none"
  >
    {#if copied}
      <Check size={13} class="text-success" />
    {:else}
      <Copy size={13} />
    {/if}
  </button>

  <!-- Edit -->
  <button
    type="button"
    onclick={onStartEdit}
    disabled={chatStore.isStreaming}
    aria-label="Edit message"
    title="Edit"
    class="flex h-5 w-5 items-center justify-center rounded-md text-fg-muted transition-colors cursor-pointer hover:bg-bg-hover hover:text-fg disabled:opacity-30 disabled:pointer-events-none"
  >
    <Pencil size={13} />
  </button>

  <!-- Regenerate (Assistant only) -->
  {#if message.role === "assistant"}
    <button
      type="button"
      onclick={handleRegenerate}
      disabled={chatStore.isStreaming}
      aria-label="Regenerate response"
      title="Regenerate"
      class="flex h-5 w-5 items-center justify-center rounded-md text-fg-muted transition-colors cursor-pointer hover:bg-bg-hover hover:text-fg disabled:opacity-30 disabled:pointer-events-none"
    >
      <RotateCw size={13} />
    </button>
  {/if}

  <!-- Continue (Assistant & Last Message only) -->
  {#if message.role === "assistant" && isLast}
    <button
      type="button"
      onclick={handleContinue}
      disabled={chatStore.isStreaming}
      aria-label="Continue response"
      title="Continue Response"
      class="flex h-5 w-5 items-center justify-center rounded-md text-fg-muted transition-colors cursor-pointer hover:bg-bg-hover hover:text-fg disabled:opacity-30 disabled:pointer-events-none"
    >
      <Play size={13} />
    </button>
  {/if}

  <!-- Delete -->
  {#if canDelete}
    <button
      type="button"
      onclick={handleDelete}
      disabled={chatStore.isStreaming}
      aria-label="Delete message"
      title="Delete"
      class="flex h-5 w-5 items-center justify-center rounded-md text-fg-muted transition-colors cursor-pointer hover:bg-bg-hover hover:text-danger disabled:opacity-30 disabled:pointer-events-none"
    >
      <Trash2 size={13} />
    </button>
  {/if}
</div>
