import { describe, it, expect } from "vitest";
import {
  estimateTokens,
  estimateMessagesTokens,
  estimateToolDefinitionsTokens,
  partitionMessageGroups,
  applyContextOverflowPolicy,
  filterReasoningContent,
} from "../contextWindow.js";

describe("contextWindow service", () => {
  describe("estimateTokens", () => {
    it("estimates simple strings conservatively", () => {
      const text = "Hello world"; // 11 chars -> ceil(11/3) + 4 = 8
      expect(estimateTokens(text)).toBe(8);
    });

    it("handles base64 image trap without ballooning token counts", () => {
      const largeBase64 = "A".repeat(100000);
      const multimodalContent = [
        { type: "text", text: "Look at this image:" },
        { type: "image_url", image_url: { url: `data:image/png;base64,${largeBase64}` } },
      ];
      // Should be 4 + ceil(19/3) + 1024 = 1035 tokens, NOT 33,000+ tokens!
      const tokens = estimateTokens(multimodalContent);
      expect(tokens).toBeLessThan(2000);
      expect(tokens).toBeGreaterThan(1000);
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
        { role: "assistant", content: "Res 1 " + "X".repeat(500) },
        { role: "user", content: "Turn 2 " + "Y".repeat(500) },
        { role: "assistant", content: "Res 2 " + "Z".repeat(500) },
        { role: "user", content: "Latest Query: Fix navbar" },
      ];

      const result = applyContextOverflowPolicy({
        messages,
        contextLimit: 600,
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
      expect(resultContents).not.toContain("Res 1 " + "X".repeat(500));
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
