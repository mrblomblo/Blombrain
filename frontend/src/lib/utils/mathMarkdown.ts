import katex from "katex";

export interface ExtractedMathResult {
  content: string;
  slots: Array<{ token: string; html: string; displayMode: boolean }>;
}

interface ProtectedCodeResult {
  text: string;
  codeSlots: string[];
}

/**
 * Temporarily swaps fenced code blocks (including unclosed streaming fences)
 * and inline backtick code spans with inert placeholder tokens so math
 * delimiters inside code are never interpreted as LaTeX.
 */
export function protectCodeForMath(input: string): ProtectedCodeResult {
  const codeSlots: string[] = [];
  let out = "";
  let i = 0;

  while (i < input.length) {
    // Check line-start fenced code block: up to 3 leading spaces, 3+ ` or ~
    const atLineStart = i === 0 || input[i - 1] === "\n";
    if (atLineStart) {
      let ws = i;
      while (ws < input.length && input[ws] === " " && ws - i < 3) ws++;
      const fenceChar = input[ws];
      if (fenceChar === "`" || fenceChar === "~") {
        let fenceEnd = ws;
        while (fenceEnd < input.length && input[fenceEnd] === fenceChar) fenceEnd++;
        const fenceLen = fenceEnd - ws;
        if (fenceLen >= 3) {
          // For backtick fences, info string cannot contain backticks (CommonMark)
          const firstNl = input.indexOf("\n", fenceEnd);
          const infoStr = firstNl === -1 ? input.slice(fenceEnd) : input.slice(fenceEnd, firstNl);
          if (fenceChar === "~" || !infoStr.includes("`")) {
            let blockEnd = input.length;
            if (firstNl !== -1) {
              let lineStart = firstNl + 1;
              while (lineStart < input.length) {
                const nextNl = input.indexOf("\n", lineStart);
                const line = nextNl === -1 ? input.slice(lineStart) : input.slice(lineStart, nextNl);
                const closeMatch = line.match(/^ {0,3}(`{3,}|~{3,})[ \t]*$/);
                if (closeMatch && closeMatch[1][0] === fenceChar && closeMatch[1].length >= fenceLen) {
                  blockEnd = nextNl === -1 ? input.length : nextNl + 1;
                  break;
                }
                if (nextNl === -1) break;
                lineStart = nextNl + 1;
              }
            }
            const idx = codeSlots.length;
            codeSlots.push(input.slice(i, blockEnd));
            out += `MATHCODESLOT${idx}END`;
            i = blockEnd;
            continue;
          }
        }
      }
    }

    // Check inline code span (`...` or ``...``)
    if (input[i] === "`" && (i === 0 || input[i - 1] !== "\\")) {
      let tickEnd = i;
      while (tickEnd < input.length && input[tickEnd] === "`") tickEnd++;
      const tickLen = tickEnd - i;

      // Scan forward for a matching closing backtick run of exact length `tickLen`
      let j = tickEnd;
      let foundClose = -1;
      while (j < input.length) {
        if (input[j] === "`") {
          let closeEnd = j;
          while (closeEnd < input.length && input[closeEnd] === "`") closeEnd++;
          if (closeEnd - j === tickLen) {
            foundClose = closeEnd;
            break;
          }
          j = closeEnd;
          continue;
        }
        // Stop inline code search across blank lines (paragraph boundary)
        if (input[j] === "\n" && input[j + 1] === "\n") {
          break;
        }
        j++;
      }

      if (foundClose !== -1) {
        const idx = codeSlots.length;
        codeSlots.push(input.slice(i, foundClose));
        out += `MATHCODESLOT${idx}END`;
        i = foundClose;
        continue;
      }

      out += input.slice(i, tickEnd);
      i = tickEnd;
      continue;
    }

    out += input[i];
    i++;
  }

  return { text: out, codeSlots };
}

function renderKatexSafe(expr: string, displayMode: boolean): string {
  return katex.renderToString(expr.trim(), {
    displayMode,
    throwOnError: false,
    strict: false,
    trust: false,
  });
}

function findUnescapedSequence(text: string, seq: string, from: number, stopAtBlankLine: boolean): number {
  let i = from;
  while (i < text.length) {
    if (stopAtBlankLine && text[i] === "\n" && text[i + 1] === "\n") {
      return -1;
    }
    if (text.startsWith(seq, i)) {
      return i;
    }
    if (text[i] === "\\") {
      i += 2;
      continue;
    }
    i++;
  }
  return -1;
}

function findClosingSingleDollar(text: string, from: number): number {
  let i = from;
  while (i < text.length) {
    const ch = text[i];
    if (ch === "\n" || ch === "\r") {
      return -1;
    }
    if (ch === "\\") {
      i += 2;
      continue;
    }
    if (ch === "$") {
      if (text[i + 1] === "$") {
        // Avoid colliding with display $$ inside an unclosed single-$ probe
        i += 2;
        continue;
      }
      return i;
    }
    i++;
  }
  return -1;
}

/**
 * Extracts inline ($...$, \(...\)) and display ($$...$$, \[...\]) LaTeX math
 * outside protected code blocks/spans, renders each via KaTeX, and returns
 * restored markdown containing MATHSLOT{i}END placeholders plus rendered slots.
 */
export function extractAndRenderMath(content: string): ExtractedMathResult {
  if (!content || (!content.includes("$") && !content.includes("\\(") && !content.includes("\\["))) {
    return { content, slots: [] };
  }

  const { text, codeSlots } = protectCodeForMath(content);
  const slots: Array<{ token: string; html: string; displayMode: boolean }> = [];
  let out = "";
  let i = 0;

  while (i < text.length) {
    const ch = text[i];

    // Preserve escaped chars (e.g. \\[, \$, \\() so they aren't parsed as math
    if (ch === "\\") {
      const next = text[i + 1];
      if (next === "(") {
        const closeIdx = findUnescapedSequence(text, "\\)", i + 2, true);
        if (closeIdx !== -1) {
          const inner = text.slice(i + 2, closeIdx);
          if (inner.trim().length > 0) {
            const idx = slots.length;
            const token = `MATHSLOT${idx}END`;
            slots.push({ token, html: renderKatexSafe(inner, false), displayMode: false });
            out += token;
            i = closeIdx + 2;
            continue;
          }
        }
      } else if (next === "[") {
        const closeIdx = findUnescapedSequence(text, "\\]", i + 2, false);
        if (closeIdx !== -1) {
          const inner = text.slice(i + 2, closeIdx);
          if (inner.trim().length > 0) {
            const idx = slots.length;
            const token = `MATHSLOT${idx}END`;
            slots.push({ token, html: renderKatexSafe(inner, true), displayMode: true });
            out += `\n\n${token}\n\n`;
            i = closeIdx + 2;
            continue;
          }
        }
      }
      // Consume backslash + next char literally
      out += text.slice(i, Math.min(i + 2, text.length));
      i += 2;
      continue;
    }

    if (ch === "$") {
      // Display $$...$$
      if (text[i + 1] === "$") {
        const closeIdx = findUnescapedSequence(text, "$$", i + 2, false);
        if (closeIdx !== -1) {
          const inner = text.slice(i + 2, closeIdx);
          if (inner.trim().length > 0) {
            const idx = slots.length;
            const token = `MATHSLOT${idx}END`;
            slots.push({ token, html: renderKatexSafe(inner, true), displayMode: true });
            out += `\n\n${token}\n\n`;
            i = closeIdx + 2;
            continue;
          }
        }
        out += "$$";
        i += 2;
        continue;
      }

      // Inline $...$: apply currency & whitespace guards
      const prevChar = i > 0 ? text[i - 1] : "";
      const nextChar = text[i + 1] ?? "";
      const badStart =
        !nextChar ||
        /\s/.test(nextChar) ||
        /[0-9]/.test(prevChar);

      if (!badStart) {
        const closeIdx = findClosingSingleDollar(text, i + 1);
        if (closeIdx !== -1) {
          const inner = text.slice(i + 1, closeIdx);
          const beforeClose = text[closeIdx - 1] ?? "";
          const afterClose = text[closeIdx + 1] ?? "";
          const badEnd = /\s/.test(beforeClose) || /[0-9]/.test(afterClose);

          if (!badEnd && inner.trim().length > 0) {
            const idx = slots.length;
            const token = `MATHSLOT${idx}END`;
            slots.push({ token, html: renderKatexSafe(inner, false), displayMode: false });
            out += token;
            i = closeIdx + 1;
            continue;
          }
        }
      }

      out += "$";
      i += 1;
      continue;
    }

    out += ch;
    i++;
  }

  // Restore protected code blocks/spans before passing to Marked
  let restored = out;
  for (let c = 0; c < codeSlots.length; c++) {
    restored = restored.split(`MATHCODESLOT${c}END`).join(codeSlots[c]);
  }

  return { content: restored, slots };
}
