import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

const stageValidator = v.union(
  v.literal("plan"),
  v.literal("gather"),
  v.literal("extract"),
  v.literal("critique"),
  v.literal("cross_validate"),
  v.literal("synthesize"),
);

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

export default defineSchema({
  researchJobs: defineTable({
    question: v.string(),
    threadId: v.optional(v.string()),
    promptMessageId: v.optional(v.string()),
    assistantMessageId: v.optional(v.string()),
    runId: v.optional(v.string()),
    status: v.union(
      v.literal("queued"),
      v.literal("running"),
      v.literal("succeeded"),
      v.literal("failed"),
      v.literal("cancelled"),
    ),
    currentStage: stageValidator,
    config: v.object({
      depthPreset: v.union(v.literal("fast"), v.literal("standard"), v.literal("deep")),
      sourcesEnabled: v.array(sourceTypeValidator),
      model: v.string(),
      limits: v.object({
        maxDocs: v.number(),
        maxPassagesPerDoc: v.number(),
        maxClaims: v.optional(v.number()),
      }),
    }),
    error: v.optional(
      v.object({
        stage: stageValidator,
        message: v.string(),
        code: v.optional(v.string()),
      }),
    ),
    createdAt: v.number(),
    startedAt: v.optional(v.number()),
    finishedAt: v.optional(v.number()),
    ownerId: v.optional(v.string()),
  })
    .index("by_status", ["status"])
    .index("by_createdAt", ["createdAt"])
    .index("by_ownerId_createdAt", ["ownerId", "createdAt"])
    .index("by_threadId_createdAt", ["threadId", "createdAt"]),

  chatSessions: defineTable({
    threadId: v.string(),
    title: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
    lastMessageAt: v.number(),
  })
    .index("by_threadId", ["threadId"])
    .index("by_lastMessageAt", ["lastMessageAt"]),

  chatMessages: defineTable({
    sessionId: v.id("chatSessions"),
    threadId: v.string(),
    role: v.union(v.literal("user"), v.literal("assistant"), v.literal("system"), v.literal("tool")),
    parts: v.optional(v.any()),
    text: v.string(),
    createdAt: v.number(),
    runId: v.optional(v.string()),
    jobId: v.optional(v.id("researchJobs")),
  })
    .index("by_sessionId_createdAt", ["sessionId", "createdAt"])
    .index("by_threadId_createdAt", ["threadId", "createdAt"]),

  jobEvents: defineTable({
    jobId: v.id("researchJobs"),
    threadId: v.optional(v.string()),
    runId: v.optional(v.string()),
    ts: v.number(),
    stage: stageValidator,
    level: v.union(
      v.literal("debug"),
      v.literal("info"),
      v.literal("warn"),
      v.literal("error"),
    ),
    message: v.string(),
    payload: v.optional(v.any()),
  })
    .index("by_jobId_ts", ["jobId", "ts"])
    .index("by_jobId_stage_ts", ["jobId", "stage", "ts"])
    .index("by_threadId_ts", ["threadId", "ts"]),

  documents: defineTable({
    jobId: v.id("researchJobs"),
    sourceType: sourceTypeValidator,
    url: v.string(),
    title: v.optional(v.string()),
    fetchedAt: v.number(),
    text: v.string(),
    metadata: v.optional(v.any()),
    contentHash: v.optional(v.string()),
    chunkingVersion: v.optional(v.string()),
    embeddingModel: v.optional(v.string()),
  })
    .index("by_jobId_sourceType", ["jobId", "sourceType"])
    .index("by_jobId_url", ["jobId", "url"])
    .index("by_contentHash", ["contentHash"]),

  passages: defineTable({
    jobId: v.id("researchJobs"),
    documentId: v.id("documents"),
    text: v.string(),
    locator: locatorValidator,
    relevanceScore: v.optional(v.number()),
    createdAt: v.number(),
    embeddingStatus: v.optional(
      v.union(v.literal("pending"), v.literal("indexed"), v.literal("failed")),
    ),
    vectorProvider: v.optional(v.union(v.literal("cloud"), v.literal("chroma"))),
    vectorNamespace: v.optional(v.string()),
    externalVectorId: v.optional(v.string()),
    lastIndexedAt: v.optional(v.number()),
  })
    .index("by_jobId_documentId", ["jobId", "documentId"])
    .index("by_jobId_relevanceScore", ["jobId", "relevanceScore"])
    .index("by_jobId_embeddingStatus", ["jobId", "embeddingStatus"]),

  claims: defineTable({
    jobId: v.id("researchJobs"),
    claim: v.string(),
    status: v.union(
      v.literal("supported"),
      v.literal("contested"),
      v.literal("unknown"),
    ),
    notes: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_jobId_status", ["jobId", "status"])
    .index("by_jobId_createdAt", ["jobId", "createdAt"]),

  citations: defineTable({
    jobId: v.id("researchJobs"),
    claimId: v.id("claims"),
    documentId: v.id("documents"),
    url: v.string(),
    quote: v.string(),
    locator: locatorValidator,
    createdAt: v.number(),
  })
    .index("by_jobId_claimId", ["jobId", "claimId"])
    .index("by_jobId_documentId", ["jobId", "documentId"]),

  reports: defineTable({
    jobId: v.id("researchJobs"),
    reportMd: v.string(),
    reportJson: v.any(),
    createdAt: v.number(),
  }).index("by_jobId", ["jobId"]),
});
