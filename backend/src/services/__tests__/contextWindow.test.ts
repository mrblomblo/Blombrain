import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  estimateTokens,
  partitionMessageGroups,
  applyContextOverflowPolicy,
  filterReasoningContent,
  pruneToolDefinitionsToFit,
} from "../contextWindow.js";

describe("contextWindow service", () => {
  describe("pruneToolDefinitionsToFit", () => {
    const makeTool = (name: string) => ({
      type: "function",
      function: { name, description: "x".repeat(200), parameters: { type: "object", properties: {} } },
    });

    it("drops built-in tools before MCP tools", () => {
      const tools = [makeTool("execute_skill_script"), makeTool("mcpserver__search")];
      const result = pruneToolDefinitionsToFit(tools, 20, []);
      assert.equal(result.toolDefinitions.some((t: any) => t.function.name === "execute_skill_script"), false);
    });

    it("never drops forced tools while non-forced tools remain", () => {
      const tools = [makeTool("mcpserver__forced"), makeTool("mcpserver__other")];
      const result = pruneToolDefinitionsToFit(tools, 130, ["mcpserver__forced"]);
      assert.equal(result.toolDefinitions.some((t: any) => t.function.name === "mcpserver__forced"), true);
      assert.equal(result.toolDefinitions.some((t: any) => t.function.name === "mcpserver__other"), false);
    });
  });

  describe("applyContextOverflowPolicy tool pruning fallback", () => {
    it("prunes tool schemas instead of failing when they alone blow the budget", () => {
      const messages = [
        { role: "system", content: "System" },
        { role: "user", content: "Query" },
      ];
      const toolDefinitions = Array.from({ length: 20 }, (_, i) => ({
        type: "function",
        function: { name: `mcpserver__tool_${i}`, description: "x".repeat(500), parameters: {} },
      }));

      const result = applyContextOverflowPolicy({
        messages,
        toolDefinitions,
        contextLimit: 2000,
        completionReserve: 200,
        safetyReserve: 100,
        behavior: "truncate_middle",
      });

      assert.equal(result.action, "proceed");
      assert.ok(result.prunedToolCount > 0);
      assert.ok(result.toolDefinitions.length < toolDefinitions.length);
    });

    it("still returns impossible_fit when system+query alone exceed budget, even with 0 tools", () => {
      const messages = [
        { role: "system", content: "System " + "X".repeat(3000) },
        { role: "user", content: "Query " + "Y".repeat(3000) },
      ];

      const result = applyContextOverflowPolicy({
        messages,
        toolDefinitions: [],
        contextLimit: 500,
        completionReserve: 100,
        safetyReserve: 50,
        behavior: "truncate_middle",
      });

      assert.equal(result.action, "impossible_fit");
    });
  });

  describe("estimateTokens", () => {
    it("estimates simple strings conservatively", () => {
      const text = "Hello world"; // 11 chars -> ceil(11/4) + 4 = 7
      assert.equal(estimateTokens(text), 7);
    });

    it("handles base64 image trap without ballooning token counts", () => {
      const largeBase64 = "A".repeat(100000);
      const multimodalContent = [
        { type: "text", text: "Look at this image:" },
        { type: "image_url", image_url: { url: `data:image/png;base64,${largeBase64}` } },
      ];
      // Should be 4 + ceil(19/4) + 510 = 519 tokens, NOT 33,000+ tokens!
      const tokens = estimateTokens(multimodalContent);
      assert.ok(tokens < 2000);
      assert.ok(tokens > 400);
    });
  });

  describe("partitionMessageGroups", () => {
    it("preserves system prompt and binds injected system reminder to first user anchor", () => {
      const messages = [
        { role: "system", content: "System prompt instructions" },
        { role: "system", content: 'Reminder: the user\'s actual request for this turn is: "Build app"' },
        { role: "user", content: "Build app" },
        { role: "assistant", content: "Sure!" },
        { role: "user", content: "Change color to blue" },
        { role: "assistant", content: "Done!" },
      ];

      const groups = partitionMessageGroups(messages);
      assert.equal(groups.length, 4);
      assert.equal(groups[0].kind, "system");
      assert.equal(groups[1].kind, "first_user_anchor");
      assert.equal(groups[1].messages.length, 2); // Injected reminder + user message!
    });

    it("groups assistant tool_calls with subsequent tool responses atomically", () => {
      const messages = [
        { role: "system", content: "System prompt" },
        { role: "user", content: "Run script" },
        {
          role: "assistant",
          content: "Running...",
          tool_calls: [{ id: "call_1", function: { name: "test", arguments: "{}" } }],
        },
        { role: "tool", tool_call_id: "call_1", content: "Output 1" },
        { role: "assistant", content: "Finished running tool." },
        { role: "user", content: "What next?" },
      ];

      const groups = partitionMessageGroups(messages);
      assert.equal(groups.some((g) => g.kind === "tool_round"), true);

      const toolRound = groups.find((g) => g.kind === "tool_round")!;
      assert.equal(toolRound.messages.length, 3); // Assistant tool call + Tool result + Assistant continuation!
    });
  });

  describe("applyContextOverflowPolicy", () => {
    it("proceeds without trimming if within prompt budget", () => {
      const messages = [
        { role: "system", content: "System" },
        { role: "user", content: "Hello" },
      ];
      const result = applyContextOverflowPolicy({
        messages,
        contextLimit: 8192,
        completionReserve: 1000,
        behavior: "truncate_middle",
      });

      assert.equal(result.action, "proceed");
      assert.equal(result.trimmed, false);
    });

    it("stops generation if behavior is 'stop' and budget exceeded", () => {
      const messages = [
        { role: "system", content: "A".repeat(3000) },
        { role: "user", content: "B".repeat(3000) },
      ];
      const result = applyContextOverflowPolicy({
        messages,
        contextLimit: 1000,
        completionReserve: 200,
        safetyReserve: 100,
        behavior: "stop",
      });

      assert.equal(result.action, "stop");
      assert.equal(result.trimmed, false);
    });

    it("applies truncate_middle by keeping system + first user anchor + newest query", () => {
      const messages = [
        { role: "system", content: "System prompt" },
        { role: "user", content: "Initial Task: Create website" },
        { role: "assistant", content: "Res 1 " + "X".repeat(2000) },
        { role: "user", content: "Turn 2 " + "Y".repeat(2000) },
        { role: "assistant", content: "Res 2 " + "Z".repeat(2000) },
        { role: "user", content: "Latest Query: Fix navbar" },
      ];

      const result = applyContextOverflowPolicy({
        messages,
        contextLimit: 1000,
        completionReserve: 100,
        safetyReserve: 50,
        behavior: "truncate_middle",
      });

      assert.equal(result.action, "proceed");
      assert.equal(result.trimmed, true);

      const resultContents = result.messages.map((m) => m.content);
      assert.ok(resultContents.includes("System prompt"));
      assert.ok(resultContents.includes("Initial Task: Create website"));
      assert.ok(resultContents.includes("Latest Query: Fix navbar"));
      assert.ok(!resultContents.includes("Res 1 " + "X".repeat(2000)));
    });

    it("triggers impossible_fit when system prompt + query alone exceed prompt budget", () => {
      const messages = [
        { role: "system", content: "System " + "X".repeat(3000) },
        { role: "user", content: "Query " + "Y".repeat(3000) },
      ];

      const result = applyContextOverflowPolicy({
        messages,
        contextLimit: 500,
        completionReserve: 100,
        safetyReserve: 50,
        behavior: "truncate_middle",
      });

      assert.equal(result.action, "impossible_fit");
    });
  });

  describe("filterReasoningContent", () => {
    const messages = [
      { role: "user", content: "Query 1" },
      { role: "assistant", content: "<think>Step 1</think>\nAnswer 1" },
      { role: "user", content: "Query 2" },
      { role: "assistant", content: "<think>Step 2</think>\nAnswer 2" },
    ];

    it("leaves all reasoning tags intact for 'all' mode", () => {
      const res = filterReasoningContent(messages, "all");
      assert.ok(res[1].content.includes("<think>Step 1</think>"));
      assert.ok(res[3].content.includes("<think>Step 2</think>"));
    });

    it("strips past reasoning tags but keeps latest reasoning for 'latest' mode", () => {
      const res = filterReasoningContent(messages, "latest");
      assert.equal(res[1].content, "Answer 1");
      assert.ok(res[3].content.includes("<think>Step 2</think>"));
    });

    it("strips all reasoning tags for 'none' mode", () => {
      const res = filterReasoningContent(messages, "none");
      assert.equal(res[1].content, "Answer 1");
      assert.equal(res[3].content, "Answer 2");
    });
  });
});
