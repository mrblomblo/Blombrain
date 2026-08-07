import type { BuiltInToolDefinition } from "../types.js";

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function countText(text: string) {
  const chars = Array.from(text).length;
  const charsWithoutWhitespace = Array.from(text.replace(/\s+/g, "")).length;

  const words = text.trim().length
    ? text.trim().split(/\s+/).filter(Boolean).length
    : 0;

  const lines = text.length ? text.split(/\r?\n/).length : 0;

  const sentences = text.trim().length
    ? text
        .trim()
        .split(/[.!?]+(?:\s|$)/)
        .filter((sentence) => sentence.trim().length > 0).length
    : 0;

  return {
    chars,
    chars_without_whitespace: charsWithoutWhitespace,
    words,
    lines,
    sentences,
  };
}

function toTitle(text: string): string {
  return text.replace(/[^\s\-_]+/g, (word) => {
    return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
  });
}

function toSnake(text: string): string {
  return text
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
    .replace(/[\s\-]+/g, "_")
    .replace(/_+/g, "_")
    .toLowerCase();
}

function toKebab(text: string): string {
  return text
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1-$2")
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .toLowerCase();
}

function toCamel(text: string): string {
  const words = text.split(/[^a-zA-Z0-9]+/).filter(Boolean);

  return words
    .map((word, index) => {
      if (index === 0) {
        return word.toLowerCase();
      }

      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join("");
}

function slugify(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export const textUtilsTool: BuiltInToolDefinition = {
  name: "text_utils",
  description:
    "Perform offline text operations: counting, casing, slugification, regex matching, regex replacement, and extraction of emails or URLs.",
  parameters: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: [
          "count",
          "reverse",
          "to_upper",
          "to_lower",
          "to_title",
          "to_snake",
          "to_kebab",
          "to_camel",
          "slugify",
          "trim",
          "normalize_whitespace",
          "regex_match",
          "regex_replace",
          "extract_emails",
          "extract_urls",
        ],
        description: "Text operation to perform.",
      },
      text: {
        type: "string",
        description: "Input text.",
      },
      pattern: {
        type: "string",
        description: "Regular expression pattern for regex_match or regex_replace.",
      },
      replacement: {
        type: "string",
        description: "Replacement string for regex_replace.",
      },
      flags: {
        type: "string",
        description:
          "Regex flags. Defaults to 'g' for regex_match and regex_replace.",
      },
      limit: {
        type: "integer",
        description: "Maximum number of regex matches to return. Defaults to 100.",
      },
    },
    required: ["action", "text"],
  },
  execute: async (args) => {
    const action = typeof args.action === "string" ? args.action : "";
    const text = typeof args.text === "string" ? args.text : "";

    try {
      switch (action) {
        case "count": {
          return {
            content: JSON.stringify(
              {
                action,
                counts: countText(text),
              },
              null,
              2
            ),
          };
        }

        case "reverse": {
          return {
            content: JSON.stringify(
              {
                action,
                output: Array.from(text).reverse().join(""),
              },
              null,
              2
            ),
          };
        }

        case "to_upper": {
          return {
            content: JSON.stringify(
              {
                action,
                output: text.toUpperCase(),
              },
              null,
              2
            ),
          };
        }

        case "to_lower": {
          return {
            content: JSON.stringify(
              {
                action,
                output: text.toLowerCase(),
              },
              null,
              2
            ),
          };
        }

        case "to_title": {
          return {
            content: JSON.stringify(
              {
                action,
                output: toTitle(text),
              },
              null,
              2
            ),
          };
        }

        case "to_snake": {
          return {
            content: JSON.stringify(
              {
                action,
                output: toSnake(text),
              },
              null,
              2
            ),
          };
        }

        case "to_kebab": {
          return {
            content: JSON.stringify(
              {
                action,
                output: toKebab(text),
              },
              null,
              2
            ),
          };
        }

        case "to_camel": {
          return {
            content: JSON.stringify(
              {
                action,
                output: toCamel(text),
              },
              null,
              2
            ),
          };
        }

        case "slugify": {
          return {
            content: JSON.stringify(
              {
                action,
                output: slugify(text),
              },
              null,
              2
            ),
          };
        }

        case "trim": {
          return {
            content: JSON.stringify(
              {
                action,
                output: text.trim(),
              },
              null,
              2
            ),
          };
        }

        case "normalize_whitespace": {
          return {
            content: JSON.stringify(
              {
                action,
                output: normalizeWhitespace(text),
              },
              null,
              2
            ),
          };
        }

        case "regex_match": {
          const pattern = typeof args.pattern === "string" ? args.pattern : "";

          if (!pattern) {
            return {
              content: JSON.stringify(
                {
                  error: "pattern is required for regex_match.",
                },
                null,
                2
              ),
              isError: true,
            };
          }

          const flags = typeof args.flags === "string" ? args.flags : "g";
          const finalFlags = flags.includes("g") ? flags : `${flags}g`;
          const regex = new RegExp(pattern, finalFlags);

          const limit = Number.isInteger(args.limit)
            ? Math.min(Math.max(Number(args.limit), 1), 1000)
            : 100;

          const matches: Array<{
            match: string;
            index?: number;
            groups?: Record<string, string>;
          }> = [];

          for (const match of text.matchAll(regex)) {
            matches.push({
              match: match[0],
              index: match.index,
              groups: match.groups ?? undefined,
            });

            if (matches.length >= limit) {
              break;
            }
          }

          return {
            content: JSON.stringify(
              {
                action,
                pattern,
                flags: finalFlags,
                count: matches.length,
                matches,
              },
              null,
              2
            ),
          };
        }

        case "regex_replace": {
          const pattern = typeof args.pattern === "string" ? args.pattern : "";

          if (!pattern) {
            return {
              content: JSON.stringify(
                {
                  error: "pattern is required for regex_replace.",
                },
                null,
                2
              ),
              isError: true,
            };
          }

          const replacement =
            typeof args.replacement === "string" ? args.replacement : "";

          const flags = typeof args.flags === "string" ? args.flags : "g";
          const regex = new RegExp(pattern, flags);

          return {
            content: JSON.stringify(
              {
                action,
                pattern,
                flags,
                output: text.replace(regex, replacement),
              },
              null,
              2
            ),
          };
        }

        case "extract_emails": {
          const emails = unique(
            text.match(
              /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g
            ) ?? []
          );

          return {
            content: JSON.stringify(
              {
                action,
                count: emails.length,
                emails,
              },
              null,
              2
            ),
          };
        }

        case "extract_urls": {
          const urls = unique(
            text.match(/https?:\/\/[^\s<>"')]+/g) ?? []
          );

          return {
            content: JSON.stringify(
              {
                action,
                count: urls.length,
                urls,
              },
              null,
              2
            ),
          };
        }

        default: {
          return {
            content: JSON.stringify(
              {
                error: `Unknown action '${action}'.`,
              },
              null,
              2
            ),
            isError: true,
          };
        }
      }
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