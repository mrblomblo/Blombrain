import type { BuiltInToolDefinition } from "../types.js";

function cryptoObj(): any {
  return (globalThis as any).crypto;
}

function randomBytes(length: number): Uint8Array {
  const crypto = cryptoObj();

  if (crypto?.getRandomValues) {
    const bytes = new Uint8Array(length);
    crypto.getRandomValues(bytes);
    return bytes;
  }

  // Non-cryptographic fallback.
  return Uint8Array.from({ length }, () => Math.floor(Math.random() * 256));
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function randomUint32(): number {
  const bytes = randomBytes(4);
  return (
    ((bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3]) >>> 0
  );
}

function randomFloat01(): number {
  return randomUint32() / 4294967296;
}

function randomInteger(min: number, max: number): number {
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    return NaN;
  }

  if (min > max) {
    [min, max] = [max, min];
  }

  const lo = Math.ceil(min);
  const hi = Math.floor(max);
  const range = hi - lo;

  if (range < 0) {
    return NaN;
  }

  if (range === 0) {
    return lo;
  }

  return lo + Math.floor(randomFloat01() * (range + 1));
}

function generateUuid(): string {
  const crypto = cryptoObj();

  if (crypto?.randomUUID) {
    return crypto.randomUUID();
  }

  const bytes = randomBytes(16);

  // UUID version 4
  bytes[6] = (bytes[6] & 0x0f) | 0x40;

  // UUID variant 10xx
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = bytesToHex(bytes);

  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join("-");
}

export const getRandomValueTool: BuiltInToolDefinition = {
  name: "get_random_value",
  description:
    "Generate random values locally: UUIDs, integers, floats, hex strings, passwords, or a random choice from a list. Does not use the network.",
  parameters: {
    type: "object",
    properties: {
      kind: {
        type: "string",
        enum: ["uuid", "integer", "float", "hex", "password", "choice"],
        description: "Type of random value to generate. Defaults to uuid.",
      },
      min: {
        type: "number",
        description: "Minimum value for integer or float generation.",
      },
      max: {
        type: "number",
        description: "Maximum value for integer or float generation.",
      },
      length: {
        type: "integer",
        description: "Length for hex strings or passwords.",
      },
      alphabet: {
        type: "string",
        description: "Custom alphabet to use for password generation.",
      },
      choices: {
        type: "array",
        items: { type: "string" },
        description: "List of values to choose from when kind is 'choice'.",
      },
    },
  },
  execute: async (args) => {
    const kind = typeof args.kind === "string" ? args.kind : "uuid";

    try {
      if (kind === "uuid") {
        return {
          content: JSON.stringify(
            {
              kind,
              value: generateUuid(),
            },
            null,
            2
          ),
        };
      }

      if (kind === "integer") {
        const min = Math.trunc(Number(args.min ?? 0));
        const max = Math.trunc(Number(args.max ?? 100));

        if (!Number.isFinite(min) || !Number.isFinite(max)) {
          return {
            content: JSON.stringify(
              {
                error: "min and max must be finite numbers.",
              },
              null,
              2
            ),
            isError: true,
          };
        }

        const value = randomInteger(min, max);

        if (Number.isNaN(value)) {
          return {
            content: JSON.stringify(
              {
                error: "Could not generate an integer in the requested range.",
              },
              null,
              2
            ),
            isError: true,
          };
        }

        return {
          content: JSON.stringify(
            {
              kind,
              value,
              min,
              max,
            },
            null,
            2
          ),
        };
      }

      if (kind === "float") {
        let min = Number(args.min ?? 0);
        let max = Number(args.max ?? 1);

        if (!Number.isFinite(min) || !Number.isFinite(max)) {
          return {
            content: JSON.stringify(
              {
                error: "min and max must be finite numbers.",
              },
              null,
              2
            ),
            isError: true,
          };
        }

        if (min > max) {
          [min, max] = [max, min];
        }

        const value = min + randomFloat01() * (max - min);

        return {
          content: JSON.stringify(
            {
              kind,
              value,
              min,
              max,
            },
            null,
            2
          ),
        };
      }

      if (kind === "hex") {
        const desiredLength = Number.isInteger(args.length)
          ? Math.min(Math.max(Number(args.length), 1), 1024)
          : 32;

        const bytes = randomBytes(Math.ceil(desiredLength / 2));
        const value = bytesToHex(bytes).slice(0, desiredLength);

        return {
          content: JSON.stringify(
            {
              kind,
              value,
              length: value.length,
            },
            null,
            2
          ),
        };
      }

      if (kind === "password") {
        const desiredLength = Number.isInteger(args.length)
          ? Math.min(Math.max(Number(args.length), 4), 256)
          : 16;

        const alphabet =
          typeof args.alphabet === "string" && args.alphabet.length > 0
            ? args.alphabet
            : "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()-_=+[]{}";

        const chars = Array.from(alphabet);

        if (chars.length === 0) {
          return {
            content: JSON.stringify(
              {
                error: "Password alphabet cannot be empty.",
              },
              null,
              2
            ),
            isError: true,
          };
        }

        let value = "";

        for (let i = 0; i < desiredLength; i++) {
          const index = randomInteger(0, chars.length - 1);
          value += chars[index];
        }

        return {
          content: JSON.stringify(
            {
              kind,
              value,
              length: value.length,
            },
            null,
            2
          ),
        };
      }

      if (kind === "choice") {
        const choices = Array.isArray(args.choices) ? args.choices : [];

        if (choices.length === 0) {
          return {
            content: JSON.stringify(
              {
                error: "choices must be a non-empty array when kind is 'choice'.",
              },
              null,
              2
            ),
            isError: true,
          };
        }

        const index = randomInteger(0, choices.length - 1);
        const value = choices[index];

        return {
          content: JSON.stringify(
            {
              kind,
              value,
              index,
              choices_count: choices.length,
            },
            null,
            2
          ),
        };
      }

      return {
        content: JSON.stringify(
          {
            error: `Unknown kind '${kind}'. Expected uuid, integer, float, hex, password, or choice.`,
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