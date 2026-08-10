export interface ToolVisibilityOptions {
  allowNetwork?: boolean;
}

export interface BuiltInToolContext {
  conversationId?: string;
  activeSkillIds?: string[];
  activeSkills?: any[];
  abortSignal?: AbortSignal;
  uploadsDir?: string;
  emitEvent?: (type: string, payload: Record<string, any>) => void;
}

export interface BuiltInToolDefinition {
  name: string;
  description: string;
  category?: string;
  parameters: Record<string, any> | ((ctx?: BuiltInToolContext) => Record<string, any>);
  /** Optional predicate: whether this tool is available for the given turn context (defaults to true) */
  isAvailable?: (ctx?: BuiltInToolContext) => boolean;
  requiresNetwork?: boolean;
  cacheable?: boolean;
  execute: (
    args: Record<string, any>,
    ctx: BuiltInToolContext
  ) => Promise<{ content: string; isError?: boolean }>;
}
