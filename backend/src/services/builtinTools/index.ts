import type { BuiltInToolDefinition, BuiltInToolContext, ToolVisibilityOptions } from "./types.js";
import { getCurrentTimeTool } from "./tools/getCurrentTime.js";
import { executeSkillScriptToolDef } from "./tools/executeSkillScript.js";
import { getRandomValueTool } from "./tools/getRandomValue.js";
import { encodeDecodeTool } from "./tools/encodeDecode.js";
import { jsonUtilsTool } from "./tools/jsonUtils.js";
import { textUtilsTool } from "./tools/textUtils.js";
import { mathEvalTool } from "./tools/mathEval.js";
import { unitConvertTool } from "./tools/unitConvert.js";
import { csvTool } from "./tools/csvTool.js";
import { pathTool } from "./tools/pathTool.js";
import { diffTool } from "./tools/diffTool.js";
import { dateMathTool } from "./tools/dateMathTool.js";
import { timezoneTool } from "./tools/timezoneTool.js";
import { percentageTool } from "./tools/percentageTool.js";
import { colorTool } from "./tools/colorTool.js";
import { getWeatherTool } from "./tools/getWeather.js";
import { searchWikipediaTool } from "./tools/searchWikipedia.js";

export * from "./types.js";

class BuiltInToolRegistry {
  private tools = new Map<string, BuiltInToolDefinition>();

  constructor() {
    this.register(getCurrentTimeTool);
    this.register(executeSkillScriptToolDef);
    this.register(getRandomValueTool);
    this.register(encodeDecodeTool);
    this.register(jsonUtilsTool);
    this.register(textUtilsTool);
    this.register(mathEvalTool);
    this.register(unitConvertTool);
    this.register(csvTool);
    this.register(pathTool);
    this.register(diffTool);
    this.register(dateMathTool);
    this.register(timezoneTool);
    this.register(percentageTool);
    this.register(colorTool);
    this.register(getWeatherTool);
    this.register(searchWikipediaTool);
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

  public getAvailableTools(
    ctx: BuiltInToolContext = {},
    options?: ToolVisibilityOptions
  ): BuiltInToolDefinition[] {
    return this.getAllTools().filter((t) => {
      if (t.requiresNetwork && !options?.allowNetwork) {
        return false;
      }
      return t.isAvailable ? t.isAvailable(ctx) : true;
    });
  }

  public getOpenAIToolSchemas(
    ctx: BuiltInToolContext = {},
    options?: ToolVisibilityOptions
  ): any[] {
    return this.getAvailableTools(ctx, options).map((t) => {
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
