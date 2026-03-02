---
name: Convex Schema (Deep)
overview: Design a detailed Convex schema for research jobs, events, documents, passages, claims, citations, and reports—including indexes, constraints, types, and lifecycle patterns that support durable multi-stage agent workflows and strict citation guardrails.
todos:
  - id: schema-define-tables
    content: Define all MVP tables in `convex/schema.ts` (jobs, events, documents, passages, claims, citations, reports) with clear field types and stage/config enums.
    status: pending
  - id: schema-indexes
    content: Add indexes optimized for UI reads (history, event feed, artifacts by job) and stage-specific filtering.
    status: pending
  - id: schema-guardrails
    content: Implement application-layer checks for citation guardrails and document dedupe (jobId+url, non-empty quotes, etc.).
    status: pending
  - id: schema-query-surface
    content: Implement Convex queries/mutations for job list, job detail, events feed, artifacts lists, and report retrieval using the new indexes.
    status: pending
  - id: schema-size-retention
    content: Add initial size limits/truncation rules for document text and event payloads; outline optional retention/cleanup helpers for later.
    status: pending
isProject: false
---

# Convex Schema Plan (Deep Dive)

## Goal

Define a durable, query-friendly Convex schema that supports:

- Long-running, multi-stage research jobs
- Real-time progress/event streaming to the UI
- Artifact persistence (documents → passages → claims → citations → report)
- Strict citation guardrails (no report claim without stored evidence)

## Files to implement

- `[convex/schema.ts](convex/schema.ts)`: all table definitions + indexes
- `[convex/jobs.ts](convex/jobs.ts)`: queries/mutations around jobs + events (thin wrappers over schema)
- `[convex/artifacts.ts](convex/artifacts.ts)`: queries/mutations around documents/passages/claims/citations/reports (optional but keeps code organized)

## Core entities and relationships

### `researchJobs`

**Purpose**: durable job root and execution state.

- **Fields** (suggested):
  - `question: string`
  - `status: "queued" | "running" | "succeeded" | "failed" | "cancelled"`
  - `currentStage: StageName` (see below)
  - `config`: `{ depthPreset, sourcesEnabled, model, limits }`
  - `error?: { stage, message, code? }`
  - `createdAt, startedAt?, finishedAt?`: numbers (ms)
  - `ownerId?`: string (optional for future auth)
- **Indexes**:
  - by `status`
  - by `createdAt` (for history)
  - by `ownerId + createdAt` (if multi-user)
- **Notes**:
  - keep config minimal but explicit; avoid free-form JSON blobs that you can’t query.

### `jobEvents`

**Purpose**: append-only timeline for realtime UI.

- **Fields**:
  - `jobId: Id<"researchJobs">`
  - `ts: number`
  - `stage: StageName`
  - `level: "debug" | "info" | "warn" | "error"`
  - `message: string`
  - `payload?`: small JSON (avoid huge blobs; store big artifacts in dedicated tables)
- **Indexes**:
  - by `jobId + ts` (primary feed)
  - by `jobId + stage + ts` (stage filter)
- **Retention**:
  - optional pruning policy later; MVP can keep all events.

### `documents`

**Purpose**: normalized fetched sources.

- **Fields**:
  - `jobId: Id<"researchJobs">`
  - `sourceType: "wikipedia" | "arxiv" | "news" | "gov" | "web"`
  - `url: string`
  - `title?: string`
  - `fetchedAt: number`
  - `text: string` (raw extracted text; consider size limits)
  - `metadata`: `{ authors?, publishedAt?, doi?, arxivId?, wikiPageId?, language?, ... }`
  - `contentHash?`: string (dedupe)
- **Indexes**:
  - by `jobId + sourceType`
  - by `jobId + url`
  - optional by `contentHash`
- **Guardrails**:
  - ensure `url` is always present for citation linking.

### `passages`

**Purpose**: smaller evidence chunks derived from documents.

- **Fields**:
  - `jobId: Id<"researchJobs">`
  - `documentId: Id<"documents">`
  - `text: string`
  - `locator`: `{ kind: "section" | "offset" | "page" | "unknown", value?: string }`
  - `relevanceScore?: number`
  - `createdAt: number`
- **Indexes**:
  - by `jobId + documentId`
  - by `jobId + relevanceScore` (optional ranking view)
- **Notes**:
  - keep passage text small enough to display quickly and quote safely.

### `claims`

**Purpose**: canonical list of extracted claims to be supported/contested.

- **Fields**:
  - `jobId: Id<"researchJobs">`
  - `claim: string`
  - `status: "supported" | "contested" | "unknown"`
  - `notes?`: string (critic notes)
  - `createdAt: number`
- **Indexes**:
  - by `jobId + status`
  - by `jobId + createdAt`

### `citations`

**Purpose**: evidence edges connecting claims to documents (+ exact quote).

- **Fields**:
  - `jobId: Id<"researchJobs">`
  - `claimId: Id<"claims">`
  - `documentId: Id<"documents">`
  - `url: string` (duplicate for convenience; should match `documents.url`)
  - `quote: string` (verbatim excerpt)
  - `locator`: same shape as passages
  - `createdAt: number`
- **Indexes**:
  - by `jobId + claimId`
  - by `jobId + documentId`
- **Critical guardrails**:
  - synthesis step must only cite **existing** `citations` rows.
  - require `quote` to be non-empty and a substring (or near-substring) of the parent document/passages (enforce later).

### `reports`

**Purpose**: final output + structured form.

- **Fields**:
  - `jobId: Id<"researchJobs">`
  - `reportMd: string`
  - `reportJson`: structured representation (sections + claim refs + citation refs)
  - `createdAt: number`
- **Indexes**:
  - by `jobId`
- **Notes**:
  - prefer `reportJson` that references `claimId` and `citationId` rather than raw URLs.

## Shared types

- `**StageName`** enum/union used across schema + events:
  - `"plan" | "gather" | "extract" | "critique" | "cross_validate" | "synthesize"`
- **Config types** to keep UI and backend consistent:
  - depth preset (`fast|standard|deep`)
  - limits (maxDocs, maxPassagesPerDoc, etc.)
  - selected model id

## Query patterns to support UI

- **History**: list jobs ordered by createdAt (optionally filtered by owner)
- **Run page**:
  - job header (status/currentStage)
  - event feed (jobId + ts)
  - docs list (jobId)
  - claims list (jobId, optionally by status)
- **Report page**:
  - report by jobId
  - citations by claimId (for evidence drawer)

## Data lifecycle rules

- **Append-only where possible**:
  - events always append
  - documents append per gather
  - passages append per extract
  - claims append per extract; critic/xval can update status/notes
- **Idempotency**:
  - enforce `jobId+url` uniqueness at the application layer (Convex doesn’t do unique constraints); use `contentHash` or check-before-insert.
- **Cleanup** (future): optional delete job cascade helpers; MVP can skip.

## Validation and size considerations

- Convex doc size limits mean:
  - keep `documents.text` bounded (truncate or store only relevant sections)
  - avoid huge `payload` in events; store artifacts in dedicated tables
- Keep `quote` and `passage.text` small (e.g., <= ~1–2k chars) for fast UI rendering.

## Migration strategy

- Start with MVP tables above.
- When adding new sources or fields, prefer additive changes.
- Write a one-off migration script only if you need backfill; otherwise handle missing fields defensively.

## Test plan (schema + queries)

- Create job → insert events → query feed ordered by `ts`
- Insert docs/passages/claims/citations; verify indexes support fast per-job reads
- Confirm report can reference citations deterministically

