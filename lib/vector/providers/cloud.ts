import type {
  PassageVectorRecord,
  QuerySimilarFilters,
  VectorAdapter,
  VectorQueryHit,
} from "../types";

type CloudConfig = {
  baseUrl: string;
  index: string;
  apiKey: string;
};

const headersForCloud = (apiKey: string) => ({
  "content-type": "application/json",
  authorization: `Bearer ${apiKey}`,
});

const parseHits = (raw: unknown): VectorQueryHit[] => {
  if (!raw || typeof raw !== "object") {
    return [];
  }
  const rows = (raw as { hits?: unknown[]; matches?: unknown[] }).hits ??
    (raw as { hits?: unknown[]; matches?: unknown[] }).matches;
  if (!Array.isArray(rows)) {
    return [];
  }
  return rows
    .map((row) => {
      const typed = row as { id?: unknown; score?: unknown; metadata?: unknown };
      if (
        typeof typed.id !== "string" ||
        typeof typed.score !== "number" ||
        !typed.metadata ||
        typeof typed.metadata !== "object"
      ) {
        return null;
      }
      return {
        id: typed.id,
        score: typed.score,
        metadata: typed.metadata as VectorQueryHit["metadata"],
      };
    })
    .filter((row): row is VectorQueryHit => row !== null);
};

export const createCloudProvider = (config: CloudConfig): VectorAdapter => {
  return {
    provider: "cloud",

    async upsertPassages(args: {
      jobId: string;
      namespace: string;
      records: PassageVectorRecord[];
    }) {
      const response = await fetch(`${config.baseUrl}/indexes/${config.index}/upsert`, {
        method: "POST",
        headers: headersForCloud(config.apiKey),
        body: JSON.stringify({
          namespace: args.namespace,
          vectors: args.records.map((r) => ({
            id: r.id,
            values: r.values,
            metadata: {
              ...r.metadata,
              jobId: args.jobId,
            },
          })),
        }),
      });

      if (!response.ok) {
        throw new Error(`Cloud upsert failed: ${response.status}`);
      }
      return { upsertedCount: args.records.length };
    },

    async querySimilar(args: {
      jobId: string;
      namespace: string;
      queryEmbedding: number[];
      topK: number;
      filters?: QuerySimilarFilters;
    }) {
      const response = await fetch(`${config.baseUrl}/indexes/${config.index}/query`, {
        method: "POST",
        headers: headersForCloud(config.apiKey),
        body: JSON.stringify({
          namespace: args.namespace,
          vector: args.queryEmbedding,
          topK: args.topK,
          includeMetadata: true,
          filter: {
            ...(args.filters?.documentId ? { documentId: args.filters.documentId } : {}),
            ...(args.filters?.sourceType ? { sourceType: args.filters.sourceType } : {}),
            jobId: args.jobId,
          },
        }),
      });

      if (!response.ok) {
        throw new Error(`Cloud query failed: ${response.status}`);
      }

      const data = (await response.json()) as unknown;
      return parseHits(data);
    },

    async deleteNamespace(args: { namespace: string }) {
      const response = await fetch(`${config.baseUrl}/indexes/${config.index}/delete`, {
        method: "POST",
        headers: headersForCloud(config.apiKey),
        body: JSON.stringify({
          deleteAll: true,
          namespace: args.namespace,
        }),
      });

      if (!response.ok) {
        throw new Error(`Cloud namespace delete failed: ${response.status}`);
      }
    },

    async healthcheck() {
      const response = await fetch(`${config.baseUrl}/healthcheck`, {
        method: "GET",
        headers: headersForCloud(config.apiKey),
      });

      if (!response.ok) {
        return { ok: false, details: `status=${response.status}` };
      }
      return { ok: true };
    },
  };
};
