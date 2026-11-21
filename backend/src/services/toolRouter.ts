import { mcpManager, type McpToolDefinition } from "./mcp.js";
import { getAllSkills, getSkillScripts } from "./skills.js";
import type { SkillOut, SlashToolSelection } from "../types.js";
import db from "../db.js";
import { backendRegistry } from "../registry.js";
import { getAdapter } from "../adapters/index.js";
import { Readable } from "stream";

import { builtInToolRegistry, type BuiltInToolDefinition } from "./builtinTools/index.js";

export interface ToolRoutingResult {
  mcpTools: McpToolDefinition[];
  selectedSkills: SkillOut[];
  selectedBuiltInTools: BuiltInToolDefinition[];
}

/**
 * Extracts balanced `{ ... }` JSON object candidates from a string, ignoring braces inside string literals.
 */
function extractBalancedJsonObjects(str: string): string[] {
  const results: string[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escapeNext = false;

  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (escapeNext) {
      escapeNext = false;
      continue;
    }
    if (ch === "\\") {
      if (inString) escapeNext = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (ch === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0 && start !== -1) {
        results.push(str.slice(start, i + 1));
        start = -1;
      } else if (depth < 0) {
        depth = 0;
        start = -1;
      }
    }
  }
  return results;
}

export function parseRouterOutput(text: string): { tools: string[]; skills: string[] } {
  // 1. Strip any thinking/reasoning blocks first so braces inside <think> never pollute extraction
  let cleaned = text
    .replace(/<(?:think|thought|reason|reasoning)>[\s\S]*?<\/(?:think|thought|reason|reasoning)>/gi, "")
    .replace(/^[\s\S]*?<\/(?:think|thought|reason|reasoning)>/i, "")
    .trim();

  // 2. If there is an unclosed <think> tag, strip from it to the end unless JSON follows
  cleaned = cleaned.replace(/```(?:json)?([\s\S]*?)```/gi, "$1").trim();

  // 3. Try balanced JSON candidates from last to first
  const candidates = extractBalancedJsonObjects(cleaned);
  for (let i = candidates.length - 1; i >= 0; i--) {
    const candidate = candidates[i].replace(/,\s*([\]}])/g, "$1");
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === "object" && ("tools" in parsed || "skills" in parsed)) {
        const tools = Array.isArray(parsed.tools) ? parsed.tools.map((t: any) => String(t)) : [];
        const skills = Array.isArray(parsed.skills) ? parsed.skills.map((s: any) => String(s)) : [];
        return { tools, skills };
      }
    } catch { }
  }

  // 4. Fallback direct parse after cleaning trailing commas
  const fallbackMatch = cleaned.match(/\{[\s\S]*\}/);
  const rawTarget = (fallbackMatch ? fallbackMatch[0] : cleaned).replace(/,\s*([\]}])/g, "$1");
  const parsed = JSON.parse(rawTarget);
  const tools = Array.isArray(parsed.tools) ? parsed.tools.map((t: any) => String(t)) : [];
  const skills = Array.isArray(parsed.skills) ? parsed.skills.map((s: any) => String(s)) : [];
  return { tools, skills };
}

async function queryLLM(
  modelId: string,
  systemPrompt: string,
  userPrompt: string,
  onToken?: (text: string) => void,
  signal?: AbortSignal
): Promise<string> {
  if (signal?.aborted) {
    throw new Error("Router LLM operation aborted");
  }

  let targetModelId = modelId;
  const settingRow = db.prepare("SELECT * FROM model_settings WHERE id = ?").get(modelId) as any;
  if (settingRow && settingRow.is_preset && settingRow.base_model_id) {
    targetModelId = settingRow.base_model_id;
  }

  const resolved = backendRegistry.resolveModelId(targetModelId);
  if (!resolved) {
    throw new Error(`Model id "${modelId}" doesn't match any configured backend.`);
  }

  const { backend, rawModelId } = resolved;
  const adapter = getAdapter(backend.apiType);

  const extraParams: Record<string, any> = {};
  if (settingRow) {
    if (settingRow.seed !== null && settingRow.seed !== undefined) extraParams.seed = settingRow.seed;
    if (settingRow.max_tokens !== null && settingRow.max_tokens !== undefined) extraParams.max_tokens = settingRow.max_tokens;
    if (settingRow.top_k !== null && settingRow.top_k !== undefined) extraParams.top_k = settingRow.top_k;
    if (settingRow.top_p !== null && settingRow.top_p !== undefined) extraParams.top_p = settingRow.top_p;
    if (settingRow.min_p !== null && settingRow.min_p !== undefined) extraParams.min_p = settingRow.min_p;
    if (settingRow.presence_penalty !== null && settingRow.presence_penalty !== undefined) extraParams.presence_penalty = settingRow.presence_penalty;
    if (settingRow.frequency_penalty !== null && settingRow.frequency_penalty !== undefined) extraParams.frequency_penalty = settingRow.frequency_penalty;
    if (settingRow.repeat_penalty !== null && settingRow.repeat_penalty !== undefined) extraParams.repeat_penalty = settingRow.repeat_penalty;
    if (settingRow.reasoning_effort) extraParams.reasoning_effort = settingRow.reasoning_effort;
    if (settingRow.ctx_length !== null && settingRow.ctx_length !== undefined) {
      extraParams.num_ctx = settingRow.ctx_length;
    }
  }

  const messages = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt },
  ];

  const reqConfig = await adapter.buildRequest({
    backend,
    modelId: rawModelId,
    messages,
    extraParams,
    temperature: settingRow?.temperature ?? 0.1,
  });

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 60000); // 60-second timeout for pre-pass

  const onExternalAbort = () => {
    try { controller.abort(); } catch { }
  };
  if (signal) {
    signal.addEventListener("abort", onExternalAbort, { once: true });
  }

  try {
    const res = await fetch(reqConfig.url, {
      ...reqConfig.init,
      signal: controller.signal,
    });

    if (!res.ok || !res.body) {
      throw new Error(`Router LLM HTTP error ${res.status}: ${res.statusText}`);
    }

    const nodeStream = Readable.fromWeb(res.body as any);
    const parser = adapter.createStreamParser();
    let textResult = "";
    let reasoningMode: "oob" | null = null;

    await new Promise<void>((resolve, reject) => {
      const onStreamAbort = () => {
        try { nodeStream.destroy(); } catch { }
        reject(new Error("Router LLM operation aborted"));
      };
      if (signal) {
        signal.addEventListener("abort", onStreamAbort, { once: true });
      }

      nodeStream.on("data", (chunk: Buffer) => {
        if (signal?.aborted) {
          try { nodeStream.destroy(); } catch { }
          return reject(new Error("Router LLM operation aborted"));
        }
        const events = parser(chunk);
        for (const ev of events) {
          if (ev.reasoning) {
            if (!reasoningMode) {
              reasoningMode = "oob";
              textResult += "<think>\n";
              if (onToken) onToken("<think>\n");
            }
            textResult += ev.reasoning;
            if (onToken) onToken(ev.reasoning);
          }
          if (ev.delta) {
            if (reasoningMode === "oob") {
              reasoningMode = null;
              textResult += "\n</think>\n";
              if (onToken) onToken("\n</think>\n");
            }
            textResult += ev.delta;
            if (onToken) onToken(ev.delta);
          }
        }
      });
      nodeStream.on("end", () => {
        if (reasoningMode === "oob") {
          reasoningMode = null;
          textResult += "\n</think>\n";
          if (onToken) onToken("\n</think>\n");
        }
        if (signal) signal.removeEventListener("abort", onStreamAbort);
        resolve();
      });
      nodeStream.on("error", (err) => {
        if (signal) signal.removeEventListener("abort", onStreamAbort);
        reject(err);
      });
      nodeStream.on("close", () => {
        if (signal) signal.removeEventListener("abort", onStreamAbort);
        resolve();
      });
    });

    return textResult;
  } finally {
    clearTimeout(timeoutId);
    if (signal) {
      signal.removeEventListener("abort", onExternalAbort);
    }
  }
}

export function buildRecentContext(messages: any[], maxMessages = 4): string {
  if (!Array.isArray(messages) || messages.length <= 1) return "";

  const prior = messages.slice(0, -1);
  const recent = prior.slice(-maxMessages);

  const lines: string[] = [];
  for (const m of recent) {
    if (m.role === "system") continue;

    let text = "";
    if (typeof m.content === "string") {
      text = m.content;
    } else if (Array.isArray(m.content)) {
      text = m.content
        .filter((p: any) => p.type === "text")
        .map((p: any) => p.text)
        .join(" ");
    }

    text = text
      .replace(/<router_execution>[\s\S]*?<\/router_execution>/gi, "")
      .replace(/<tool_execution>[\s\S]*?<\/tool_execution>/gi, "")
      .replace(/<(?:think|thought|reason|reasoning)>[\s\S]*?<\/(?:think|thought|reason|reasoning)>/gi, "")
      .replace(/<artifact-card[^>]*>[\s\S]*?<\/artifact-card>/gi, "")
      .trim();

    if (!text) continue;

    if (text.length > 400) {
      text = text.slice(0, 400) + "... [truncated]";
    }

    const roleName = m.role === "user" ? "User" : m.role === "assistant" ? "Assistant" : m.role;
    lines.push(`${roleName}: ${text}`);
  }

  return lines.join("\n");
}

export async function summarizeMcpServerTools(
  serverName: string,
  tools: Array<{ name: string; description?: string }>,
  requestedModelId?: string
): Promise<{ summary: string; keywords: string }> {
  const fallbackSummary =
    tools.length > 0
      ? `Provides ${tools.length} tools for ${serverName} (${tools.slice(0, 5).map((t) => t.name).join(", ")}${tools.length > 5 ? ", ..." : ""}).`
      : `MCP server ${serverName}.`;
  const fallbackKeywords = [
    serverName.toLowerCase(),
    ...tools.slice(0, 8).flatMap((t) => t.name.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2)),
  ]
    .filter((v, i, a) => a.indexOf(v) === i)
    .slice(0, 10)
    .join(", ");

  let modelToUse = requestedModelId;
  if (!modelToUse) {
    const gs = db
      .prepare("SELECT tool_routing_model, auto_name_model FROM global_settings WHERE id = 'default'")
      .get() as any;
    modelToUse = gs?.tool_routing_model || gs?.auto_name_model;
  }
  if (!modelToUse) {
    const defaultRow = db
      .prepare("SELECT id FROM model_settings WHERE is_default = 1 LIMIT 1")
      .get() as any;
    const cachedRow = db
      .prepare("SELECT id FROM cached_models WHERE is_online = 1 LIMIT 1")
      .get() as any;
    modelToUse = defaultRow?.id || cachedRow?.id;
  }

  if (!modelToUse || tools.length === 0) {
    return { summary: fallbackSummary, keywords: fallbackKeywords };
  }

  try {
    const sys = `You generate concise 1-sentence descriptions and keywords for MCP tool servers.
Respond strictly with a raw JSON object:
{
  "summary": "One concise sentence describing what this server and its tools do.",
  "keywords": "comma, separated, keywords"
}`;
    const toolList = tools
      .slice(0, 30)
      .map((t) => `- ${t.name}: ${(t.description || "").slice(0, 160)}`)
      .join("\n");
    const raw = await queryLLM(
      modelToUse,
      sys,
      `Server Name: ${serverName}\nTools:\n${toolList}`
    );
    const cleaned = raw.replace(/<(?:think|thought|reason|reasoning)>[\s\S]*?<\/(?:think|thought|reason|reasoning)>/gi, "");
    const candidates = extractBalancedJsonObjects(cleaned);
    for (let i = candidates.length - 1; i >= 0; i--) {
      try {
        const parsed = JSON.parse(candidates[i]);
        if (parsed && typeof parsed.summary === "string") {
          return {
            summary: parsed.summary.trim() || fallbackSummary,
            keywords:
              typeof parsed.keywords === "string"
                ? parsed.keywords.trim()
                : Array.isArray(parsed.keywords)
                  ? parsed.keywords.join(", ")
                  : fallbackKeywords,
          };
        }
      } catch { }
    }
  } catch { }

  return { summary: fallbackSummary, keywords: fallbackKeywords };
}

export async function routeToolsAndSkills(
  userQuery: string,
  excludedMcps: string[] = [],
  excludedSkills: string[] = [],
  forceTools: string[] = [],
  activeModelId?: string,
  contextLimit?: number | null,
  onToken?: (text: string) => void,
  priorContext?: string,
  signal?: AbortSignal,
  conversationMemoryEnabled?: boolean | null,
  workspacePath?: string | null,
  workspaceWriteEnabled?: boolean,
  onRoutingStart?: () => void
): Promise<ToolRoutingResult> {
  // Check global settings for tool_routing_mode, tool_routing_model, network_tools_enabled, disabled_builtin_tools, memory_enabled, cross_chat_recall_enabled
  const settingsRow = db.prepare("SELECT tool_routing_mode, tool_routing_model, network_tools_enabled, disabled_builtin_tools, memory_enabled, cross_chat_recall_enabled, cross_chat_include_archived FROM global_settings LIMIT 1").get() as any;
  const allowNetwork = !!settingsRow?.network_tools_enabled;
  const globalMemoryEnabled = settingsRow?.memory_enabled !== undefined ? !!settingsRow.memory_enabled : true;
  const effectiveMemoryEnabled =
    conversationMemoryEnabled !== undefined && conversationMemoryEnabled !== null
      ? conversationMemoryEnabled
      : globalMemoryEnabled;
  const crossChatRecallEnabled =
    settingsRow?.cross_chat_recall_enabled !== undefined
      ? !!settingsRow.cross_chat_recall_enabled
      : true;
  const crossChatIncludeArchived = !!settingsRow?.cross_chat_include_archived;

  let disabledTools: string[] = [];
  if (settingsRow?.disabled_builtin_tools) {
    try {
      const parsed = JSON.parse(settingsRow.disabled_builtin_tools);
      if (Array.isArray(parsed)) disabledTools = parsed.map(String);
    } catch { }
  }

  const allMcpTools = await mcpManager.getAvailableTools(excludedMcps);
  const allSkills = getAllSkills(excludedSkills).filter((s) => s.isEnabled);
  const allBuiltInTools = builtInToolRegistry.getAvailableTools(
    {
      activeSkills: allSkills,
      memoryEnabled: effectiveMemoryEnabled,
      crossChatRecallEnabled,
      crossChatIncludeArchived,
      workspacePath,
      workspaceWriteEnabled,
    },
    { allowNetwork, disabledTools }
  );

  const toolsCatalog = [
    ...allBuiltInTools.map((t) => ({
      name: t.name,
      description: t.description ? t.description.trim().slice(0, 300) : "No description",
    })),
    ...allMcpTools.map((t) => {
      const prefixParts: string[] = [];
      if (t.serverSummary) prefixParts.push(t.serverSummary);
      if (t.serverKeywords) prefixParts.push(`keywords: ${t.serverKeywords}`);
      const prefix = prefixParts.length > 0 ? `[${prefixParts.join(" | ")}] ` : "";
      const baseDesc = t.description ? t.description.trim() : "No description";
      return {
        name: t.name,
        description: (prefix + baseDesc).slice(0, 360),
      };
    }),
  ];

  const skillsCatalog = allSkills.map((s) => {
    const baseDesc = (s.summary || s.description || "No description").trim();
    const kwSuffix = s.keywords ? ` (keywords: ${s.keywords})` : "";
    return {
      name: s.name,
      description: (baseDesc + kwSuffix).slice(0, 320),
    };
  });

  const mode = settingsRow?.tool_routing_mode || "off";
  const designatedModel = settingsRow?.tool_routing_model;

  // Strictly respect disabled pre-pass routing ("off").
  // Context overflow protection in contextWindow.ts handles schema pruning if needed.
  const shouldRoute = mode !== "off";

  if (!shouldRoute || !userQuery.trim() || (allMcpTools.length === 0 && allSkills.length === 0 && allBuiltInTools.length === 0)) {
    return {
      mcpTools: allMcpTools,
      selectedSkills: allSkills,
      selectedBuiltInTools: allBuiltInTools,
    };
  }

  // Determine which model ID to use for the pre-pass
  let modelToUse: string | undefined;
  if (mode === "designated_model" && designatedModel) {
    modelToUse = designatedModel;
  } else {
    modelToUse = activeModelId || designatedModel;
  }

  // Fallback if modelToUse is still not resolved
  if (!modelToUse) {
    const row = db.prepare("SELECT id FROM model_settings LIMIT 1").get() as any;
    if (row?.id) {
      modelToUse = row.id;
    }
  }

  if (!modelToUse) {
    console.warn("[toolRouter] No valid model available for routing pre-pass, skipping routing.");
    return { mcpTools: allMcpTools, selectedSkills: allSkills, selectedBuiltInTools: allBuiltInTools };
  }

  onRoutingStart?.();

  try {
    const systemPrompt = `You are a precision AI tool and skill selector.
Analyze the user's query along with recent conversation context, and select ONLY the tools and skills strictly required to fulfill it.
Be conservative: if no external tools or skills are needed, return empty arrays.

You MUST respond strictly with a raw JSON object and NO other text:
{
  "tools": ["tool_name_1"],
  "skills": ["skill_name_1"]
}`;

    const contextHeader = priorContext && priorContext.trim()
      ? `Recent Conversation Context:\n${priorContext.trim()}\n\n`
      : "";

    const userPrompt = `${contextHeader}Current User Query: "${userQuery}"

Available Tools:
${JSON.stringify(toolsCatalog, null, 2)}

Available Skills:
${JSON.stringify(skillsCatalog, null, 2)}`;

    const rawResponse = await queryLLM(modelToUse, systemPrompt, userPrompt, onToken, signal);
    const { tools: selectedToolNames, skills: selectedSkillNames } = parseRouterOutput(rawResponse);

    // Filter tools & skills, ensuring forcedTools are ALWAYS included
    const selectedMcpTools = allMcpTools.filter(
      (t) =>
        selectedToolNames.includes(t.name) ||
        forceTools.includes(t.name) ||
        forceTools.includes(t.serverId) ||
        forceTools.includes(`mcp:${t.serverId}`)
    );

    const selectedBuiltInTools = allBuiltInTools.filter(
      (t) => selectedToolNames.includes(t.name) || forceTools.includes(t.name)
    );

    const selectedSkills = allSkills.filter(
      (s) =>
        selectedSkillNames.includes(s.name) ||
        forceTools.includes(s.name) ||
        forceTools.includes(s.id) ||
        forceTools.includes(`skill:${s.id}`)
    );

    console.log(
      `[toolRouter] Pre-pass completed using ${modelToUse}. Selected ${selectedMcpTools.length}/${allMcpTools.length} MCP tools, ${selectedBuiltInTools.length}/${allBuiltInTools.length} built-in tools, and ${selectedSkills.length}/${allSkills.length} skills.`
    );

    return {
      mcpTools: selectedMcpTools,
      selectedSkills: selectedSkills,
      selectedBuiltInTools: selectedBuiltInTools,
    };
  } catch (err) {
    if (signal?.aborted) {
      return {
        mcpTools: [],
        selectedSkills: [],
        selectedBuiltInTools: [],
      };
    }
    console.warn("[toolRouter] LLM pre-pass failed, failing open with all tools/skills:", err);
    onToken?.(`\n${JSON.stringify({ fallback: true, tools: allMcpTools.map((t) => t.name), skills: allSkills.map((s) => s.name) })}`);
    return {
      mcpTools: allMcpTools,
      selectedSkills: allSkills,
      selectedBuiltInTools: allBuiltInTools,
    };
  }
}

/**
 * Extracts `@filename` / `@"file name"` or `/tool` / `/"tool name"` tokens
 * where the trigger character is preceded only by start-of-string or whitespace.
 */
export function extractPrefixTokens(text: string, prefix: "@" | "/"): string[] {
  if (!text) return [];
  const escaped = prefix === "/" ? "\\/" : "@";
  const regex = new RegExp(`(?:^|\\s)${escaped}(?:"([^"\\n]+)"|([^\\s"\\n]+))`, "g");
  const seen = new Set<string>();
  const tokens: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    const val = (match[1] ?? match[2] ?? "").replace(/\\([_*[\]])/g, "$1").trim();
    if (!val) continue;
    const key = val.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      tokens.push(val);
    }
  }
  return tokens;
}

export interface SlashInjectionResult extends ToolRoutingResult {
  hasInjections: boolean;
}

/**
 * Resolves explicit `/` popover selections and inline `/token` or `/"token with spaces"`
 * directives from user text into concrete tools, skills, and MCP tools.
 * Bypasses disabled flags, exclusions, and network restrictions intentionally,
 * allowing callers to skip the LLM routing pre-pass when `hasInjections` is true.
 */
export async function resolveSlashInjections(
  explicitSelections: SlashToolSelection[] = [],
  userText = ""
): Promise<SlashInjectionResult> {
  const inlineTokens = extractPrefixTokens(userText, "/");
  if (explicitSelections.length === 0 && inlineTokens.length === 0) {
    return {
      hasInjections: false,
      mcpTools: [],
      selectedSkills: [],
      selectedBuiltInTools: [],
    };
  }

  const allBuiltIn = builtInToolRegistry.getAllTools();
  const allSkills = getAllSkills();
  const allMcpServers = mcpManager.getAllServers([], { maskSecrets: true });
  const knownMcpTools = await mcpManager.getKnownTools();

  const builtInMap = new Map<string, BuiltInToolDefinition>();
  const skillMap = new Map<string, SkillOut>();
  const fullMcpServerIds = new Set<string>();
  const specificMcpToolNames = new Set<string>();
  const neededMcpServerIds = new Set<string>();

  const addBuiltIn = (tool: BuiltInToolDefinition) => {
    builtInMap.set(tool.name.trim(), tool);
  };

  const addSkill = (skill: SkillOut) => {
    skillMap.set(skill.id, skill);
  };

  for (const sel of explicitSelections) {
    if (!sel || typeof sel.kind !== "string") continue;
    const targetName = (sel.name || "").trim().toLowerCase();
    const targetId = (sel.id || "").trim();

    if (sel.kind === "builtin_tool") {
      const match = allBuiltIn.find(
        (t) => t.name.trim() === targetId || t.name.trim().toLowerCase() === targetName
      );
      if (match) addBuiltIn(match);
    } else if (sel.kind === "skill") {
      const match = allSkills.find(
        (s) => s.id === targetId || s.name.trim().toLowerCase() === targetName
      );
      if (match) addSkill(match);
    } else if (sel.kind === "mcp_server") {
      const match = allMcpServers.find(
        (s) => s.id === targetId || s.name.trim().toLowerCase() === targetName
      );
      if (match) {
        fullMcpServerIds.add(match.id);
        neededMcpServerIds.add(match.id);
      }
    } else if (sel.kind === "mcp_tool") {
      const knownMatch = knownMcpTools.find(
        (t) => t.name === targetId || t.name.toLowerCase() === targetName
      );
      if (knownMatch) {
        neededMcpServerIds.add(knownMatch.serverId);
        specificMcpToolNames.add(knownMatch.name);
      } else {
        const rawRef = sel.id || sel.name || "";
        const sepIdx = rawRef.indexOf("__");
        if (sepIdx > 0) {
          const srvPrefix = rawRef.slice(0, sepIdx).toLowerCase();
          const srv = allMcpServers.find(
            (s) => s.name.trim().toLowerCase() === srvPrefix || s.id === srvPrefix
          );
          if (srv) {
            neededMcpServerIds.add(srv.id);
            specificMcpToolNames.add(rawRef);
          }
        }
      }
    }
  }

  for (const token of inlineTokens) {
    const lower = token.toLowerCase();

    const builtInMatch = allBuiltIn.find((t) => t.name.trim().toLowerCase() === lower);
    if (builtInMatch) {
      addBuiltIn(builtInMatch);
      continue;
    }

    const skillMatch = allSkills.find((s) => s.name.trim().toLowerCase() === lower);
    if (skillMatch) {
      addSkill(skillMatch);
      continue;
    }

    const serverMatch = allMcpServers.find((s) => s.name.trim().toLowerCase() === lower);
    if (serverMatch) {
      fullMcpServerIds.add(serverMatch.id);
      neededMcpServerIds.add(serverMatch.id);
      continue;
    }

    const knownToolMatch = knownMcpTools.find((t) => t.name.toLowerCase() === lower);
    if (knownToolMatch) {
      neededMcpServerIds.add(knownToolMatch.serverId);
      specificMcpToolNames.add(knownToolMatch.name);
      continue;
    }

    const sepIdx = token.indexOf("__");
    if (sepIdx > 0) {
      const srvPrefix = token.slice(0, sepIdx).toLowerCase();
      const srv = allMcpServers.find((s) => s.name.trim().toLowerCase() === srvPrefix);
      if (srv) {
        neededMcpServerIds.add(srv.id);
        specificMcpToolNames.add(token);
      }
    }
  }

  // If any injected skill has runnable scripts, automatically provide execute_skill_script
  const selectedSkills = Array.from(skillMap.values());
  if (selectedSkills.some((s) => getSkillScripts(s.dirPath).length > 0)) {
    const execScriptTool = allBuiltIn.find((t) => t.name.trim() === "execute_skill_script");
    if (execScriptTool) addBuiltIn(execScriptTool);
  }

  let mcpTools: McpToolDefinition[] = [];
  if (neededMcpServerIds.size > 0) {
    const fetchedTools = await mcpManager.getToolsForServers(Array.from(neededMcpServerIds), true);
    const specificLower = new Set(Array.from(specificMcpToolNames).map((n) => n.toLowerCase()));
    mcpTools = fetchedTools.filter(
      (t) => fullMcpServerIds.has(t.serverId) || specificLower.has(t.name.toLowerCase())
    );
  }

  const selectedBuiltInTools = Array.from(builtInMap.values());
  const hasInjections =
    selectedBuiltInTools.length > 0 || selectedSkills.length > 0 || mcpTools.length > 0;

  return {
    hasInjections,
    mcpTools,
    selectedSkills,
    selectedBuiltInTools,
  };
}
