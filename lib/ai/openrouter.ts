import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { generateObject, streamText } from "ai";
import type { ModelMessage } from "ai";
import { z } from "zod";

import type { DepthPreset, ResearchRunConfig } from "./contracts";
import { DEFAULT_MODEL_BY_DEPTH } from "./contracts";

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
  prompt?: string;
  messages?: ModelMessage[];
  config: Pick<ResearchRunConfig, "depthPreset" | "model">;
  tools?: Parameters<typeof streamText>[0]["tools"];
  stopWhen?: Parameters<typeof streamText>[0]["stopWhen"];
}) {
  if (!args.prompt && !args.messages?.length) {
    throw new Error("streamSynthesisText requires either prompt or messages.");
  }
  const base = {
    model: resolveModel(args.config),
    system: args.system,
    temperature: 0.2,
    tools: args.tools,
    stopWhen: args.stopWhen,
  };
  if (args.messages && args.messages.length > 0) {
    return streamText({ ...base, messages: args.messages });
  }
  return streamText({ ...base, prompt: args.prompt as string });
}
