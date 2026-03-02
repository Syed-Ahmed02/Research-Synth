import type { GatheredDocument } from "./types";

const ARXIV_API = "http://export.arxiv.org/api/query";

const cleanXmlText = (value: string) =>
  value
    .replaceAll(/<[^>]+>/g, " ")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&")
    .replaceAll(/\s+/g, " ")
    .trim();

const matchesForTag = (entry: string, tag: string) =>
  Array.from(entry.matchAll(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, "g"))).map(
    (match) => match[1] ?? "",
  );

export async function gatherArxivDocuments(args: {
  maxDocs: number;
  searchTerms: string[];
}): Promise<GatheredDocument[]> {
  const docsByUrl = new Map<string, GatheredDocument>();
  const terms = args.searchTerms.length > 0 ? args.searchTerms : ["research survey"];

  for (const term of terms) {
    if (docsByUrl.size >= args.maxDocs) {
      break;
    }

    const queryUrl = `${ARXIV_API}?search_query=all:${encodeURIComponent(term)}&start=0&max_results=5`;
    const response = await fetch(queryUrl, { cache: "no-store" });
    if (!response.ok) {
      continue;
    }

    const xml = await response.text();
    const entries = xml.match(/<entry>[\s\S]*?<\/entry>/g) ?? [];
    for (const entry of entries) {
      if (docsByUrl.size >= args.maxDocs) {
        break;
      }

      const id = entry.match(/<id>([\s\S]*?)<\/id>/)?.[1]?.trim();
      const title = cleanXmlText(entry.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? "");
      const summary = cleanXmlText(entry.match(/<summary>([\s\S]*?)<\/summary>/)?.[1] ?? "");
      if (!id || !summary) {
        continue;
      }

      const published = entry.match(/<published>([\s\S]*?)<\/published>/)?.[1]?.trim();
      const updated = entry.match(/<updated>([\s\S]*?)<\/updated>/)?.[1]?.trim();
      const authors = matchesForTag(entry, "name").map((name) => cleanXmlText(name)).filter(Boolean);
      const categories = Array.from(
        entry.matchAll(/<category[^>]*term="([^"]+)"[^>]*\/?>/g),
      )
        .map((match) => cleanXmlText(match[1] ?? ""))
        .filter(Boolean);
      const pdfUrl =
        entry
          .match(/<link[^>]*title="pdf"[^>]*href="([^"]+)"[^>]*\/?>/)?.[1]
          ?.replace("http://", "https://") ??
        entry
          .match(/<link[^>]*type="application\/pdf"[^>]*href="([^"]+)"[^>]*\/?>/)?.[1]
          ?.replace("http://", "https://");
      const url = id.replace("http://", "https://");

      if (!docsByUrl.has(url)) {
        docsByUrl.set(url, {
          metadata: {
            authors,
            categories,
            pdfUrl,
            published,
            summary,
            updated,
          },
          sourceType: "arxiv",
          text: summary,
          title,
          url,
        });
      }
    }
  }

  return Array.from(docsByUrl.values()).slice(0, args.maxDocs);
}
