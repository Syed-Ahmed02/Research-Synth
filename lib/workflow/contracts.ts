import { z } from "zod";

export const STAGE_ORDER = [
  "plan",
  "gather",
  "extract",
  "critique",
  "cross_validate",
  "synthesize",
] as const;

export const PlannerOutputSchema = z.object({
  limits: z.object({
    maxDocs: z.number().int().positive().max(40),
    maxPassagesPerDoc: z.number().int().positive().max(20),
  }),
  searchTermsBySource: z.object({
    arxiv: z.array(z.string()).default([]),
    gov: z.array(z.string()).default([]),
    news: z.array(z.string()).default([]),
    web: z.array(z.string()).default([]),
    wikipedia: z.array(z.string()).default([]),
  }),
  subQuestions: z.array(z.string()).min(1).max(8),
});

export const ExtractOutputSchema = z.object({
  claims: z.array(z.string()).max(12),
  passages: z.array(
    z.object({
      locatorKind: z.enum(["section", "offset", "page", "unknown"]).default("unknown"),
      locatorValue: z.string().optional(),
      relevanceScore: z.number().min(0).max(1).optional(),
      text: z.string().min(20),
    }),
  ),
});

export const CritiqueOutputSchema = z.object({
  updates: z.array(
    z.object({
      claimId: z.string(),
      notes: z.string().optional(),
      status: z.enum(["supported", "contested", "unknown"]),
    }),
  ),
});

export const CrossValidateOutputSchema = z.object({
  citations: z.array(
    z.object({
      claimId: z.string(),
      locatorKind: z.enum(["section", "offset", "page", "unknown"]).default("unknown"),
      locatorValue: z.string().optional(),
      quote: z.string().min(1),
      url: z.string().url(),
    }),
  ),
});

export type PlannerOutput = z.infer<typeof PlannerOutputSchema>;
