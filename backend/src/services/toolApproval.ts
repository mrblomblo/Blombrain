export type ApprovalDecision = "approved" | "approved_all_turn" | "rejected";

export interface PendingToolApproval {
  conversationId: string;
  callId: string;
  toolName: string;
  resolve: (decision: ApprovalDecision) => void;
}

const pendingApprovals = new Map<string, PendingToolApproval>();

export function resolveToolApproval(
  callId: string,
  decision: ApprovalDecision
): boolean {
  const entry = pendingApprovals.get(callId);
  if (!entry) return false;
  pendingApprovals.delete(callId);
  entry.resolve(decision);
  return true;
}

export async function requestToolApproval(params: {
  conversationId?: string;
  callId?: string;
  toolName: string;
  args: Record<string, any>;
  diffPreview?: string;
  commandPreview?: string;
  cwd?: string;
  message?: string;
  emitEvent?: (type: string, payload: Record<string, any>) => void;
  abortSignal?: AbortSignal;
}): Promise<ApprovalDecision> {
  const callId = params.callId || `approval_${Date.now()}`;
  const conversationId = params.conversationId || "";

  if (!params.emitEvent) {
    // If running in a headless context without an SSE emitter, fail safe by rejecting
    return "rejected";
  }

  params.emitEvent("tool_execution", {
    callId,
    toolName: params.toolName,
    args: params.args,
    cacheable: false,
    status: "awaiting_approval",
    diffPreview: params.diffPreview,
    commandPreview: params.commandPreview,
    cwd: params.cwd,
    message: params.message || "Waiting for user approval...",
  });

  return new Promise<ApprovalDecision>((resolve) => {
    let settled = false;
    const finish = (decision: ApprovalDecision) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      params.abortSignal?.removeEventListener("abort", onAbort);
      pendingApprovals.delete(callId);
      resolve(decision);
    };

    const onAbort = () => finish("rejected");
    if (params.abortSignal?.aborted) {
      finish("rejected");
      return;
    }
    params.abortSignal?.addEventListener("abort", onAbort, { once: true });

    const timer = setTimeout(() => {
      finish("rejected");
    }, 10 * 60_000);

    pendingApprovals.set(callId, {
      conversationId,
      callId,
      toolName: params.toolName,
      resolve: finish,
    });
  });
}
