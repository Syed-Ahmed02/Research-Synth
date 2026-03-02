---
name: Architecture + Agents
overview: "Define the end-to-end architecture and multi-stage agent workflow: Next.js entrypoints, Convex actions/queries, durable stage state, structured LLM outputs via Vercel AI SDK/OpenRouter, and the responsibilities/contracts of each agent step (planner/gather/extract/critic/xval/synthesize)."
todos:
  - id: arch-entrypoints
    content: Define the Next.js entrypoints for creating and starting jobs (UI → Convex mutation, then route handler → Convex action), and document the request/response shape.
    status: pending
  - id: arch-workflow-runner
    content: Design the Convex action workflow runner (single-action MVP) with a clear stage state machine, durable writes, and event emission at consistent checkpoints.
    status: pending
  - id: arch-stage-contracts
    content: Define Zod schemas and TypeScript contracts for each stage’s structured inputs/outputs (plan/gather/extract/critique/xval/synthesize).
    status: pending
  - id: arch-citation-guardrails
    content: Specify enforcement points for citation guardrails (ID-only references, fail-closed synthesis) and how the UI evidence drawer maps to citations.
    status: pending
  - id: arch-scalability-timeouts
    content: "Add a fallback architecture for timeouts: stage-level actions chained via Convex scheduling, plus retry/cancel/resume semantics."
    status: pending
isProject: false
---

# Overall Architecture + Agents Plan

## Goal

Document and implement the overall system architecture for a minimal-stack research synthesizer:

- Next.js UI to create and view research jobs
- Convex as the only database + realtime layer
- A durable multi-stage workflow runner (agents/steps)
- Vercel AI SDK calling OpenRouter for models
- End-to-end citation guardrails (no invented sources)

## System overview (data + control flow)

```mermaid
flowchart TD
  user[User] --> ui[Nextjs_UI]
  ui --> createJob[Convex_Mutation_createJob]
  ui --> startJob[Nextjs_RouteHandler_startJob]
  startJob --> runAction[Convex_Action_runResearchJob]

  runAction --> stagePlan[Stage_plan]
  stagePlan --> stageGather[Stage_gather]
  stageGather --> stageExtract[Stage_extract]
  stageExtract --> stageCritique[Stage_critique]
  stageCritique --> stageXval[Stage_cross_validate]
  stageXval --> stageSynth[Stage_synthesize]

  runAction --> db[(Convex_DB)]
  ui <-->|subscriptions| db

  runAction --> llm[OpenRouter_via_Vercel_AI_SDK]
  stageGather --> extApis[Public_APIs]
```



## Main components and responsibilities

### Next.js app

- **UI pages** subscribe to Convex for live updates and read-only artifact viewing.
- **Route handlers** (server-side) are used only when needed for:
  - starting a job securely
  - hiding provider keys (OpenRouter)
  - returning immediate acknowledgements for long jobs
- Suggested entrypoints:
  - `[app/api/research/start/route.ts](app/api/research/start/route.ts)` start/run a job
  - UI pages: `[app/jobs/[jobId]/page.tsx](app/jobs/[jobId]/page.tsx)` and report/history

### Convex

- **Tables** store jobs, events, and artifacts.
- **Queries** power UI subscriptions.
- **Mutations** create jobs, append events, persist artifacts.
- **Actions** run the workflow because they can call external APIs + LLM.

### LLM access layer (Vercel AI SDK + OpenRouter)

- Single wrapper module provides:
  - model registry (e.g. fast/standard/deep)
  - structured output schemas (Zod) for each stage
  - consistent retry/timeouts and logging
- Suggested module:
  - `[lib/ai](lib/ai)` (model config + helpers)

## Workflow design (durable stages)

### Stages (state machine)

Use a small explicit state machine with a fixed stage order:

- `plan` → `gather` → `extract` → `critique` → `cross_validate` → `synthesize`

Each stage:

- **Reads**: prior artifacts from Convex
- **Writes**:
  - new artifacts (documents/passages/claims/citations/report)
  - `jobEvents` for progress
  - job state updates (`currentStage`, `status`, timestamps)

### Execution model

- **MVP**: one Convex action `runResearchJob(jobId)` that runs stages sequentially.
- **Scale-up** (if time limits appear): split into stage actions and chain them via Convex scheduling:
  - `runStage(jobId, stage)`
  - schedule next stage on completion

### Idempotency and re-runs

- Reruns should not duplicate artifacts unnecessarily:
  - document upserts by `jobId+url` (app-layer uniqueness)
  - passages/claims/citations can be regenerated per rerun with a `runId` or by clearing stage-specific artifacts (later)
- Define behavior for:
  - **cancel**: stop scheduling next stages; mark job cancelled
  - **resume**: re-enter at currentStage
  - **retry**: rerun failed stage with backoff

## Agent/step contracts (inputs/outputs)

### Planner

- **Input**: job question + config.
- **Output (structured)**:
  - sub-questions
  - search terms per source
  - per-stage limits (maxDocs, maxPassages)
- **Writes**:
  - events (`planned N queries`)
  - optional `plan` artifact (can be embedded in job config or a dedicated table later)

### Gather (per source)

- **Input**: plan search terms + source config.
- **Output**: normalized `documents`.
- **Writes**:
  - documents rows
  - events for each fetch

### Extract

- **Input**: documents.
- **Output (structured)**:
  - passages (docId + quote + locator + relevance)
  - initial claims list
- **Writes**:
  - passages rows
  - claims rows

### Critique

- **Input**: claims + passages.
- **Output (structured)**:
  - claim status updates (supported/contested/unknown)
  - missing counterarguments and questions to validate
- **Writes**:
  - claim status/notes updates
  - events

### Cross-validate

- **Input**: top claims + critic questions.
- **Output**:
  - additional documents/passages
  - citations linking claims to evidence
  - contested flags if contradictory sources found
- **Writes**:
  - citations rows (must include verbatim `quote` + locator)
  - optional new documents/passages

### Synthesizer

- **Input**: claims + citations + supporting passages.
- **Output**:
  - `reportMd`
  - `reportJson` referencing claimIds and citationIds
- **Hard constraint**:
  - synthesizer can only cite existing `citations` rows (no raw URL invention)

## Citation guardrails (architecture-level)

- Enforce guardrails at the workflow boundary:
  - stage outputs must reference Convex IDs (docId/claimId/citationId)
  - synthesis step must fail closed if citations are missing
- UI should display evidence first-class:
  - every citation → quote + locator + source URL

## Observability and debuggability

- `jobEvents` is the single source for progress.
- Ensure consistent event shapes per stage:
  - stage start/finish
  - counts (docs/passages/claims/citations)
  - warnings (rate limits, partial failures)

## Suggested code layout

- Next.js:
  - `[app](app)` routes/pages
  - `[components](components)` UI components
- Convex:
  - `[convex/schema.ts](convex/schema.ts)`
  - `[convex/runResearch.ts](convex/runResearch.ts)` main action
  - `[convex/jobs.ts](convex/jobs.ts)` job/event queries/mutations
- Workflow:
  - `[lib/workflow](lib/workflow)` stage functions + Zod schemas
  - `[lib/sources](lib/sources)` connectors (wikipedia/arxiv)
  - `[lib/ai](lib/ai)` model registry + structured generation helpers

## Test plan (manual, end-to-end)

- Start a job and watch stages advance in order.
- Confirm documents/passages/claims/citations are persisted and queryable.
- Confirm report cites only stored citations; remove citations and ensure synth fails closed.
- Confirm rerun behavior doesn’t create runaway duplicates.

