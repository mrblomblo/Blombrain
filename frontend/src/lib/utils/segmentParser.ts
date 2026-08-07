import type { ToolExecutionEvent } from "../types.js";

export interface MessageSegment {
  id: string;
  type: "router" | "think" | "tool" | "text";
  content?: string;
  isDone?: boolean;
  execution?: ToolExecutionEvent;
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

  if (!fullRaw.trim()) return [];

  // Track if this message has demonstrated reasoning behavior at all
  const hasReasoningHistory =
    OPEN_TAGS.some((open) => fullRaw.includes(open)) ||
    CLOSE_TAGS.some((close) => fullRaw.includes(close));

  const segments: MessageSegment[] = [];
  let pos = 0;
  let segIndex = 0;
  let lastParsedTagType: "router" | "think" | "tool" | null = null;

  const ROUTER_OPEN = "<router_execution>";
  const ROUTER_CLOSE = "</router_execution>";
  const TOOL_OPEN = "<tool_execution>";
  const TOOL_CLOSE = "</tool_execution>";

  while (pos < fullRaw.length) {
    const nextRouter = fullRaw.indexOf(ROUTER_OPEN, pos);
    const openThink = findNextOpenTag(fullRaw, pos);
    const nextThink = openThink ? openThink.pos : -1;
    const nextTool = fullRaw.indexOf(TOOL_OPEN, pos);
    const closeThink = findNextCloseTag(fullRaw, pos);
    const nextEndThink = closeThink ? closeThink.pos : -1;
    const endThinkLen = closeThink ? closeThink.len : 0;

    let firstTagType: "router" | "think" | "endThink" | "tool" | null = null;
    let firstTagPos = -1;

    const candidates: { type: "router" | "think" | "endThink" | "tool"; pos: number }[] = [];
    if (nextRouter !== -1) candidates.push({ type: "router", pos: nextRouter });
    if (nextThink !== -1) candidates.push({ type: "think", pos: nextThink });
    if (nextTool !== -1) candidates.push({ type: "tool", pos: nextTool });

    // Only consider an orphan closing tag if it appears before the next opening tag
    if (nextEndThink !== -1 && (nextThink === -1 || nextEndThink < nextThink)) {
      candidates.push({ type: "endThink", pos: nextEndThink });
    }

    candidates.sort((a, b) => a.pos - b.pos);

    if (candidates.length > 0) {
      firstTagType = candidates[0].type;
      firstTagPos = candidates[0].pos;
    }

    // No more tags -- emit remainder as text or a streaming think block
    if (firstTagPos === -1) {
      const remainingText = fullRaw.slice(pos).trimStart();
      if (remainingText) {
        if (lastParsedTagType === "tool" && hasReasoningHistory) {
          segments.push({ id: `think_${segIndex++}`, type: "think", content: remainingText, isDone: false });
        } else {
          segments.push({ id: `text_${segIndex++}`, type: "text", content: remainingText });
        }
      }
      break;
    }

    // Emit text/think for the region before the first tag
    if (firstTagPos > pos) {
      const priorText = fullRaw.slice(pos, firstTagPos).trim();
      if (priorText) {
        if (firstTagType === "endThink") {
          // Orphan close tag: treat prior text as a completed think block
          segments.push({ id: `think_${segIndex++}`, type: "think", content: priorText, isDone: true });
          pos = firstTagPos + endThinkLen;
          lastParsedTagType = "think";
          continue;
        } else if (lastParsedTagType === "tool" && hasReasoningHistory && firstTagType !== "think" && firstTagType !== "router") {
          // Post-tool text in a reasoning message is another think block
          segments.push({ id: `think_${segIndex++}`, type: "think", content: priorText, isDone: true });
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
    }
  }

  // Append any live (streaming) tool executions not yet in the raw buffer
  if (activeToolExecutions && activeToolExecutions.length > 0) {
    const closedCallIds = new Set(
      segments
        .filter((s) => s.type === "tool" && s.execution)
        .map((s) => s.execution!.callId),
    );

    for (const exec of activeToolExecutions) {
      if (closedCallIds.has(exec.callId)) continue;
      segments.push({
        id: `tool_live_${exec.callId}`,
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
      const key = `${seg.execution.toolName}::${JSON.stringify(seg.execution.args || {})}`;
      if (seenToolKeys.has(key)) continue;
      seenToolKeys.add(key);
    }
    dedupedSegments.push(seg);
  }

  return dedupedSegments;
}


