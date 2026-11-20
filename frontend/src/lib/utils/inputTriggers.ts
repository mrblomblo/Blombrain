export type InputTriggerType = "@" | "/";

export interface ActiveInputTrigger {
  type: InputTriggerType;
  query: string;
  quoted: boolean;
  matchLength: number;
}

/**
 * Detects an active `@` or `/` autocomplete trigger immediately before the cursor.
 * Triggers only when `@` or `/` is preceded by start-of-string or whitespace.
 * Supports space-containing queries when enclosed in an unclosed double quote (`@"foo bar`, `/"foo bar`).
 */
export function detectInputTrigger(textBeforeCursor: string): ActiveInputTrigger | null {
  if (!textBeforeCursor) return null;

  const quotedMatch = /(?:^|\s)([@/])"([^"\n]*)$/.exec(textBeforeCursor);
  if (quotedMatch) {
    const type = quotedMatch[1] as InputTriggerType;
    const query = quotedMatch[2] ?? "";
    return {
      type,
      query,
      quoted: true,
      matchLength: 2 + query.length,
    };
  }

  const unquotedMatch = /(?:^|\s)([@/])([^\s"\n]*)$/.exec(textBeforeCursor);
  if (unquotedMatch) {
    const type = unquotedMatch[1] as InputTriggerType;
    const query = unquotedMatch[2] ?? "";
    return {
      type,
      query,
      quoted: false,
      matchLength: 1 + query.length,
    };
  }

  return null;
}

/**
 * Formats a selected filename, tool, skill, or MCP name as an inline token,
 * quoting with `"` automatically when it contains whitespace or quotes.
 */
export function formatTriggerToken(type: InputTriggerType, label: string): string {
  const cleaned = label.replace(/"/g, "");
  if (/\s/.test(cleaned)) {
    return `${type}"${cleaned}" `;
  }
  return `${type}${cleaned} `;
}

/**
 * Extracts completed `@token` / `@"token"` or `/token` / `/"token"` occurrences from text.
 */
export function extractPrefixTokens(text: string, prefix: InputTriggerType): string[] {
  if (!text) return [];
  const escaped = prefix === "/" ? "\\/" : "@";
  const regex = new RegExp(`(?:^|\\s)${escaped}(?:"([^"\\n]+)"|([^\\s"\\n]+))`, "g");
  const seen = new Set<string>();
  const out: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    const val = (match[1] ?? match[2] ?? "").replace(/\\([_*[\]])/g, "$1").trim();
    if (!val) continue;
    const key = val.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      out.push(val);
    }
  }
  return out;
}

export interface ValidPrefixMatch {
  start: number;
  end: number;
  value: string;
}

/**
 * Finds all character ranges of valid `@file` / `@"file name"` or `/tool` / `/"tool name"`
 * occurrences in plain text where the prefix is preceded only by start-of-string or whitespace.
 */
export function findValidPrefixMatchesInText(
  text: string,
  prefix: InputTriggerType,
  validLowerSet: Set<string>,
): ValidPrefixMatch[] {
  if (!text || validLowerSet.size === 0) return [];
  const escaped = prefix === "/" ? "\\/" : "@";
  const regex = new RegExp(`(?:^|\\s)(${escaped}(?:"([^"\\n]+)"|([^\\s"\\n]+)))`, "g");
  const matches: ValidPrefixMatch[] = [];
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    const token = match[1];
    const rawVal = (match[2] ?? match[3] ?? "").replace(/\\([_*[\]])/g, "$1").trim();
    if (!token || !rawVal) continue;
    if (!validLowerSet.has(rawVal.toLowerCase())) continue;
    const leadingWs = match[0].length - token.length;
    const start = match.index + leadingWs;
    const end = match.index + match[0].length;
    matches.push({ start, end, value: rawVal });
  }
  return matches;
}

const SKIP_TRIGGER_ANCESTOR_SELECTOR =
  "code, pre, a, button, kbd, .code-block-wrapper, .artifact-card, .input-mention-chip";

/**
 * Decorates valid `@file` / `@"file"` and `/tool` / `/"tool"` inline tokens inside rendered message HTML,
 * matching the same validation and chip styling rules used in the composer input.
 */
export function decorateTriggerTokensInElement(
  root: HTMLElement,
  validAtSet: Set<string>,
  validSlashSet: Set<string>,
): void {
  if (typeof document === "undefined") return;
  if (validAtSet.size === 0 && validSlashSet.size === 0) return;

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  let current: Node | null;
  while ((current = walker.nextNode()) !== null) {
    const textNode = current as Text;
    if (!textNode.nodeValue) continue;
    const parentEl = textNode.parentElement;
    if (!parentEl || parentEl.closest(SKIP_TRIGGER_ANCESTOR_SELECTOR)) continue;
    textNodes.push(textNode);
  }

  for (const textNode of textNodes) {
    const text = textNode.nodeValue ?? "";
    if (!text.includes("@") && !text.includes("/")) continue;

    // Only allow start-of-node matches at index 0 when not immediately following non-whitespace inline text.
    const prev = textNode.previousSibling;
    const precededByBoundary =
      !prev ||
      prev.nodeName === "BR" ||
      /\s$/.test(prev.textContent ?? "");

    type TaggedMatch = ValidPrefixMatch & { kind: InputTriggerType };
    const candidates: TaggedMatch[] = [];

    for (const m of findValidPrefixMatchesInText(text, "@", validAtSet)) {
      if (m.start === 0 && !precededByBoundary) continue;
      candidates.push({ ...m, kind: "@" });
    }
    for (const m of findValidPrefixMatchesInText(text, "/", validSlashSet)) {
      if (m.start === 0 && !precededByBoundary) continue;
      candidates.push({ ...m, kind: "/" });
    }

    if (candidates.length === 0) continue;

    candidates.sort((a, b) => a.start - b.start);

    const frag = document.createDocumentFragment();
    let cursor = 0;
    for (const match of candidates) {
      if (match.start < cursor) continue;
      if (match.start > cursor) {
        frag.appendChild(document.createTextNode(text.slice(cursor, match.start)));
      }
      const span = document.createElement("span");
      span.className =
        match.kind === "@"
          ? "input-mention-chip input-mention-at"
          : "input-mention-chip input-mention-slash";
      span.dataset.triggerKind = match.kind === "@" ? "at" : "slash";
      span.dataset.triggerValue = match.value;
      if (match.kind === "@") {
        span.setAttribute("role", "button");
        span.setAttribute("tabindex", "0");
        span.title = `Open ${match.value}`;
      } else {
        span.title = "Injected tool, skill, or MCP";
      }
      span.textContent = text.slice(match.start, match.end);
      frag.appendChild(span);
      cursor = match.end;
    }

    if (cursor < text.length) {
      frag.appendChild(document.createTextNode(text.slice(cursor)));
    }

    textNode.parentNode?.replaceChild(frag, textNode);
  }
}
