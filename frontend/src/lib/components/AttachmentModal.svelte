<script lang="ts">
  import { chatStore } from "../stores/chat.svelte";
  import { serveUploadUrl, fetchUploadText, triggerDownload } from "../api";
  import { X, Download, FileText, ExternalLink } from "@lucide/svelte";
  import { fade, scale } from "svelte/transition";
  import hljs from "highlight.js";

  let attachment = $derived(chatStore.selectedAttachment);

  let textContent = $state<string | null>(null);
  let highlightedHtml = $state<string | null>(null);
  let isLoadingText = $state(false);
  let isBinary = $state(false);
  let showExtractedPdfText = $state(false);
  let downloadError = $state<string | null>(null);

  let isPdf = $derived(
    Boolean(
      attachment &&
        (attachment.mimeType === "application/pdf" ||
          attachment.originalName.toLowerCase().endsWith(".pdf")),
    ),
  );

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
      ".json",
      ".json5",
      ".css",
      ".scss",
      ".sass",
      ".less",
      ".html",
      ".htm",
      ".xml",
      ".svg",
      ".py",
      ".rb",
      ".php",
      ".java",
      ".c",
      ".cpp",
      ".h",
      ".hpp",
      ".cs",
      ".go",
      ".rs",
      ".swift",
      ".kt",
      ".kts",
      ".sh",
      ".bash",
      ".zsh",
      ".fish",
      ".ps1",
      ".sql",
      ".yaml",
      ".yml",
      ".toml",
      ".ini",
      ".env",
      ".md",
      ".markdown",
      ".dockerfile",
      "dockerfile",
      ".gitignore",
    ];
    return codeExts.some((ext) => lower.endsWith(ext));
  }

  function isMediaAttachment(att: any): boolean {
    return att.mimeType.startsWith("image/") || att.mimeType.startsWith("video/") || att.mimeType.startsWith("audio/");
  }

  $effect(() => {
    const att = chatStore.selectedAttachment;
    showExtractedPdfText = false;
    if (!att || isMediaAttachment(att)) {
      textContent = null;
      highlightedHtml = null;
      isLoadingText = false;
      isBinary = false;
      return;
    }

    // Fetch extracted text / binary status for non-media files
    isLoadingText = true;
    isBinary = false;

    fetchUploadText(att.id)
      .then((res) => {
        isBinary = Boolean(res.isBinary);
        textContent = res.text;
        if (res.text && isCodeFile(att.originalName) && res.text.length < 100_000) {
          try {
            const hl = hljs.highlightAuto(res.text);
            highlightedHtml = hl.value;
          } catch (e) {
            highlightedHtml = null;
          }
        } else {
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

{#if attachment}
  <!-- Backdrop -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div
    transition:fade={{ duration: 150 }}
    onclick={close}
    class="fixed inset-0 z-50 flex items-center justify-center bg-overlay backdrop-blur-sm p-4 sm:p-6"
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
          {#if isPdf && textContent}
            <button
              type="button"
              onclick={() => (showExtractedPdfText = !showExtractedPdfText)}
              class="rounded-lg border border-line bg-bg px-2.5 py-1.5 text-xs font-medium text-fg-muted hover:bg-bg-hover hover:text-fg transition-colors cursor-pointer"
            >
              {showExtractedPdfText ? "PDF Preview" : "Extracted Text"}
            </button>
          {/if}
          <button
            type="button"
            onclick={() => {
              downloadError = null;
              void triggerDownload(
                serveUploadUrl(attachment.id, true),
                attachment.originalName,
              ).catch((err) => {
                downloadError = `Failed to download file: ${(err as Error).message}`;
              });
            }}
            title="Download file"
            aria-label="Download file"
            class="flex h-8 w-8 items-center justify-center rounded-lg border border-line bg-bg text-fg-muted transition-colors hover:bg-bg-hover hover:text-fg cursor-pointer"
          >
            <Download size={14} />
          </button>
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
        {#if downloadError}
          <div class="mx-4 mt-3 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
            {downloadError}
          </div>
        {/if}
        <div class="w-full">
          {#if !isMediaAttachment(attachment)}
            {#if isPdf && !showExtractedPdfText}
              <iframe
                src={serveUploadUrl(attachment.id)}
                title={attachment.originalName}
                class="w-full h-[75vh] border-0 bg-bg-inset"
              ></iframe>
            {:else if isLoadingText}
              <div
                class="flex h-48 w-full items-center justify-center gap-2 text-xs text-fg-muted font-mono"
              >
                <span class="animate-spin text-accent text-base">⟳</span>
                Loading file contents…
              </div>
            {:else if highlightedHtml}
              <pre
                class="w-full p-5 overflow-x-auto text-xs font-mono leading-relaxed"><code
                  class="hljs bg-transparent">{@html highlightedHtml}</code
                ></pre>
            {:else if textContent !== null}
              <pre
                class="w-full p-5 overflow-x-auto text-xs font-mono leading-relaxed text-fg whitespace-pre-wrap">{textContent}</pre>
            {:else if isBinary}
              <div
                class="flex flex-col items-center justify-center gap-2 py-16 px-6 text-center text-xs text-fg-muted"
              >
                <FileText size={28} class="text-fg-subtle opacity-60" />
                <p class="font-medium text-fg">
                  Preview unavailable for this binary file
                </p>
                <p class="text-fg-subtle max-w-sm">
                  This file format cannot be displayed as plain text. Use the
                  Download button above to open it on your device.
                </p>
              </div>
            {/if}
          {:else if attachment.mimeType.startsWith("image/")}
            <div
              class="flex h-full w-full items-center justify-center min-h-[300px]"
            >
              <img
                src={serveUploadUrl(attachment.id)}
                alt={attachment.originalName}
                class="max-h-[75vh] max-w-full m-6 rounded-xl object-contain shadow-md border border-line"
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
                class="max-h-[75vh] max-w-full m-6 rounded-xl border border-line shadow-md"
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
