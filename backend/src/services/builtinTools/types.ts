export interface ToolVisibilityOptions {
  allowNetwork?: boolean;
  allowMemory?: boolean;
  allowCrossChatRecall?: boolean;
  disabledTools?: string[];
}

export interface BuiltInToolContext {
  conversationId?: string;
  callId?: string;
  activeSkillIds?: string[];
  activeSkills?: any[];
  abortSignal?: AbortSignal;
  uploadsDir?: string;
  memoryEnabled?: boolean;
  crossChatRecallEnabled?: boolean;
  crossChatIncludeArchived?: boolean;
  workspacePath?: string | null;
  workspaceWriteEnabled?: boolean;
  workspaceApprovalMode?: "auto" | "ask";
  autoApproveCommands?: boolean;
  isTurnWriteApproved?: () => boolean;
  markTurnWriteApproved?: () => void;
  emitEvent?: (type: string, payload: Record<string, any>) => void;
}

export interface BuiltInToolResult {
  content: string;
  isError?: boolean;
  checkpointId?: string;
  diffPreview?: string;
  commandPreview?: string;
  cwd?: string;
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
  ) => Promise<BuiltInToolResult>;
}
