import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";

const now = () => Date.now();

const messageRoleValidator = v.union(
  v.literal("user"),
  v.literal("assistant"),
  v.literal("system"),
  v.literal("tool"),
);

const getSessionByThreadId = async (
  ctx: MutationCtx | QueryCtx,
  threadId: string,
) => {
  return await ctx.db
    .query("chatSessions")
    .withIndex("by_threadId", (q) => q.eq("threadId", threadId))
    .first();
};

export const upsertSession = mutation({
  args: {
    threadId: v.string(),
    title: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const ts = now();
    const existing = await getSessionByThreadId(ctx, args.threadId);
    if (existing) {
      await ctx.db.patch(existing._id, {
        ...(args.title ? { title: args.title } : {}),
        updatedAt: ts,
      });
      return existing._id;
    }

    return await ctx.db.insert("chatSessions", {
      threadId: args.threadId,
      ...(args.title ? { title: args.title } : {}),
      createdAt: ts,
      updatedAt: ts,
      lastMessageAt: ts,
    });
  },
});

export const touchSession = mutation({
  args: {
    sessionId: v.optional(v.id("chatSessions")),
    threadId: v.optional(v.string()),
    title: v.optional(v.string()),
    lastMessageAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const ts = args.lastMessageAt ?? now();
    let sessionId = args.sessionId;
    if (!sessionId && args.threadId) {
      const existing = await getSessionByThreadId(ctx, args.threadId);
      if (existing) {
        sessionId = existing._id;
      } else {
        sessionId = await ctx.db.insert("chatSessions", {
          threadId: args.threadId,
          ...(args.title ? { title: args.title } : {}),
          createdAt: ts,
          updatedAt: ts,
          lastMessageAt: ts,
        });
      }
    }
    if (!sessionId) {
      throw new Error("Either sessionId or threadId is required.");
    }
    await ctx.db.patch(sessionId, {
      ...(args.title ? { title: args.title } : {}),
      updatedAt: ts,
      lastMessageAt: ts,
    });
    return sessionId;
  },
});

export const appendMessage = mutation({
  args: {
    threadId: v.string(),
    role: messageRoleValidator,
    text: v.string(),
    parts: v.optional(v.any()),
    runId: v.optional(v.string()),
    jobId: v.optional(v.id("researchJobs")),
    createdAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const ts = args.createdAt ?? now();
    let session = await getSessionByThreadId(ctx, args.threadId);
    let sessionId: Id<"chatSessions">;
    if (!session) {
      const title = args.role === "user" ? args.text.slice(0, 120) : undefined;
      sessionId = await ctx.db.insert("chatSessions", {
        threadId: args.threadId,
        ...(title ? { title } : {}),
        createdAt: ts,
        updatedAt: ts,
        lastMessageAt: ts,
      });
      session = await ctx.db.get(sessionId);
    } else {
      sessionId = session._id;
    }

    const messageId = await ctx.db.insert("chatMessages", {
      sessionId,
      threadId: args.threadId,
      role: args.role,
      text: args.text,
      parts: args.parts,
      createdAt: ts,
      runId: args.runId,
      jobId: args.jobId,
    });

    const nextTitle =
      !session?.title && args.role === "user" && args.text.trim()
        ? args.text.trim().slice(0, 120)
        : undefined;
    await ctx.db.patch(sessionId, {
      ...(nextTitle ? { title: nextTitle } : {}),
      updatedAt: ts,
      lastMessageAt: ts,
    });

    return messageId;
  },
});

export const listSessions = query({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 50;
    return await ctx.db.query("chatSessions").withIndex("by_lastMessageAt").order("desc").take(limit);
  },
});

export const listMessagesByThread = query({
  args: {
    threadId: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 60;
    const newestFirst = await ctx.db
      .query("chatMessages")
      .withIndex("by_threadId_createdAt", (q) => q.eq("threadId", args.threadId))
      .order("desc")
      .take(limit);
    return newestFirst.reverse();
  },
});
