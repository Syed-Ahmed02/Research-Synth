import { ConvexHttpClient } from "convex/browser";
import { stepCountIs } from "ai";
import { webSearch } from "@exalabs/ai-sdk";
import { streamSynthesisText } from "@/lib/ai/openrouter";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import type { ResearchRunConfig } from "@/lib/ai/contracts";
import { decideClarification } from "@/lib/ai/clarify";
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

const extractResourcesFromMarkdown = (markdown: string) => {
  const resources: Array<{ url: string; title?: string }> = [];
  const seen = new Set<string>();
  const regex = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;
  for (const match of markdown.matchAll(regex)) {
    const title = (match[1] ?? "").trim();
    const url = (match[2] ?? "").trim();
    if (!url || seen.has(url)) {
      continue;
    }
    if (!url.includes("arxiv.org")) {
      continue;
    }
    seen.add(url);
    resources.push({ url, title: title || undefined });
    if (resources.length >= 15) {
      break;
    }
  }
  return resources;
};

const conversationContextFromMessages = (messages: unknown[]) => {
  const lines: string[] = [];
  for (const message of messages.slice(-8)) {
    if (!message || typeof message !== "object") continue;
    const role = typeof (message as { role?: unknown }).role === "string" ? (message as { role: string }).role : "unknown";
    const text = extractMessageText(message).trim();
    if (!text) continue;
    lines.push(`${role.toUpperCase()}: ${text}`);
  }
  return lines.join("\n");
};

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
  if (!process.env.EXA_API_KEY) {
    return new Response("EXA_API_KEY is not configured.", { status: 500 });
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

  // If the question is vague, ask follow-ups and don't start searching yet.
  const clarification = await decideClarification({
    config,
    question,
    conversationContext: conversationContextFromMessages(parsed.data.messages),
  });
  if (clarification.decision === "clarify") {
    const followUps = clarification.followUpQuestions ?? [];
    const followUpPrompt =
      followUps.length > 0
        ? `The user asked: ${question}\n\nAsk these follow-up questions (bulleted), then instruct the user to answer them in one reply:\n${followUps.map((q) => `- ${q}`).join("\n")}`
        : `The user asked: ${question}\n\nAsk 2-4 follow-up questions to clarify what they mean, then instruct them to answer in one reply.`;

    const streamResult = streamSynthesisText({
      config,
      system:
        "You are a research assistant. Do NOT answer yet. Only ask clarifying questions to make the user request specific, then wait for their reply.",
      prompt: followUpPrompt,
    });

    return streamResult.toUIMessageStreamResponse({
      onError: () => "Failed to ask clarifying questions.",
    });
  }

  const convex = new ConvexHttpClient(convexUrl);
  let jobId: Id<"researchJobs"> | undefined;

  try {
    jobId = await convex.mutation(api.jobs.createJob, {
      config,
      question: clarification.refinedQuestion ?? question,
      runId,
      threadId,
    });
    const refinedQuestion = clarification.refinedQuestion ?? question;

    const streamResult = streamSynthesisText({
      config,
      system:
        "You are a research assistant. First, use the webSearch tool to find relevant arXiv resources for the question.\n\nRules:\n- Use webSearch once.\n- Your search query MUST restrict to arXiv (use site:arxiv.org).\n- Use ONLY the webSearch results. Do not invent sources or URLs.\n- Output markdown with: ## Summary, ## Resources, ## Limits & Unknowns.\n- In ## Resources, include a ranked bullet list of markdown links, each with a 1-line note.\n- If no relevant arXiv results are found, say so and ask a clarifying question.",
      tools: {
        webSearch: webSearch({
          numResults: 10,
          type: "auto",
          contents: {
            summary: true,
            text: { maxCharacters: 2500 },
            livecrawl: "fallback",
          },
        }),
      },
      stopWhen: stepCountIs(2),
      prompt: `Question:\n${refinedQuestion}\n\nDo:\n1) Call webSearch with query: site:arxiv.org ${refinedQuestion}\n2) Read the results and write the response.`,
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
        const resources = extractResourcesFromMarkdown(reportMd);
        const reportJson = {
          refinedQuestion,
          resources,
          generatedAt: new Date().toISOString(),
        };
        await convex.mutation(api.artifacts.upsertReport, {
          jobId,
          reportJson,
          reportMd,
        });
        await convex.mutation(api.jobs.appendEvent, {
          jobId,
          level: "info",
          message: "[synthesize] completed",
          payload: { reportChars: reportMd.length, resourceCount: resources.length },
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
