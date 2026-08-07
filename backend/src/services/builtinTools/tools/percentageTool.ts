import type { BuiltInToolDefinition } from "../types.js";

function requireNumber(args: Record<string, any>, ...names: string[]): number {
    for (const name of names) {
        const value = args[name];

        if (value === undefined || value === null || value === "") {
            continue;
        }

        const num = Number(value);

        if (!Number.isFinite(num)) {
            throw new Error(`${name} must be a finite number.`);
        }

        return num;
    }

    throw new Error(`Missing required number: ${names.join(" or ")}.`);
}

function roundValue(value: number, args: Record<string, any>): number {
    const digits = Number.isInteger(args.fraction_digits)
        ? Math.min(Math.max(Number(args.fraction_digits), 0), 15)
        : 6;

    const factor = 10 ** digits;

    return Math.round(value * factor) / factor;
}

export const percentageTool: BuiltInToolDefinition = {
    name: "percentage_tool",
    description:
        "Perform percentage calculations offline: percent of number, percentage increase/decrease, ratio to percent, percentage change, tip calculation, and discount calculation.",
    parameters: {
        type: "object",
        properties: {
            action: {
                type: "string",
                enum: [
                    "percent_of",
                    "increase",
                    "decrease",
                    "ratio_to_percent",
                    "percentage_change",
                    "tip",
                    "discount",
                ],
                description: "Percentage calculation to perform.",
            },
            percent: {
                type: "number",
                description: "Percentage value, e.g. 15 for 15%.",
            },
            value: {
                type: "number",
                description: "Base value for percent_of, increase, or decrease.",
            },
            numerator: {
                type: "number",
                description: "Numerator for ratio_to_percent.",
            },
            denominator: {
                type: "number",
                description: "Denominator for ratio_to_percent.",
            },
            old_value: {
                type: "number",
                description: "Starting value for percentage_change.",
            },
            new_value: {
                type: "number",
                description: "Ending value for percentage_change.",
            },
            amount: {
                type: "number",
                description: "Amount for tip or discount calculations.",
            },
            fraction_digits: {
                type: "integer",
                description:
                    "Number of decimal places to round to. Defaults to 6.",
            },
        },
        required: ["action"],
    },
    execute: async (args) => {
        const action = typeof args.action === "string" ? args.action : "";

        try {
            if (action === "percent_of") {
                const percent = requireNumber(args, "percent", "percentage", "rate");
                const value = requireNumber(args, "value", "base", "of");

                const result = (percent / 100) * value;

                return {
                    content: JSON.stringify(
                        {
                            action,
                            percent,
                            value,
                            result: roundValue(result, args),
                        },
                        null,
                        2
                    ),
                };
            }

            if (action === "increase") {
                const percent = requireNumber(args, "percent", "percentage", "rate");
                const value = requireNumber(args, "value", "base", "amount");

                const increaseAmount = (percent / 100) * value;
                const result = value + increaseAmount;

                return {
                    content: JSON.stringify(
                        {
                            action,
                            percent,
                            value,
                            increase_amount: roundValue(increaseAmount, args),
                            result: roundValue(result, args),
                        },
                        null,
                        2
                    ),
                };
            }

            if (action === "decrease") {
                const percent = requireNumber(args, "percent", "percentage", "rate");
                const value = requireNumber(args, "value", "base", "amount");

                const decreaseAmount = (percent / 100) * value;
                const result = value - decreaseAmount;

                return {
                    content: JSON.stringify(
                        {
                            action,
                            percent,
                            value,
                            decrease_amount: roundValue(decreaseAmount, args),
                            result: roundValue(result, args),
                        },
                        null,
                        2
                    ),
                };
            }

            if (action === "ratio_to_percent") {
                const numerator = requireNumber(args, "numerator", "part");
                const denominator = requireNumber(args, "denominator", "whole", "total");

                if (denominator === 0) {
                    return {
                        content: JSON.stringify(
                            {
                                error: "denominator cannot be zero.",
                            },
                            null,
                            2
                        ),
                        isError: true,
                    };
                }

                const result = (numerator / denominator) * 100;

                return {
                    content: JSON.stringify(
                        {
                            action,
                            numerator,
                            denominator,
                            ratio: roundValue(numerator / denominator, args),
                            percent: roundValue(result, args),
                        },
                        null,
                        2
                    ),
                };
            }

            if (action === "percentage_change") {
                const oldValue = requireNumber(args, "old_value", "from", "start");
                const newValue = requireNumber(args, "new_value", "to", "end");

                if (oldValue === 0) {
                    return {
                        content: JSON.stringify(
                            {
                                error:
                                    "old_value cannot be zero for percentage_change. Use ratio_to_percent instead if appropriate.",
                            },
                            null,
                            2
                        ),
                        isError: true,
                    };
                }

                const change = ((newValue - oldValue) / Math.abs(oldValue)) * 100;

                const direction =
                    Math.abs(change) < 1e-12
                        ? "no_change"
                        : change > 0
                            ? "increase"
                            : "decrease";

                return {
                    content: JSON.stringify(
                        {
                            action,
                            old_value: oldValue,
                            new_value: newValue,
                            absolute_change: roundValue(newValue - oldValue, args),
                            percentage_change: roundValue(change, args),
                            direction,
                        },
                        null,
                        2
                    ),
                };
            }

            if (action === "tip") {
                const amount = requireNumber(args, "amount", "bill", "total", "value");
                const tipPercent = requireNumber(
                    args,
                    "tip_percent",
                    "percent",
                    "percentage",
                    "rate"
                );

                const tipAmount = (tipPercent / 100) * amount;
                const total = amount + tipAmount;

                return {
                    content: JSON.stringify(
                        {
                            action,
                            amount,
                            tip_percent: tipPercent,
                            tip_amount: roundValue(tipAmount, args),
                            total: roundValue(total, args),
                        },
                        null,
                        2
                    ),
                };
            }

            if (action === "discount") {
                const amount = requireNumber(
                    args,
                    "amount",
                    "price",
                    "original",
                    "value"
                );

                const discountPercent = requireNumber(
                    args,
                    "discount_percent",
                    "percent",
                    "percentage",
                    "rate"
                );

                const discountAmount = (discountPercent / 100) * amount;
                const finalAmount = amount - discountAmount;

                return {
                    content: JSON.stringify(
                        {
                            action,
                            amount,
                            discount_percent: discountPercent,
                            discount_amount: roundValue(discountAmount, args),
                            final_amount: roundValue(finalAmount, args),
                        },
                        null,
                        2
                    ),
                };
            }

            return {
                content: JSON.stringify(
                    {
                        error: `Unknown action '${action}'.`,
                        available_actions: [
                            "percent_of",
                            "increase",
                            "decrease",
                            "ratio_to_percent",
                            "percentage_change",
                            "tip",
                            "discount",
                        ],
                    },
                    null,
                    2
                ),
                isError: true,
            };
        } catch (err) {
            return {
                content: JSON.stringify(
                    {
                        action,
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
