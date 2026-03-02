export type StageName =
  | "plan"
  | "gather"
  | "extract"
  | "critique"
  | "cross_validate"
  | "synthesize";

export type SourceType = "wikipedia" | "arxiv" | "news" | "gov" | "web";
export type DepthPreset = "fast" | "standard" | "deep";

export const DEFAULT_MODEL_BY_DEPTH: Record<DepthPreset, string> = {
  deep: "openai/gpt-5.2",
  fast: "openai/gpt-4o-mini",
  standard: "anthropic/claude-opus-4.6",
};

export type ResearchRunConfig = {
  depthPreset: DepthPreset;
  sourcesEnabled: SourceType[];
  model: string;
  limits: {
    maxDocs: number;
    maxPassagesPerDoc: number;
    maxClaims?: number;
  };
};

export type LocatorKind = "section" | "offset" | "page" | "unknown";

export type Locator = {
  kind: LocatorKind;
  value?: string;
};

export type EvidenceItem = {
  passageId?: string;
  documentId: string;
  url: string;
  title?: string;
  quote: string;
  locator: Locator;
  score: number;
  sourceType?: SourceType;
};

export type ClaimEvidenceStatus = "supported" | "contested" | "unknown";

export type ClaimWithEvidence = {
  claimId: string;
  claim: string;
  status: ClaimEvidenceStatus;
  notes?: string;
  evidence: EvidenceItem[];
};
