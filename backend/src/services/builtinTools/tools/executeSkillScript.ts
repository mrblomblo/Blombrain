import type { BuiltInToolDefinition, BuiltInToolContext } from "../types.js";
import { executeSkillScriptTool } from "../../scriptExecution.js";
import { getSkillScripts } from "../../skills.js";

export function getExecuteSkillScriptParameters(ctx?: BuiltInToolContext): Record<string, any> {
  const activeSkills = ctx?.activeSkills ?? [];
  const activeSkillsWithScripts = activeSkills.filter(
    (s: any) => getSkillScripts(s.dirPath).length > 0
  );
  const names = activeSkillsWithScripts.map((s: any) => s.name);
  const ids = activeSkillsWithScripts.map((s: any) => s.id);

  return {
    type: "object",
    properties: {
      skill_name: {
        type: "string",
        ...(names.length > 0 ? { enum: names } : {}),
        description: "The name of the active skill that owns the script.",
      },
      skill_id: {
        type: "string",
        ...(ids.length > 0 ? { enum: ids } : {}),
        description: "The ID of the active skill that owns the script (optional).",
      },
      script_name: {
        type: "string",
        description:
          "The script filename inside the skill's scripts/ directory (e.g. 'init-artifact.sh'). Do not include paths or '..'.",
      },
      cwd: {
        type: "string",
        description:
          "Optional relative subdirectory to execute the script in (e.g. 'apex-fitness-landing'). Runs in the workspace root by default.",
      },
      args: {
        type: "array",
        description: "Command-line arguments to pass to the script (e.g. ['mrblomblo-portfolio']).",
        items: { type: "string" },
      },
    },
    required: ["skill_name", "script_name"],
  };
}

export const executeSkillScriptToolDef: BuiltInToolDefinition = {
  name: "execute_skill_script",
  description:
    "Execute a script provided by an active skill. The script runs in a conversation-scoped working directory. Returns stdout, stderr, and exit code.",
  parameters: getExecuteSkillScriptParameters,
  isAvailable: (ctx?: BuiltInToolContext) => {
    if (!ctx?.activeSkills || ctx.activeSkills.length === 0) return false;
    return ctx.activeSkills.some((s: any) => getSkillScripts(s.dirPath).length > 0);
  },
  execute: async (args: Record<string, any>, ctx: BuiltInToolContext) => {
    return executeSkillScriptTool(args, {
      conversationId: ctx.conversationId || "",
      activeSkillIds: ctx.activeSkillIds || [],
      abortSignal: ctx.abortSignal,
    });
  },
};
