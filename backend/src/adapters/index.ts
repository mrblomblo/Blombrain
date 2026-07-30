import type { ApiAdapter } from "./types.js";
import { openAIAdapter } from "./openai.js";
import { ollamaAdapter } from "./ollama.js";
import { lmStudioAdapter } from "./lmstudio.js";

const adapters: Record<string, ApiAdapter> = {
  [openAIAdapter.id]: openAIAdapter,
  [ollamaAdapter.id]: ollamaAdapter,
  [lmStudioAdapter.id]: lmStudioAdapter,
};

export function getAdapter(id?: string): ApiAdapter {
  if (id && adapters[id]) {
    return adapters[id];
  }
  return openAIAdapter;
}

export function getAllAdaptersInfo(): Array<{ id: string; name: string; badgeLabel: string }> {
  return Object.values(adapters).map((a) => ({
    id: a.id,
    name: a.name,
    badgeLabel: a.badgeLabel,
  }));
}

export * from "./types.js";
