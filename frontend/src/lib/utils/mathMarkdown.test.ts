import test from "node:test";
import assert from "node:assert/strict";
import { extractAndRenderMath } from "./mathMarkdown.ts";

test("currency expressions like $5 and $10 are not treated as math", () => {
  const inputs = [
    "It costs $5 and $10.",
    "Prices range from ($10) to ($20).",
    "Budget: $12.50, actual: $15.75.",
    "Compare $5/$10 tiers.",
    "Revenue went from $100k to $200k.",
    "He paid \\$5 and \\$10.",
  ];

  for (const input of inputs) {
    const { slots, content } = extractAndRenderMath(input);
    assert.equal(slots.length, 0, `Expected no math slots for: ${input}`);
    assert.equal(content, input);
  }
});

test("code spans and fenced code blocks keep $VAR and math delimiters untouched", () => {
  const inlineCode = "Run `echo $HOME and $USER` or `$x + y$` here.";
  const inlineRes = extractAndRenderMath(inlineCode);
  assert.equal(inlineRes.slots.length, 0);
  assert.equal(inlineRes.content, inlineCode);

  const fencedCode = [
    "Example:",
    "```bash",
    "echo $HOME",
    "val=$((1 + 2))",
    "echo $$",
    "```",
  ].join("\n");
  const fencedRes = extractAndRenderMath(fencedCode);
  assert.equal(fencedRes.slots.length, 0);
  assert.equal(fencedRes.content, fencedCode);

  const unclosedFence = "Streaming:\n```tex\n$$x^2 + y^2$$\n$a + b$";
  const unclosedRes = extractAndRenderMath(unclosedFence);
  assert.equal(unclosedRes.slots.length, 0);
  assert.equal(unclosedRes.content, unclosedFence);
});

test("inline and display LaTeX delimiters render safely with KaTeX", () => {
  const md = [
    "Inline $x^2 + y^2 = z^2$ and \\(e^{i\\pi} + 1 = 0\\).",
    "",
    "$$\\int_0^1 x^2\\,dx = \\frac{1}{3}$$",
    "",
    "\\[\\sum_{n=1}^{\\infty} \\frac{1}{n^2} = \\frac{\\pi^2}{6}\\]",
  ].join("\n");

  const { content, slots } = extractAndRenderMath(md);
  assert.equal(slots.length, 4);
  assert.equal(slots[0].displayMode, false);
  assert.equal(slots[1].displayMode, false);
  assert.equal(slots[2].displayMode, true);
  assert.equal(slots[3].displayMode, true);
  assert(slots[0].html.includes("katex"));
  assert(slots[2].html.includes("katex-display"));
  assert(content.includes(slots[0].token));
  assert(content.includes(slots[2].token));
});

test("KaTeX rejects unsafe javascript: links via trust: false", () => {
  const payload = "$$\\href{javascript:alert(1)}{click me}$$";
  const { slots } = extractAndRenderMath(payload);
  assert.equal(slots.length, 1);
  assert.equal(
    /href\s*=\s*["']\s*javascript:/i.test(slots[0].html),
    false,
    `Unsafe href must not appear: ${slots[0].html}`,
  );
  assert.equal(slots[0].html.includes("<script"), false);
});

test("matrices with \\\\ row breaks inside \\[...\\] and $$...$$ stay intact", () => {
  const md = "\\[\\begin{bmatrix} 1 & 2 \\\\ 3 & 4 \\end{bmatrix}\\]";
  const { slots } = extractAndRenderMath(md);
  assert.equal(slots.length, 1);
  assert.equal(slots[0].displayMode, true);
  assert(slots[0].html.includes("katex-display"));
});
