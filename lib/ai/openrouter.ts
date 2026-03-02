import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { generateObject, streamText } from "ai";
import { z } from "zod";

import type { DepthPreset, ResearchRunConfig } from "./contracts";

const DEFAULT_MODEL_BY_DEPTH: Record<DepthPreset, string> = {
  deep: "anthropic/claude-3.7-sonnet",
  fast: "openai/gpt-4o-mini",
  standard: "anthropic/claude-3.5-sonnet",
};

const openrouter = createOpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY,
});

export function resolveModel(config: Pick<ResearchRunConfig, "depthPreset" | "model">) {
  return openrouter(config.model || DEFAULT_MODEL_BY_DEPTH[config.depthPreset]);
}

export async function generateStructured<TSchema extends z.ZodTypeAny>(args: {
  schema: TSchema;
  system: string;
  prompt: string;
  config: Pick<ResearchRunConfig, "depthPreset" | "model">;
}) {
  const result = await generateObject({
    model: resolveModel(args.config),
    prompt: args.prompt,
    schema: args.schema,
    system: args.system,
    temperature: 0.1,
  });

  return result.object as z.infer<TSchema>;
}

export function streamSynthesisText(args: {
  system: string;
  prompt: string;
  config: Pick<ResearchRunConfig, "depthPreset" | "model">;
}) {
  return streamText({
    model: resolveModel(args.config),
    prompt: args.prompt,
    system: args.system,
    temperature: 0.2,
  });
}
