import type { ToolExecutionEvent } from "../types.js";

export interface MessageSegment {
  id: string;
  type: "router" | "think" | "tool" | "text";
  content?: string;
  isDone?: boolean;
  execution?: ToolExecutionEvent;
}

export function parseMessageSegments(rawContent: string, loadedThinkingContent?: string): MessageSegment[] {
  let fullRaw = rawContent || "";
  if (loadedThinkingContent && !fullRaw.includes("<think>")) {
    fullRaw = `<think>${loadedThinkingContent}</think>\n${fullRaw}`;
  }

  if (!fullRaw.trim()) return [];

  // Track if this message has demonstrated reasoning behavior (<think> or </think> tags)
  const hasReasoningHistory = fullRaw.includes("<think>") || fullRaw.includes("</think>");

  const segments: MessageSegment[] = [];
  let pos = 0;
  let segIndex = 0;
  let lastParsedTagType: "router" | "think" | "tool" | null = null;

  while (pos < fullRaw.length) {
    const findNextTag = (tagName: string, startPos: number) => {
      const regex = new RegExp(`<${tagName}(?:\\s|>|$)`, "i");
      const match = fullRaw.slice(startPos).match(regex);
      return match && match.index !== undefined ? startPos + match.index : -1;
    };

    const nextRouter = findNextTag("router_execution", pos);
    const nextThink = findNextTag("think", pos);
    const nextTool = findNextTag("tool_execution", pos);
    const nextEndThink = fullRaw.indexOf("</think>", pos);

    let firstTagType: "router" | "think" | "endThink" | "tool" | null = null;
    let firstTagPos = -1;

    const candidates: { type: "router" | "think" | "endThink" | "tool"; pos: number }[] = [];
    if (nextRouter !== -1) candidates.push({ type: "router", pos: nextRouter });
    if (nextThink !== -1) candidates.push({ type: "think", pos: nextThink });
    if (nextTool !== -1) candidates.push({ type: "tool", pos: nextTool });

    // Only consider orphan </think> if it appears BEFORE <think> or if there is no <think> tag ahead
    if (nextEndThink !== -1 && (nextThink === -1 || nextEndThink < nextThink)) {
      candidates.push({ type: "endThink", pos: nextEndThink });
    }

    candidates.sort((a, b) => a.pos - b.pos);

    if (candidates.length > 0) {
      firstTagType = candidates[0].type;
      firstTagPos = candidates[0].pos;
    }

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

    if (firstTagPos > pos) {
      const priorText = fullRaw.slice(pos, firstTagPos).trim();
      if (priorText) {
        if (firstTagType === "endThink") {
          segments.push({ id: `think_${segIndex++}`, type: "think", content: priorText, isDone: true });
          pos = firstTagPos + 8;
          lastParsedTagType = "think";
          continue;
        } else if (lastParsedTagType === "tool" && hasReasoningHistory && firstTagType !== "think" && firstTagType !== "router") {
          segments.push({ id: `think_${segIndex++}`, type: "think", content: priorText, isDone: true });
        } else {
          segments.push({ id: `text_${segIndex++}`, type: "text", content: priorText });
        }
      } else if (firstTagType === "endThink") {
        pos = firstTagPos + 8;
        lastParsedTagType = "think";
        continue;
      }
    }

    if (firstTagType === "router") {
      const routerTagHeaderEnd = fullRaw.indexOf(">", firstTagPos);
      const endTag = fullRaw.indexOf("</router_execution>", firstTagPos + 18);

      const contentStart = routerTagHeaderEnd !== -1 ? routerTagHeaderEnd + 1 : firstTagPos + 18;
      if (endTag === -1) {
        const content = fullRaw.slice(contentStart).trim();
        segments.push({ id: `router_${segIndex++}`, type: "router", content });
        pos = fullRaw.length;
        lastParsedTagType = "router";
        break;
      } else {
        const content = fullRaw.slice(contentStart, endTag).trim();
        segments.push({ id: `router_${segIndex++}`, type: "router", content });
        pos = endTag + 19;
        lastParsedTagType = "router";
      }
    } else if (firstTagType === "think") {
      const thinkTagHeaderEnd = fullRaw.indexOf(">", firstTagPos);
      const endTag = fullRaw.indexOf("</think>", firstTagPos + 7);

      const contentStart = thinkTagHeaderEnd !== -1 ? thinkTagHeaderEnd + 1 : firstTagPos + 7;
      if (endTag === -1) {
        const thinkContent = fullRaw.slice(contentStart);
        segments.push({ id: `think_${segIndex++}`, type: "think", content: thinkContent, isDone: false });
        pos = fullRaw.length;
        lastParsedTagType = "think";
        break;
      } else {
        const thinkContent = fullRaw.slice(contentStart, endTag).trim();
        segments.push({ id: `think_${segIndex++}`, type: "think", content: thinkContent, isDone: true });
        pos = endTag + 8;
        lastParsedTagType = "think";
      }
    } else if (firstTagType === "tool") {
      const endTag = fullRaw.indexOf("</tool_execution>", firstTagPos + 16);
      if (endTag === -1) {
        pos = fullRaw.length;
        lastParsedTagType = "tool";
        break;
      } else {
        const jsonStr = fullRaw.slice(firstTagPos + 16, endTag).trim();
        try {
          const exec: ToolExecutionEvent = JSON.parse(jsonStr);
          segments.push({ id: `tool_${exec.callId}_${segIndex++}`, type: "tool", execution: exec });
        } catch { }
        pos = endTag + 17;
        lastParsedTagType = "tool";
      }
    }
  }

  return segments;
}
