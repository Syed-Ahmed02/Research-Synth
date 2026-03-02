import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

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

const now = () => Date.now();

export const createJob = mutation({
  args: {
    question: v.string(),
    ownerId: v.optional(v.string()),
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
  },
  handler: async (ctx, args) => {
    const createdAt = now();
    const jobId = await ctx.db.insert("researchJobs", {
      question: args.question,
      status: "queued",
      currentStage: "plan",
      config: args.config,
      ownerId: args.ownerId,
      createdAt,
    });

    await ctx.db.insert("jobEvents", {
      jobId,
      ts: createdAt,
      stage: "plan",
      level: "info",
      message: "Job queued",
      payload: { eventType: "job_created" },
    });

    return jobId;
  },
});

export const setJobStatus = mutation({
  args: {
    jobId: v.id("researchJobs"),
    status: v.union(
      v.literal("queued"),
      v.literal("running"),
      v.literal("succeeded"),
      v.literal("failed"),
      v.literal("cancelled"),
    ),
    currentStage: stageValidator,
    error: v.optional(
      v.object({
        stage: stageValidator,
        message: v.string(),
        code: v.optional(v.string()),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const ts = now();
    await ctx.db.patch(args.jobId, {
      status: args.status,
      currentStage: args.currentStage,
      ...(args.status === "running" ? { startedAt: ts } : {}),
      ...(["succeeded", "failed", "cancelled"].includes(args.status)
        ? { finishedAt: ts }
        : {}),
      ...(args.error ? { error: args.error } : {}),
    });

    await ctx.db.insert("jobEvents", {
      jobId: args.jobId,
      ts,
      stage: args.currentStage,
      level: args.status === "failed" ? "error" : "info",
      message: `Job status changed to ${args.status}`,
      payload: { eventType: "job_status_changed", status: args.status, error: args.error },
    });
  },
});

export const appendEvent = mutation({
  args: {
    jobId: v.id("researchJobs"),
    stage: stageValidator,
    level: v.union(v.literal("debug"), v.literal("info"), v.literal("warn"), v.literal("error")),
    message: v.string(),
    payload: v.optional(v.any()),
    ts: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("jobEvents", {
      jobId: args.jobId,
      ts: args.ts ?? now(),
      stage: args.stage,
      level: args.level,
      message: args.message,
      payload: args.payload,
    });
  },
});

export const getJob = query({
  args: { jobId: v.id("researchJobs") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.jobId);
  },
});

export const listJobs = query({
  args: {
    status: v.optional(
      v.union(
        v.literal("queued"),
        v.literal("running"),
        v.literal("succeeded"),
        v.literal("failed"),
        v.literal("cancelled"),
      ),
    ),
    ownerId: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 50;
    if (args.ownerId) {
      return await ctx.db
        .query("researchJobs")
        .withIndex("by_ownerId_createdAt", (q) => q.eq("ownerId", args.ownerId!))
        .order("desc")
        .take(limit);
    }
    if (args.status) {
      return await ctx.db
        .query("researchJobs")
        .withIndex("by_status", (q) => q.eq("status", args.status!))
        .order("desc")
        .take(limit);
    }
    return await ctx.db.query("researchJobs").withIndex("by_createdAt").order("desc").take(limit);
  },
});

export const listJobEvents = query({
  args: {
    jobId: v.id("researchJobs"),
    stage: v.optional(stageValidator),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 200;
    if (args.stage) {
      return await ctx.db
        .query("jobEvents")
        .withIndex("by_jobId_stage_ts", (q) => q.eq("jobId", args.jobId).eq("stage", args.stage!))
        .order("asc")
        .take(limit);
    }
    return await ctx.db
      .query("jobEvents")
      .withIndex("by_jobId_ts", (q) => q.eq("jobId", args.jobId))
      .order("asc")
      .take(limit);
  },
});
