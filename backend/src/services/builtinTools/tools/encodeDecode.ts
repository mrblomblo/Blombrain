import type { BuiltInToolDefinition } from "../types.js";

const escapeMap: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

function asString(input: unknown): string {
  if (typeof input === "string") {
    return input;
  }

  if (input == null) {
    return "";
  }

  return String(input);
}

function textToBytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function bytesToText(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

function bytesToBase64(bytes: Uint8Array): string {
  const MaybeBuffer = (globalThis as any).Buffer;

  if (MaybeBuffer) {
    return MaybeBuffer.from(bytes).toString("base64");
  }

  const btoaFn = (globalThis as any).btoa;

  if (!btoaFn) {
    throw new Error("base64 encoding is not available in this runtime.");
  }

  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoaFn(binary);
}

function base64ToBytes(input: string): Uint8Array {
  const MaybeBuffer = (globalThis as any).Buffer;

  if (MaybeBuffer) {
    return new Uint8Array(MaybeBuffer.from(input, "base64"));
  }

  const atobFn = (globalThis as any).atob;

  if (!atobFn) {
    throw new Error("base64 decoding is not available in this runtime.");
  }

  const binary = atobFn(input.trim());
  const bytes = new Uint8Array(binary.length);

  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }

  return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function hexToBytes(input: string): Uint8Array {
  const clean = input.replace(/[^0-9a-fA-F]/g, "");

  if (clean.length % 2 !== 0) {
    throw new Error("Hex string must have an even number of hex digits.");
  }

  const bytes = new Uint8Array(clean.length / 2);

  for (let i = 0; i < clean.length; i += 2) {
    const byte = parseInt(clean.slice(i, i + 2), 16);

    if (Number.isNaN(byte)) {
      throw new Error("Invalid hex input.");
    }

    bytes[i / 2] = byte;
  }

  return bytes;
}

function escapeHtml(input: string): string {
  return input.replace(/[&<>"']/g, (ch) => escapeMap[ch] ?? ch);
}

function unescapeHtml(input: string): string {
  return input
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => {
      try {
        return String.fromCodePoint(parseInt(hex, 16));
      } catch {
        return _;
      }
    })
    .replace(/&#(\d+);/g, (_, dec) => {
      try {
        return String.fromCodePoint(Number(dec));
      } catch {
        return _;
      }
    })
    .replace(
      /&(amp|lt|gt|quot|apos|#39);/g,
      (entity) =>
        ({
          "&amp;": "&",
          "&lt;": "<",
          "&gt;": ">",
          "&quot;": '"',
          "&apos;": "'",
          "&#39;": "'",
        })[entity] ?? entity
    );
}

export const encodeDecodeTool: BuiltInToolDefinition = {
  name: "encode_decode",
  description:
    "Encode or decode text locally. Supports base64, URL encoding, HTML escaping/unescaping, and hex encoding/decoding.",
  parameters: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: [
          "base64_encode",
          "base64_decode",
          "url_encode",
          "url_decode",
          "html_escape",
          "html_unescape",
          "hex_encode",
          "hex_decode",
        ],
        description: "Encoding or decoding operation to perform.",
      },
      text: {
        type: "string",
        description: "Text input to encode or decode.",
      },
    },
    required: ["action", "text"],
  },
  execute: async (args) => {
    const action = typeof args.action === "string" ? args.action : "";
    const text = asString(args.text);

    try {
      let output = "";

      switch (action) {
        case "base64_encode": {
          output = bytesToBase64(textToBytes(text));
          break;
        }

        case "base64_decode": {
          output = bytesToText(base64ToBytes(text));
          break;
        }

        case "url_encode": {
          output = encodeURIComponent(text);
          break;
        }

        case "url_decode": {
          output = decodeURIComponent(text);
          break;
        }

        case "html_escape": {
          output = escapeHtml(text);
          break;
        }

        case "html_unescape": {
          output = unescapeHtml(text);
          break;
        }

        case "hex_encode": {
          output = bytesToHex(textToBytes(text));
          break;
        }

        case "hex_decode": {
          output = bytesToText(hexToBytes(text));
          break;
        }

        default: {
          return {
            content: JSON.stringify(
              {
                error: `Unknown action '${action}'.`,
                available_actions: [
                  "base64_encode",
                  "base64_decode",
                  "url_encode",
                  "url_decode",
                  "html_escape",
                  "html_unescape",
                  "hex_encode",
                  "hex_decode",
                ],
              },
              null,
              2
            ),
            isError: true,
          };
        }
      }

      return {
        content: JSON.stringify(
          {
            action,
            output,
          },
          null,
          2
        ),
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