import type { BuiltInToolDefinition } from "../types.js";

const MAX_CSV_INPUT = 200_000;
const MAX_CSV_ROWS = 20_000;

function getDelimiter(input: unknown): string {
    if (typeof input !== "string" || input.length === 0) {
        return ",";
    }

    if (input === "tab" || input === "\\t") {
        return "\t";
    }

    if (input.length !== 1) {
        throw new Error("delimiter must be a single character.");
    }

    return input;
}

function parseCsv(text: string, delimiter: string): string[][] {
    const rows: string[][] = [];
    let row: string[] = [];
    let field = "";
    let inQuotes = false;

    for (let i = 0; i < text.length; i++) {
        const ch = text[i];

        if (inQuotes) {
            if (ch === '"') {
                if (text[i + 1] === '"') {
                    field += '"';
                    i++;
                } else {
                    inQuotes = false;
                }
            } else {
                field += ch;
            }

            continue;
        }

        if (ch === '"') {
            inQuotes = true;
            continue;
        }

        if (ch === delimiter) {
            row.push(field);
            field = "";
            continue;
        }

        if (ch === "\n") {
            row.push(field);
            field = "";
            rows.push(row);
            row = [];
            continue;
        }

        if (ch === "\r") {
            row.push(field);
            field = "";
            rows.push(row);
            row = [];

            if (text[i + 1] === "\n") {
                i++;
            }

            continue;
        }

        field += ch;
    }

    if (field.length > 0 || row.length > 0) {
        row.push(field);
        rows.push(row);
    }

    return rows;
}

function makeUniqueColumns(rawColumns: string[]): string[] {
    const used = new Set<string>();

    return rawColumns.map((raw, index) => {
        const base = raw.trim() === "" ? `column_${index + 1}` : raw.trim();

        let candidate = base;
        let suffix = 1;

        while (used.has(candidate)) {
            candidate = `${base}_${suffix++}`;
        }

        used.add(candidate);

        return candidate;
    });
}

function escapeCsvField(value: unknown, delimiter: string): string {
    let text = "";

    if (value == null) {
        text = "";
    } else if (typeof value === "object") {
        text = JSON.stringify(value);
    } else {
        text = String(value);
    }

    if (
        text.includes(delimiter) ||
        text.includes('"') ||
        text.includes("\n") ||
        text.includes("\r")
    ) {
        return `"${text.replace(/"/g, '""')}"`;
    }

    return text;
}

function inferColumns(data: any[]): string[] {
    const columns = new Set<string>();

    for (const row of data) {
        if (row && typeof row === "object" && !Array.isArray(row)) {
            for (const key of Object.keys(row)) {
                columns.add(key);
            }
        }
    }

    return [...columns];
}

function toCsv(
    data: any[],
    columns: string[] | undefined,
    delimiter: string,
    includeHeader: boolean
): string {
    const cols = columns ?? (data.some((row) => !Array.isArray(row)) ? inferColumns(data) : []);

    if (data.length === 0) {
        if (includeHeader && cols.length > 0) {
            return cols.map((column) => escapeCsvField(column, delimiter)).join(delimiter);
        }

        return "";
    }

    const lines: string[] = [];

    if (includeHeader && cols.length > 0) {
        lines.push(cols.map((column) => escapeCsvField(column, delimiter)).join(delimiter));
    }

    for (const row of data) {
        if (Array.isArray(row)) {
            lines.push(row.map((value) => escapeCsvField(value, delimiter)).join(delimiter));
        } else if (row && typeof row === "object") {
            lines.push(cols.map((column) => escapeCsvField(row[column], delimiter)).join(delimiter));
        } else {
            lines.push(escapeCsvField(row, delimiter));
        }
    }

    return lines.join("\n");
}

export const csvTool: BuiltInToolDefinition = {
    name: "csv_tool",
    description:
        "Parse CSV into JSON or convert JSON into CSV. Useful for spreadsheets, tabular data, data cleaning, import/export workflows. Runs fully offline.",
    parameters: {
        type: "object",
        properties: {
            action: {
                type: "string",
                enum: ["parse", "stringify"],
                description:
                    "Use 'parse' to convert CSV text into JSON. Use 'stringify' to convert JSON data into CSV text.",
            },
            text: {
                type: "string",
                description: "CSV text input. Required for action='parse'.",
            },
            data: {
                description:
                    "JSON data input for action='stringify'. Should usually be an array of objects or an array of arrays.",
            },
            columns: {
                type: "array",
                items: { type: "string" },
                description:
                    "Optional column order for stringify. If omitted, columns are inferred from object rows.",
            },
            delimiter: {
                type: "string",
                description:
                    "CSV delimiter. Defaults to ','. Use 'tab' or '\\t' for tab-separated values.",
            },
            header: {
                type: "boolean",
                description:
                    "For parse: whether the first row is a header row. For stringify: whether to output a header row.",
            },
        },
        required: ["action"],
    },
    execute: async (args) => {
        const action = typeof args.action === "string" ? args.action : "";

        try {
            const delimiter = getDelimiter(args.delimiter);

            if (action === "parse") {
                if (typeof args.text !== "string") {
                    return {
                        content: JSON.stringify(
                            {
                                error: "text is required for action='parse' and must be a string.",
                            },
                            null,
                            2
                        ),
                        isError: true,
                    };
                }

                if (args.text.length > MAX_CSV_INPUT) {
                    return {
                        content: JSON.stringify(
                            {
                                error: `CSV input is too large. Maximum input length is ${MAX_CSV_INPUT} characters.`,
                            },
                            null,
                            2
                        ),
                        isError: true,
                    };
                }

                const rows = parseCsv(args.text, delimiter);

                if (rows.length > MAX_CSV_ROWS) {
                    return {
                        content: JSON.stringify(
                            {
                                error: `Too many CSV rows. Maximum supported row count is ${MAX_CSV_ROWS}.`,
                            },
                            null,
                            2
                        ),
                        isError: true,
                    };
                }

                const hasHeader = args.header === undefined ? true : Boolean(args.header);

                if (!hasHeader) {
                    return {
                        content: JSON.stringify(
                            {
                                action,
                                delimiter,
                                header: false,
                                row_count: rows.length,
                                rows,
                            },
                            null,
                            2
                        ),
                    };
                }

                if (rows.length === 0) {
                    return {
                        content: JSON.stringify(
                            {
                                action,
                                delimiter,
                                header: true,
                                columns: [],
                                row_count: 0,
                                rows: [],
                            },
                            null,
                            2
                        ),
                    };
                }

                const columns = makeUniqueColumns(rows[0]);
                const objectRows: Record<string, string | null>[] = [];

                for (let i = 1; i < rows.length; i++) {
                    const row = rows[i];
                    const obj: Record<string, string | null> = {};

                    for (let j = 0; j < columns.length; j++) {
                        obj[columns[j]] = row[j] ?? null;
                    }

                    objectRows.push(obj);
                }

                return {
                    content: JSON.stringify(
                        {
                            action,
                            delimiter,
                            header: true,
                            columns,
                            row_count: objectRows.length,
                            rows: objectRows,
                        },
                        null,
                        2
                    ),
                };
            }

            if (action === "stringify") {
                let data = args.data;

                if (typeof data === "string") {
                    try {
                        data = JSON.parse(data);
                    } catch (err) {
                        return {
                            content: JSON.stringify(
                                {
                                    error:
                                        "data was provided as a string but could not be parsed as JSON.",
                                    details: err instanceof Error ? err.message : String(err),
                                },
                                null,
                                2
                            ),
                            isError: true,
                        };
                    }
                }

                if (
                    data &&
                    typeof data === "object" &&
                    !Array.isArray(data) &&
                    Array.isArray((data as any).rows)
                ) {
                    data = (data as any).rows;
                }

                if (!Array.isArray(data)) {
                    return {
                        content: JSON.stringify(
                            {
                                error:
                                    "data must be an array of objects, an array of arrays, or an object with a 'rows' array.",
                            },
                            null,
                            2
                        ),
                        isError: true,
                    };
                }

                if (data.length > MAX_CSV_ROWS) {
                    return {
                        content: JSON.stringify(
                            {
                                error: `Too many rows. Maximum supported row count is ${MAX_CSV_ROWS}.`,
                            },
                            null,
                            2
                        ),
                        isError: true,
                    };
                }

                const columns = Array.isArray(args.columns)
                    ? args.columns.map((column) => String(column))
                    : undefined;

                const firstIsArray = data.length > 0 && Array.isArray(data[0]);

                const includeHeader =
                    typeof args.header === "boolean"
                        ? args.header
                        : columns
                            ? true
                            : !firstIsArray;

                const csv = toCsv(data, columns, delimiter, includeHeader);

                return {
                    content: JSON.stringify(
                        {
                            action,
                            delimiter,
                            row_count: data.length,
                            csv,
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
                        available_actions: ["parse", "stringify"],
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
