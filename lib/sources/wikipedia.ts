import type { GatheredDocument } from "./types";

const WIKIPEDIA_API = "https://en.wikipedia.org/w/api.php";

type WikiSearchResponse = {
  query?: {
    search?: Array<{
      pageid: number;
      snippet: string;
      title: string;
    }>;
  };
};

type WikiExtractResponse = {
  query?: {
    pages?: Record<
      string,
      {
        extract?: string;
        fullurl?: string;
        title?: string;
      }
    >;
  };
};

export async function gatherWikipediaDocuments(args: {
  maxDocs: number;
  searchTerms: string[];
}): Promise<GatheredDocument[]> {
  const docsByUrl = new Map<string, GatheredDocument>();
  const terms = args.searchTerms.length > 0 ? args.searchTerms : ["overview"];

  for (const term of terms) {
    if (docsByUrl.size >= args.maxDocs) {
      break;
    }

    const searchUrl = new URL(WIKIPEDIA_API);
    searchUrl.searchParams.set("action", "query");
    searchUrl.searchParams.set("format", "json");
    searchUrl.searchParams.set("list", "search");
    searchUrl.searchParams.set("srlimit", "5");
    searchUrl.searchParams.set("srsearch", term);
    searchUrl.searchParams.set("origin", "*");

    const searchRes = await fetch(searchUrl.toString(), { cache: "no-store" });
    if (!searchRes.ok) {
      continue;
    }
    const searchJson = (await searchRes.json()) as WikiSearchResponse;
    const pages = searchJson.query?.search ?? [];

    for (const page of pages) {
      if (docsByUrl.size >= args.maxDocs) {
        break;
      }

      const extractUrl = new URL(WIKIPEDIA_API);
      extractUrl.searchParams.set("action", "query");
      extractUrl.searchParams.set("format", "json");
      extractUrl.searchParams.set("prop", "extracts|info");
      extractUrl.searchParams.set("pageids", String(page.pageid));
      extractUrl.searchParams.set("explaintext", "1");
      extractUrl.searchParams.set("inprop", "url");
      extractUrl.searchParams.set("origin", "*");

      const extractRes = await fetch(extractUrl.toString(), { cache: "no-store" });
      if (!extractRes.ok) {
        continue;
      }
      const extractJson = (await extractRes.json()) as WikiExtractResponse;
      const pageData = Object.values(extractJson.query?.pages ?? {})[0];
      if (!pageData?.extract || !pageData.fullurl) {
        continue;
      }

      if (!docsByUrl.has(pageData.fullurl)) {
        docsByUrl.set(pageData.fullurl, {
          metadata: { snippet: page.snippet },
          sourceType: "wikipedia",
          text: pageData.extract,
          title: pageData.title ?? page.title,
          url: pageData.fullurl,
        });
      }
    }
  }

  return Array.from(docsByUrl.values()).slice(0, args.maxDocs);
}
