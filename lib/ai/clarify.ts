import { z } from "zod";

import type { ResearchRunConfig } from "@/lib/ai/contracts";
import { generateStructured } from "@/lib/ai/openrouter";

export const ClarifyDecisionSchema = z.object({
  decision: z.enum(["clarify", "proceed"]),
  followUpQuestions: z.array(z.string().min(1)).max(5).optional(),
  refinedQuestion: z.string().min(1).optional(),
});

export type ClarifyDecision = z.infer<typeof ClarifyDecisionSchema>;

const fallbackFollowUpsFor = (question: string): string[] => {
  const q = question.trim();
  const base = [
    "What specific aspect are you interested in?",
    "What is your goal (learn fundamentals, compare options, troubleshoot, or get recommendations)?",
    "What context should I assume (your background level, tech stack, constraints)?",
  ];
  if (q.toLowerCase().includes("llm")) {
    return [
      "Which aspects of LLMs do you mean (tokenizers, transformers, training, inference, alignment, evaluation)?",
      ...base.slice(1),
    ];
  }
  return base;
};

const looksVagueHeuristic = (question: string): boolean => {
  const q = question.trim().toLowerCase();
  if (q.length < 12) return true;
  const words = q.split(/\s+/).filter(Boolean);
  if (words.length <= 3) return true;
  if (/^(tell me about|explain|overview of|what is|what are)\b/.test(q) && words.length <= 6) {
    return true;
  }
  return false;
};

export async function decideClarification(args: {
  config: ResearchRunConfig;
  question: string;
  conversationContext?: string;
}): Promise<ClarifyDecision> {
  const question = args.question.trim();
  if (!question) {
    return {
      decision: "clarify",
      followUpQuestions: ["What would you like to know? Please share a bit more detail."],
    };
  }

  // If it's clearly vague, don't block on LLM availability.
  const heuristicVague = looksVagueHeuristic(question);

  try {
    const result = await generateStructured({
      schema: ClarifyDecisionSchema,
      config: {
        depthPreset: args.config.depthPreset,
        // keep this cheap/fast even if main run uses a heavier model
        model: "openai/gpt-4o-mini",
      },
      system:
        "You help clarify user questions before research. If the question is too broad/vague, ask 2-4 follow-up questions and set decision=clarify. If it's specific enough, rewrite it into a concrete, search-ready question and set decision=proceed. Never answer the question yet.",
      prompt: `User question:\n${question}\n\nConversation context (optional):\n${args.conversationContext ?? "(none)"}\n\nReturn JSON that matches the schema exactly.`,
    });

    if (result.decision === "clarify") {
      const followUps = (result.followUpQuestions ?? []).map((q) => q.trim()).filter(Boolean);
      return {
        decision: "clarify",
        followUpQuestions: followUps.length ? followUps.slice(0, 4) : fallbackFollowUpsFor(question),
      };
    }

    const refined = (result.refinedQuestion ?? "").trim();
    if (refined) {
      return { decision: "proceed", refinedQuestion: refined };
    }

    // If model said proceed but didn't provide refined text, fall back to original question.
    return { decision: "proceed", refinedQuestion: question };
  } catch {
    if (heuristicVague) {
      return { decision: "clarify", followUpQuestions: fallbackFollowUpsFor(question) };
    }
    return { decision: "proceed", refinedQuestion: question };
  }
}

