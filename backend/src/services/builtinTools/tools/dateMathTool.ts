import type { BuiltInToolDefinition } from "../types.js";

type DateUnit =
    | "year"
    | "month"
    | "week"
    | "day"
    | "hour"
    | "minute"
    | "second"
    | "millisecond";

const DATE_UNIT_ALIASES: Record<string, DateUnit> = {
    y: "year",
    yr: "year",
    yrs: "year",
    year: "year",
    years: "year",

    mo: "month",
    mos: "month",
    month: "month",
    months: "month",

    w: "week",
    wk: "week",
    wks: "week",
    week: "week",
    weeks: "week",

    d: "day",
    day: "day",
    days: "day",

    h: "hour",
    hr: "hour",
    hrs: "hour",
    hour: "hour",
    hours: "hour",

    m: "minute",
    min: "minute",
    mins: "minute",
    minute: "minute",
    minutes: "minute",

    s: "second",
    sec: "second",
    secs: "second",
    second: "second",
    seconds: "second",

    ms: "millisecond",
    msec: "millisecond",
    msecs: "millisecond",
    millisecond: "millisecond",
    milliseconds: "millisecond",
};

const WEEKDAY_ALIASES: Record<string, number> = {
    sun: 0,
    sunday: 0,
    mon: 1,
    monday: 1,
    tue: 2,
    tues: 2,
    tuesday: 2,
    wed: 3,
    weds: 3,
    wednesday: 3,
    thu: 4,
    thur: 4,
    thurs: 4,
    thursday: 4,
    fri: 5,
    friday: 5,
    sat: 6,
    saturday: 6,
};

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

function normalizeDateUnit(input: unknown): DateUnit {
    const raw = typeof input === "string" ? input.trim().toLowerCase() : "";
    const unit = DATE_UNIT_ALIASES[raw];

    if (!unit) {
        throw new Error(
            `Unknown unit '${String(input)}'. Expected year, month, week, day, hour, minute, second, or millisecond.`
        );
    }

    return unit;
}

function normalizeWeekday(input: unknown): number {
    const raw = typeof input === "string" ? input.trim().toLowerCase() : "";
    const weekday = WEEKDAY_ALIASES[raw];

    if (weekday === undefined) {
        throw new Error(
            `Unknown weekday '${String(input)}'. Expected monday, tuesday, wednesday, thursday, friday, saturday, or sunday.`
        );
    }

    return weekday;
}

function parseDateInput(input: unknown): Date {
    if (input === undefined || input === null || input === "") {
        return new Date();
    }

    if (typeof input === "number") {
        const date = new Date(input);

        if (Number.isNaN(date.getTime())) {
            throw new Error("Invalid date timestamp.");
        }

        return date;
    }

    if (typeof input !== "string") {
        throw new Error("date must be a string, number, or omitted for now.");
    }

    const text = input.trim();

    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
        return new Date(`${text}T00:00:00.000Z`);
    }

    if (
        /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?$/.test(text)
    ) {
        return new Date(`${text.replace(" ", "T")}Z`);
    }

    const date = new Date(text);

    if (Number.isNaN(date.getTime())) {
        throw new Error(
            "Invalid date. Use ISO format, e.g. 2026-08-07 or 2026-08-07T15:30:00Z."
        );
    }

    return date;
}

function addMonthsClampUTC(date: Date, months: number): Date {
    const result = new Date(date.getTime());
    const originalDay = result.getUTCDate();

    result.setUTCDate(1);
    result.setUTCMonth(result.getUTCMonth() + Math.trunc(months));

    const targetYear = result.getUTCFullYear();
    const targetMonth = result.getUTCMonth();

    const daysInMonth = new Date(
        Date.UTC(targetYear, targetMonth + 1, 0)
    ).getUTCDate();

    result.setUTCDate(Math.min(originalDay, daysInMonth));

    return result;
}

function addDateUTC(date: Date, unit: DateUnit, amount: number): Date {
    if (!Number.isFinite(amount)) {
        throw new Error("amount must be finite.");
    }

    if (unit === "year") {
        return addMonthsClampUTC(date, Math.trunc(amount) * 12);
    }

    if (unit === "month") {
        return addMonthsClampUTC(date, Math.trunc(amount));
    }

    const multipliers: Record<Exclude<DateUnit, "year" | "month">, number> = {
        week: 7 * 24 * 60 * 60 * 1000,
        day: 24 * 60 * 60 * 1000,
        hour: 60 * 60 * 1000,
        minute: 60 * 1000,
        second: 1000,
        millisecond: 1,
    };

    const multiplier = multipliers[unit as Exclude<DateUnit, "year" | "month">];

    const result = new Date(date.getTime() + Math.round(amount * multiplier));

    if (Number.isNaN(result.getTime())) {
        throw new Error("Resulting date is invalid.");
    }

    return result;
}

function startOfDayUTC(date: Date): Date {
    return new Date(
        Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
    );
}

function endOfDayUTC(date: Date): Date {
    return new Date(
        Date.UTC(
            date.getUTCFullYear(),
            date.getUTCMonth(),
            date.getUTCDate(),
            23,
            59,
            59,
            999
        )
    );
}

function startOfUTC(date: Date, unit: DateUnit, weekStart: number): Date {
    if (unit === "day") {
        return startOfDayUTC(date);
    }

    if (unit === "week") {
        const day = date.getUTCDay();
        const delta = (day - weekStart + 7) % 7;

        const result = new Date(date.getTime());
        result.setUTCDate(result.getUTCDate() - delta);

        return startOfDayUTC(result);
    }

    if (unit === "month") {
        return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
    }

    if (unit === "year") {
        return new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
    }

    throw new Error("start_of only supports week, day, month, or year.");
}

function endOfUTC(date: Date, unit: DateUnit, weekStart: number): Date {
    if (unit === "day") {
        return endOfDayUTC(date);
    }

    if (unit === "week") {
        const start = startOfUTC(date, "week", weekStart);
        const end = new Date(start.getTime() + 6 * 24 * 60 * 60 * 1000);

        return endOfDayUTC(end);
    }

    if (unit === "month") {
        const lastDay = new Date(
            Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)
        );

        return endOfDayUTC(lastDay);
    }

    if (unit === "year") {
        const lastDay = new Date(Date.UTC(date.getUTCFullYear(), 11, 31));

        return endOfDayUTC(lastDay);
    }

    throw new Error("end_of only supports week, day, month, or year.");
}

function formatResultPayload(date: Date, extra: Record<string, unknown>) {
    return {
        iso: date.toISOString(),
        date: date.toISOString().slice(0, 10),
        time: date.toISOString().slice(11, 19),
        dayOfWeek: date.toLocaleDateString("en-US", {
            weekday: "long",
            timeZone: "UTC",
        }),
        timezone: "UTC",
        unixTimestamp: Math.floor(date.getTime() / 1000),
        ...extra,
    };
}

function roundTo(value: number, digits: number): number {
    const factor = 10 ** digits;
    return Math.round(value * factor) / factor;
}

export const dateMathTool: BuiltInToolDefinition = {
    name: "date_math_tool",
    description:
        "Perform offline date arithmetic: add/subtract time, compute differences, find next weekdays, and get start/end of day/week/month/year. Uses UTC for deterministic results.",
    parameters: {
        type: "object",
        properties: {
            action: {
                type: "string",
                enum: [
                    "add",
                    "subtract",
                    "difference",
                    "next_weekday",
                    "start_of",
                    "end_of",
                ],
                description: "Date operation to perform.",
            },
            date: {
                type: "string",
                description:
                    "Input date. Defaults to now. ISO format is recommended, e.g. 2026-08-07T15:30:00Z.",
            },
            amount: {
                type: "number",
                description: "Amount to add or subtract.",
            },
            unit: {
                type: "string",
                description:
                    "Time unit: year, month, week, day, hour, minute, second, or millisecond.",
            },
            start_date: {
                type: "string",
                description: "Start date for action='difference'.",
            },
            end_date: {
                type: "string",
                description: "End date for action='difference'. Defaults to now.",
            },
            weekday: {
                type: "string",
                description: "Weekday for action='next_weekday'.",
            },
            include_current: {
                type: "boolean",
                description:
                    "For action='next_weekday': whether the current day counts if it already matches the weekday. Defaults to false.",
            },
            week_start: {
                type: "string",
                description:
                    "Week start day for action='start_of' or action='end_of' with unit='week'. Defaults to monday.",
            },
            fraction_digits: {
                type: "integer",
                description:
                    "Optional number of decimal places for difference results. Defaults to 6.",
            },
        },
        required: ["action"],
    },
    execute: async (args) => {
        const action = typeof args.action === "string" ? args.action : "";

        try {
            const fractionDigits = Number.isInteger(args.fraction_digits)
                ? Math.min(Math.max(Number(args.fraction_digits), 0), 15)
                : 6;

            if (action === "add" || action === "subtract") {
                const date = parseDateInput(args.date);
                const unit = normalizeDateUnit(args.unit);
                const rawAmount = requireNumber(args, "amount");
                const amount =
                    action === "subtract" ? -Math.abs(rawAmount) : rawAmount;

                const result = addDateUTC(date, unit, amount);

                return {
                    content: JSON.stringify(
                        formatResultPayload(result, {
                            action,
                            input: args.date ?? null,
                            unit,
                            amount,
                        }),
                        null,
                        2
                    ),
                };
            }

            if (action === "difference") {
                const start = parseDateInput(
                    args.start_date ?? args.from ?? args.date
                );

                const end = parseDateInput(args.end_date ?? args.to ?? undefined);

                const ms = end.getTime() - start.getTime();
                const absMs = Math.abs(ms);

                const values: Record<string, number> = {
                    milliseconds: ms,
                    seconds: ms / 1000,
                    minutes: ms / (60 * 1000),
                    hours: ms / (60 * 60 * 1000),
                    days: ms / (24 * 60 * 60 * 1000),
                    weeks: ms / (7 * 24 * 60 * 60 * 1000),
                    approx_months: ms / (30.436875 * 24 * 60 * 60 * 1000),
                    approx_years: ms / (365.25 * 24 * 60 * 60 * 1000),
                };

                for (const key of Object.keys(values)) {
                    values[key] = roundTo(values[key], fractionDigits);
                }

                const breakdown = {
                    days: Math.floor(absMs / (24 * 60 * 60 * 1000)),
                    hours: Math.floor(absMs / (60 * 60 * 1000)) % 24,
                    minutes: Math.floor(absMs / (60 * 1000)) % 60,
                    seconds: Math.floor(absMs / 1000) % 60,
                    milliseconds: absMs % 1000,
                };

                let selectedValue: number | undefined;
                let selectedUnit: string | undefined;

                if (args.unit !== undefined && args.unit !== null && args.unit !== "") {
                    selectedUnit = normalizeDateUnit(args.unit);

                    if (selectedUnit === "year") {
                        selectedValue = values.approx_years;
                    } else if (selectedUnit === "month") {
                        selectedValue = values.approx_months;
                    } else {
                        selectedValue = values[`${selectedUnit}s` as keyof typeof values];
                    }
                }

                return {
                    content: JSON.stringify(
                        {
                            action,
                            start: start.toISOString(),
                            end: end.toISOString(),
                            signed: ms >= 0,
                            milliseconds: ms,
                            selected_unit: selectedUnit ?? null,
                            selected_value: selectedValue ?? null,
                            values,
                            breakdown,
                            notes:
                                "months and years are approximate calendar averages. For exact calendar arithmetic, use add/subtract with months or years.",
                        },
                        null,
                        2
                    ),
                };
            }

            if (action === "next_weekday") {
                const date = parseDateInput(args.date);
                const targetWeekday = normalizeWeekday(args.weekday);
                const includeCurrent = Boolean(args.include_current ?? false);

                const currentWeekday = date.getUTCDay();

                let daysAhead = (targetWeekday - currentWeekday + 7) % 7;

                if (daysAhead === 0 && !includeCurrent) {
                    daysAhead = 7;
                }

                const result = new Date(
                    date.getTime() + daysAhead * 24 * 60 * 60 * 1000
                );

                return {
                    content: JSON.stringify(
                        formatResultPayload(result, {
                            action,
                            input: args.date ?? null,
                            target_weekday: args.weekday,
                            include_current: includeCurrent,
                            days_added: daysAhead,
                        }),
                        null,
                        2
                    ),
                };
            }

            if (action === "start_of" || action === "end_of") {
                const date = parseDateInput(args.date);
                const unit = normalizeDateUnit(args.unit);
                const weekStart = normalizeWeekday(args.week_start ?? "monday");

                const result =
                    action === "start_of"
                        ? startOfUTC(date, unit, weekStart)
                        : endOfUTC(date, unit, weekStart);

                return {
                    content: JSON.stringify(
                        formatResultPayload(result, {
                            action,
                            input: args.date ?? null,
                            unit,
                            week_start: args.week_start ?? "monday",
                        }),
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
                            "add",
                            "subtract",
                            "difference",
                            "next_weekday",
                            "start_of",
                            "end_of",
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
