import type { Locator } from "../ai/contracts";

export type VectorProvider = "cloud" | "chroma";

export type VectorMetadata = {
  passageId: string;
  documentId: string;
  jobId: string;
  url: string;
  title?: string;
  quote: string;
  locator: Locator;
  sourceType?: "wikipedia" | "arxiv" | "news" | "gov" | "web";
};

export type PassageVectorRecord = {
  id: string;
  values: number[];
  metadata: VectorMetadata;
};

export type QuerySimilarFilters = {
  documentId?: string;
  sourceType?: "wikipedia" | "arxiv" | "news" | "gov" | "web";
};

export type VectorQueryHit = {
  id: string;
  score: number;
  metadata: VectorMetadata;
};

export interface VectorAdapter {
  readonly provider: VectorProvider;
  upsertPassages(args: {
    jobId: string;
    namespace: string;
    records: PassageVectorRecord[];
  }): Promise<{ upsertedCount: number }>;
  querySimilar(args: {
    jobId: string;
    namespace: string;
    queryEmbedding: number[];
    topK: number;
    filters?: QuerySimilarFilters;
  }): Promise<VectorQueryHit[]>;
  deleteNamespace(args: { jobId: string; namespace: string }): Promise<void>;
  healthcheck(): Promise<{ ok: boolean; details?: string }>;
}

export type VectorRuntimeConfig = {
  provider: VectorProvider;
  embeddingModel: string;
  topK: number;
  namespacePrefix: string;
};
