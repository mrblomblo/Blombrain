import { mcpManager, type McpToolDefinition } from "./mcp.js";
import { getAllSkills } from "./skills.js";
import type { SkillOut } from "../types.js";
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

export function parseRouterOutput(text: string): { tools: string[]; skills: string[] } {
  // Strip markdown code fences if present
  let cleaned = text.replace(/```(?:json)?([\s\S]*?)```/gi, "$1").trim();

  // Match first JSON object in text
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (match) {
    cleaned = match[0];
  }

  const parsed = JSON.parse(cleaned);
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
    let reasoningMode: "oob" | "inband" | null = null;

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
      .replace(/<think>[\s\S]*?<\/think>/gi, "")
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

export async function routeToolsAndSkills(
  userQuery: string,
  excludedMcps: string[] = [],
  excludedSkills: string[] = [],
  forceTools: string[] = [],
  activeModelId?: string,
  contextLimit?: number | null,
  onToken?: (text: string) => void,
  priorContext?: string,
  signal?: AbortSignal
): Promise<ToolRoutingResult> {
  // Check global settings for tool_routing_mode, tool_routing_model, and network_tools_enabled
  const settingsRow = db.prepare("SELECT tool_routing_mode, tool_routing_model, network_tools_enabled FROM global_settings LIMIT 1").get() as any;
  const allowNetwork = !!settingsRow?.network_tools_enabled;

  const allMcpTools = await mcpManager.getAvailableTools(excludedMcps);
  const allSkills = getAllSkills(excludedSkills).filter((s) => s.isEnabled);
  const allBuiltInTools = builtInToolRegistry.getAvailableTools(
    { activeSkills: allSkills },
    { allowNetwork }
  );

  // Single unified token estimation (1 token ~= 4 chars)
  const totalSchemaLength = JSON.stringify(allMcpTools).length + JSON.stringify(allSkills).length + JSON.stringify(allBuiltInTools).length;
  const estimatedTokens = Math.ceil(totalSchemaLength / 4);

  const mode = settingsRow?.tool_routing_mode || "off";
  const designatedModel = settingsRow?.tool_routing_model;

  // Determine whether to run LLM pre-pass:
  // - If mode is 'off', auto-trigger routing once tool/skill schemas would eat
  //   more than 30% of the target model's context window (capped at 20,000
  //   tokens as an absolute ceiling for models with very large/no limit set).
  // - If mode is 'active_model' or 'designated_model', always run router
  const dynamicRoutingThreshold =
    contextLimit && contextLimit > 0 ? Math.min(20000, Math.floor(contextLimit * 0.30)) : 20000;
  const shouldRoute = mode !== "off" || estimatedTokens >= dynamicRoutingThreshold;

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

  try {
    const toolsCatalog = [
      ...allBuiltInTools.map((t) => ({
        name: t.name,
        description: t.description ? t.description.trim().slice(0, 300) : "No description",
      })),
      ...allMcpTools.map((t) => ({
        name: t.name,
        description: t.description ? t.description.trim().slice(0, 300) : "No description",
      })),
    ];

    const skillsCatalog = allSkills.map((s) => ({
      name: s.name,
      description: s.description ? s.description.trim().slice(0, 300) : "No description",
    }));

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
      (t) => selectedToolNames.includes(t.name) || forceTools.includes(t.name)
    );

    const selectedBuiltInTools = allBuiltInTools.filter(
      (t) => selectedToolNames.includes(t.name) || forceTools.includes(t.name)
    );

    const selectedSkills = allSkills.filter(
      (s) => selectedSkillNames.includes(s.name) || forceTools.includes(s.name)
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
    if (signal?.aborted || (err instanceof Error && (err.name === "AbortError" || err.message.includes("aborted")))) {
      return {
        mcpTools: [],
        selectedSkills: [],
        selectedBuiltInTools: [],
      };
    }
    console.warn("[toolRouter] LLM pre-pass failed, failing open with all tools/skills:", err);
    return {
      mcpTools: allMcpTools,
      selectedSkills: allSkills,
      selectedBuiltInTools: allBuiltInTools,
    };
  }
}
