import { ConvexHttpClient } from "convex/browser";
import type { Id } from "@/convex/_generated/dataModel";
import { api } from "@/convex/_generated/api";
import type { ResearchRunConfig, SourceType } from "@/lib/ai/contracts";
import { generateStructured } from "@/lib/ai/openrouter";
import { gatherArxivDocuments } from "@/lib/sources/arxiv";
import { gatherWikipediaDocuments } from "@/lib/sources/wikipedia";
import type { GatheredDocument } from "@/lib/sources/types";
import {
  CritiqueOutputSchema,
  CrossValidateOutputSchema,
  ExtractOutputSchema,
  PlannerOutputSchema,
} from "./contracts";

type JobId = Id<"researchJobs">;
type StageName = "plan" | "gather" | "extract" | "critique" | "cross_validate" | "synthesize";

type ClaimRow = {
  _id: Id<"claims">;
  claim: string;
  notes?: string;
  status: "supported" | "contested" | "unknown";
};

type DocumentRow = {
  _id: Id<"documents">;
  sourceType: SourceType;
  text: string;
  title?: string;
  url: string;
};

type CitationRow = {
  _id: Id<"citations">;
  claimId: Id<"claims">;
  locator: { kind: "section" | "offset" | "page" | "unknown"; value?: string };
  quote: string;
  url: string;
};

export type SynthesisInput = {
  claims: Array<ClaimRow & { citations: CitationRow[] }>;
  question: string;
};

const stageMessage = (stage: StageName, message: string) => `[${stage}] ${message}`;

const normalizeLimits = (config: ResearchRunConfig, plannedMaxDocs?: number, plannedMaxPassages?: number) => ({
  maxDocs: Math.min(Math.max(plannedMaxDocs ?? config.limits.maxDocs, 1), 40),
  maxPassagesPerDoc: Math.min(
    Math.max(plannedMaxPassages ?? config.limits.maxPassagesPerDoc, 1),
    20,
  ),
});

const splitIntoCandidatePassages = (text: string, maxPassages: number) => {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter((part) => part.length >= 80);
  if (paragraphs.length > 0) {
    return paragraphs.slice(0, maxPassages);
  }

  const sentences = text
    .split(/(?<=[.!?])\s+/)
    .map((part) => part.trim())
    .filter((part) => part.length >= 40);

  const chunks: string[] = [];
  let current = "";
  for (const sentence of sentences) {
    const candidate = current ? `${current} ${sentence}` : sentence;
    if (candidate.length <= 500) {
      current = candidate;
      continue;
    }
    if (current.length > 0) {
      chunks.push(current);
    }
    current = sentence;
    if (chunks.length >= maxPassages) {
      break;
    }
  }
  if (current.length > 0 && chunks.length < maxPassages) {
    chunks.push(current);
  }

  return chunks.slice(0, maxPassages);
};

const deriveFallbackClaim = (args: { docTitle?: string; passage: string }) => {
  const normalized = args.passage.replaceAll(/\s+/g, " ").trim();
  const sentence = normalized.split(/(?<=[.!?])\s+/)[0]?.trim() ?? normalized;
  const capped = sentence.length > 220 ? `${sentence.slice(0, 217)}...` : sentence;
  return args.docTitle ? `${args.docTitle}: ${capped}` : capped;
};

async function appendEvent(
  convex: ConvexHttpClient,
  args: {
    jobId: JobId;
    level: "debug" | "info" | "warn" | "error";
    message: string;
    payload?: unknown;
    runId?: string;
    stage: StageName;
    threadId?: string;
  },
) {
  await convex.mutation(api.jobs.appendEvent, args);
}

async function setRunningStage(convex: ConvexHttpClient, jobId: JobId, stage: StageName) {
  await convex.mutation(api.jobs.setJobStatus, {
    currentStage: stage,
    jobId,
    status: "running",
  });
}

async function runPlanStage(args: {
  config: ResearchRunConfig;
  convex: ConvexHttpClient;
  jobId: JobId;
  question: string;
  runId?: string;
  threadId?: string;
}) {
  await setRunningStage(args.convex, args.jobId, "plan");
  await appendEvent(args.convex, {
    jobId: args.jobId,
    level: "info",
    message: stageMessage("plan", "starting"),
    runId: args.runId,
    stage: "plan",
    threadId: args.threadId,
  });

  const output = await generateStructured({
    config: args.config,
    prompt: `Question: ${args.question}
Available sources: ${args.config.sourcesEnabled.join(", ")}
Current limits: maxDocs=${args.config.limits.maxDocs}, maxPassagesPerDoc=${args.config.limits.maxPassagesPerDoc}`,
    schema: PlannerOutputSchema,
    system:
      "You are a research planner. Return concise sub-questions and search terms per source.",
  }).catch(() => ({
    limits: {
      maxDocs: args.config.limits.maxDocs,
      maxPassagesPerDoc: args.config.limits.maxPassagesPerDoc,
    },
    searchTermsBySource: {
      arxiv: [args.question],
      gov: [args.question],
      news: [args.question],
      web: [args.question],
      wikipedia: [args.question],
    },
    subQuestions: [args.question],
  }));

  const limits = normalizeLimits(args.config, output.limits.maxDocs, output.limits.maxPassagesPerDoc);

  await appendEvent(args.convex, {
    jobId: args.jobId,
    level: "info",
    message: stageMessage("plan", "completed"),
    payload: {
      limits,
      searchTermsBySource: output.searchTermsBySource,
      subQuestionCount: output.subQuestions.length,
    },
    runId: args.runId,
    stage: "plan",
    threadId: args.threadId,
  });

  return { limits, searchTermsBySource: output.searchTermsBySource, subQuestions: output.subQuestions };
}

async function gatherForSource(args: {
  maxDocs: number;
  searchTerms: string[];
  source: SourceType;
}): Promise<GatheredDocument[]> {
  if (args.source === "wikipedia") {
    return gatherWikipediaDocuments({ maxDocs: args.maxDocs, searchTerms: args.searchTerms });
  }
  if (args.source === "arxiv") {
    return gatherArxivDocuments({ maxDocs: args.maxDocs, searchTerms: args.searchTerms });
  }
  return [];
}

async function runGatherStage(args: {
  convex: ConvexHttpClient;
  jobId: JobId;
  limits: { maxDocs: number; maxPassagesPerDoc: number };
  runId?: string;
  searchTermsBySource: Record<SourceType, string[]>;
  sourcesEnabled: SourceType[];
  threadId?: string;
}) {
  await setRunningStage(args.convex, args.jobId, "gather");
  await appendEvent(args.convex, {
    jobId: args.jobId,
    level: "info",
    message: stageMessage("gather", "starting"),
    runId: args.runId,
    stage: "gather",
    threadId: args.threadId,
  });

  let storedCount = 0;
  for (const source of args.sourcesEnabled) {
    const docs = await gatherForSource({
      maxDocs: args.limits.maxDocs,
      searchTerms: args.searchTermsBySource[source] ?? [],
      source,
    });

    if (docs.length === 0) {
      await appendEvent(args.convex, {
        jobId: args.jobId,
        level: source === "wikipedia" || source === "arxiv" ? "warn" : "info",
        message:
          source === "wikipedia" || source === "arxiv"
            ? stageMessage("gather", `no documents found for ${source}`)
            : stageMessage("gather", `source not yet implemented: ${source}`),
        runId: args.runId,
        stage: "gather",
        threadId: args.threadId,
      });
      continue;
    }

    for (const doc of docs) {
      await args.convex.mutation(api.artifacts.upsertDocument, {
        jobId: args.jobId,
        metadata: doc.metadata,
        sourceType: doc.sourceType,
        text: doc.text,
        title: doc.title,
        url: doc.url,
      });
      storedCount += 1;
    }

    await appendEvent(args.convex, {
      jobId: args.jobId,
      level: "info",
      message: stageMessage("gather", `stored ${docs.length} docs from ${source}`),
      runId: args.runId,
      stage: "gather",
      threadId: args.threadId,
    });
  }

  await appendEvent(args.convex, {
    jobId: args.jobId,
    level: "info",
    message: stageMessage("gather", "completed"),
    payload: { documentCount: storedCount },
    runId: args.runId,
    stage: "gather",
    threadId: args.threadId,
  });
}

async function runExtractStage(args: {
  config: ResearchRunConfig;
  convex: ConvexHttpClient;
  jobId: JobId;
  limits: { maxDocs: number; maxPassagesPerDoc: number };
  question: string;
  runId?: string;
  threadId?: string;
}) {
  await setRunningStage(args.convex, args.jobId, "extract");
  await appendEvent(args.convex, {
    jobId: args.jobId,
    level: "info",
    message: stageMessage("extract", "starting"),
    runId: args.runId,
    stage: "extract",
    threadId: args.threadId,
  });

  const docs = (await args.convex.query(api.artifacts.listDocumentsByJob, {
    jobId: args.jobId,
  })) as DocumentRow[];

  const selectedDocs = docs.slice(0, args.limits.maxDocs);
  let passagesCreated = 0;
  let claimsCreated = 0;

  for (const doc of selectedDocs) {
    const extraction = await generateStructured({
      config: args.config,
      prompt: `Question: ${args.question}
Document title: ${doc.title ?? "Untitled"}
Document URL: ${doc.url}
Document text:
${doc.text.slice(0, 9000)}

Extract high-signal passages and concise claims relevant to the question.`,
      schema: ExtractOutputSchema,
      system:
        "You extract evidence for research synthesis. Keep quotes verbatim. Keep claims factual and specific.",
    }).catch(() => ({
      claims: [],
      passages: [],
    }));

    const modelPassages = extraction.passages.slice(0, args.limits.maxPassagesPerDoc);
    const passages =
      modelPassages.length > 0
        ? modelPassages
        : splitIntoCandidatePassages(doc.text, args.limits.maxPassagesPerDoc).map((text) => ({
            locatorKind: "unknown" as const,
            locatorValue: "fallback",
            relevanceScore: 0.35,
            text,
          }));
    if (passages.length > 0) {
      await args.convex.mutation(api.artifacts.createPassages, {
        documentId: doc._id,
        jobId: args.jobId,
        passages: passages.map((p) => ({
          locator: { kind: p.locatorKind, value: p.locatorValue },
          relevanceScore: p.relevanceScore,
          text: p.text,
        })),
      });
      passagesCreated += passages.length;
    }

    const modelClaims = extraction.claims.slice(0, args.config.limits.maxClaims ?? 8);
    const claims =
      modelClaims.length > 0
        ? modelClaims
        : passages.length > 0
          ? [deriveFallbackClaim({ docTitle: doc.title, passage: passages[0].text })]
          : [];
    for (const claim of claims) {
      await args.convex.mutation(api.artifacts.upsertClaim, {
        claim,
        jobId: args.jobId,
        status: "unknown",
      });
      claimsCreated += 1;
    }
  }

  if (claimsCreated === 0 && selectedDocs.length > 0) {
    const fallbackDoc = selectedDocs[0];
    const fallbackPassage = splitIntoCandidatePassages(fallbackDoc.text, 1)[0];
    if (fallbackPassage) {
      await args.convex.mutation(api.artifacts.upsertClaim, {
        claim: deriveFallbackClaim({ docTitle: fallbackDoc.title, passage: fallbackPassage }),
        jobId: args.jobId,
        status: "unknown",
      });
      claimsCreated = 1;
      await appendEvent(args.convex, {
        jobId: args.jobId,
        level: "warn",
        message: stageMessage("extract", "model returned no claims; injected fallback claim"),
        runId: args.runId,
        stage: "extract",
        threadId: args.threadId,
      });
    }
  }

  await appendEvent(args.convex, {
    jobId: args.jobId,
    level: "info",
    message: stageMessage("extract", "completed"),
    payload: { claimsCreated, passagesCreated },
    runId: args.runId,
    stage: "extract",
    threadId: args.threadId,
  });
}

async function runCritiqueStage(args: {
  config: ResearchRunConfig;
  convex: ConvexHttpClient;
  jobId: JobId;
  runId?: string;
  threadId?: string;
}) {
  await setRunningStage(args.convex, args.jobId, "critique");
  const claims = (await args.convex.query(api.artifacts.listClaimsByJob, {
    jobId: args.jobId,
  })) as ClaimRow[];

  if (claims.length === 0) {
    await appendEvent(args.convex, {
      jobId: args.jobId,
      level: "warn",
      message: stageMessage("critique", "skipped because no claims were extracted"),
      runId: args.runId,
      stage: "critique",
      threadId: args.threadId,
    });
    return;
  }

  const critique = await generateStructured({
    config: args.config,
    prompt: `Claims:
${claims.map((c) => `- ${c._id}: ${c.claim}`).join("\n")}

Label each claim as supported, contested, or unknown.
Unknown is preferred unless evidence is clearly strong.`,
    schema: CritiqueOutputSchema,
    system: "You are a strict research critic. Be conservative and avoid overconfidence.",
  }).catch(() => ({ updates: [] }));

  const claimsById = new Map(claims.map((claim) => [claim._id, claim]));
  let updated = 0;
  for (const update of critique.updates) {
    const existing = claimsById.get(update.claimId as Id<"claims">);
    if (!existing) {
      continue;
    }
    await args.convex.mutation(api.artifacts.upsertClaim, {
      claim: existing.claim,
      claimId: existing._id,
      jobId: args.jobId,
      notes: update.notes,
      status: update.status,
    });
    updated += 1;
  }

  await appendEvent(args.convex, {
    jobId: args.jobId,
    level: "info",
    message: stageMessage("critique", "completed"),
    payload: { updatedClaims: updated },
    runId: args.runId,
    stage: "critique",
    threadId: args.threadId,
  });
}

async function runCrossValidateStage(args: {
  config: ResearchRunConfig;
  convex: ConvexHttpClient;
  jobId: JobId;
  question: string;
  runId?: string;
  threadId?: string;
}) {
  await setRunningStage(args.convex, args.jobId, "cross_validate");
  const claims = (await args.convex.query(api.artifacts.listClaimsByJob, {
    jobId: args.jobId,
  })) as ClaimRow[];
  const docs = (await args.convex.query(api.artifacts.listDocumentsByJob, {
    jobId: args.jobId,
  })) as DocumentRow[];

  if (claims.length === 0 || docs.length === 0) {
    await appendEvent(args.convex, {
      jobId: args.jobId,
      level: "warn",
      message: stageMessage("cross_validate", "skipped because claims or documents were missing"),
      runId: args.runId,
      stage: "cross_validate",
      threadId: args.threadId,
    });
    return;
  }

  const docsForPrompt = docs.slice(0, 8).map((d) => ({
    title: d.title,
    url: d.url,
    excerpt: d.text.slice(0, 600),
  }));

  const crossValidation = await generateStructured({
    config: args.config,
    prompt: `Question: ${args.question}
Claims:
${claims.map((c) => `- ${c._id}: ${c.claim}`).join("\n")}

Candidate documents (use these exact URLs only):
${docsForPrompt.map((d) => `- ${d.url}\n  title=${d.title ?? "Untitled"}\n  excerpt=${d.excerpt}`).join("\n")}

Return citation candidates with verbatim quotes and claim IDs.`,
    schema: CrossValidateOutputSchema,
    system:
      "You are a cross-validator. Only produce citations that can be traced to provided docs. Never invent URLs.",
  }).catch(() => ({ citations: [] }));

  const docsByUrl = new Map(docs.map((doc) => [doc.url, doc]));
  const claimsById = new Map(claims.map((claim) => [claim._id, claim]));

  let created = 0;
  for (const citation of crossValidation.citations) {
    const claimId = citation.claimId as Id<"claims">;
    const claim = claimsById.get(claimId);
    const doc = docsByUrl.get(citation.url);
    if (!claim || !doc) {
      continue;
    }
    if (!citation.quote.trim()) {
      continue;
    }
    await args.convex.mutation(api.artifacts.createCitation, {
      claimId: claim._id,
      documentId: doc._id,
      jobId: args.jobId,
      locator: { kind: citation.locatorKind, value: citation.locatorValue },
      quote: citation.quote,
      url: citation.url,
    });
    created += 1;
  }

  if (created === 0) {
    const fallbackClaim = claims[0];
    const fallbackDoc = docs[0];
    const fallbackQuote = fallbackDoc.text.slice(0, 280).trim();
    if (fallbackQuote) {
      await args.convex.mutation(api.artifacts.createCitation, {
        claimId: fallbackClaim._id,
        documentId: fallbackDoc._id,
        jobId: args.jobId,
        locator: { kind: "unknown", value: "fallback" },
        quote: fallbackQuote,
        url: fallbackDoc.url,
      });
      created = 1;
    }
  }

  await appendEvent(args.convex, {
    jobId: args.jobId,
    level: created > 0 ? "info" : "warn",
    message: stageMessage("cross_validate", "completed"),
    payload: { citationsCreated: created },
    runId: args.runId,
    stage: "cross_validate",
    threadId: args.threadId,
  });
}

export async function runWorkflowUntilSynthesis(args: {
  config: ResearchRunConfig;
  convex: ConvexHttpClient;
  jobId: JobId;
  question: string;
  runId?: string;
  threadId?: string;
}): Promise<SynthesisInput> {
  const plan = await runPlanStage(args);
  await runGatherStage({
    convex: args.convex,
    jobId: args.jobId,
    limits: plan.limits,
    runId: args.runId,
    searchTermsBySource: plan.searchTermsBySource,
    sourcesEnabled: args.config.sourcesEnabled,
    threadId: args.threadId,
  });
  await runExtractStage({
    config: args.config,
    convex: args.convex,
    jobId: args.jobId,
    limits: plan.limits,
    question: args.question,
    runId: args.runId,
    threadId: args.threadId,
  });
  await runCritiqueStage({
    config: args.config,
    convex: args.convex,
    jobId: args.jobId,
    runId: args.runId,
    threadId: args.threadId,
  });
  await runCrossValidateStage({
    config: args.config,
    convex: args.convex,
    jobId: args.jobId,
    question: args.question,
    runId: args.runId,
    threadId: args.threadId,
  });

  const claims = (await args.convex.query(api.artifacts.listClaimsByJob, {
    jobId: args.jobId,
  })) as ClaimRow[];
  const claimsWithCitations: SynthesisInput["claims"] = [];
  for (const claim of claims) {
    const citations = (await args.convex.query(api.artifacts.listCitationsByClaim, {
      claimId: claim._id,
      jobId: args.jobId,
    })) as CitationRow[];
    if (citations.length > 0) {
      claimsWithCitations.push({ ...claim, citations });
    }
  }

  if (claimsWithCitations.length === 0) {
    throw new Error("Synthesis blocked: no citations were produced by cross validation.");
  }

  return {
    claims: claimsWithCitations,
    question: args.question,
  };
}

export function buildSynthesisPrompt(input: SynthesisInput) {
  const evidence = input.claims
    .map((claim) => {
      const cits = claim.citations
        .map((citation) => {
          return `- citationId=${citation._id}
  url=${citation.url}
  locator=${citation.locator.kind}:${citation.locator.value ?? ""}
  quote=${citation.quote}`;
        })
        .join("\n");
      return `claimId=${claim._id}
claim="${claim.claim}"
status=${claim.status}
notes=${claim.notes ?? ""}
citations:
${cits}`;
    })
    .join("\n\n");

  return `Research question:
${input.question}

Evidence packet (ground truth):
${evidence}

Write a concise markdown synthesis that:
1) Answers the question directly.
2) Separates what is supported vs contested.
3) Includes explicit citation IDs in brackets, e.g. [citationId].
4) Never references sources not present in the evidence packet.
5) Adds a short "Limits & Unknowns" section.`;
}
