import { Marked } from "marked";
import { markedHighlight } from "marked-highlight";
import hljs from "highlight.js";
import DOMPurify from "dompurify";

export function encodeBase64(str: string): string {
  const gBuf = (globalThis as any).Buffer;
  if (typeof gBuf !== "undefined") {
    return gBuf.from(str, "utf8").toString("base64");
  }
  const bytes = new TextEncoder().encode(str);
  const binString = Array.from(bytes, (byte) => String.fromCodePoint(byte)).join("");
  return btoa(binString);
}

export function decodeBase64(b64: string): string {
  const gBuf = (globalThis as any).Buffer;
  if (typeof gBuf !== "undefined") {
    return gBuf.from(b64, "base64").toString("utf8");
  }
  const binString = atob(b64);
  const bytes = Uint8Array.from(binString, (m) => m.codePointAt(0)!);
  return new TextDecoder().decode(bytes);
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const marked = new Marked(
  markedHighlight({
    emptyLangClass: "hljs",
    langPrefix: "hljs language-",
    highlight(code, lang) {
      const rawLang = (lang || "").trim().split(/\s+/)[0].toLowerCase();
      if (rawLang === "html" || rawLang === "svg" || rawLang === "markdown" || rawLang === "md") {
        return code;
      }
      const language = hljs.getLanguage(rawLang) ? rawLang : "";
      if (language) {
        return hljs.highlight(code, { language }).value;
      }
      return hljs.highlightAuto(code).value;
    },
  })
);

const ALERT_CONFIGS: Record<
  string,
  { title: string; borderStyle: string; textStyle: string; bgStyle: string; iconSvg: string }
> = {
  NOTE: {
    title: "Note",
    borderStyle: "border-left-color: var(--blue)",
    textStyle: "color: var(--blue)",
    bgStyle: "background-color: color-mix(in srgb, var(--blue) 10%, transparent)",
    iconSvg: `<svg class="w-4 h-4 shrink-0" style="color: var(--blue)" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>`,
  },
  TIP: {
    title: "Tip",
    borderStyle: "border-left-color: var(--green)",
    textStyle: "color: var(--green)",
    bgStyle: "background-color: color-mix(in srgb, var(--green) 10%, transparent)",
    iconSvg: `<svg class="w-4 h-4 shrink-0" style="color: var(--green)" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/><path d="M9 18h6"/><path d="M10 22h4"/></svg>`,
  },
  IMPORTANT: {
    title: "Important",
    borderStyle: "border-left-color: var(--purple)",
    textStyle: "color: var(--purple)",
    bgStyle: "background-color: color-mix(in srgb, var(--purple) 10%, transparent)",
    iconSvg: `<svg class="w-4 h-4 shrink-0" style="color: var(--purple)" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z"/><path d="M12 8v4"/><path d="M12 16h.01"/></svg>`,
  },
  WARNING: {
    title: "Warning",
    borderStyle: "border-left-color: var(--orange)",
    textStyle: "color: var(--orange)",
    bgStyle: "background-color: color-mix(in srgb, var(--orange) 10%, transparent)",
    iconSvg: `<svg class="w-4 h-4 shrink-0" style="color: var(--orange)" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" x2="12" y1="9" y2="13"/><line x1="12" x2="12.01" y1="17" y2="17"/></svg>`,
  },
  CAUTION: {
    title: "Caution",
    borderStyle: "border-left-color: var(--red)",
    textStyle: "color: var(--red)",
    bgStyle: "background-color: color-mix(in srgb, var(--red) 10%, transparent)",
    iconSvg: `<svg class="w-4 h-4 shrink-0" style="color: var(--red)" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="7.86 2 16.14 2 22 7.86 22 16.14 16.14 22 7.86 22 2 16.14 2 7.86 7.86 2"/><line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12.01" y1="16" y2="16"/></svg>`,
  },
};

function isSafeUrl(url: string, isImage: boolean = false): boolean {
  if (!url) return false;
  const trimmed = url.trim().toLowerCase();

  if (trimmed.startsWith("javascript:") || trimmed.startsWith("vbscript:") || trimmed.startsWith("file:")) {
    return false;
  }

  try {
    const parsed = new URL(url, "http://dummy-base.local");
    const allowedProtocols = isImage
      ? ["http:", "https:", "data:"]
      : ["http:", "https:", "mailto:"];
    return allowedProtocols.includes(parsed.protocol);
  } catch {
    return !trimmed.includes(":");
  }
}

marked.use({
  gfm: true,
  breaks: true,
  renderer: {
    html({ text }: { text: string }) {
      return escapeHtml(text);
    },
    link(this: any, { href, title, tokens }: { href: string; title?: string | null; tokens: any[] }) {
      const text = this.parser.parseInline(tokens);
      if (!isSafeUrl(href, false)) {
        return `<span class="text-danger font-semibold select-none" title="Blocked unsafe link">[blocked unsafe link]</span>`;
      }
      const titleAttr = title ? ` title="${escapeHtml(title)}"` : "";
      return `<a href="${escapeHtml(href)}"${titleAttr} target="_blank" rel="noopener noreferrer">${text}</a>`;
    },
    image({ href, title, text }: { href: string; title?: string | null; text: string }) {
      if (!isSafeUrl(href, true)) {
        return `<span class="text-danger font-semibold select-none" title="Blocked unsafe image">[blocked unsafe image]</span>`;
      }
      const titleAttr = title ? ` title="${escapeHtml(title)}"` : "";
      return `<img src="${escapeHtml(href)}" alt="${escapeHtml(text)}"${titleAttr} class="max-w-full rounded-md my-2" />`;
    },
    code(this: any, { text, lang }: { text: string; lang?: string }) {
      const isArtifactPreview = !!(this.options as any)?.isArtifactPreview;
      const rawLang = (lang || "").trim().split(/\s+/)[0].toLowerCase();
      const validLang = hljs.getLanguage(rawLang) ? rawLang : "";
      const displayLang = validLang || rawLang || "code";

      if (!isArtifactPreview && (rawLang === "html" || rawLang === "svg" || rawLang === "markdown" || rawLang === "md")) {
        let cardTitle = "HTML Web Content";
        let iconSvg = `<svg class="w-4 h-4 text-accent" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>`;
        if (rawLang === "svg") {
          cardTitle = "SVG Graphic";
          iconSvg = `<svg class="w-4 h-4 text-accent" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polygon points="12 8 8 16 16 16"/></svg>`;
        } else if (rawLang === "markdown" || rawLang === "md") {
          cardTitle = "Markdown Document";
          iconSvg = `<svg class="w-4 h-4 text-accent" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><line x1="10" y1="9" x2="8" y2="9"/></svg>`;
        }

        return `<div class="artifact-card relative my-4 rounded-xl border border-line bg-bg-elevated p-3 sm:p-3.5 shadow-sm transition-all hover:border-accent group cursor-pointer flex flex-col gap-2.5" data-artifact-lang="${rawLang}" data-artifact-title="Artifact" data-artifact-code="${encodeBase64(text)}">
  <div class="flex items-center justify-between w-full gap-3">
    <div class="flex items-center gap-3 min-w-0">
      <div class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent/10 border border-accent/20">
        ${iconSvg}
      </div>
      <div class="min-w-0">
        <div class="text-sm font-semibold text-fg truncate">${cardTitle}</div>
        <div class="hidden sm:flex text-xs text-fg-muted items-center gap-1.5 mt-0.5">
          <span class="font-mono text-[11px] uppercase px-1.5 py-0.2 rounded bg-bg-inset border border-line">${rawLang}</span>
          <span>Click to view artifact in side panel</span>
        </div>
        <div class="flex sm:hidden text-xs text-fg-muted items-center gap-1.5 mt-0.5">
          <span class="font-mono text-[11px] uppercase px-1.5 py-0.2 rounded bg-bg-inset border border-line">${rawLang}</span>
        </div>
      </div>
    </div>
    <button type="button" class="open-artifact-btn hidden sm:flex shrink-0 items-center gap-1.5 rounded-lg border border-accent/40 bg-accent/10 px-3 py-1.5 text-xs font-semibold text-accent transition-all hover:bg-accent hover:text-white shadow-xs">
      <span>View Artifact</span>
      <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" x2="21" y1="14" y2="3"/></svg>
    </button>
  </div>
  <div class="flex sm:hidden items-center justify-between w-full border-t border-line/50 pt-2.5 mt-0.5">
    <span class="text-xs text-fg-muted">Click to view artifact</span>
    <button type="button" class="open-artifact-btn shrink-0 flex items-center gap-1.5 rounded-lg border border-accent/40 bg-accent/10 px-2.5 py-1 text-xs font-semibold text-accent transition-all hover:bg-accent hover:text-white shadow-xs">
      <span>View Artifact</span>
      <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" x2="21" y1="14" y2="3"/></svg>
    </button>
  </div>
</div>`;
      }

      return `<div class="code-block-wrapper relative my-4 rounded-md border border-line shadow-sm group">
  <div style="position:absolute;inset:0 0 4.5rem 0;z-index:10;pointer-events:none;">
    <div class="code-sticky-sentinel" aria-hidden="true" style="height:1px;margin-bottom:-1px;pointer-events:none;visibility:hidden;"></div>
    <div class="code-block-header sticky top-0 pl-4 pr-1.5 py-1.5 rounded-t-md border-b border-line/50 bg-bg text-[11px] font-mono text-fg-muted flex items-center justify-between" style="pointer-events:auto;">
      <span>${displayLang}</span>
      <button
        type="button"
        class="copy-code-btn flex items-center gap-1.5 rounded-sm border border-line bg-bg-elevated px-2 py-0.5 text-[11px] font-mono font-medium text-fg-muted transition-all hover:bg-bg-hover hover:text-fg shadow-xs"
        aria-label="Copy code block"
      >
        <svg class="copy-icon w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect width="14" height="14" x="8" y="8" rx="2" ry="2"/>
          <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>
        </svg>
        <svg class="check-icon hidden w-3.5 h-3.5 text-success" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="20 6 9 17 4 12"/>
        </svg>
        <span class="btn-text">Copy</span>
      </button>
    </div>
  </div>
  <div class="overflow-x-auto rounded-md bg-bg-elevated" style="padding-top:34px;">
    <pre class="text-xs font-mono leading-relaxed text-fg bg-transparent"><code class="hljs ${validLang ? `language-${validLang}` : ""} block">${text}</code></pre>
  </div>
</div>`;
    },
    blockquote(this: any, { tokens }: { tokens: any[] }) {
      const innerHtml = this.parser.parse(tokens);
      const alertRegex = /^\s*(?:<p>)?\s*\[\!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*(?:<\/p>|<br\s*\/?>|\n)?\s*/i;
      const match = innerHtml.match(alertRegex);

      if (match) {
        const type = match[1].toUpperCase();
        const config = ALERT_CONFIGS[type] || ALERT_CONFIGS.NOTE;

        let content = innerHtml.replace(alertRegex, "");
        const trimmed = content.trim();
        if (trimmed && !trimmed.startsWith("<")) {
          content = `<p>${content}`;
        }

        return `<div class="my-3 rounded-l-xs rounded-r-md border-l-3 p-4 shadow-xs" style="${config.borderStyle}; ${config.bgStyle}">
  <div class="flex items-center gap-2 font-semibold text-xs mb-1.5 uppercase tracking-wide select-none" style="${config.textStyle}">
    ${config.iconSvg}
    <span>${config.title}</span>
  </div>
  <div class="text-sm leading-relaxed text-fg [&>:first-child]:!mt-0 [&>:last-child]:!mb-0">
    ${content}
  </div>
</div>`;
      }

      return `<blockquote class="my-3 border-l-3 border-bg-inset bg-bg-inset/45 px-3.5 py-2 rounded-l-xs rounded-r-md text-fg-muted italic [&>:first-child]:!mt-0 [&>:last-child]:!mb-0 [&>blockquote]:my-2 [&>blockquote]:border-bg-inset [&>blockquote]:bg-bg-inset/25">${innerHtml}</blockquote>`;
    },
    codespan({ text }: { text: string }) {
      return `<code class="inline-code cursor-pointer rounded-sm border border-line bg-bg-elevated px-1.5 py-0.5 text-[0.85em] font-mono text-fg transition-colors hover:border-accent/40 hover:bg-bg-hover">${escapeHtml(text)}</code>`;
    },
  },
});

function findMatchingCloseIndex(lines: string[], startIndex: number, fenceChar: string, fenceLength: number): number {
  for (let i = startIndex; i < lines.length; i++) {
    const line = lines[i];
    const fenceMatch = line.match(/^( {0,3})(`{3,}|~{3,})(.*)$/);
    if (fenceMatch) {
      const currChar = fenceMatch[2][0];
      const currLength = fenceMatch[2].length;
      const rest = fenceMatch[3].trim();
      const currLang = rest.split(/\s+/)[0].toLowerCase();

      if (currLang) {
        return -1; // Another opening fence
      }

      if (currChar === fenceChar && currLength >= fenceLength) {
        return i; // Found matching close
      }
    }
  }
  return -1;
}

function hasFenceAfter(lines: string[], startIndex: number): boolean {
  for (let i = startIndex; i < lines.length; i++) {
    if (lines[i].match(/^( {0,3})(`{3,}|~{3,})(.*)$/)) {
      return true;
    }
  }
  return false;
}

function fixNestedMarkdownCodeBlocks(src: string): string {
  const normalizedSrc = src.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = normalizedSrc.split("\n");
  const result: string[] = [];

  let inArtifact = false;
  let artifactIndent = "";
  let artifactFenceChar = "";
  let artifactFenceLength = 0;
  let innerStack: Array<{ char: string; length: number }> = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fenceMatch = line.match(/^( {0,3})(`{3,}|~{3,})(.*)$/);

    if (fenceMatch) {
      const indent = fenceMatch[1];
      const fenceStr = fenceMatch[2];
      const fenceChar = fenceStr[0];
      const fenceLength = fenceStr.length;
      const rest = fenceMatch[3].trim();
      const rawLang = rest.split(/\s+/)[0].toLowerCase();

      if (!inArtifact) {
        if (rawLang === "markdown" || rawLang === "md") {
          inArtifact = true;
          artifactIndent = indent;
          artifactFenceChar = fenceChar;
          artifactFenceLength = fenceLength;
          innerStack = [];
          result.push(`${indent}${"`".repeat(20)}${rawLang}`);
          continue;
        }
      } else {
        if (innerStack.length > 0) {
          const top = innerStack[innerStack.length - 1];
          if (fenceChar === top.char && fenceLength >= top.length && !rawLang) {
            innerStack.pop();
            result.push(line);
            continue;
          } else {
            // Literal text inside inner code block
            result.push(line);
            continue;
          }
        } else {
          // innerStack is empty
          if (rawLang) {
            // Potential opening fence for inner block
            const closeIndex = findMatchingCloseIndex(lines, i + 1, fenceChar, fenceLength);
            // Only treat as inner block if it has a matching close AND there's another fence after it
            if (closeIndex !== -1 && hasFenceAfter(lines, closeIndex + 1)) {
              innerStack.push({ char: fenceChar, length: fenceLength });
              result.push(line);
              continue;
            } else {
              // No matching close, or no fence after. Treat as artifact close.
              inArtifact = false;
              result.push(`${artifactIndent}${"`".repeat(20)}`);
              continue;
            }
          } else {
            // Bare fence
            // Close artifact
            inArtifact = false;
            result.push(`${artifactIndent}${"`".repeat(20)}`);
            continue;
          }
        }
      }
    }

    result.push(line);
  }

  if (inArtifact) {
    result.push(`${artifactIndent}${"`".repeat(20)}`);
  }

  return result.join("\n");
}

export function renderMarkdown(
  content: string,
  options?: { isArtifactPreview?: boolean }
): string {
  if (!content) return "";
  try {
    const isArtifactPreview = !!options?.isArtifactPreview;
    const processedContent = isArtifactPreview
      ? content
      : fixNestedMarkdownCodeBlocks(content);
    const rawHtml = (marked.parse(processedContent, { isArtifactPreview } as any) as unknown) as string;

    if (typeof window === "undefined") {
      return rawHtml;
    }

    return DOMPurify.sanitize(rawHtml, {
      ADD_ATTR: ["target", "rel"],
    });
  } catch (err) {
    console.error("[markdown] parse error:", err);
    return escapeHtml(content);
  }
}
