import type { GatheredDocument } from "./types";

const EXA_SEARCH_API = "https://api.exa.ai/search";

type ExaResult = {
  id?: string;
  url?: string;
  title?: string;
  text?: string;
  summary?: string;
  publishedDate?: string;
  author?: string;
  score?: number;
  highlights?: string[];
};

type ExaSearchResponse = {
  results?: ExaResult[];
};

const cleanText = (value: string) => value.replaceAll(/\s+/g, " ").trim();

const fallbackText = (result: ExaResult) => {
  const text = typeof result.text === "string" ? cleanText(result.text) : "";
  if (text) {
    return text;
  }
  const summary = typeof result.summary === "string" ? cleanText(result.summary) : "";
  if (summary) {
    return summary;
  }
  if (Array.isArray(result.highlights) && result.highlights.length > 0) {
    return cleanText(result.highlights.join(" "));
  }
  return "";
};

export async function gatherExaDocuments(args: {
  maxDocs: number;
  searchTerms: string[];
}): Promise<GatheredDocument[]> {
  const apiKey = process.env.EXA_API_KEY;
  if (!apiKey) {
    return [];
  }

  const docsByUrl = new Map<string, GatheredDocument>();
  const terms = args.searchTerms.length > 0 ? args.searchTerms : ["research overview"];

  for (const term of terms) {
    if (docsByUrl.size >= args.maxDocs) {
      break;
    }

    const response = await fetch(EXA_SEARCH_API, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
      },
      cache: "no-store",
      body: JSON.stringify({
        contents: { text: { maxCharacters: 6000 } },
        numResults: Math.min(10, args.maxDocs),
        query: term,
        useAutoprompt: true,
      }),
    });

    if (!response.ok) {
      continue;
    }

    const json = (await response.json()) as ExaSearchResponse;
    for (const result of json.results ?? []) {
      if (docsByUrl.size >= args.maxDocs) {
        break;
      }
      const url = typeof result.url === "string" ? result.url.trim() : "";
      const text = fallbackText(result);
      if (!url || !text || docsByUrl.has(url)) {
        continue;
      }
      docsByUrl.set(url, {
        metadata: {
          author: result.author,
          exaId: result.id,
          published: result.publishedDate,
          score: result.score,
          summary: typeof result.summary === "string" ? cleanText(result.summary) : undefined,
        },
        sourceType: "web",
        text,
        title: typeof result.title === "string" ? cleanText(result.title) : undefined,
        url,
      });
    }
  }

  return Array.from(docsByUrl.values()).slice(0, args.maxDocs);
}
