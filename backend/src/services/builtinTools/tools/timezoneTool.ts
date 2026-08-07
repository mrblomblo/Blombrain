import type { BuiltInToolDefinition } from "../types.js";

type DateTimeComponents = {
    year: number;
    month: number;
    day: number;
    hour: number;
    minute: number;
    second: number;
    millisecond: number;
};

function isValidTimeZone(timeZone: string): boolean {
    try {
        new Intl.DateTimeFormat("en-US", { timeZone });
        return true;
    } catch {
        return false;
    }
}

function getOffsetMinutes(date: Date, timeZone: string): number {
    const dtf = new Intl.DateTimeFormat("en-US", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h23",
    } as any);

    const parts = dtf.formatToParts(date);
    const map: Record<string, number> = {};

    for (const part of parts) {
        if (part.type !== "literal") {
            map[part.type] = Number(part.value);
        }
    }

    const hour = map.hour === 24 ? 0 : map.hour;

    const asUTC = Date.UTC(
        map.year,
        map.month - 1,
        map.day,
        hour,
        map.minute,
        map.second
    );

    return Math.round((asUTC - date.getTime()) / 60_000);
}

function zonedTimeToUtc(components: DateTimeComponents, timeZone: string): Date {
    const utcGuess = Date.UTC(
        components.year,
        components.month - 1,
        components.day,
        components.hour,
        components.minute,
        components.second,
        components.millisecond
    );

    let utc = utcGuess;

    for (let i = 0; i < 3; i++) {
        const offset = getOffsetMinutes(new Date(utc), timeZone);
        const next = utcGuess - offset * 60_000;

        if (next === utc) {
            break;
        }

        utc = next;
    }

    return new Date(utc);
}

function parseTimeZoneInput(
    input: unknown,
    sourceTimeZone: string
): { utcDate: Date; parsedAs: string } {
    if (input === undefined || input === null || input === "") {
        return {
            utcDate: new Date(),
            parsedAs: "now",
        };
    }

    if (typeof input === "number") {
        const date = new Date(input);

        if (Number.isNaN(date.getTime())) {
            throw new Error("Invalid timestamp.");
        }

        return {
            utcDate: date,
            parsedAs: "timestamp",
        };
    }

    if (typeof input !== "string") {
        throw new Error("input must be a string, number, or omitted for now.");
    }

    const text = input.trim();

    const explicitOffset = /(Z|[+-]\d{2}:?\d{2})$/i.test(text);

    if (explicitOffset) {
        const date = new Date(text);

        if (Number.isNaN(date.getTime())) {
            throw new Error("Invalid ISO date string.");
        }

        return {
            utcDate: date,
            parsedAs: "explicit_offset",
        };
    }

    const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);

    if (dateOnly) {
        return {
            utcDate: zonedTimeToUtc(
                {
                    year: Number(dateOnly[1]),
                    month: Number(dateOnly[2]),
                    day: Number(dateOnly[3]),
                    hour: 0,
                    minute: 0,
                    second: 0,
                    millisecond: 0,
                },
                sourceTimeZone
            ),
            parsedAs: "date_in_source_timezone",
        };
    }

    const dateTime =
        /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/.exec(
            text
        );

    if (dateTime) {
        const millisecond = dateTime[7]
            ? Number((dateTime[7] + "00").slice(0, 3))
            : 0;

        return {
            utcDate: zonedTimeToUtc(
                {
                    year: Number(dateTime[1]),
                    month: Number(dateTime[2]),
                    day: Number(dateTime[3]),
                    hour: Number(dateTime[4]),
                    minute: Number(dateTime[5]),
                    second: dateTime[6] ? Number(dateTime[6]) : 0,
                    millisecond,
                },
                sourceTimeZone
            ),
            parsedAs: "datetime_in_source_timezone",
        };
    }

    const fallbackDate = new Date(text);

    if (!Number.isNaN(fallbackDate.getTime())) {
        return {
            utcDate: fallbackDate,
            parsedAs: "fallback_date_parse",
        };
    }

    throw new Error(
        "Could not parse input. Use ISO format, e.g. 2026-08-07 or 2026-08-07T15:30:00."
    );
}

function formatInTimeZone(date: Date, timeZone: string) {
    const full = new Intl.DateTimeFormat("en-US", {
        timeZone,
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        timeZoneName: "longOffset",
        hourCycle: "h23",
    } as any);

    const dateOnly = new Intl.DateTimeFormat("sv-SE", {
        timeZone,
    }).format(date);

    const timeOnly = new Intl.DateTimeFormat("en-GB", {
        timeZone,
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h23",
    } as any).format(date);

    const dayOfWeek = new Intl.DateTimeFormat("en-US", {
        timeZone,
        weekday: "long",
    }).format(date);

    const offsetParts = new Intl.DateTimeFormat("en-US", {
        timeZone,
        timeZoneName: "longOffset",
    } as any).formatToParts(date);

    const tzPart = offsetParts.find((part) => part.type === "timeZoneName");

    const utcOffset = tzPart
        ? tzPart.value.replace("GMT", "") || "+00:00"
        : "";

    return {
        timezone: timeZone,
        formatted: full.format(date),
        date: dateOnly,
        time: timeOnly,
        dayOfWeek,
        utcOffset,
    };
}

export const timezoneTool: BuiltInToolDefinition = {
    name: "timezone_tool",
    description:
        "Convert a time between IANA timezones offline. Accepts ISO dates, date-only values, datetime values, timestamps, and explicit-offset ISO strings.",
    parameters: {
        type: "object",
        properties: {
            input: {
                type: "string",
                description:
                    "Date/time input. If omitted, the current time is used. Examples: '2026-08-07', '2026-08-07T15:30:00', '2026-08-07T15:30:00+02:00'.",
            },
            from: {
                type: "string",
                description:
                    "Source IANA timezone, e.g. 'America/New_York'. Used when input has no explicit offset. Defaults to local system timezone.",
            },
            to: {
                type: "string",
                description:
                    "Target IANA timezone, e.g. 'Asia/Tokyo'. Required.",
            },
        },
        required: ["to"],
    },
    execute: async (args) => {
        const input = args.input ?? args.date ?? args.time;

        const from =
            typeof args.from === "string" && args.from.trim()
                ? args.from.trim()
                : Intl.DateTimeFormat().resolvedOptions().timeZone;

        const to =
            typeof args.to === "string" && args.to.trim()
                ? args.to.trim()
                : "";

        try {
            if (!to) {
                return {
                    content: JSON.stringify(
                        {
                            error: "to is required and must be an IANA timezone name.",
                        },
                        null,
                        2
                    ),
                    isError: true,
                };
            }

            if (!isValidTimeZone(from)) {
                return {
                    content: JSON.stringify(
                        {
                            error: `Invalid source timezone '${from}'.`,
                        },
                        null,
                        2
                    ),
                    isError: true,
                };
            }

            if (!isValidTimeZone(to)) {
                return {
                    content: JSON.stringify(
                        {
                            error: `Invalid target timezone '${to}'.`,
                        },
                        null,
                        2
                    ),
                    isError: true,
                };
            }

            const { utcDate, parsedAs } = parseTimeZoneInput(input, from);

            return {
                content: JSON.stringify(
                    {
                        input: input == null ? null : String(input),
                        parsed_as: parsedAs,
                        utc_iso: utcDate.toISOString(),
                        unixTimestamp: Math.floor(utcDate.getTime() / 1000),
                        source: formatInTimeZone(utcDate, from),
                        target: formatInTimeZone(utcDate, to),
                    },
                    null,
                    2
                ),
            };
        } catch (err) {
            return {
                content: JSON.stringify(
                    {
                        input: input == null ? null : String(input),
                        from,
                        to,
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
