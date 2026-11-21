import test from "node:test";
import assert from "node:assert/strict";
import { parseMessageSegments } from "./segmentParser.ts";
import type { ToolExecutionEvent } from "../types.ts";

test("renders active awaiting_approval workspace_write even if a prior round reused the same callId", () => {
  const completedRound1 = `<tool_execution>${JSON.stringify({
    callId: "ollama_tc_0",
    toolName: "workspace_list",
    args: { path: "." },
    cacheable: false,
    result: "Workspace entries...",
    status: "completed",
  })}</tool_execution>\n`;

  const liveExecutions: ToolExecutionEvent[] = [
    {
      callId: "ollama_tc_0",
      toolName: "workspace_write",
      args: { path: "newfile.html", content: "<h1>Hi</h1>" },
      cacheable: false,
      status: "awaiting_approval",
      message: "Approve creating 'newfile.html'?",
      diffPreview: "--- /dev/null\n+++ b/newfile.html\n@@ -0,0 +1,1 @@\n+<h1>Hi</h1>",
    },
  ];

  const segments = parseMessageSegments(completedRound1, undefined, liveExecutions);
  const toolSegs = segments.filter((s) => s.type === "tool");
  assert.equal(toolSegs.length, 2);
  assert.equal(toolSegs[0].execution?.toolName, "workspace_list");
  assert.equal(toolSegs[1].execution?.toolName, "workspace_write");
  assert.equal(toolSegs[1].execution?.status, "awaiting_approval");
});

test("does not duplicate a completed tool execution that is already present in rawContent", () => {
  const completed: ToolExecutionEvent = {
    callId: "call_unique_1",
    toolName: "workspace_write",
    args: { path: "app.ts", content: "export {};" },
    cacheable: false,
    result: "Created 'app.ts'",
    status: "completed",
  };
  const raw = `<tool_execution>${JSON.stringify(completed)}</tool_execution>\nDone!`;
  const segments = parseMessageSegments(raw, undefined, [completed]);
  const toolSegs = segments.filter((s) => s.type === "tool");
  assert.equal(toolSegs.length, 1);
  assert.equal(toolSegs[0].execution?.callId, "call_unique_1");
});
