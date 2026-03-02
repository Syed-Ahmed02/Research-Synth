"use node";

import { v } from "convex/values";
import { action } from "./_generated/server";
import { getVectorProvider, getVectorRuntimeConfig, namespaceForJob } from "../lib/vector";
import type { EvidenceItem, Locator } from "../lib/ai/contracts";
import type { PassageVectorRecord, QuerySimilarFilters } from "../lib/vector/types";

const fn = (name: string) => name as any;

const sourceTypeValidator = v.union(
  v.literal("wikipedia"),
  v.literal("arxiv"),
  v.literal("news"),
  v.literal("gov"),
  v.literal("web"),
);

const vectorIdForPassage = (jobId: string, passageId: string) => `${jobId}:${passageId}`;

// Deterministic local embedding fallback keeps integration testable before model wiring.
const embedTextDeterministic = (text: string): number[] => {
  const dims = 64;
  const values = new Array(dims).fill(0);
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    values[i % dims] += code / 255;
  }
  return values;
};

const quoteFromPassage = (text: string): string => {
  if (text.length <= 900) {
    return text;
  }
  return `${text.slice(0, 897)}...`;
};

const toRecord = (args: {
  jobId: string;
  passageId: string;
  documentId: string;
  url: string;
  title?: string;
  sourceType?: "wikipedia" | "arxiv" | "news" | "gov" | "web";
  text: string;
  locator: Locator;
}): PassageVectorRecord => {
  return {
    id: vectorIdForPassage(args.jobId, args.passageId),
    values: embedTextDeterministic(args.text),
    metadata: {
      passageId: args.passageId,
      documentId: args.documentId,
      jobId: args.jobId,
      url: args.url,
      title: args.title,
      quote: quoteFromPassage(args.text),
      locator: args.locator,
      sourceType: args.sourceType,
    },
  };
};

export const validateVectorRuntime = action({
  args: {},
  handler: async () => {
    const config = getVectorRuntimeConfig();
    const provider = getVectorProvider();
    const health = await provider.healthcheck();
    return {
      config,
      provider: provider.provider,
      health,
    };
  },
});

export const backfillPassagesForJob = action({
  args: {
    jobId: v.id("researchJobs"),
    forceReindex: v.optional(v.boolean()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<{ upsertedCount: number; attemptedCount: number }> => {
    const provider = getVectorProvider();
    const namespace = namespaceForJob(args.jobId);
    const passages = await ctx.runQuery(fn("artifacts:getPassagesForJob"), {
      jobId: args.jobId,
      limit: args.limit ?? 500,
      embeddingStatus: args.forceReindex ? undefined : "pending",
    });
    const documents = await ctx.runQuery(fn("artifacts:listDocumentsByJob"), {
      jobId: args.jobId,
    });

    const docsById = new Map<string, (typeof documents)[number]>();
    for (const doc of documents) {
      docsById.set(doc._id, doc);
    }

    await ctx.runMutation(fn("jobs:appendEvent"), {
      jobId: args.jobId,
      stage: "extract",
      level: "info",
      message: "embedding_started",
      payload: { provider: provider.provider, passageCount: passages.length },
    });

    let upserted = 0;
    for (const passage of passages) {
      try {
        const doc = docsById.get(passage.documentId);
        if (!doc?.url) {
          await ctx.runMutation(fn("artifacts:markPassageIndexFailed"), {
            passageId: passage._id,
          });
          continue;
        }

        const record = toRecord({
          jobId: args.jobId,
          passageId: passage._id,
          documentId: passage.documentId,
          url: doc.url,
          title: doc.title,
          sourceType: doc.sourceType,
          text: passage.text,
          locator: passage.locator,
        });

        await provider.upsertPassages({
          jobId: args.jobId,
          namespace,
          records: [record],
        });

        await ctx.runMutation(fn("artifacts:markPassageIndexed"), {
          passageId: passage._id,
          vectorProvider: provider.provider,
          vectorNamespace: namespace,
          externalVectorId: record.id,
        });
        upserted += 1;
      } catch {
        await ctx.runMutation(fn("artifacts:markPassageIndexFailed"), {
          passageId: passage._id,
        });
      }
    }

    await ctx.runMutation(fn("jobs:appendEvent"), {
      jobId: args.jobId,
      stage: "extract",
      level: "info",
      message: "embedding_indexed",
      payload: { provider: provider.provider, indexedCount: upserted },
    });

    return { upsertedCount: upserted, attemptedCount: passages.length };
  },
});

export const retrievePassages = action({
  args: {
    jobId: v.id("researchJobs"),
    queryText: v.string(),
    topK: v.optional(v.number()),
    filters: v.optional(
      v.object({
        documentId: v.optional(v.id("documents")),
        sourceType: v.optional(sourceTypeValidator),
      }),
    ),
  },
  handler: async (ctx, args): Promise<{ hits: EvidenceItem[] }> => {
    const config = getVectorRuntimeConfig();
    const provider = getVectorProvider();
    const namespace = namespaceForJob(args.jobId);
    const queryEmbedding = embedTextDeterministic(args.queryText);

    const filters: QuerySimilarFilters | undefined = args.filters
      ? {
          documentId: args.filters.documentId,
          sourceType: args.filters.sourceType,
        }
      : undefined;

    const hits = await provider.querySimilar({
      jobId: args.jobId,
      namespace,
      queryEmbedding,
      topK: args.topK ?? config.topK,
      filters,
    });

    const evidence: EvidenceItem[] = hits.map((hit) => ({
      passageId: hit.metadata.passageId,
      documentId: hit.metadata.documentId,
      url: hit.metadata.url,
      title: hit.metadata.title,
      quote: hit.metadata.quote,
      locator: hit.metadata.locator,
      score: hit.score,
      sourceType: hit.metadata.sourceType,
    }));

    await ctx.runMutation(fn("jobs:appendEvent"), {
      jobId: args.jobId,
      stage: "synthesize",
      level: "debug",
      message: "retrieval_hit",
      payload: {
        provider: provider.provider,
        hitCount: evidence.length,
        topK: args.topK ?? config.topK,
      },
    });

    return { hits: evidence };
  },
});
