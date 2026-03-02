import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

const sourceTypeValidator = v.union(
  v.literal("wikipedia"),
  v.literal("arxiv"),
  v.literal("news"),
  v.literal("gov"),
  v.literal("web"),
);

const locatorValidator = v.object({
  kind: v.union(
    v.literal("section"),
    v.literal("offset"),
    v.literal("page"),
    v.literal("unknown"),
  ),
  value: v.optional(v.string()),
});

const now = () => Date.now();

export const upsertDocument = mutation({
  args: {
    jobId: v.id("researchJobs"),
    sourceType: sourceTypeValidator,
    url: v.string(),
    title: v.optional(v.string()),
    text: v.string(),
    metadata: v.optional(v.any()),
    contentHash: v.optional(v.string()),
    chunkingVersion: v.optional(v.string()),
    embeddingModel: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("documents")
      .withIndex("by_jobId_url", (q) => q.eq("jobId", args.jobId).eq("url", args.url))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        sourceType: args.sourceType,
        title: args.title,
        text: args.text,
        metadata: args.metadata,
        contentHash: args.contentHash,
        chunkingVersion: args.chunkingVersion,
        embeddingModel: args.embeddingModel,
        fetchedAt: now(),
      });
      return existing._id;
    }

    return await ctx.db.insert("documents", {
      jobId: args.jobId,
      sourceType: args.sourceType,
      url: args.url,
      title: args.title,
      text: args.text,
      metadata: args.metadata,
      contentHash: args.contentHash,
      chunkingVersion: args.chunkingVersion,
      embeddingModel: args.embeddingModel,
      fetchedAt: now(),
    });
  },
});

export const createPassages = mutation({
  args: {
    jobId: v.id("researchJobs"),
    documentId: v.id("documents"),
    passages: v.array(
      v.object({
        text: v.string(),
        locator: locatorValidator,
        relevanceScore: v.optional(v.number()),
      }),
    ),
    vectorProvider: v.optional(v.union(v.literal("cloud"), v.literal("chroma"))),
    vectorNamespace: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const createdAt = now();
    const ids = [];
    for (const passage of args.passages) {
      const id = await ctx.db.insert("passages", {
        jobId: args.jobId,
        documentId: args.documentId,
        text: passage.text,
        locator: passage.locator,
        relevanceScore: passage.relevanceScore,
        createdAt,
        embeddingStatus: "pending",
        vectorProvider: args.vectorProvider,
        vectorNamespace: args.vectorNamespace,
      });
      ids.push(id);
    }
    return ids;
  },
});

export const markPassageIndexed = mutation({
  args: {
    passageId: v.id("passages"),
    vectorProvider: v.union(v.literal("cloud"), v.literal("chroma")),
    vectorNamespace: v.string(),
    externalVectorId: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.passageId, {
      embeddingStatus: "indexed",
      vectorProvider: args.vectorProvider,
      vectorNamespace: args.vectorNamespace,
      externalVectorId: args.externalVectorId,
      lastIndexedAt: now(),
    });
  },
});

export const markPassageIndexFailed = mutation({
  args: { passageId: v.id("passages") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.passageId, {
      embeddingStatus: "failed",
      lastIndexedAt: now(),
    });
  },
});

export const listDocumentsByJob = query({
  args: { jobId: v.id("researchJobs") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("documents")
      .withIndex("by_jobId_sourceType", (q) => q.eq("jobId", args.jobId))
      .collect();
  },
});

export const getPassagesForJob = query({
  args: {
    jobId: v.id("researchJobs"),
    embeddingStatus: v.optional(v.union(v.literal("pending"), v.literal("indexed"), v.literal("failed"))),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    if (args.embeddingStatus) {
      return await ctx.db
        .query("passages")
        .withIndex("by_jobId_embeddingStatus", (q) =>
          q.eq("jobId", args.jobId).eq("embeddingStatus", args.embeddingStatus!),
        )
        .take(args.limit ?? 500);
    }
    return await ctx.db
      .query("passages")
      .withIndex("by_jobId_documentId", (q) => q.eq("jobId", args.jobId))
      .take(args.limit ?? 500);
  },
});

export const upsertClaim = mutation({
  args: {
    jobId: v.id("researchJobs"),
    claimId: v.optional(v.id("claims")),
    claim: v.string(),
    status: v.union(v.literal("supported"), v.literal("contested"), v.literal("unknown")),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    if (args.claimId) {
      await ctx.db.patch(args.claimId, {
        claim: args.claim,
        status: args.status,
        notes: args.notes,
      });
      return args.claimId;
    }

    return await ctx.db.insert("claims", {
      jobId: args.jobId,
      claim: args.claim,
      status: args.status,
      notes: args.notes,
      createdAt: now(),
    });
  },
});

export const createCitation = mutation({
  args: {
    jobId: v.id("researchJobs"),
    claimId: v.id("claims"),
    documentId: v.id("documents"),
    url: v.string(),
    quote: v.string(),
    locator: locatorValidator,
  },
  handler: async (ctx, args) => {
    if (!args.quote.trim()) {
      throw new Error("Citation quote must be non-empty.");
    }

    const document = await ctx.db.get(args.documentId);
    if (!document) {
      throw new Error("Citation document not found.");
    }
    if (document.jobId !== args.jobId) {
      throw new Error("Citation document does not belong to the provided job.");
    }
    if (document.url !== args.url) {
      throw new Error("Citation URL must match the parent document URL.");
    }

    return await ctx.db.insert("citations", {
      ...args,
      createdAt: now(),
    });
  },
});

export const listClaimsByJob = query({
  args: {
    jobId: v.id("researchJobs"),
    status: v.optional(v.union(v.literal("supported"), v.literal("contested"), v.literal("unknown"))),
  },
  handler: async (ctx, args) => {
    if (args.status) {
      return await ctx.db
        .query("claims")
        .withIndex("by_jobId_status", (q) => q.eq("jobId", args.jobId).eq("status", args.status!))
        .collect();
    }
    return await ctx.db
      .query("claims")
      .withIndex("by_jobId_createdAt", (q) => q.eq("jobId", args.jobId))
      .collect();
  },
});

export const listCitationsByClaim = query({
  args: { jobId: v.id("researchJobs"), claimId: v.id("claims") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("citations")
      .withIndex("by_jobId_claimId", (q) => q.eq("jobId", args.jobId).eq("claimId", args.claimId))
      .collect();
  },
});

export const upsertReport = mutation({
  args: {
    jobId: v.id("researchJobs"),
    reportMd: v.string(),
    reportJson: v.any(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("reports")
      .withIndex("by_jobId", (q) => q.eq("jobId", args.jobId))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        reportMd: args.reportMd,
        reportJson: args.reportJson,
        createdAt: now(),
      });
      return existing._id;
    }

    return await ctx.db.insert("reports", {
      ...args,
      createdAt: now(),
    });
  },
});

export const getReportByJob = query({
  args: { jobId: v.id("researchJobs") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("reports")
      .withIndex("by_jobId", (q) => q.eq("jobId", args.jobId))
      .first();
  },
});
