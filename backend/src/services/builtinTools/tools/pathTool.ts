import type { BuiltInToolDefinition } from "../types.js";

const MAX_PATH_LENGTH = 4096;
const MAX_PARTS = 100;

function isAbsolutePath(path: string): boolean {
    return (
        path.startsWith("/") ||
        /^[A-Za-z]:[\/\\]/.test(path) ||
        /^\\\\/.test(path)
    );
}

function normalizeGeneral(input: string): string {
    const path = input.replace(/\\/g, "/");
    const rooted = path.startsWith("/");
    const segments = path.split("/");
    const stack: string[] = [];

    for (const segment of segments) {
        if (!segment || segment === ".") {
            continue;
        }

        if (segment === "..") {
            if (stack.length > 0 && stack[stack.length - 1] !== "..") {
                stack.pop();
            } else if (!rooted) {
                stack.push("..");
            }
        } else {
            stack.push(segment);
        }
    }

    const joined = stack.join("/");

    if (rooted) {
        return joined ? `/${joined}` : "/";
    }

    return joined || ".";
}

function sanitizePath(input: string, allowAbsolute = false): string {
    if (input.includes("\0")) {
        throw new Error("Path contains a null byte.");
    }

    const path = input.replace(/\\/g, "/");

    if (/^[A-Za-z]:[\/\\]/.test(path) || /^\\\\/.test(path)) {
        throw new Error("Windows drive and network paths are not allowed.");
    }

    const rooted = path.startsWith("/");

    if (rooted && !allowAbsolute) {
        throw new Error("Absolute paths are not allowed by default.");
    }

    const segments = path.split("/");
    const stack: string[] = [];

    for (const segment of segments) {
        if (!segment || segment === ".") {
            continue;
        }

        if (segment === "..") {
            if (stack.length > 0) {
                stack.pop();
            }
        } else {
            stack.push(segment);
        }
    }

    const joined = stack.join("/");

    if (rooted && allowAbsolute) {
        return joined ? `/${joined}` : "/";
    }

    return joined || ".";
}

function getSafetyIssues(input: string, allowAbsolute: boolean): string[] {
    const issues: string[] = [];

    if (input.includes("\0")) {
        issues.push("Path contains a null byte.");
    }

    if (/^[A-Za-z]:[\/\\]/.test(input) || /^\\\\/.test(input)) {
        issues.push("Windows drive or network path is not allowed.");
    }

    if (!allowAbsolute && isAbsolutePath(input)) {
        issues.push("Absolute path is not allowed.");
    }

    const normalized = normalizeGeneral(input);

    if (normalized === ".." || normalized.startsWith("../")) {
        issues.push("Path escapes the current directory.");
    }

    return issues;
}

function basenameGeneral(input: string, extensionToStrip?: string): string {
    const normalized = normalizeGeneral(input);

    if (normalized === "/") {
        return "";
    }

    const parts = normalized.split("/");
    let base = parts[parts.length - 1] ?? "";

    if (extensionToStrip) {
        const ext = extensionToStrip.startsWith(".")
            ? extensionToStrip
            : `.${extensionToStrip}`;

        if (base.endsWith(ext)) {
            base = base.slice(0, -ext.length);
        }
    }

    return base;
}

function dirnameGeneral(input: string): string {
    const normalized = normalizeGeneral(input);

    if (normalized === "/") {
        return "/";
    }

    const index = normalized.lastIndexOf("/");

    if (index === -1) {
        return ".";
    }

    if (index === 0) {
        return "/";
    }

    return normalized.slice(0, index);
}

function extensionGeneral(input: string): string {
    const base = basenameGeneral(input);
    const dotIndex = base.lastIndexOf(".");

    if (dotIndex <= 0 || dotIndex === base.length - 1) {
        return "";
    }

    return base.slice(dotIndex);
}

function requirePath(args: Record<string, any>): string {
    if (typeof args.path !== "string" || args.path.length === 0) {
        throw new Error("path is required and must be a non-empty string.");
    }

    if (args.path.length > MAX_PATH_LENGTH) {
        throw new Error(`path is too long. Maximum length is ${MAX_PATH_LENGTH}.`);
    }

    return args.path;
}

export const pathTool: BuiltInToolDefinition = {
    name: "path_tool",
    description:
        "Safe offline path utilities: join, normalize, basename, dirname, extension, sanitize, and safety checks. Prevents '..' traversal from escaping the workspace root by default.",
    parameters: {
        type: "object",
        properties: {
            action: {
                type: "string",
                enum: [
                    "join",
                    "normalize",
                    "basename",
                    "dirname",
                    "extension",
                    "sanitize",
                    "is_safe",
                ],
                description: "Path operation to perform.",
            },
            path: {
                type: "string",
                description:
                    "Path input for normalize, basename, dirname, extension, sanitize, or is_safe.",
            },
            parts: {
                type: "array",
                items: { type: "string" },
                description: "Path segments to join for action='join'.",
            },
            allow_absolute: {
                type: "boolean",
                description:
                    "Whether absolute paths are allowed for safe operations. Defaults to false.",
            },
            safe: {
                type: "boolean",
                description:
                    "For join and normalize: whether to sanitize against path traversal. Defaults to true.",
            },
            extension: {
                type: "string",
                description: "Optional extension to strip for action='basename'.",
            },
        },
        required: ["action"],
    },
    execute: async (args) => {
        const action = typeof args.action === "string" ? args.action : "";
        const allowAbsolute = Boolean(args.allow_absolute);
        const safe = args.safe !== false;

        try {
            if (action === "join") {
                const parts = Array.isArray(args.parts)
                    ? args.parts
                    : Array.isArray(args.paths)
                        ? args.paths
                        : typeof args.path === "string"
                            ? [args.path]
                            : [];

                if (parts.length === 0) {
                    return {
                        content: JSON.stringify(
                            {
                                error: "parts is required for action='join'.",
                            },
                            null,
                            2
                        ),
                        isError: true,
                    };
                }

                if (parts.length > MAX_PARTS) {
                    return {
                        content: JSON.stringify(
                            {
                                error: `Too many path parts. Maximum is ${MAX_PARTS}.`,
                            },
                            null,
                            2
                        ),
                        isError: true,
                    };
                }

                const stringParts = parts.map((part) => String(part));

                for (const part of stringParts) {
                    if (part.length > MAX_PATH_LENGTH) {
                        return {
                            content: JSON.stringify(
                                {
                                    error: `A path part is too long. Maximum length is ${MAX_PATH_LENGTH}.`,
                                },
                                null,
                                2
                            ),
                            isError: true,
                        };
                    }
                }

                const joined = stringParts.join("/");
                const output = safe
                    ? sanitizePath(joined, allowAbsolute)
                    : normalizeGeneral(joined);

                return {
                    content: JSON.stringify(
                        {
                            action,
                            input: stringParts,
                            output,
                            safe,
                            allow_absolute: allowAbsolute,
                        },
                        null,
                        2
                    ),
                };
            }

            if (action === "normalize") {
                const path = requirePath(args);
                const output = safe
                    ? sanitizePath(path, allowAbsolute)
                    : normalizeGeneral(path);

                return {
                    content: JSON.stringify(
                        {
                            action,
                            input: path,
                            output,
                            safe,
                            allow_absolute: allowAbsolute,
                        },
                        null,
                        2
                    ),
                };
            }

            if (action === "basename") {
                const path = requirePath(args);
                const extensionToStrip =
                    typeof args.extension === "string" ? args.extension : undefined;

                return {
                    content: JSON.stringify(
                        {
                            action,
                            input: path,
                            output: basenameGeneral(path, extensionToStrip),
                        },
                        null,
                        2
                    ),
                };
            }

            if (action === "dirname") {
                const path = requirePath(args);

                return {
                    content: JSON.stringify(
                        {
                            action,
                            input: path,
                            output: dirnameGeneral(path),
                        },
                        null,
                        2
                    ),
                };
            }

            if (action === "extension") {
                const path = requirePath(args);

                return {
                    content: JSON.stringify(
                        {
                            action,
                            input: path,
                            output: extensionGeneral(path),
                        },
                        null,
                        2
                    ),
                };
            }

            if (action === "sanitize") {
                const path = requirePath(args);
                const output = sanitizePath(path, allowAbsolute);

                return {
                    content: JSON.stringify(
                        {
                            action,
                            input: path,
                            output,
                            allow_absolute: allowAbsolute,
                        },
                        null,
                        2
                    ),
                };
            }

            if (action === "is_safe") {
                const path = requirePath(args);
                const issues = getSafetyIssues(path, allowAbsolute);
                const sanitized = issues.length === 0 ? sanitizePath(path, allowAbsolute) : null;

                return {
                    content: JSON.stringify(
                        {
                            action,
                            input: path,
                            safe: issues.length === 0,
                            issues,
                            sanitized,
                            allow_absolute: allowAbsolute,
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
                            "join",
                            "normalize",
                            "basename",
                            "dirname",
                            "extension",
                            "sanitize",
                            "is_safe",
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
