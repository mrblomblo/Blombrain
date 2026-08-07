import type { BuiltInToolDefinition } from "../types.js";

export const jsonUtilsTool: BuiltInToolDefinition = {
  name: "json_utils",
  description:
    "Validate, parse, format, or minify JSON locally without network access.",
  parameters: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["validate", "parse", "format", "minify"],
        description: "JSON operation to perform.",
      },
      text: {
        type: "string",
        description: "JSON text input.",
      },
      indent: {
        type: "integer",
        description: "Indentation width for formatting. Defaults to 2.",
      },
    },
    required: ["action", "text"],
  },
  execute: async (args) => {
    const action = typeof args.action === "string" ? args.action : "validate";

    if (typeof args.text !== "string") {
      return {
        content: JSON.stringify(
          {
            error: "args.text must be a string containing JSON.",
          },
          null,
          2
        ),
        isError: true,
      };
    }

    const raw = args.text;

    const indent = Number.isInteger(args.indent)
      ? Math.min(Math.max(Number(args.indent), 0), 10)
      : 2;

    let parsed: unknown;

    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);

      if (action === "validate") {
        return {
          content: JSON.stringify(
            {
              valid: false,
              error: message,
            },
            null,
            2
          ),
        };
      }

      return {
        content: JSON.stringify(
          {
            valid: false,
            error: message,
          },
          null,
          2
        ),
        isError: true,
      };
    }

    switch (action) {
      case "validate": {
        return {
          content: JSON.stringify(
            {
              valid: true,
            },
            null,
            2
          ),
        };
      }

      case "parse": {
        return {
          content: JSON.stringify(
            {
              valid: true,
              data: parsed,
            },
            null,
            2
          ),
        };
      }

      case "format": {
        return {
          content: JSON.stringify(parsed, null, indent),
        };
      }

      case "minify": {
        return {
          content: JSON.stringify(parsed),
        };
      }

      default: {
        return {
          content: JSON.stringify(
            {
              error: `Unknown action '${action}'.`,
              available_actions: ["validate", "parse", "format", "minify"],
            },
            null,
            2
          ),
          isError: true,
        };
      }
    }
  },
};