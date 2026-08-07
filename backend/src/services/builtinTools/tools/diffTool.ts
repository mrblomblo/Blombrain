import type { BuiltInToolDefinition } from "../types.js";

const MAX_DIFF_INPUT = 200_000;
const MAX_DIFF_LINES = 2_000;
const MAX_DIFF_PRODUCT = 4_100_000;

type DiffOp = {
    type: "equal" | "add" | "remove";
    value: string;
};

function clamp(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max);
}

function splitLines(text: string): string[] {
    if (text.length === 0) {
        return [];
    }

    const lines = text.split(/\r?\n/);

    // Ignore a final trailing newline for simpler diffs.
    if (lines[lines.length - 1] === "") {
        lines.pop();
    }

    return lines;
}

function computeLineDiff(oldText: string, newText: string): DiffOp[] {
    const oldLines = splitLines(oldText);
    const newLines = splitLines(newText);

    if (oldLines.length > MAX_DIFF_LINES || newLines.length > MAX_DIFF_LINES) {
        throw new Error(
            `Too many lines. Maximum supported line count is ${MAX_DIFF_LINES} per input.`
        );
    }

    const product = (oldLines.length + 1) * (newLines.length + 1);

    if (product > MAX_DIFF_PRODUCT) {
        throw new Error(
            "Diff is too large. Reduce the number of lines in old_text and new_text."
        );
    }

    const cols = newLines.length + 1;
    const dp = new Uint16Array((oldLines.length + 1) * cols);

    for (let i = 1; i <= oldLines.length; i++) {
        for (let j = 1; j <= newLines.length; j++) {
            const idx = i * cols + j;

            if (oldLines[i - 1] === newLines[j - 1]) {
                dp[idx] = dp[(i - 1) * cols + (j - 1)] + 1;
            } else {
                dp[idx] = Math.max(dp[(i - 1) * cols + j], dp[i * cols + (j - 1)]);
            }
        }
    }

    const ops: DiffOp[] = [];

    let i = oldLines.length;
    let j = newLines.length;

    while (i > 0 && j > 0) {
        if (oldLines[i - 1] === newLines[j - 1]) {
            ops.push({
                type: "equal",
                value: oldLines[i - 1],
            });

            i--;
            j--;
        } else if (dp[(i - 1) * cols + j] >= dp[i * cols + (j - 1)]) {
            ops.push({
                type: "remove",
                value: oldLines[i - 1],
            });

            i--;
        } else {
            ops.push({
                type: "add",
                value: newLines[j - 1],
            });

            j--;
        }
    }

    while (i > 0) {
        ops.push({
            type: "remove",
            value: oldLines[i - 1],
        });

        i--;
    }

    while (j > 0) {
        ops.push({
            type: "add",
            value: newLines[j - 1],
        });

        j--;
    }

    ops.reverse();

    return ops;
}

function buildHunks(ops: DiffOp[], contextLines: number) {
    const changeIndices: number[] = [];

    ops.forEach((op, index) => {
        if (op.type !== "equal") {
            changeIndices.push(index);
        }
    });

    if (changeIndices.length === 0) {
        return [];
    }

    const ranges: Array<{ start: number; end: number }> = [];

    for (const changeIndex of changeIndices) {
        const start = Math.max(0, changeIndex - contextLines);
        const end = Math.min(ops.length - 1, changeIndex + contextLines);

        const last = ranges[ranges.length - 1];

        if (last && start <= last.end + 1) {
            last.end = Math.max(last.end, end);
        } else {
            ranges.push({ start, end });
        }
    }

    return ranges.map((range) => {
        let oldConsumed = 0;
        let newConsumed = 0;

        for (let k = 0; k < range.start; k++) {
            const op = ops[k];

            if (op.type !== "add") {
                oldConsumed++;
            }

            if (op.type !== "remove") {
                newConsumed++;
            }
        }

        let oldLines = 0;
        let newLines = 0;

        const lines: string[] = [];

        for (let k = range.start; k <= range.end; k++) {
            const op = ops[k];

            if (op.type === "equal") {
                lines.push(` ${op.value}`);
                oldLines++;
                newLines++;
            } else if (op.type === "remove") {
                lines.push(`-${op.value}`);
                oldLines++;
            } else {
                lines.push(`+${op.value}`);
                newLines++;
            }
        }

        const oldStart = oldConsumed + (oldLines === 0 ? 0 : 1);
        const newStart = newConsumed + (newLines === 0 ? 0 : 1);

        const header = `@@ -${oldStart},${oldLines} +${newStart},${newLines} @@`;

        return {
            header,
            lines,
        };
    });
}

export const diffTool: BuiltInToolDefinition = {
    name: "diff_tool",
    description:
        "Produce a simple line-based diff between two text inputs. Useful for code review, editing assistance, showing what changed, and patch-style workflows. Runs fully offline.",
    parameters: {
        type: "object",
        properties: {
            old_text: {
                type: "string",
                description: "Original text.",
            },
            new_text: {
                type: "string",
                description: "Modified text.",
            },
            context_lines: {
                type: "integer",
                description:
                    "Number of unchanged context lines to include around each change. Defaults to 3.",
            },
        },
        required: ["old_text", "new_text"],
    },
    execute: async (args) => {
        const oldText = typeof args.old_text === "string" ? args.old_text : "";
        const newText = typeof args.new_text === "string" ? args.new_text : "";

        try {
            if (oldText.length > MAX_DIFF_INPUT || newText.length > MAX_DIFF_INPUT) {
                return {
                    content: JSON.stringify(
                        {
                            error: `Input text is too large. Maximum input length is ${MAX_DIFF_INPUT} characters.`,
                        },
                        null,
                        2
                    ),
                    isError: true,
                };
            }

            const ops = computeLineDiff(oldText, newText);

            let additions = 0;
            let deletions = 0;

            for (const op of ops) {
                if (op.type === "add") {
                    additions++;
                } else if (op.type === "remove") {
                    deletions++;
                }
            }

            if (additions === 0 && deletions === 0) {
                return {
                    content: JSON.stringify(
                        {
                            changed: false,
                            additions: 0,
                            deletions: 0,
                            hunks: [],
                            unified_diff: "",
                        },
                        null,
                        2
                    ),
                };
            }

            const contextLines = Number.isInteger(args.context_lines)
                ? clamp(Number(args.context_lines), 0, 20)
                : 3;

            const hunks = buildHunks(ops, contextLines);

            const unified_diff =
                hunks.length > 0
                    ? `--- old\n+++ new\n${hunks
                        .map((hunk) => [hunk.header, ...hunk.lines].join("\n"))
                        .join("\n")}`
                    : "";

            return {
                content: JSON.stringify(
                    {
                        changed: true,
                        additions,
                        deletions,
                        context_lines: contextLines,
                        hunks,
                        unified_diff,
                    },
                    null,
                    2
                ),
            };
        } catch (err) {
            return {
                content: JSON.stringify(
                    {
                        error: err instanceof Error ? err.message : String(err),
                    },
                    null,
                    2
                ),
                isError: true,
            };
        }
    },
};
