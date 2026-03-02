import { ConvexHttpClient } from "convex/browser";
import { streamSynthesisText } from "@/lib/ai/openrouter";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import type { ResearchRunConfig } from "@/lib/ai/contracts";
import { buildSynthesisPrompt, runWorkflowUntilSynthesis } from "@/lib/workflow/runner";
import { z } from "zod";

const RequestSchema = z.object({
  config: z
    .object({
      depthPreset: z.enum(["fast", "standard", "deep"]),
      limits: z.object({
        maxClaims: z.number().int().positive().max(20).optional(),
        maxDocs: z.number().int().positive().max(40),
        maxPassagesPerDoc: z.number().int().positive().max(20),
      }),
      model: z.string().min(1),
      sourcesEnabled: z.array(z.enum(["wikipedia", "arxiv", "news", "gov", "web"])).min(1),
    })
    .optional(),
  id: z.string().optional(),
  messages: z.array(z.any()),
  threadId: z.string().optional(),
});

const DEFAULT_CONFIG: ResearchRunConfig = {
  depthPreset: "standard",
  limits: {
    maxClaims: 8,
    maxDocs: 8,
    maxPassagesPerDoc: 4,
  },
  model: "anthropic/claude-3.5-sonnet",
  sourcesEnabled: ["wikipedia", "arxiv"],
};

const extractMessageText = (message: unknown) => {
  if (!message || typeof message !== "object") {
    return "";
  }

  const parts = (message as { parts?: unknown }).parts;
  if (!Array.isArray(parts)) {
    return "";
  }

  return parts
    .map((part) => {
      if (!part || typeof part !== "object") {
        return "";
      }
      if ((part as { type?: unknown }).type !== "text") {
        return "";
      }
      return typeof (part as { text?: unknown }).text === "string"
        ? (part as { text: string }).text
        : "";
    })
    .filter(Boolean)
    .join("\n");
};

const mergeConfig = (config?: Partial<ResearchRunConfig>): ResearchRunConfig => ({
  ...DEFAULT_CONFIG,
  ...config,
  limits: { ...DEFAULT_CONFIG.limits, ...config?.limits },
  sourcesEnabled: config?.sourcesEnabled?.length ? config.sourcesEnabled : DEFAULT_CONFIG.sourcesEnabled,
});

const extractAssistantText = (responseMessage: unknown) => extractMessageText(responseMessage);

export async function POST(req: Request) {
  const bodyRaw = await req.json();
  const parsed = RequestSchema.safeParse(bodyRaw);
  if (!parsed.success) {
    return new Response("Invalid request payload.", { status: 400 });
  }

  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!convexUrl) {
    return new Response("NEXT_PUBLIC_CONVEX_URL is not configured.", { status: 500 });
  }
  if (!process.env.OPENROUTER_API_KEY) {
    return new Response("OPENROUTER_API_KEY is not configured.", { status: 500 });
  }

  const config = mergeConfig(parsed.data.config);
  const threadId = parsed.data.threadId ?? parsed.data.id;
  const runId = crypto.randomUUID();
  const userMessages = parsed.data.messages.filter(
    (message) => message && typeof message === "object" && (message as { role?: string }).role === "user",
  );
  const lastUser = userMessages.at(-1);
  const question = extractMessageText(lastUser)?.trim();
  if (!question) {
    return new Response("Please send a user question.", { status: 400 });
  }

  const convex = new ConvexHttpClient(convexUrl);
  let jobId: Id<"researchJobs"> | undefined;

  try {
    jobId = await convex.mutation(api.jobs.createJob, {
      config,
      question,
      runId,
      threadId,
    });

    const synthesisInput = await runWorkflowUntilSynthesis({
      config,
      convex,
      jobId,
      question,
      runId,
      threadId,
    });

    await convex.mutation(api.jobs.setJobStatus, {
      currentStage: "synthesize",
      jobId,
      status: "running",
    });
    await convex.mutation(api.jobs.appendEvent, {
      jobId,
      level: "info",
      message: "[synthesize] starting",
      payload: { claimCount: synthesisInput.claims.length },
      runId,
      stage: "synthesize",
      threadId,
    });

    const reportJson = {
      claims: synthesisInput.claims.map((claim) => ({
        citations: claim.citations.map((citation) => citation._id),
        claimId: claim._id,
        status: claim.status,
      })),
    };

    const streamResult = streamSynthesisText({
      config,
      prompt: buildSynthesisPrompt(synthesisInput),
      system:
        "You are a research synthesizer. Never invent sources. If evidence is missing, say unknown explicitly.",
    });

    return streamResult.toUIMessageStreamResponse({
      onError: (error) => {
        if (jobId) {
          void convex.mutation(api.jobs.setJobStatus, {
            currentStage: "synthesize",
            error: {
              message: error instanceof Error ? error.message : "Unknown stream error",
              stage: "synthesize",
            },
            jobId,
            status: "failed",
          });
        }
        return "Synthesis streaming failed.";
      },
      onFinish: async ({ responseMessage }) => {
        if (!jobId) {
          return;
        }
        const reportMd = extractAssistantText(responseMessage);
        await convex.mutation(api.artifacts.upsertReport, {
          jobId,
          reportJson,
          reportMd,
        });
        await convex.mutation(api.jobs.appendEvent, {
          jobId,
          level: "info",
          message: "[synthesize] completed",
          payload: { reportChars: reportMd.length },
          runId,
          stage: "synthesize",
          threadId,
        });
        await convex.mutation(api.jobs.setJobStatus, {
          currentStage: "synthesize",
          jobId,
          status: "succeeded",
        });
      },
    });
  } catch (error) {
    if (jobId) {
      await convex.mutation(api.jobs.setJobStatus, {
        currentStage: "synthesize",
        error: {
          message: error instanceof Error ? error.message : "Unknown workflow failure",
          stage: "synthesize",
        },
        jobId,
        status: "failed",
      });
    }
    return new Response(error instanceof Error ? error.message : "Failed to run workflow.", {
      status: 500,
    });
  }
}
