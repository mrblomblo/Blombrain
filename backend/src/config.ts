import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import type { BackendConfig, ResolvedBackend } from "./types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const CONFIG_PATH =
  process.env.BLOMBRAIN_BACKENDS_CONFIG ?? path.join(__dirname, "..", "config", "backends.json");

export function loadBackendRegistry(): ResolvedBackend[] {
  let raw: string;
  try {
    raw = readFileSync(CONFIG_PATH, "utf-8");
  } catch (err) {
    throw new Error(
      `Could not read backend registry config at ${CONFIG_PATH}. ` +
        `Set BLOMBRAIN_BACKENDS_CONFIG to point elsewhere, or create the file. (${
          err instanceof Error ? err.message : err
        })`,
    );
  }

  let parsed: BackendConfig[];
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Backend registry config at ${CONFIG_PATH} is not valid JSON: ${err}`);
  }

  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error(`Backend registry config at ${CONFIG_PATH} must be a non-empty JSON array.`);
  }

  const seenIds = new Set<string>();
  const seenPrefixes = new Set<string>();

  return parsed.map((entry): ResolvedBackend => {
    if (!entry.id || !entry.name || !entry.baseUrl) {
      throw new Error(`Each backend needs at least id, name, and baseUrl. Got: ${JSON.stringify(entry)}`);
    }
    if (seenIds.has(entry.id)) {
      throw new Error(`Duplicate backend id "${entry.id}" in ${CONFIG_PATH}`);
    }
    seenIds.add(entry.id);

    const prefix = entry.prefix ?? entry.id;
    if (seenPrefixes.has(prefix)) {
      throw new Error(`Duplicate backend prefix "${prefix}" in ${CONFIG_PATH} -- prefixes must be unique.`);
    }
    seenPrefixes.add(prefix);

    let apiKey = entry.apiKey;
    if (entry.apiKeyEnv) {
      const fromEnv = process.env[entry.apiKeyEnv];
      if (!fromEnv) {
        console.warn(
          `[blombrain] backend "${entry.id}" references apiKeyEnv "${entry.apiKeyEnv}" but that environment variable is not set.`,
        );
      }
      apiKey = fromEnv ?? apiKey;
    }

    return {
      id: entry.id,
      name: entry.name,
      baseUrl: entry.baseUrl.replace(/\/+$/, ""),
      prefix,
      apiKey,
    };
  });
}
