import type { ToolExecutionEvent } from "../types.js";

export interface MessageSegment {
  id: string;
  type: "router" | "think" | "tool" | "notice" | "text";
  content?: string;
  isDone?: boolean;
  execution?: ToolExecutionEvent;
  noticeKind?: "trimmed" | "tools_pruned";
}

/**
 * All opening tag names that are treated as thinking blocks.
 * Any opening tag in this list can be closed by any closing tag in this list.
 * To add new aliases in future, just append to this array.
 */
export const THINK_TAG_NAMES = ["think", "thought", "reason", "reasoning"];

// Pre-compute opening/closing strings from the tag names list.
const OPEN_TAGS = THINK_TAG_NAMES.map((t) => `<${t}>`);
const CLOSE_TAGS = THINK_TAG_NAMES.map((t) => `</${t}>`);

/** Returns the position and byte-length of the earliest opening think tag at or after startPos, or null. */
function findNextOpenTag(str: string, startPos: number): { pos: number; len: number } | null {
  let earliest: { pos: number; len: number } | null = null;
  for (const open of OPEN_TAGS) {
    const p = str.indexOf(open, startPos);
    if (p !== -1 && (!earliest || p < earliest.pos)) {
      earliest = { pos: p, len: open.length };
    }
  }
  return earliest;
}

/** Returns the position and byte-length of the earliest closing think tag at or after startPos, or null. */
function findNextCloseTag(str: string, startPos: number): { pos: number; len: number } | null {
  let earliest: { pos: number; len: number } | null = null;
  for (const close of CLOSE_TAGS) {
    const p = str.indexOf(close, startPos);
    if (p !== -1 && (!earliest || p < earliest.pos)) {
      earliest = { pos: p, len: close.length };
    }
  }
  return earliest;
}

export function parseMessageSegments(
  rawContent: string,
  loadedThinkingContent?: string,
  activeToolExecutions?: ToolExecutionEvent[],
): MessageSegment[] {
  let fullRaw = rawContent || "";

  // If a message has pre-parsed thinking content but no think tags in raw, wrap it
  const hasAnyOpenTag = OPEN_TAGS.some((open) => fullRaw.includes(open));
  if (loadedThinkingContent && !hasAnyOpenTag) {
    fullRaw = `<think>${loadedThinkingContent}</think>\n${fullRaw}`;
  }

  if (!fullRaw.trim() && (!activeToolExecutions || activeToolExecutions.length === 0)) return [];

  const segments: MessageSegment[] = [];
  let pos = 0;
  let segIndex = 0;
  let lastParsedTagType: "router" | "think" | "tool" | "notice" | null = null;

  const ROUTER_OPEN = "<router_execution>";
  const ROUTER_CLOSE = "</router_execution>";
  const TOOL_OPEN = "<tool_execution>";
  const TOOL_CLOSE = "</tool_execution>";
  const NOTICE_OPEN = "<context_notice>";
  const NOTICE_CLOSE = "</context_notice>";

  while (pos < fullRaw.length) {
    const nextRouter = fullRaw.indexOf(ROUTER_OPEN, pos);
    const openThink = findNextOpenTag(fullRaw, pos);
    const nextThink = openThink ? openThink.pos : -1;
    const nextTool = fullRaw.indexOf(TOOL_OPEN, pos);
    const nextNotice = fullRaw.indexOf(NOTICE_OPEN, pos);
    const closeThink = findNextCloseTag(fullRaw, pos);
    const nextEndThink = closeThink ? closeThink.pos : -1;
    const endThinkLen = closeThink ? closeThink.len : 0;

    let firstTagType: "router" | "think" | "endThink" | "tool" | "notice" | null = null;
    let firstTagPos = -1;

    // Find the earliest tag without allocating arrays/sorting
    if (nextRouter !== -1) {
      firstTagType = "router";
      firstTagPos = nextRouter;
    }
    if (nextThink !== -1 && (firstTagPos === -1 || nextThink < firstTagPos)) {
      firstTagType = "think";
      firstTagPos = nextThink;
    }
    if (nextTool !== -1 && (firstTagPos === -1 || nextTool < firstTagPos)) {
      firstTagType = "tool";
      firstTagPos = nextTool;
    }
    if (nextNotice !== -1 && (firstTagPos === -1 || nextNotice < firstTagPos)) {
      firstTagType = "notice";
      firstTagPos = nextNotice;
    }
    // Only consider an orphan closing tag if it appears before the next opening tag
    if (nextEndThink !== -1 && (nextThink === -1 || nextEndThink < nextThink)) {
      if (firstTagPos === -1 || nextEndThink < firstTagPos) {
        firstTagType = "endThink";
        firstTagPos = nextEndThink;
      }
    }

    // No more tags -- emit remainder as text
    if (firstTagPos === -1) {
      const remainingText = fullRaw.slice(pos).trimStart();
      if (remainingText) {
        segments.push({ id: `text_${segIndex++}`, type: "text", content: remainingText });
      }
      break;
    }

    // Emit text for the region before the first tag
    if (firstTagPos > pos) {
      const priorText = fullRaw.slice(pos, firstTagPos).trim();
      if (priorText) {
        if (firstTagType === "endThink") {
          // Orphan close tag: treat prior text as a completed think block
          segments.push({ id: `think_${segIndex++}`, type: "think", content: priorText, isDone: true });
          pos = firstTagPos + endThinkLen;
          lastParsedTagType = "think";
          continue;
        } else {
          segments.push({ id: `text_${segIndex++}`, type: "text", content: priorText });
        }
      } else if (firstTagType === "endThink") {
        // Empty orphan close tag: just advance past it
        pos = firstTagPos + endThinkLen;
        lastParsedTagType = "think";
        continue;
      }
    }

    if (firstTagType === "router") {
      const endTag = fullRaw.indexOf(ROUTER_CLOSE, firstTagPos + ROUTER_OPEN.length);
      const contentStart = firstTagPos + ROUTER_OPEN.length;
      if (endTag === -1) {
        const content = fullRaw.slice(contentStart).trim();
        segments.push({ id: `router_${segIndex++}`, type: "router", content });
        pos = fullRaw.length;
        lastParsedTagType = "router";
        break;
      } else {
        const content = fullRaw.slice(contentStart, endTag).trim();
        segments.push({ id: `router_${segIndex++}`, type: "router", content });
        pos = endTag + ROUTER_CLOSE.length;
        lastParsedTagType = "router";
      }
    } else if (firstTagType === "think") {
      const openLen = openThink!.len;
      const contentStart = firstTagPos + openLen;
      const closeInfo = findNextCloseTag(fullRaw, contentStart);

      if (!closeInfo) {
        // Unclosed streaming think block
        const thinkContent = fullRaw.slice(contentStart);
        segments.push({ id: `think_${segIndex++}`, type: "think", content: thinkContent, isDone: false });
        pos = fullRaw.length;
        lastParsedTagType = "think";
        break;
      } else {
        const thinkContent = fullRaw.slice(contentStart, closeInfo.pos).trim();
        segments.push({ id: `think_${segIndex++}`, type: "think", content: thinkContent, isDone: true });
        pos = closeInfo.pos + closeInfo.len;
        lastParsedTagType = "think";
      }
    } else if (firstTagType === "tool") {
      const endTag = fullRaw.indexOf(TOOL_CLOSE, firstTagPos + TOOL_OPEN.length);
      if (endTag === -1) {
        pos = fullRaw.length;
        lastParsedTagType = "tool";
        break;
      } else {
        const jsonStr = fullRaw.slice(firstTagPos + TOOL_OPEN.length, endTag).trim();
        try {
          const exec: ToolExecutionEvent = JSON.parse(jsonStr);
          segments.push({ id: `tool_${exec.callId}_${segIndex++}`, type: "tool", execution: exec });
        } catch { }
        pos = endTag + TOOL_CLOSE.length;
        lastParsedTagType = "tool";
      }
    } else if (firstTagType === "notice") {
      const endTag = fullRaw.indexOf(NOTICE_CLOSE, firstTagPos + NOTICE_OPEN.length);
      if (endTag === -1) {
        pos = fullRaw.length;
        lastParsedTagType = "notice";
        break;
      } else {
        const jsonStr = fullRaw.slice(firstTagPos + NOTICE_OPEN.length, endTag).trim();
        try {
          const parsedNotice = JSON.parse(jsonStr) as {
            kind?: "trimmed" | "tools_pruned";
            message?: string;
          };
          if (parsedNotice.message) {
            segments.push({
              id: `notice_${segIndex++}`,
              type: "notice",
              noticeKind: parsedNotice.kind ?? "trimmed",
              content: parsedNotice.message,
            });
          }
        } catch { }
        pos = endTag + NOTICE_CLOSE.length;
        lastParsedTagType = "notice";
      }
    }
  }

  // Append any live (streaming) tool executions not yet in the raw buffer
  if (activeToolExecutions && activeToolExecutions.length > 0) {
    const closedToolSegments = segments
      .filter((s) => s.type === "tool" && s.execution)
      .map((s) => s.execution!);

    for (const exec of activeToolExecutions) {
      const isActiveStatus =
        exec.status === "executing" ||
        exec.status === "awaiting_approval" ||
        exec.status === "polling";
      const matchingClosed = closedToolSegments.find((c) => c.callId === exec.callId);
      // Only skip if this exact callId already closed for the same tool AND is no longer active.
      // If a backend reused callId across rounds, an active executing/awaiting_approval event must still render!
      if (matchingClosed && (!isActiveStatus || matchingClosed.toolName === exec.toolName && !isActiveStatus)) {
        continue;
      }
      segments.push({
        id: `tool_live_${exec.callId}_${exec.toolName}`,
        type: "tool",
        execution: exec,
      });
    }
  }

  // Deduplicate tool segments by toolName+args key (suppress duplicate tool calls)
  const seenToolKeys = new Set<string>();
  const dedupedSegments: MessageSegment[] = [];
  for (const seg of segments) {
    if (seg.type === "tool" && seg.execution) {
      const isCacheable = seg.execution.cacheable !== false;
      if (isCacheable) {
        const key = `${seg.execution.toolName}::${JSON.stringify(seg.execution.args || {})}`;
        if (seenToolKeys.has(key)) continue;
        seenToolKeys.add(key);
      }
    }
    dedupedSegments.push(seg);
  }

  return dedupedSegments;
}

/**
 * Strips internal `<router_execution>`, `<think>`, and `<tool_execution>` blocks,
 * converting `<artifact-card>` tags back to `[artifact: filename]` placeholders.
 * Used for clean clipboard copying and message editing.
 */
export function getCleanVisibleText(rawContent: string, fallbackThinking?: string): string {
  if (!rawContent) return fallbackThinking ?? "";

  let cleaned = rawContent
    .replace(/<context_notice>[\s\S]*?<\/context_notice>/gi, "")
    .replace(/<router_execution>[\s\S]*?<\/router_execution>/gi, "")
    .replace(/<tool_execution>[\s\S]*?<\/tool_execution>/gi, "")
    .replace(/<(?:think|thought|reason|reasoning)>[\s\S]*?<\/(?:think|thought|reason|reasoning)>/gi, "")
    .replace(/<(?:think|thought|reason|reasoning)>[\s\S]*$/gi, "")
    .replace(
      /<artifact-card\s+[^>]*?filename="([^"]*)"[^>]*?>\s*<\/artifact-card>/gi,
      "[artifact: $1]",
    )
    .trim();

  if (!cleaned && fallbackThinking) {
    return fallbackThinking.trim();
  }
  return cleaned;
}

/**
 * Reconstructs the stored assistant message content after the user edits the visible text,
 * preserving `<router_execution>`, `<think>`, and `<tool_execution>` blocks in place
 * without duplicating thinking blocks or destroying tool execution history.
 */
export function reconstructEditedMessageContent(
  originalRawContent: string,
  newVisibleText: string,
  loadedThinkingContent?: string,
): string {
  const raw = originalRawContent || "";
  const preservedPrefixBlocks: string[] = [];

  const noticeMatches = raw.match(/<context_notice>[\s\S]*?<\/context_notice>/gi);
  if (noticeMatches) {
    preservedPrefixBlocks.push(...noticeMatches);
  }

  const routerMatches = raw.match(/<router_execution>[\s\S]*?<\/router_execution>/gi);
  if (routerMatches) {
    preservedPrefixBlocks.push(...routerMatches);
  }

  const thinkMatches = raw.match(
    /<(?:think|thought|reason|reasoning)>[\s\S]*?<\/(?:think|thought|reason|reasoning)>/gi,
  );
  if (thinkMatches && thinkMatches.length > 0) {
    preservedPrefixBlocks.push(...thinkMatches);
  } else if (loadedThinkingContent && !/<(?:think|thought|reason|reasoning)>/i.test(newVisibleText)) {
    preservedPrefixBlocks.push(`<think>\n${loadedThinkingContent}\n</think>`);
  }

  const toolMatches = raw.match(/<tool_execution>[\s\S]*?<\/tool_execution>/gi);
  if (toolMatches) {
    preservedPrefixBlocks.push(...toolMatches);
  }

  // Strip any internal tags if the user pasted them into newVisibleText to prevent duplication
  const cleanUserEdit = newVisibleText
    .replace(/<context_notice>[\s\S]*?<\/context_notice>/gi, "")
    .replace(/<router_execution>[\s\S]*?<\/router_execution>/gi, "")
    .replace(/<tool_execution>[\s\S]*?<\/tool_execution>/gi, "")
    .replace(/<(?:think|thought|reason|reasoning)>[\s\S]*?<\/(?:think|thought|reason|reasoning)>/gi, "")
    .trim();

  if (preservedPrefixBlocks.length === 0) {
    return cleanUserEdit;
  }

  return `${preservedPrefixBlocks.join("\n")}\n${cleanUserEdit}`;
}
