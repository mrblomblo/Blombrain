<script lang="ts">
  import { chatStore } from "../stores/chat.svelte";
  import { themeStore } from "../theme.svelte";
  import { serveUploadUrl } from "../api";
  import { X, Download, FileText, ExternalLink } from "@lucide/svelte";
  import { fade, scale } from "svelte/transition";
  import hljs from "highlight.js";
  import githubDarkCss from "highlight.js/styles/github-dark.css?raw";
  import githubLightCss from "highlight.js/styles/github.css?raw";

  let attachment = $derived(chatStore.selectedAttachment);

  let textContent = $state<string | null>(null);
  let highlightedHtml = $state<string | null>(null);
  let isLoadingText = $state(false);

  function isCodeFile(filename: string): boolean {
    const lower = filename.toLowerCase();
    const codeExts = [
      ".ts",
      ".tsx",
      ".mts",
      ".cts",
      ".svelte",
      ".vue",
      ".js",
      ".jsx",
      ".mjs",
      ".cjs",
      ".py",
      ".rs",
      ".go",
      ".c",
      ".cpp",
      ".h",
      ".hpp",
      ".cs",
      ".java",
      ".kt",
      ".rb",
      ".php",
      ".sh",
      ".bash",
      ".zsh",
      ".json",
      ".toml",
      ".yaml",
      ".yml",
      ".md",
      ".css",
      ".scss",
      ".html",
      ".xml",
      ".sql",
    ];
    return codeExts.some((ext) => lower.endsWith(ext));
  }

  function isMediaAttachment(att: typeof attachment): boolean {
    if (!att) return false;
    if (isCodeFile(att.originalName)) return false;
    return (
      att.mimeType.startsWith("image/") ||
      att.mimeType.startsWith("video/") ||
      att.mimeType.startsWith("audio/")
    );
  }

  $effect(() => {
    const att = chatStore.selectedAttachment;
    if (!att || isMediaAttachment(att)) {
      textContent = null;
      highlightedHtml = null;
      isLoadingText = false;
      return;
    }

    // Fetch text for non-media files
    isLoadingText = true;
    const url = serveUploadUrl(att.id);

    fetch(url)
      .then((res) => res.text())
      .then((text) => {
        textContent = text;
        try {
          const res = hljs.highlightAuto(text);
          highlightedHtml = res.value;
        } catch (e) {
          highlightedHtml = null;
        }
      })
      .catch((err) => {
        console.error("[AttachmentModal] failed to fetch text:", err);
        textContent = "Failed to load attachment content.";
        highlightedHtml = null;
      })
      .finally(() => {
        isLoadingText = false;
      });
  });

  function close() {
    chatStore.selectedAttachment = null;
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      close();
    }
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<svelte:head>
  {@html `<style id="hljs-dynamic-theme">${themeStore.isDark ? githubDarkCss : githubLightCss}</style>`}
</svelte:head>

{#if attachment}
  <!-- Backdrop -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div
    transition:fade={{ duration: 150 }}
    onclick={close}
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 sm:p-6"
  >
    <!-- Modal Card -->
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      transition:scale={{ start: 0.95, duration: 150 }}
      onclick={(e) => e.stopPropagation()}
      class="relative flex flex-col w-full max-w-4xl max-h-[90vh] rounded-2xl border border-line bg-bg shadow-2xl overflow-hidden"
    >
      <!-- Header -->
      <div
        class="flex items-center justify-between border-b border-line px-5 py-3.5 bg-bg-elevated/80 shrink-0"
      >
        <div class="flex items-center gap-3 min-w-0">
          <div
            class="flex h-8 w-8 items-center justify-center rounded-lg border border-line bg-bg text-fg-muted shrink-0"
          >
            <FileText size={16} />
          </div>
          <div class="min-w-0">
            <h3 class="text-sm font-semibold text-fg truncate">
              {attachment.originalName}
            </h3>
            <p class="text-[11px] font-mono text-fg-subtle">
              {attachment.mimeType} • {(attachment.sizeBytes / 1024).toFixed(1)}
              KB
            </p>
          </div>
        </div>

        <div class="flex items-center gap-2">
          <a
            href={serveUploadUrl(attachment.id)}
            target="_blank"
            download={attachment.originalName}
            title="Download file"
            class="flex h-8 w-8 items-center justify-center rounded-lg border border-line bg-bg text-fg-muted transition-colors hover:bg-bg-hover hover:text-fg"
          >
            <Download size={14} />
          </a>
          <a
            href={serveUploadUrl(attachment.id)}
            target="_blank"
            rel="noopener noreferrer"
            title="Open raw file in new tab"
            class="flex h-8 w-8 items-center justify-center rounded-lg border border-line bg-bg text-fg-muted transition-colors hover:bg-bg-hover hover:text-fg"
          >
            <ExternalLink size={14} />
          </a>
          <button
            type="button"
            onclick={close}
            aria-label="Close modal"
            class="flex h-8 w-8 items-center justify-center rounded-lg border border-line bg-bg text-fg-muted transition-colors hover:bg-bg-hover hover:text-fg"
          >
            <X size={16} />
          </button>
        </div>
      </div>

      <!-- Body Content -->
      <div class="modal-body flex-1 overflow-auto bg-bg">
        <div class="p-6 w-full">
          {#if !isMediaAttachment(attachment)}
            {#if isLoadingText}
              <div
                class="flex h-48 w-full items-center justify-center gap-2 text-xs text-fg-muted font-mono"
              >
                <span class="animate-spin text-accent text-base">⟳</span>
                Loading file contents…
              </div>
            {:else if highlightedHtml}
              <pre
                class="w-full rounded-xl border border-line bg-bg-elevated p-4 overflow-x-auto text-xs font-mono leading-relaxed shadow-sm"><code
                  class="hljs bg-transparent p-0 rounded-sm"
                  >{@html highlightedHtml}</code
                ></pre>
            {:else if textContent !== null}
              <pre
                class="w-full rounded-xl border border-line bg-bg-elevated p-4 overflow-x-auto text-xs font-mono leading-relaxed text-fg whitespace-pre-wrap shadow-sm">{textContent}</pre>
            {/if}
          {:else if attachment.mimeType.startsWith("image/")}
            <div
              class="flex h-full w-full items-center justify-center min-h-[300px]"
            >
              <img
                src={serveUploadUrl(attachment.id)}
                alt={attachment.originalName}
                class="max-h-[75vh] max-w-full rounded-xl object-contain shadow-md border border-line"
              />
            </div>
          {:else if attachment.mimeType.startsWith("video/")}
            <div
              class="flex h-full w-full items-center justify-center min-h-[300px]"
            >
              <!-- svelte-ignore a11y_media_has_caption -->
              <video
                controls
                src={serveUploadUrl(attachment.id)}
                class="max-h-[75vh] max-w-full rounded-xl border border-line shadow-md"
              ></video>
            </div>
          {:else if attachment.mimeType.startsWith("audio/")}
            <div
              class="flex h-full w-full flex-col items-center justify-center gap-4 min-h-[200px] py-12"
            >
              <audio
                controls
                src={serveUploadUrl(attachment.id)}
                class="w-full max-w-md"
              ></audio>
            </div>
          {/if}
        </div>
      </div>
    </div>
  </div>
{/if}

<style>
  .modal-body {
    scrollbar-width: thin;
    scrollbar-color: var(--line-strong) transparent;
  }
  .modal-body::-webkit-scrollbar {
    width: 6px;
    height: 6px;
  }
  .modal-body::-webkit-scrollbar-track {
    background: transparent;
  }
  .modal-body::-webkit-scrollbar-thumb {
    background: var(--line-strong);
    border-radius: 9999px;
  }
</style>
