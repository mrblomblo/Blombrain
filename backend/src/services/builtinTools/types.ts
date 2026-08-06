export interface BuiltInToolContext {
  conversationId?: string;
  activeSkillIds?: string[];
  activeSkills?: any[];
  abortSignal?: AbortSignal;
}

export interface BuiltInToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, any> | ((ctx?: BuiltInToolContext) => Record<string, any>);
  /** Optional predicate: whether this tool is available for the given turn context (defaults to true) */
  isAvailable?: (ctx?: BuiltInToolContext) => boolean;
  execute: (
    args: Record<string, any>,
    ctx: BuiltInToolContext
  ) => Promise<{ content: string; isError?: boolean }>;
}
