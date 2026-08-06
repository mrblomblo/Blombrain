import type { BuiltInToolDefinition, BuiltInToolContext } from "./types.js";
import { getCurrentTimeTool } from "./tools/getCurrentTime.js";
import { executeSkillScriptToolDef } from "./tools/executeSkillScript.js";

export * from "./types.js";

class BuiltInToolRegistry {
  private tools = new Map<string, BuiltInToolDefinition>();

  constructor() {
    this.register(getCurrentTimeTool);
    this.register(executeSkillScriptToolDef);
  }

  public register(tool: BuiltInToolDefinition) {
    this.tools.set(tool.name, tool);
  }

  public getTool(name: string): BuiltInToolDefinition | undefined {
    return this.tools.get(name);
  }

  public getAllTools(): BuiltInToolDefinition[] {
    return Array.from(this.tools.values());
  }

  public getAvailableTools(ctx: BuiltInToolContext = {}): BuiltInToolDefinition[] {
    return this.getAllTools().filter((t) => (t.isAvailable ? t.isAvailable(ctx) : true));
  }

  public getOpenAIToolSchemas(ctx: BuiltInToolContext = {}): any[] {
    return this.getAvailableTools(ctx).map((t) => {
      const params = typeof t.parameters === "function" ? t.parameters(ctx) : t.parameters;
      return {
        type: "function" as const,
        function: {
          name: t.name,
          description: t.description,
          parameters: params,
        },
      };
    });
  }

  public async executeTool(
    name: string,
    args: Record<string, any>,
    ctx: BuiltInToolContext
  ): Promise<{ content: string; isError?: boolean }> {
    const tool = this.getTool(name);
    if (!tool) {
      return { content: `[built-in tool] Tool '${name}' not found`, isError: true };
    }
    return tool.execute(args, ctx);
  }
}

export const builtInToolRegistry = new BuiltInToolRegistry();
