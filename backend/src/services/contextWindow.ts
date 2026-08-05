import type { CtxOverflowBehavior } from "../types.js";

export interface TokenEstimateBreakdown {
  messagesTokens: number;
  toolSchemasTokens: number;
  systemTokens: number;
  totalTokens: number;
  promptBudget: number;
  contextLimit: number;
}

export type MessageGroupKind = "system" | "first_user_anchor" | "turn" | "tool_round";

export interface MessageGroup {
  id: string;
  kind: MessageGroupKind;
  messages: any[];
  estimatedTokens: number;
  protected: boolean;
}

export interface ContextTrimResult {
  messages: any[];
  trimmed: boolean;
  action: "proceed" | "stop" | "impossible_fit";
  breakdown: TokenEstimateBreakdown;
  droppedMessageCount: number;
  droppedGroupCount: number;
  reason?: string;
}

export interface ApplyContextOverflowPolicyOptions {
  messages: any[];
  toolDefinitions?: any[];
  contextLimit: number | null | undefined;
  completionReserve?: number | null;
  safetyReserve?: number | null;
  behavior?: CtxOverflowBehavior | null;
}

/**
 * Conservative token estimator for strings, multimodal content arrays,
 * tool calls, and tool schemas.
 */
export function estimateTokens(content: any): number {
  if (!content) return 0;

  if (typeof content === "string") {
    return Math.ceil(content.length / 3) + 4;
  }

  if (Array.isArray(content)) {
    let tokens = 4;
    for (const item of content) {
      if (typeof item === "string") {
        tokens += Math.ceil(item.length / 3);
      } else if (item && typeof item === "object") {
        if (item.type === "image_url" || item.image_url) {
          // Base64 image trap protection: Fixed 1024 token heuristic per image
          tokens += 1024;
        } else if (item.type === "text" && typeof item.text === "string") {
          tokens += Math.ceil(item.text.length / 3);
        } else {
          tokens += Math.ceil(JSON.stringify(item).length / 3);
        }
      }
    }
    return tokens;
  }

  if (typeof content === "object") {
    return Math.ceil(JSON.stringify(content).length / 3) + 4;
  }

  return 4;
}

/**
 * Estimates tokens for an array of message objects, accounting for role overhead,
 * tool_calls attributes, and attachments.
 */
export function estimateMessagesTokens(messages: any[]): number {
  let total = 0;
  for (const m of messages) {
    total += 4; // Header & role framing overhead
    if (m.role) total += Math.ceil(m.role.length / 3);
    total += estimateTokens(m.content);
    if (m.tool_calls) total += estimateTokens(m.tool_calls);
    if (m.tool_call_id) total += Math.ceil(m.tool_call_id.length / 3) + 2;
    if (m.name) total += Math.ceil(m.name.length / 3) + 2;
  }
  return total;
}

/**
 * Estimates tokens required for tool schema definitions (MCP tools, skill scripts, etc.).
 */
export function estimateToolDefinitionsTokens(toolDefinitions?: any[]): number {
  if (!toolDefinitions || toolDefinitions.length === 0) return 0;
  return Math.ceil(JSON.stringify(toolDefinitions).length / 3) + 16;
}

/**
 * Partitions a list of messages into atomic MessageGroups.
 * Ensures tool-call chains (assistant tool_calls + matching tool results + continuations)
 * and injected system reminders preceding first user requests are kept intact.
 */
export function partitionMessageGroups(messages: any[]): MessageGroup[] {
  if (messages.length === 0) return [];

  const groups: MessageGroup[] = [];
  let i = 0;

  // 1. Extract leading system messages (and skill instructions)
  const systemMsgs: any[] = [];
  while (i < messages.length && messages[i].role === "system") {
    // Stop if this system message is a reminder right before the first user message
    const nextMsg = messages[i + 1];
    if (
      nextMsg &&
      nextMsg.role === "user" &&
      typeof messages[i].content === "string" &&
      messages[i].content.startsWith("Reminder:")
    ) {
      break;
    }
    systemMsgs.push(messages[i]);
    i++;
  }

  if (systemMsgs.length > 0) {
    groups.push({
      id: `group_system_${groups.length}`,
      kind: "system",
      messages: systemMsgs,
      estimatedTokens: estimateMessagesTokens(systemMsgs),
      protected: true,
    });
  }

  // 2. Identify first user anchor (including any immediately preceding system reminder)
  let foundFirstUser = false;
  while (i < messages.length) {
    const current = messages[i];

    // Check if system reminder + first user message
    if (
      !foundFirstUser &&
      current.role === "system" &&
      typeof current.content === "string" &&
      current.content.startsWith("Reminder:") &&
      i + 1 < messages.length &&
      messages[i + 1].role === "user"
    ) {
      const anchorMsgs = [current, messages[i + 1]];
      i += 2;
      foundFirstUser = true;
      groups.push({
        id: `group_first_user_${groups.length}`,
        kind: "first_user_anchor",
        messages: anchorMsgs,
        estimatedTokens: estimateMessagesTokens(anchorMsgs),
        protected: false, // Can be trimmed if truncate_middle falls back or rolling is used
      });
      continue;
    }

    if (!foundFirstUser && current.role === "user") {
      const anchorMsgs = [current];
      i++;
      foundFirstUser = true;
      groups.push({
        id: `group_first_user_${groups.length}`,
        kind: "first_user_anchor",
        messages: anchorMsgs,
        estimatedTokens: estimateMessagesTokens(anchorMsgs),
        protected: false,
      });
      continue;
    }

    // 3. Tool round lookahead grouping
    // If assistant message with tool_calls (or tool role message), consume assistant + tools + continuations
    if (
      current.role === "assistant" &&
      Array.isArray(current.tool_calls) &&
      current.tool_calls.length > 0
    ) {
      const roundMsgs: any[] = [current];
      i++;

      // Consume all subsequent tool results AND assistant continuations until the next user message
      while (i < messages.length && messages[i].role !== "user") {
        roundMsgs.push(messages[i]);
        i++;
      }

      groups.push({
        id: `group_tool_round_${groups.length}`,
        kind: "tool_round",
        messages: roundMsgs,
        estimatedTokens: estimateMessagesTokens(roundMsgs),
        protected: false,
      });
      continue;
    }

    // 4. Standard turn (user message or user + assistant pair)
    const turnMsgs: any[] = [current];
    i++;
    if (i < messages.length && messages[i].role === "assistant") {
      // If assistant has tool calls, let the next loop iteration handle it as a tool round
      if (!Array.isArray(messages[i].tool_calls) || messages[i].tool_calls.length === 0) {
        turnMsgs.push(messages[i]);
        i++;
      }
    }

    groups.push({
      id: `group_turn_${groups.length}`,
      kind: "turn",
      messages: turnMsgs,
      estimatedTokens: estimateMessagesTokens(turnMsgs),
      protected: false,
    });
  }

  // Always mark the very last group as protected so the prompt ends cleanly with the current query/turn
  if (groups.length > 0) {
    const lastGroup = groups[groups.length - 1];
    if (lastGroup.kind !== "system") {
      lastGroup.protected = true;
    }
  }

  return groups;
}

/**
 * Main context overflow policy function.
 * Evaluates budget and applies truncate_middle, rolling, or stop behavior.
 */
export function applyContextOverflowPolicy(
  opts: ApplyContextOverflowPolicyOptions
): ContextTrimResult {
  const {
    messages,
    toolDefinitions = [],
    contextLimit,
    completionReserve: rawCompletionReserve,
    safetyReserve: rawSafetyReserve,
    behavior = "truncate_middle",
  } = opts;

  const effectiveBehavior: CtxOverflowBehavior = behavior || "truncate_middle";

  // If no context limit is set or invalid, proceed without trimming
  if (!contextLimit || contextLimit <= 0) {
    const messagesTokens = estimateMessagesTokens(messages);
    const toolSchemasTokens = estimateToolDefinitionsTokens(toolDefinitions);
    return {
      messages,
      trimmed: false,
      action: "proceed",
      breakdown: {
        messagesTokens,
        toolSchemasTokens,
        systemTokens: 0,
        totalTokens: messagesTokens + toolSchemasTokens,
        promptBudget: Infinity,
        contextLimit: Infinity,
      },
      droppedMessageCount: 0,
      droppedGroupCount: 0,
    };
  }

  const completionReserve = rawCompletionReserve ?? 2048;
  const safetyReserve =
    rawSafetyReserve ?? Math.max(256, Math.ceil(contextLimit * 0.10));

  const promptBudget = contextLimit - completionReserve - safetyReserve;

  const messagesTokens = estimateMessagesTokens(messages);
  const toolSchemasTokens = estimateToolDefinitionsTokens(toolDefinitions);
  const totalTokens = messagesTokens + toolSchemasTokens;

  const initialBreakdown: TokenEstimateBreakdown = {
    messagesTokens,
    toolSchemasTokens,
    systemTokens: 0,
    totalTokens,
    promptBudget,
    contextLimit,
  };

  // If already fits within promptBudget, proceed directly
  if (totalTokens <= promptBudget) {
    return {
      messages,
      trimmed: false,
      action: "proceed",
      breakdown: initialBreakdown,
      droppedMessageCount: 0,
      droppedGroupCount: 0,
    };
  }

  // If behavior is stop, reject immediately
  if (effectiveBehavior === "stop") {
    return {
      messages,
      trimmed: false,
      action: "stop",
      breakdown: initialBreakdown,
      droppedMessageCount: 0,
      droppedGroupCount: 0,
      reason: `Context overflow: total estimated tokens (${totalTokens}) exceeds prompt budget (${promptBudget}).`,
    };
  }

  // Partition messages into atomic groups
  const groups = partitionMessageGroups(messages);
  const systemGroup = groups.find((g) => g.kind === "system");
  const systemTokens = systemGroup ? systemGroup.estimatedTokens : 0;
  initialBreakdown.systemTokens = systemTokens;

  // Cap first user anchor if it exceeds anchor budget
  const anchorGroupIndex = groups.findIndex((g) => g.kind === "first_user_anchor");
  if (anchorGroupIndex !== -1 && effectiveBehavior === "truncate_middle") {
    const anchorCap = Math.min(
      groups[anchorGroupIndex].estimatedTokens,
      Math.floor(promptBudget * 0.20),
      2048
    );
    // If the anchor group is larger than its cap, we allow it to be droppable during trimming
    groups[anchorGroupIndex].protected = false;
  }

  // Calculate required protected tokens (system + latest turn)
  const protectedTokens = groups
    .filter((g) => g.protected)
    .reduce((acc, g) => acc + g.estimatedTokens, 0) + toolSchemasTokens;

  // If even protected content alone exceeds promptBudget, return impossible_fit
  if (protectedTokens > promptBudget) {
    return {
      messages,
      trimmed: false,
      action: "impossible_fit",
      breakdown: initialBreakdown,
      droppedMessageCount: 0,
      droppedGroupCount: 0,
      reason: `Required system prompt, tools, and current query (${protectedTokens} tokens) exceed prompt budget (${promptBudget}).`,
    };
  }

  // Determine candidate groups to trim
  let currentGroupTokens = totalTokens;
  let droppedGroupCount = 0;
  let droppedMessageCount = 0;

  const activeGroups = [...groups];

  if (effectiveBehavior === "rolling") {
    // Sliding window: drop oldest non-protected groups from top to bottom
    let idx = 0;
    while (idx < activeGroups.length && currentGroupTokens > promptBudget) {
      const g = activeGroups[idx];
      if (!g.protected && g.kind !== "system") {
        currentGroupTokens -= g.estimatedTokens;
        droppedGroupCount++;
        droppedMessageCount += g.messages.length;
        activeGroups.splice(idx, 1);
      } else {
        idx++;
      }
    }
  } else {
    // Truncate middle: drop intermediate groups starting AFTER first_user_anchor
    let startIdx = 0;
    const anchorIdx = activeGroups.findIndex((g) => g.kind === "first_user_anchor");
    if (anchorIdx !== -1) {
      startIdx = anchorIdx + 1;
    } else {
      const sysIdx = activeGroups.findIndex((g) => g.kind === "system");
      if (sysIdx !== -1) startIdx = sysIdx + 1;
    }

    while (startIdx < activeGroups.length - 1 && currentGroupTokens > promptBudget) {
      const g = activeGroups[startIdx];
      if (!g.protected) {
        currentGroupTokens -= g.estimatedTokens;
        droppedGroupCount++;
        droppedMessageCount += g.messages.length;
        activeGroups.splice(startIdx, 1);
      } else {
        startIdx++;
      }
    }

    // If middle truncation wasn't enough (e.g. anchor was too large), drop anchor as fallback
    if (currentGroupTokens > promptBudget && anchorIdx !== -1 && anchorIdx < activeGroups.length) {
      const anchorGroup = activeGroups[anchorIdx];
      if (!anchorGroup.protected) {
        currentGroupTokens -= anchorGroup.estimatedTokens;
        droppedGroupCount++;
        droppedMessageCount += anchorGroup.messages.length;
        activeGroups.splice(anchorIdx, 1);
      }
    }
  }

  const trimmedMessages = activeGroups.flatMap((g) => g.messages);
  const finalMessagesTokens = estimateMessagesTokens(trimmedMessages);

  return {
    messages: trimmedMessages,
    trimmed: true,
    action: "proceed",
    breakdown: {
      messagesTokens: finalMessagesTokens,
      toolSchemasTokens,
      systemTokens,
      totalTokens: finalMessagesTokens + toolSchemasTokens,
      promptBudget,
      contextLimit,
    },
    droppedMessageCount,
    droppedGroupCount,
  };
}
