import { describe, it, expect } from "vitest";
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
      expect(result.toolDefinitions.some((t: any) => t.function.name === "execute_skill_script")).toBe(false);
    });

    it("never drops forced tools while non-forced tools remain", () => {
      const tools = [makeTool("mcpserver__forced"), makeTool("mcpserver__other")];
      const result = pruneToolDefinitionsToFit(tools, 1, ["mcpserver__forced"]);
      expect(result.toolDefinitions.some((t: any) => t.function.name === "mcpserver__forced")).toBe(true);
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

      expect(result.action).toBe("proceed");
      expect(result.prunedToolCount).toBeGreaterThan(0);
      expect(result.toolDefinitions.length).toBeLessThan(toolDefinitions.length);
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

      expect(result.action).toBe("impossible_fit");
    });
  });

  describe("estimateTokens", () => {
    it("estimates simple strings conservatively", () => {
      const text = "Hello world"; // 11 chars -> ceil(11/4) + 4 = 7
      expect(estimateTokens(text)).toBe(7);
    });

    it("handles base64 image trap without ballooning token counts", () => {
      const largeBase64 = "A".repeat(100000);
      const multimodalContent = [
        { type: "text", text: "Look at this image:" },
        { type: "image_url", image_url: { url: `data:image/png;base64,${largeBase64}` } },
      ];
      // Should be 4 + ceil(19/4) + 510 = 519 tokens, NOT 33,000+ tokens!
      const tokens = estimateTokens(multimodalContent);
      expect(tokens).toBeLessThan(2000);
      expect(tokens).toBeGreaterThan(400);
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
      expect(groups.length).toBe(4);
      expect(groups[0].kind).toBe("system");
      expect(groups[1].kind).toBe("first_user_anchor");
      expect(groups[1].messages.length).toBe(2); // Injected reminder + user message!
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
      expect(groups.some((g) => g.kind === "tool_round")).toBe(true);

      const toolRound = groups.find((g) => g.kind === "tool_round")!;
      expect(toolRound.messages.length).toBe(3); // Assistant tool call + Tool result + Assistant continuation!
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

      expect(result.action).toBe("proceed");
      expect(result.trimmed).toBe(false);
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

      expect(result.action).toBe("stop");
      expect(result.trimmed).toBe(false);
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

      expect(result.action).toBe("proceed");
      expect(result.trimmed).toBe(true);

      const resultContents = result.messages.map((m) => m.content);
      expect(resultContents).toContain("System prompt");
      expect(resultContents).toContain("Initial Task: Create website");
      expect(resultContents).toContain("Latest Query: Fix navbar");
      expect(resultContents).not.toContain("Res 1 " + "X".repeat(2000));
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

      expect(result.action).toBe("impossible_fit");
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
      expect(res[1].content).toContain("<think>Step 1</think>");
      expect(res[3].content).toContain("<think>Step 2</think>");
    });

    it("strips past reasoning tags but keeps latest reasoning for 'latest' mode", () => {
      const res = filterReasoningContent(messages, "latest");
      expect(res[1].content).toBe("Answer 1");
      expect(res[3].content).toContain("<think>Step 2</think>");
    });

    it("strips all reasoning tags for 'none' mode", () => {
      const res = filterReasoningContent(messages, "none");
      expect(res[1].content).toBe("Answer 1");
      expect(res[3].content).toBe("Answer 2");
    });
  });
});
