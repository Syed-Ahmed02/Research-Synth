---
name: Minimal Nextjs + Convex Synthesizer
overview: "Minimal-stack chat-first research synthesizer: Next.js chat route + Vercel AI SDK streaming for primary UX, with Convex as durable realtime storage for runs, stage events, artifacts, and cited outputs."
todos:
  - id: scaffold-nextjs-convex
    content: Create Next.js app (App Router) + Convex project with schema for jobs/events/documents/passages/claims/citations/reports.
    status: pending
  - id: openrouter-via-ai-sdk
    content: Add Vercel AI SDK client configured for OpenRouter; implement model registry + structured outputs via Zod.
    status: pending
  - id: connectors-wiki-arxiv
    content: Implement Wikipedia and arXiv fetchers; normalize/store documents and emit progress events.
    status: pending
  - id: workflow-stages
    content: Implement planner → gather → extract → critique → cross_validate → synthesize pipeline with Next.js chat-primary orchestration and durable Convex persistence.
    status: pending
  - id: ui-chat-first
    content: Build a chat-first home UI with token streaming and in-chat stage/artifact updates; keep report/history as secondary views.
    status: pending
  - id: critique-crossvalidate
    content: Add critic + cross-validator stages; store claims + evidence map and enforce citation guardrails.
    status: pending
isProject: false
---

## Tech stack (minimal)

- **App**: Next.js (App Router) deployed to Vercel.
- **LLM/agents**: Vercel AI SDK (`ai`) calling **OpenRouter** (OpenAI-compatible).
- **Orchestration**: chat-primary step workflow in TypeScript.
- **Database + realtime**: **Convex** (tables + actions + queries + subscriptions).

## Core idea

- A **Research Run** starts from a chat message and is durably recorded in Convex.
- A run progresses through deterministic **stages** (plan → gather → extract → critique → cross_validate → synthesize).
- Each stage writes **events** (for live chat progress) and **artifacts** (documents, passages, claims, report).
- The final report is generated only from stored artifacts, ensuring **no invented citations**.

```mermaid
flowchart TD
  user[User] --> web[Nextjs_Chat_UI]
  web --> api[Nextjs_API_chat]
  api --> plan[Planner_Step]
  plan --> gather[Gather_Steps]
  gather --> extract[Extraction_Step]
  extract --> critique[Critic_Step]
  critique --> xval[CrossValidate_Step]
  xval --> synth[Synthesizer_Step]
  synth --> stream[Token_Stream]
  api --> db[(Convex_DB)]
  web <-->|subscriptions| db
  api --> llm[OpenRouter_via_Vercel_AI_SDK]
  api --> sources[Public_APIs(arXiv/Wikipedia/News/Gov)]
```



## Convex data model (MVP)

- `researchJobs`: question, config (sources/models/depth), status, currentStage, createdAt, startedAt, finishedAt
- `jobEvents`: jobId, ts, stage, level, message, payload
- `documents`: jobId, sourceType, url, title, fetchedAt, text, metadata
- `passages`: jobId, documentId, text, locator (section/page/offset), relevanceScore
- `claims`: jobId, claim, status (supported/contested/unknown), notes
- `citations`: jobId, claimId, documentId, url, quote, locator
- `reports`: jobId, reportMd, reportJson

## MVP sources (keep it small)

- **Wikipedia**: MediaWiki API (summary + page content/sections)
- **arXiv**: arXiv API (metadata + abstracts; add PDF parsing later)
- goo

(You can add **news** and **gov datasets** after MVP. They add complexity around quotas, noisy results, and paywalls.)

## Agent/workflow steps (implemented as TS functions)

- **Planner**: converts question → sub-questions + search terms + which sources to use.
- **Gather** (per source): fetch top N docs, store `documents`, emit events.
- **Extractor**: selects relevant passages from each doc and stores `passages`.
- **Critic**: flags weak/unsupported claims and missing counterarguments.
- **Cross-validator**: attempts to corroborate/contradict top claims using *different* documents.
- **Synthesizer**: produces final report with inline citations.

## Citation guardrails (important)

- The synthesizer is only allowed to cite **document IDs** that exist in Convex.
- For each citation, require a **verbatim quote/snippet** stored in `citations.quote`.
- If a claim cannot be cited, it must be labeled **unknown** or removed.

## UI surfaces (MVP)

- **Chat home (primary)**: prompt + token stream + in-chat stage/artifact cards
- **Report (secondary)**: rendered Markdown + evidence drawer showing quotes and source links
- **History (secondary)**: list of chat threads/runs

## Suggested repo layout (single app)

- `[app](app)`: Next.js routes and pages
- `[app/api/chat](app/api/chat)`: primary stream + orchestration route
- `[convex/schema.ts](convex/schema.ts)`: tables
- `[convex/jobs.ts](convex/jobs.ts)`: mutations/queries for runs and events
- `[lib/ai](lib/ai)`: Vercel AI SDK client + model registry (OpenRouter)
- `[lib/sources](lib/sources)`: arXiv + Wikipedia connectors
- `[lib/workflow](lib/workflow)`: step functions and Zod schemas for structured outputs

## Operational suggestions (still minimal)

- **Long-running runs**: keep each stage bounded; persist outputs continuously; if runtime limits bite, split into Convex scheduled stage jobs while keeping `/api/chat` as the UX entrypoint.
- **Model outputs**: use structured output (Zod) for `plan`, `claims`, and `citations` to reduce flakiness.
- **Cost control**: cap docs/passages; add a “fast/standard/deep” preset.

## Milestones

1. End-to-end MVP: chat prompt -> token streaming -> cited report backed by Convex artifacts.
2. Add critic + cross-validation + claim statuses.
3. Add news + gov dataset connectors + dedup/rate-limiting.
4. Add exports (Markdown/JSON; PDF later).

