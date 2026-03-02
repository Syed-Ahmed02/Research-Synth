import type { SourceType } from "@/lib/ai/contracts";

export type GatheredDocument = {
  metadata?: Record<string, unknown>;
  sourceType: SourceType;
  text: string;
  title?: string;
  url: string;
};
