<script lang="ts">
  import { artifactStore } from "../stores/artifact.svelte";
  import { themeStore } from "../theme.svelte";
  import { copyToClipboard } from "../utils/clipboard";
  import hljs from "highlight.js";
  import { fly, slide } from "svelte/transition";
  import {
    X,
    Code,
    Eye,
    Copy,
    Check,
    Maximize2,
    Minimize2,
    ChevronDown,
    Download,
    Globe,
    Trash2,
  } from "@lucide/svelte";
  import Markdown from "./Markdown.svelte";
  import ToggleSwitch from "./ui/ToggleSwitch.svelte";
  import Dropdown from "./ui/Dropdown.svelte";
  import WindowControls from "./WindowControls.svelte";
  import { confirmStore } from "../stores/confirmStore.svelte";
  import { desktopWindow } from "../stores/window.svelte";
  import { saveBytesDownload } from "../api";

  let viewMode = $state<"preview" | "code">("preview");
  let copied = $state(false);
  let copyTimer: ReturnType<typeof setTimeout> | null = null;
  let showDownloadMenu = $state(false);

  let debouncedCode = $state(artifactStore.code);

  let isIframeArtifact = $derived(
    artifactStore.language !== "markdown" && artifactStore.language !== "md",
  );

  let isCurrentArtifactGenerating = $derived(
    isIframeArtifact &&
      artifactStore.generatingArtifactId !== null &&
      artifactStore.generatingArtifactId === artifactStore.activeId,
  );

  let showPreviewReadyBanner = $state(false);
  let bannerTimer: ReturnType<typeof setTimeout> | null = null;
  let wasCurrentGenerating = false;

  $effect(() => {
    const isGen = isCurrentArtifactGenerating;
    if (isGen) {
      if (viewMode === "preview") {
        viewMode = "code";
      }
      showPreviewReadyBanner = false;
      if (bannerTimer) clearTimeout(bannerTimer);
    } else if (wasCurrentGenerating && !isGen) {
      // Just completed generating current artifact
      showPreviewReadyBanner = true;
      if (bannerTimer) clearTimeout(bannerTimer);
      bannerTimer = setTimeout(() => {
        showPreviewReadyBanner = false;
      }, 5000);
    }
    wasCurrentGenerating = isGen;
  });

  $effect(() => {
    const currentCode = artifactStore.code;
    const timer = setTimeout(() => {
      debouncedCode = currentCode;
    }, 300);

    return () => clearTimeout(timer);
  });

  let srcDoc = $derived.by(() => {
    const code = debouncedCode;
    const CSP_META = artifactStore.networkAccess
      ? `<meta http-equiv="Content-Security-Policy" content="default-src * 'unsafe-inline' 'unsafe-eval' data: blob:; script-src * 'unsafe-inline' 'unsafe-eval' data: blob:; style-src * 'unsafe-inline' data: blob:; img-src * data: blob:; font-src * data: blob:; connect-src * data: blob:; base-uri 'none'; form-action 'none';">`
      : `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: https:; font-src data: https:; connect-src 'none'; base-uri 'none'; form-action 'none';">`;
    const INTERCEPTOR_SCRIPT = `<script>
document.addEventListener('click', function(e) {
  const a = e.target.closest('a');
  if (!a) return;
  const href = a.getAttribute('href');
  if (!href) return;
  e.preventDefault();
  if (href.startsWith('#')) {
    const id = href.substring(1);
    if (!id) return;
    const target = document.getElementById(id) || document.getElementsByName(id)[0];
    if (target) {
      target.scrollIntoView({ behavior: 'smooth' });
    }
  }
});
document.addEventListener('submit', function(e) {
  e.preventDefault();
});
<\/script>`;
    const HEAD_INJECTIONS = `${CSP_META}\n${INTERCEPTOR_SCRIPT}`;

    if (artifactStore.language === "svg") {
      themeStore.current;
      let bgColor = "#161210";
      let fgColor = "#ede0d0";
      if (typeof document !== "undefined") {
        const rootStyle = getComputedStyle(document.documentElement);
        bgColor = rootStyle.getPropertyValue("--bg").trim() || bgColor;
        fgColor = rootStyle.getPropertyValue("--fg").trim() || fgColor;
      }
      return `<!DOCTYPE html><html><head><meta charset="utf-8"/>${HEAD_INJECTIONS}<style>body{margin:0;padding:24px;display:flex;align-items:center;justify-content:center;min-height:100vh;background-color:${bgColor};color:${fgColor};box-sizing:border-box;}svg{max-width:100%;height:auto;}</style></head><body>${code}</body></html>`;
    }

    if (/<head[^>]*>/i.test(code)) {
      return code.replace(/(<head[^>]*>)/i, `$1\n${HEAD_INJECTIONS}\n`);
    }

    if (/<html[^>]*>/i.test(code)) {
      return code.replace(
        /(<html[^>]*>)/i,
        `$1\n<head>\n${HEAD_INJECTIONS}\n</head>\n`,
      );
    }

    if (/<!doctype[^>]*>/i.test(code)) {
      return code.replace(
        /(<!doctype[^>]*>)/i,
        `$1\n<head>\n${HEAD_INJECTIONS}\n</head>\n`,
      );
    }

    return `<!DOCTYPE html>\n<html>\n<head>\n${HEAD_INJECTIONS}\n</head>\n<body>\n${code}\n</body>\n</html>`;
  });

  let highlightedCode = $derived.by(() => {
    const lang = artifactStore.language || "text";
    const validLang = hljs.getLanguage(lang) ? lang : "";
    if (validLang) {
      return hljs.highlight(artifactStore.code, { language: validLang }).value;
    }
    return hljs.highlightAuto(artifactStore.code).value;
  });

  function preserveLeadingIndent(htmlLine: string): string {
    let result = "";
    let i = 0;
    let inTag = false;

    while (i < htmlLine.length) {
      const char = htmlLine[i];
      if (char === "<") {
        inTag = true;
        result += char;
        i++;
      } else if (char === ">") {
        inTag = false;
        result += char;
        i++;
      } else if (inTag) {
        result += char;
        i++;
      } else if (char === " ") {
        result += "&nbsp;";
        i++;
      } else if (char === "\t") {
        result += "&nbsp;&nbsp;&nbsp;&nbsp;";
        i++;
      } else {
        result += htmlLine.slice(i);
        break;
      }
    }

    return result;
  }

  let formattedCodeLines = $derived.by(() => {
    const rawHtml = highlightedCode;
    const lines = rawHtml.split("\n");
    const openTags: string[] = [];

    return lines.map((line) => {
      const prepended = openTags.join("");
      const tagRegex = /<\/?span[^>]*>/g;
      let match: RegExpExecArray | null;
      while ((match = tagRegex.exec(line)) !== null) {
        if (match[0].startsWith("</")) {
          openTags.pop();
        } else {
          openTags.push(match[0]);
        }
      }
      const appended = openTags.map(() => "</span>").join("");
      const lineWithTags = `${prepended}${line}${appended}`;
      return preserveLeadingIndent(lineWithTags);
    });
  });

  async function handleCopy() {
    if (!artifactStore.code) return;

    const success = await copyToClipboard(artifactStore.code);
    if (success) {
      copied = true;
      if (copyTimer) clearTimeout(copyTimer);
      copyTimer = setTimeout(() => {
        copied = false;
      }, 2000);
    }
  }

  async function handleDownload() {
    if (!artifactStore.code) return;
    let ext = artifactStore.language;
    if (ext === "markdown") ext = "md";

    if (
      ![
        "html",
        "svg",
        "md",
        "txt",
        "js",
        "json",
        "ts",
        "css",
        "py",
        "jsx",
        "tsx",
      ].includes(ext)
    ) {
      ext = "txt";
    }

    // Use the actual filename if available, otherwise fallback to title
    const baseName = artifactStore.filename
      ? artifactStore.filename.replace(/\.[^/.]+$/, "")
      : artifactStore.title.replace(/[^a-z0-9]/gi, "_").toLowerCase() ||
        "artifact";

    const filename = `${baseName}.${ext}`;
    showDownloadMenu = false;

    try {
      await saveBytesDownload(
        new TextEncoder().encode(artifactStore.code),
        filename,
        "text/plain;charset=utf-8",
      );
    } catch (err) {
      console.error("Failed to download artifact:", err);
    }
  }
</script>

<div
  class="flex h-full w-full flex-col bg-bg {artifactStore.isExpanded
    ? ''
    : 'border-l border-line'} shadow-xl overflow-hidden"
>
  <!-- Top Bar / Header matching Chat header height and padding -->
  <div
    data-tauri-drag-region={desktopWindow.isTauri ? "deep" : undefined}
    class="@container flex h-14 shrink-0 items-center justify-between gap-2 border-b border-line bg-bg-elevated px-2.5 z-30"
  >
    <!-- Title & Language / Switcher -->
    <div class="flex items-center gap-2 min-w-0 flex-1">
      <span
        class="hidden @[340px]:inline-block shrink-0 text-[11px] font-mono font-bold uppercase px-1.5 py-0.5 rounded bg-bg-inset border border-line text-accent"
      >
        {artifactStore.language === "markdown" ? "md" : artifactStore.language}
      </span>
      {#if artifactStore.conversationArtifacts.length > 1}
        <div
          class="min-w-0 flex-1 max-w-60"
          data-tauri-drag-region={desktopWindow.isTauri ? "false" : undefined}
        >
          <Dropdown
            value={artifactStore.activeId ?? undefined}
            options={artifactStore.conversationArtifacts.map((a) => ({
              label: `${a.title || a.filename} (${a.language})`,
              value: a.id,
            }))}
            onchange={(id) => {
              const target = artifactStore.conversationArtifacts.find((a) => a.id === id);
              if (target) {
                artifactStore.loadArtifact(
                  target.id,
                  target.conversationId,
                  target.filename,
                  target.title,
                  target.language,
                );
              }
            }}
          />
        </div>
      {:else}
        <h3 class="text-sm font-semibold text-fg truncate min-w-0">
          {artifactStore.title}
        </h3>
      {/if}
    </div>

    <!-- Toggle View Mode Switcher -->
    <div
      class="flex items-center h-8 shrink-0 rounded-lg border border-line bg-bg-inset p-0.5 shadow-xs"
    >
      <button
        type="button"
        disabled={isCurrentArtifactGenerating}
        onclick={() => (viewMode = "preview")}
        title={isCurrentArtifactGenerating
          ? "Preview is unavailable while artifact is generating"
          : "Switch to Preview"}
        class="flex items-center justify-center gap-1.5 h-full rounded-md px-2 @[480px]:px-2.5 text-xs font-medium transition-all {isCurrentArtifactGenerating
          ? 'opacity-40 cursor-not-allowed text-fg-muted'
          : viewMode === 'preview'
            ? 'bg-bg-elevated text-fg shadow-xs font-semibold'
            : 'text-fg-muted hover:text-fg'}"
      >
        <Eye size={13} />
        <span class="hidden @[480px]:inline">Preview</span>
      </button>
      <button
        type="button"
        onclick={() => (viewMode = "code")}
        title="View Code"
        aria-label="View Code"
        class="flex items-center justify-center gap-1.5 h-full rounded-md px-2 @[480px]:px-2.5 text-xs font-medium transition-all {viewMode ===
        'code'
          ? 'bg-bg-elevated text-fg shadow-xs font-semibold'
          : 'text-fg-muted hover:text-fg'}"
      >
        <Code size={13} />
        <span class="hidden @[480px]:inline">Code</span>
      </button>
    </div>

    <!-- Action Buttons -->
    <div class="flex items-center gap-1.5 shrink-0">
      <!-- Copy / Download Split Button -->
      <div
        class="relative flex items-center h-8 rounded-lg border border-line bg-bg-inset shadow-xs"
      >
        <button
          type="button"
          onclick={handleCopy}
          aria-label="Copy artifact code"
          title="Copy code"
          class="flex items-center gap-1.5 h-full px-2 @[380px]:px-2.5 text-xs font-medium text-fg-muted hover:text-fg hover:bg-bg-hover transition-colors rounded-l-lg border-r border-line"
        >
          {#if copied}
            <Check class="w-3.5 h-3.5 text-success" />
            <span class="hidden @[380px]:inline text-success">Copied</span>
          {:else}
            <Copy class="w-3.5 h-3.5" />
            <span class="hidden @[380px]:inline">Copy</span>
          {/if}
        </button>
        <button
          type="button"
          onclick={() => (showDownloadMenu = !showDownloadMenu)}
          aria-label="More options"
          title="More options"
          class="flex items-center justify-center h-full px-1.5 text-fg-muted hover:text-fg hover:bg-bg-hover transition-colors rounded-r-lg"
        >
          <ChevronDown
            size={14}
            class="shrink-0 transition-transform duration-200 {showDownloadMenu
              ? 'rotate-180'
              : ''}"
          />
        </button>

        {#if showDownloadMenu}
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <div
            data-tauri-drag-region={desktopWindow.isTauri ? "false" : undefined}
            class="fixed inset-0 z-40"
            onclick={() => (showDownloadMenu = false)}
          ></div>
          <div
            data-tauri-drag-region={desktopWindow.isTauri ? "false" : undefined}
            transition:fly={{ y: -6, duration: 150 }}
            class="absolute right-0 top-full mt-1 z-50 min-w-44 rounded-lg border border-line bg-bg-elevated p-1 shadow-xl overflow-hidden"
          >
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div
              onclick={() => {
                artifactStore.networkAccess = !artifactStore.networkAccess;
              }}
              class="flex w-full items-center justify-between gap-3 rounded-md px-2.5 py-1.5 text-left text-xs font-medium text-fg hover:bg-bg-hover transition-colors cursor-pointer select-none"
            >
              <div class="flex items-center gap-2">
                <Globe
                  size={14}
                  class={artifactStore.networkAccess
                    ? "text-accent"
                    : "text-fg-muted"}
                />
                <span>Network</span>
              </div>
              <ToggleSwitch
                id="artifact-network-access-toggle"
                checked={artifactStore.networkAccess}
                class="pointer-events-none"
                label="Toggle Network Access"
              />
            </div>
            <div class="h-px bg-line my-1"></div>
            <button
              type="button"
              onclick={handleDownload}
              class="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-xs font-medium text-fg hover:bg-bg-hover transition-colors cursor-pointer"
            >
              <Download size={14} class="text-fg-muted" />
              <span>Download</span>
            </button>
            {#if artifactStore.activeId}
              <button
                type="button"
                onclick={async () => {
                  showDownloadMenu = false;
                  if (!artifactStore.activeId) return;
                  const confirmed = await confirmStore.confirm({
                    title: "Delete Artifact",
                    message: `Are you sure you want to delete "${artifactStore.title || artifactStore.filename}"?`,
                    confirmText: "Delete",
                    confirmStyle: "danger",
                    cancelText: "Cancel",
                    cancelStyle: "ghost",
                    cancelOutline: true,
                  });
                  if (confirmed && artifactStore.activeId) {
                    await artifactStore.removeArtifact(artifactStore.activeId);
                  }
                }}
                class="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-xs font-medium text-danger hover:bg-bg-hover transition-colors cursor-pointer"
              >
                <Trash2 size={14} />
                <span>Delete Artifact</span>
              </button>
            {/if}
          </div>
        {/if}
      </div>

      <button
        type="button"
        onclick={() => artifactStore.toggleExpand()}
        aria-label={artifactStore.isExpanded
          ? "Collapse artifact panel"
          : "Expand artifact panel"}
        title={artifactStore.isExpanded ? "Collapse" : "Expand"}
        class="hidden @[420px]:flex h-8 w-8 items-center justify-center rounded-lg text-fg-muted hover:bg-bg-hover hover:text-fg transition-colors cursor-pointer"
      >
        {#if artifactStore.isExpanded}
          <Minimize2 size={15} />
        {:else}
          <Maximize2 size={15} />
        {/if}
      </button>

      <button
        type="button"
        onclick={() => artifactStore.close()}
        aria-label="Close artifact panel"
        title="Close side panel"
        class="flex h-8 w-8 items-center justify-center rounded-lg text-fg-muted hover:bg-bg-hover hover:text-fg transition-colors cursor-pointer"
      >
        <X size={16} />
      </button>

      <WindowControls />
    </div>
  </div>

  <!-- Full-width Preview Banner -->
  {#if showPreviewReadyBanner && viewMode === "code"}
    <div
      transition:slide={{ duration: 180 }}
      class="w-full flex items-center justify-between border-b border-accent/30 bg-accent/10 px-4 py-2 text-xs shrink-0 select-none z-30"
    >
      <div class="flex items-center gap-2 min-w-0">
        <Eye size={14} class="text-accent shrink-0" />
        <span class="text-fg font-medium truncate"
          >Preview is now available</span
        >
      </div>
      <div class="flex items-center gap-2 shrink-0">
        <button
          type="button"
          onclick={() => {
            viewMode = "preview";
            showPreviewReadyBanner = false;
          }}
          class="rounded-md px-2.5 py-1 text-xs font-semibold bg-accent text-accent-fg hover:opacity-90 transition-opacity cursor-pointer shadow-xs"
        >
          View Preview
        </button>
        <button
          type="button"
          onclick={() => (showPreviewReadyBanner = false)}
          class="text-fg-muted hover:text-fg p-1 rounded-md hover:bg-bg-hover transition-colors cursor-pointer"
          aria-label="Dismiss notification"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  {/if}

  <!-- Content Pane -->
  <div class="relative flex-1 w-full h-full overflow-hidden bg-bg">
    {#if viewMode === "preview"}
      {#if artifactStore.language === "markdown" || artifactStore.language === "md"}
        <div class="h-full w-full overflow-auto bg-bg text-fg">
          <div class="p-6">
            <Markdown content={debouncedCode} isArtifactPreview={true} />
          </div>
        </div>
      {:else}
        <iframe
          title={artifactStore.title}
          srcdoc={srcDoc}
          sandbox="allow-scripts allow-forms"
          class="h-full w-full border-0 bg-bg"
        ></iframe>
      {/if}
    {:else}
      <div
        class="h-full w-full overflow-auto py-4 bg-bg-elevated font-mono text-xs leading-relaxed"
      >
        {#each formattedCodeLines as line, i}
          <div class="flex w-full min-w-full hover:bg-bg-hover/50">
            <span
              class="shrink-0 text-right pr-2 mr-3.5 border-r border-line/50 text-fg-muted/40 select-none w-12 font-mono text-[11px] py-0.5"
              >{i + 1}</span
            >
            <span
              class="flex-1 min-w-0 whitespace-pre-wrap wrap-anywhere pr-4 text-fg font-mono py-0.5"
              >{@html line || " "}</span
            >
          </div>
        {/each}
      </div>
    {/if}
  </div>
</div>
