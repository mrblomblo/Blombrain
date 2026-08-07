import type { BuiltInToolDefinition, BuiltInToolContext } from "../types.js";

async function fetchJson(url: string, signal?: AbortSignal): Promise<any> {
  const response = await fetch(url, { signal });
  const text = await response.text();

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${text.slice(0, 300)}`);
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new Error("Received non-JSON response from Wikipedia API.");
  }
}

function stripHtml(input: string): string {
  return input
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

export const searchWikipediaTool: BuiltInToolDefinition = {
  name: "search_wikipedia",
  description:
    "Retrieve factual information, biographies, historical events, and scientific concepts from Wikipedia. " +
    "CRITICAL INSTRUCTION: You MUST use this tool when the user asks about a specific person, place, organization, or concept, EVEN IF you believe you already know the answer from your training data. " +
    "Internal memory is often outdated or prone to hallucinations. Always ground your factual responses by calling this tool first before generating your final answer.",
  requiresNetwork: true,
  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description:
          "The exact, canonical name of the entity or concept to look up (e.g., 'Alan Turing', 'Plate tectonics', 'French Revolution'). Use specific nouns or proper names, not full conversational sentences.",
      },
      language: {
        type: "string",
        description:
          "Optional Wikipedia language code, e.g. 'en', 'de', 'fr', 'ja'. Defaults to 'en'.",
      },
    },
    required: ["query"],
  },
  execute: async (
    args: Record<string, any>,
    ctx: BuiltInToolContext
  ) => {
    try {
      if (typeof fetch !== "function") {
        return {
          content: JSON.stringify(
            {
              error:
                "fetch() is not available in this runtime. search_wikipedia requires a fetch-capable environment such as Node 18+ or a browser.",
            },
            null,
            2
          ),
          isError: true,
        };
      }

      if (ctx.abortSignal?.aborted) {
        return {
          content: JSON.stringify(
            {
              error: "Wikipedia request aborted before execution.",
            },
            null,
            2
          ),
          isError: true,
        };
      }

      const query = typeof args.query === "string" ? args.query.trim() : "";

      if (!query) {
        return {
          content: JSON.stringify(
            {
              error: "query is required and must be a non-empty string.",
            },
            null,
            2
          ),
          isError: true,
        };
      }

      const language =
        typeof args.language === "string" && args.language.trim()
          ? args.language.trim().toLowerCase()
          : "en";

      if (!/^[a-z0-9-]{2,12}$/i.test(language)) {
        return {
          content: JSON.stringify(
            {
              error: `Invalid Wikipedia language code '${language}'.`,
            },
            null,
            2
          ),
          isError: true,
        };
      }

      const searchUrl = new URL(`https://${language}.wikipedia.org/w/api.php`);

      searchUrl.searchParams.set("action", "query");
      searchUrl.searchParams.set("list", "search");
      searchUrl.searchParams.set("srsearch", query);
      searchUrl.searchParams.set("srlimit", "1");
      searchUrl.searchParams.set("utf8", "");
      searchUrl.searchParams.set("format", "json");
      searchUrl.searchParams.set("origin", "*");

      const searchData = await fetchJson(searchUrl.toString(), ctx.abortSignal);

      const firstResult = searchData?.query?.search?.[0];

      if (!firstResult?.title) {
        return {
          content: JSON.stringify(
            {
              found: false,
              query,
              language,
              message: "No Wikipedia result found for this query.",
            },
            null,
            2
          ),
          isError: false,
        };
      }

      const title = String(firstResult.title);
      const fallbackExtract = stripHtml(String(firstResult.snippet ?? ""));

      const summaryUrl = `https://${language}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`;

      try {
        const summaryData = await fetchJson(summaryUrl, ctx.abortSignal);

        const pageUrl =
          summaryData?.content_urls?.desktop?.page ??
          `https://${language}.wikipedia.org/wiki/${encodeURIComponent(
            title.replace(/ /g, "_")
          )}`;

        return {
          content: JSON.stringify(
            {
              found: true,
              query,
              language,
              title: summaryData.title ?? title,
              page_type: summaryData.type ?? "standard",
              description: summaryData.description ?? null,
              extract: summaryData.extract ?? fallbackExtract,
              url: pageUrl,
              note:
                summaryData.type === "disambiguation"
                  ? "This is a disambiguation page. The query may refer to multiple topics."
                  : undefined,
            },
            null,
            2
          ),
          isError: false,
        };
      } catch {
        // If the summary endpoint fails, fall back to the search snippet.
        return {
          content: JSON.stringify(
            {
              found: true,
              query,
              language,
              title,
              page_type: "search_result",
              description: null,
              extract: fallbackExtract,
              url: `https://${language}.wikipedia.org/wiki/${encodeURIComponent(
                title.replace(/ /g, "_")
              )}`,
              note: "Summary endpoint failed; returned search snippet instead.",
            },
            null,
            2
          ),
          isError: false,
        };
      }
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        return {
          content: JSON.stringify(
            {
              error: "Wikipedia request aborted.",
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
