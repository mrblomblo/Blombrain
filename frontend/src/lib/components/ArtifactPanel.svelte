<script lang="ts">
  import { artifactStore } from "../stores/artifact.svelte";
  import hljs from "highlight.js";
  import { fly } from "svelte/transition";
  import {
    X,
    Code,
    Eye,
    Copy,
    Check,
    Maximize2,
    Minimize2,
    ChevronDown,
    ChevronUp,
    Download,
  } from "@lucide/svelte";
  import Markdown from "./Markdown.svelte";

  let viewMode = $state<"preview" | "code">("preview");
  let copied = $state(false);
  let copyTimer: ReturnType<typeof setTimeout> | null = null;
  let showDownloadMenu = $state(false);

  let debouncedCode = $state(artifactStore.code);
  let timeoutRunning = false;

  $effect(() => {
    const currentCode = artifactStore.code;
    if (!timeoutRunning && debouncedCode !== currentCode) {
      timeoutRunning = true;
      debouncedCode = currentCode;
      setTimeout(() => {
        debouncedCode = artifactStore.code;
        timeoutRunning = false;
      }, 300);
    }
  });

  let srcDoc = $derived.by(() => {
    const code = debouncedCode;
    const CSP_META = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: https:; font-src data: https:; connect-src 'none'; base-uri 'none'; form-action 'none';">`;
    
    if (artifactStore.language === "svg") {
      return `<!DOCTYPE html><html><head><meta charset="utf-8"/>${CSP_META}<style>body{margin:0;padding:24px;display:flex;align-items:center;justify-content:center;min-height:100vh;background-color:#0d0f12;color:#e1e7ec;box-sizing:border-box;}svg{max-width:100%;height:auto;}</style></head><body>${code}</body></html>`;
    }
    
    if (/<head[^>]*>/i.test(code)) {
      return code.replace(/(<head[^>]*>)/i, `$1\n${CSP_META}\n`);
    }
    
    if (/<html[^>]*>/i.test(code)) {
      return code.replace(/(<html[^>]*>)/i, `$1\n<head>\n${CSP_META}\n</head>\n`);
    }
    
    if (/<!doctype[^>]*>/i.test(code)) {
      return code.replace(/(<!doctype[^>]*>)/i, `$1\n<head>\n${CSP_META}\n</head>\n`);
    }
    
    return `<!DOCTYPE html>\n<html>\n<head>\n${CSP_META}\n</head>\n<body>\n${code}\n</body>\n</html>`;
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

  function handleCopy() {
    if (!artifactStore.code) return;
    navigator.clipboard.writeText(artifactStore.code).then(() => {
      copied = true;
      if (copyTimer) clearTimeout(copyTimer);
      copyTimer = setTimeout(() => {
        copied = false;
      }, 2000);
    });
  }

  function handleDownload() {
    if (!artifactStore.code) return;
    let ext = artifactStore.language;
    if (ext === "markdown") ext = "md";

    if (
      !["html", "svg", "md", "txt", "js", "json", "ts", "css"].includes(ext)
    ) {
      ext = "txt";
    }

    const filename = `${artifactStore.title.replace(/[^a-z0-9]/gi, "_").toLowerCase() || "artifact"}.${ext}`;
    const blob = new Blob([artifactStore.code], {
      type: "text/plain;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    showDownloadMenu = false;
  }
</script>

<div
  class="flex h-full w-full flex-col bg-bg {artifactStore.isExpanded
    ? ''
    : 'border-l border-line'} shadow-xl overflow-hidden"
>
  <!-- Top Bar / Header matching Chat header height and padding -->
  <div
    class="flex min-h-[53px] shrink-0 items-center justify-between border-b border-line bg-bg-elevated px-4 py-2.5 z-30"
  >
    <!-- Title & Language -->
    <div class="flex items-center gap-2.5 min-w-0">
      <span
        class="text-xs font-mono font-bold uppercase px-2 py-0.5 rounded bg-bg-inset border border-line text-accent"
      >
        {artifactStore.language === "markdown" ? "md" : artifactStore.language}
      </span>
      <h3 class="text-sm font-semibold text-fg truncate">
        {artifactStore.title}
      </h3>
    </div>

    <!-- Toggle View Mode Switcher -->
    <div
      class="flex items-center h-7 sm:h-8 rounded-lg border border-line bg-bg-inset py-0.5 px-1 sm:px-0.5 shadow-xs"
    >
      <button
        type="button"
        onclick={() => (viewMode = "preview")}
        class="flex items-center justify-center gap-1.5 h-full rounded-md px-1 sm:px-2.5 aspect-square sm:aspect-auto text-xs font-medium transition-all {viewMode ===
        'preview'
          ? 'bg-bg-elevated text-fg shadow-xs font-semibold'
          : 'text-fg-muted hover:text-fg'}"
      >
        <Eye size={13} />
        <span class="hidden sm:inline">Preview</span>
      </button>
      <div class="h-3.5 w-px bg-line/60 mx-0.5 sm:hidden"></div>
      <button
        type="button"
        onclick={() => (viewMode = "code")}
        class="flex items-center justify-center gap-1.5 h-full rounded-md px-1 sm:px-2.5 aspect-square sm:aspect-auto text-xs font-medium transition-all {viewMode ===
        'code'
          ? 'bg-bg-elevated text-fg shadow-xs font-semibold'
          : 'text-fg-muted hover:text-fg'}"
      >
        <Code size={13} />
        <span class="hidden sm:inline">Code</span>
      </button>
    </div>

    <!-- Action Buttons -->
    <div class="flex items-center gap-1.5">
      <!-- Copy / Download Split Button -->
      <div
        class="relative flex items-center h-7 sm:h-8 rounded-lg border border-line bg-bg-inset shadow-xs"
      >
        <button
          type="button"
          onclick={handleCopy}
          aria-label="Copy artifact code"
          title="Copy code"
          class="flex items-center gap-1.5 h-full px-2 sm:px-2.5 text-xs font-medium text-fg-muted hover:text-fg hover:bg-bg-hover transition-colors rounded-l-lg border-r border-line"
        >
          {#if copied}
            <Check class="hidden sm:block w-3.5 h-3.5 text-success" />
            <span class="text-success">Copied</span>
          {:else}
            <Copy class="hidden sm:block w-3.5 h-3.5" />
            <span>Copy</span>
          {/if}
        </button>
        <button
          type="button"
          onclick={() => (showDownloadMenu = !showDownloadMenu)}
          aria-label="More options"
          title="More options"
          class="flex items-center justify-center h-full px-1.5 text-fg-muted hover:text-fg hover:bg-bg-hover transition-colors rounded-r-lg"
        >
          {#if showDownloadMenu}
            <ChevronUp size={14} />
          {:else}
            <ChevronDown size={14} />
          {/if}
        </button>

        {#if showDownloadMenu}
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <div
            class="fixed inset-0 z-40"
            onclick={() => (showDownloadMenu = false)}
          ></div>
          <div
            transition:fly={{ y: -6, duration: 150 }}
            class="absolute right-0 top-full mt-1 z-50 min-w-32.5 rounded-lg border border-line bg-bg-elevated p-1 shadow-xl overflow-hidden"
          >
            <button
              type="button"
              onclick={handleDownload}
              class="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-xs font-medium text-fg hover:bg-bg-hover transition-colors"
            >
              <Download size={14} class="text-fg-muted" />
              <span>Download</span>
            </button>
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
        class="hidden sm:flex h-8 w-8 items-center justify-center rounded-lg text-fg-muted hover:bg-bg-hover hover:text-fg transition-colors"
      >
        {#if artifactStore.isExpanded}
          <Minimize2 size={15} />
        {:else}
          <Maximize2 size={15} />
        {/if}
      </button>

      <div class="h-4 w-px bg-line mx-1 hidden sm:block"></div>

      <button
        type="button"
        onclick={() => artifactStore.close()}
        aria-label="Close artifact panel"
        title="Close side panel"
        class="flex h-7 w-7 sm:h-8 sm:w-8 items-center justify-center rounded-lg text-fg-muted hover:bg-bg-hover hover:text-fg transition-colors"
      >
        <X size={16} />
      </button>
    </div>
  </div>

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
          class="h-full w-full border-0 bg-white"
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
