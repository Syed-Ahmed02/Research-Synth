import { CloudClient } from "chromadb";
import type { Collection } from "chromadb";
import type {
  PassageVectorRecord,
  QuerySimilarFilters,
  VectorMetadata,
  VectorAdapter,
  VectorQueryHit,
} from "../types";

type ChromaConfig = {
  apiKey: string;
  tenant: string;
  database: string;
  collection: string;
};

const normalizeCollectionName = (name: string) => name.replace(/[^a-zA-Z0-9_-]/g, "_");

const toSimilarityScore = (distance: number | undefined): number => {
  if (typeof distance !== "number") {
    return 0;
  }
  return 1 / (1 + Math.max(distance, 0));
};

const toChromaMetadata = (jobId: string, metadata: PassageVectorRecord["metadata"]) => ({
  passageId: metadata.passageId,
  documentId: metadata.documentId,
  jobId,
  url: metadata.url,
  title: metadata.title ?? "",
  quote: metadata.quote,
  sourceType: metadata.sourceType ?? "",
  locatorKind: metadata.locator.kind,
  locatorValue: metadata.locator.value ?? "",
});

const fromChromaMetadata = (metadata: Record<string, unknown>): VectorMetadata | null => {
  if (
    typeof metadata.passageId !== "string" ||
    typeof metadata.documentId !== "string" ||
    typeof metadata.jobId !== "string" ||
    typeof metadata.url !== "string" ||
    typeof metadata.quote !== "string" ||
    typeof metadata.locatorKind !== "string"
  ) {
    return null;
  }

  return {
    passageId: metadata.passageId,
    documentId: metadata.documentId,
    jobId: metadata.jobId,
    url: metadata.url,
    title: typeof metadata.title === "string" && metadata.title ? metadata.title : undefined,
    quote: metadata.quote,
    sourceType:
      typeof metadata.sourceType === "string" && metadata.sourceType
        ? (metadata.sourceType as VectorMetadata["sourceType"])
        : undefined,
    locator: {
      kind: metadata.locatorKind as VectorMetadata["locator"]["kind"],
      value: typeof metadata.locatorValue === "string" && metadata.locatorValue
        ? metadata.locatorValue
        : undefined,
    },
  };
};

export const createChromaProvider = (config: ChromaConfig): VectorAdapter => {
  const client = new CloudClient({
    apiKey: config.apiKey,
    tenant: config.tenant,
    database: config.database,
  });

  const collectionCache = new Map<string, Promise<Collection>>();

  const collectionForNamespace = (namespace: string): Promise<Collection> => {
    const collectionName = normalizeCollectionName(`${config.collection}_${namespace}`);
    const cached = collectionCache.get(collectionName);
    if (cached) {
      return cached;
    }
    const created = client.getOrCreateCollection({ name: collectionName });
    collectionCache.set(collectionName, created);
    return created;
  };

  return {
    provider: "chroma",

    async upsertPassages(args: {
      jobId: string;
      namespace: string;
      records: PassageVectorRecord[];
    }) {
      const collection = await collectionForNamespace(args.namespace);
      await collection.upsert({
        ids: args.records.map((r) => r.id),
        embeddings: args.records.map((r) => r.values),
        metadatas: args.records.map((r) => toChromaMetadata(args.jobId, r.metadata)),
        documents: args.records.map((r) => r.metadata.quote),
      });

      return { upsertedCount: args.records.length };
    },

    async querySimilar(args: {
      jobId: string;
      namespace: string;
      queryEmbedding: number[];
      topK: number;
      filters?: QuerySimilarFilters;
    }) {
      const collection = await collectionForNamespace(args.namespace);
      const where = {
        ...(args.filters?.documentId ? { documentId: args.filters.documentId } : {}),
        ...(args.filters?.sourceType ? { sourceType: args.filters.sourceType } : {}),
        jobId: args.jobId,
      };

      const result = await collection.query({
        queryEmbeddings: [args.queryEmbedding],
        nResults: args.topK,
        where,
      });

      const ids = result.ids?.[0] ?? [];
      const distances = result.distances?.[0] ?? [];
      const metadatas = result.metadatas?.[0] ?? [];

      return ids
        .map((id, index) => {
          const metadata = metadatas[index];
          if (!id || !metadata) {
            return null;
          }
          const parsed = fromChromaMetadata(metadata as unknown as Record<string, unknown>);
          if (!parsed) {
            return null;
          }
          return {
            id,
            score: toSimilarityScore(distances[index] ?? undefined),
            metadata: parsed,
          };
        })
        .filter((row): row is VectorQueryHit => row !== null);
    },

    async deleteNamespace(args: { namespace: string }) {
      const collectionName = normalizeCollectionName(`${config.collection}_${args.namespace}`);
      await client.deleteCollection({ name: collectionName });
      collectionCache.delete(collectionName);
    },

    async healthcheck() {
      try {
        await client.listCollections();
        return { ok: true };
      } catch (error) {
        const message = error instanceof Error ? error.message : "unknown error";
        return { ok: false, details: message };
      }
    },
  };
};
