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
