<script lang="ts">
  import {
    Copy,
    Pencil,
    Trash2,
    RotateCw,
    Play,
    Check,
    ChevronDown,
    Volume2,
    Square,
  } from "@lucide/svelte";
  import type { ChatMessage } from "../types";
  import { chatStore } from "../stores/chat.svelte";
  import { settingsStore } from "../stores/settings.svelte";
  import { copyToClipboard } from "../utils/clipboard";
  import { confirmStore } from "../stores/confirmStore.svelte";
  import { getCleanVisibleText } from "../utils/segmentParser";
  import { fetchModels, synthesizeSpeechAudio } from "../api";
  import { createQuery } from "@tanstack/svelte-query";

  interface Props {
    message: ChatMessage;
    isLast: boolean;
    onStartEdit: () => void;
  }
  const { message, isLast, onStartEdit }: Props = $props();

  let copied = $state(false);
  let showRegenModels = $state(false);
  let regenMenuEl: HTMLDivElement | undefined = $state();
  let isSpeaking = $state(false);
  let isLoadingTts = $state(false);
  let activeAudio: HTMLAudioElement | null = null;
  let activeAudioUrl: string | null = null;

  function stopSpeaking() {
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      try { window.speechSynthesis.cancel(); } catch { }
    }
    if (activeAudio) {
      try { activeAudio.pause(); } catch { }
      activeAudio = null;
    }
    if (activeAudioUrl) {
      URL.revokeObjectURL(activeAudioUrl);
      activeAudioUrl = null;
    }
    isSpeaking = false;
    isLoadingTts = false;
  }

  async function handleToggleSpeak() {
    if (isSpeaking || isLoadingTts) {
      stopSpeaking();
      return;
    }

    const cleanText = getCleanVisibleText(
      message.content,
      message.thinkingContent,
    ).trim();
    if (!cleanText) return;

    if (
      settingsStore.ttsProvider === "browser" &&
      typeof window !== "undefined" &&
      "speechSynthesis" in window
    ) {
      try {
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(cleanText);
        if (settingsStore.ttsVoice) {
          const matchVoice = window.speechSynthesis
            .getVoices()
            .find((v) => v.name.toLowerCase().includes(settingsStore.ttsVoice!.toLowerCase()));
          if (matchVoice) utterance.voice = matchVoice;
        }
        utterance.onend = () => {
          isSpeaking = false;
        };
        utterance.onerror = () => {
          isSpeaking = false;
        };
        isSpeaking = true;
        window.speechSynthesis.speak(utterance);
        return;
      } catch (err) {
        console.error("[TTS] Browser speechSynthesis failed:", err);
      }
    }

    isLoadingTts = true;
    try {
      const blob = await synthesizeSpeechAudio(cleanText);
      const url = URL.createObjectURL(blob);
      activeAudioUrl = url;
      const audio = new Audio(url);
      activeAudio = audio;
      audio.onended = () => stopSpeaking();
      audio.onerror = () => stopSpeaking();
      isLoadingTts = false;
      isSpeaking = true;
      await audio.play();
    } catch (err) {
      console.error("[TTS] Speech synthesis failed:", err);
      stopSpeaking();
    }
  }

  const modelsQuery = createQuery(() => ({
    queryKey: ["models"],
    queryFn: fetchModels,
    enabled: showRegenModels,
  }));

  let availableModels = $derived(
    (modelsQuery.data ?? []).filter(
      (m) => !m.isHidden && !m.isOffline && !m.isOrphaned,
    ),
  );

  $effect(() => {
    if (!showRegenModels) return;
    function handleOutsideClick(e: MouseEvent) {
      if (regenMenuEl && !regenMenuEl.contains(e.target as Node)) {
        showRegenModels = false;
      }
    }
    function handleKeydown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        showRegenModels = false;
      }
    }
    document.addEventListener("mousedown", handleOutsideClick);
    document.addEventListener("keydown", handleKeydown);
    return () => {
      document.removeEventListener("mousedown", handleOutsideClick);
      document.removeEventListener("keydown", handleKeydown);
    };
  });

  async function handleCopy() {
    try {
      const textToCopy =
        message.role === "assistant"
          ? getCleanVisibleText(message.content, message.thinkingContent)
          : message.content;
      await copyToClipboard(textToCopy);
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

  function handleRegenerate(modelId?: string) {
    showRegenModels = false;
    chatStore.regenerate(message.id, modelId);
  }

  function handleContinue() {
    chatStore.continueResponse(message.id);
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
    <div bind:this={regenMenuEl} class="relative flex items-center">
      <button
        type="button"
        onclick={() => handleRegenerate()}
        disabled={chatStore.isStreaming}
        aria-label="Regenerate response"
        title="Regenerate"
        class="flex h-5 w-5 items-center justify-center rounded-l-md text-fg-muted transition-colors cursor-pointer hover:bg-bg-hover hover:text-fg disabled:opacity-30 disabled:pointer-events-none"
      >
        <RotateCw size={13} />
      </button>
      <button
        type="button"
        onclick={() => (showRegenModels = !showRegenModels)}
        disabled={chatStore.isStreaming}
        aria-label="Regenerate with another model"
        aria-haspopup="listbox"
        aria-expanded={showRegenModels}
        title="Regenerate with model..."
        class="flex h-5 w-3.5 items-center justify-center rounded-r-md text-fg-subtle transition-colors cursor-pointer hover:bg-bg-hover hover:text-fg disabled:opacity-30 disabled:pointer-events-none"
      >
        <ChevronDown size={10} />
      </button>

      {#if showRegenModels}
        <div
          role="listbox"
          aria-label="Choose model to regenerate response"
          class="absolute bottom-full left-0 mb-1.5 z-30 min-w-44 max-h-56 overflow-y-auto rounded-lg border border-line bg-bg-elevated p-1 shadow-lg"
        >
          <div class="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-fg-subtle">
            Regenerate with
          </div>
          {#each availableModels as m (m.id)}
            <button
              type="button"
              role="option"
              aria-selected={m.id === (message.model || chatStore.selectedModel)}
              onclick={() => handleRegenerate(m.id)}
              class="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-xs text-fg hover:bg-bg-hover transition-colors cursor-pointer"
            >
              <span class="truncate">{m.name || m.id}</span>
              {#if m.id === (message.model || chatStore.selectedModel)}
                <Check size={11} class="shrink-0 text-accent" />
              {/if}
            </button>
          {:else}
            <div class="px-2 py-1.5 text-xs text-fg-subtle">
              No models available
            </div>
          {/each}
        </div>
      {/if}
    </div>
  {/if}

  <!-- Continue (Assistant messages) -->
  {#if message.role === "assistant"}
    <button
      type="button"
      onclick={handleContinue}
      disabled={chatStore.isStreaming}
      aria-label="Continue response"
      title={isLast ? "Continue Response" : "Continue Response in New Branch"}
      class="flex h-5 w-5 items-center justify-center rounded-md text-fg-muted transition-colors cursor-pointer hover:bg-bg-hover hover:text-fg disabled:opacity-30 disabled:pointer-events-none"
    >
      <Play size={13} />
    </button>

    <!-- Read Aloud (TTS) -->
    <button
      type="button"
      onclick={handleToggleSpeak}
      disabled={chatStore.isStreaming}
      aria-label={isSpeaking ? "Stop reading aloud" : "Read response aloud (TTS)"}
      title={isSpeaking ? "Stop reading aloud" : "Read Aloud (TTS)"}
      class="flex h-5 w-5 items-center justify-center rounded-md transition-colors cursor-pointer hover:bg-bg-hover disabled:opacity-30 disabled:pointer-events-none {isSpeaking
        ? 'text-accent'
        : 'text-fg-muted hover:text-fg'}"
    >
      {#if isLoadingTts}
        <span class="animate-spin text-[10px]">⟳</span>
      {:else if isSpeaking}
        <Square size={11} />
      {:else}
        <Volume2 size={13} />
      {/if}
    </button>
  {/if}

  <!-- Delete -->
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
</div>
