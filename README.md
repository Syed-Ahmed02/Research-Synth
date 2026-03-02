# Research Synthesizer

A **chat-first** research app that turns your questions into synthesized answers with real citations. You ask in natural language; the app plans, gathers sources, extracts claims, and streams a structured report—all in one conversation, with durable state and no invented sources.

---

## The Big Idea

- **One unified chat**: Prompts, live status, streaming synthesis, and the final report all live in a single timeline. No separate “run” screens—you stay in the conversation.
- **Multi-stage agents**: Under the hood, a fixed pipeline of stages (plan → gather → extract → critique → cross-validate → synthesize) runs so that answers are grounded in retrieved evidence and citations are traceable.
- **Durable + real-time**: Convex holds sessions, messages, jobs, and artifacts. The UI subscribes for instant updates while the chat API streams tokens and writes through to Convex so reloads and reconnects stay correct.
- **Citation guardrails**: Synthesis is constrained to the evidence packet; the UI surfaces sources and report together so you can see where each claim comes from.

**Note:** We wanted to add a **Chroma vector store** for semantic search over an existing database of documents (so retrieval could run against pre-indexed content as well as live search), but didn’t get enough time to fully integrate it. The codebase has Convex schema and wiring for passages/embeddings and a Chroma provider in `lib/vector/providers/chroma.ts`; that path can be picked up later.

---

## User-Facing Agents & Flow

The system behaves like a single “research agent” in the chat, but that agent is implemented as a **multi-stage workflow**:

| Stage | Role |
|-------|------|
| **Plan** | Turns your question into sub-questions and search terms per source (e.g. arXiv, web). |
| **Gather** | Fetches documents from enabled sources (Wikipedia, arXiv, news, .gov, web) up to configured limits. |
| **Extract** | Pulls passages and builds an initial set of claims with locators. |
| **Critique** | Reviews claims for consistency and quality. |
| **Cross-validate** | Checks claims against evidence. |
| **Synthesize** | Produces the final markdown report (Executive Summary, Resources, Limits & Unknowns) and streams it token-by-token. |

Before running the pipeline, a **clarification** step can ask follow-up questions if the initial prompt is too vague, so the first thing you see in chat might be short follow-ups instead of an immediate search.

- **Where it’s wired**: Chat entrypoint is `app/api/chat/route.ts`; it uses `lib/ai/clarify.ts` for clarification and (when used) the workflow in `lib/workflow/runner.ts` for the stage sequence. Config (depth, model, sources, limits) is sent with each request from the client.

---

## Panels & Layout

- **App shell** (`components/app-shell.tsx`): Wraps the app with `ChatSessionProvider` and a **sessions sidebar**. The sidebar is a collapsible panel listing recent chat sessions (by thread); you can open a session or start a new chat. The main content area is the research chat.
- **Research chat** (`components/research-chat.tsx`): The main content is a vertical stack:
  - **Header**: Title, short description, and export actions (Markdown, JSON).
  - **Config strip**: Depth preset, model, max docs, and source toggles (wikipedia, arxiv, news, gov, web).
  - **Conversation panel**: A scrollable timeline (AI Elements `Conversation` / `ConversationContent`) that shows:
    - A sticky **status bar** (e.g. “Planning…”, “Gathering…”, “Complete”).
    - **Timeline items**: Each item is either a **chat message** (user or assistant) or a **durable report** card. User and assistant messages use `Message` / `MessageContent`; the report uses the same message chrome plus a “Durable Report” label and a collapsible **Sources** list.
  - **Prompt input**: `PromptInput` (with textarea, submit, and optional stop) at the bottom.
- **AI Elements `Panel`** (`components/ai-elements/panel.tsx`): A generic panel primitive (from `@xyflow/react`) used for card-like containers (e.g. in flow/canvas UIs). The main “panels” you see in the app are the sidebar and the conversation area, which are built from the shell and conversation components above.

---

## Templates & Structured Output

- **Synthesis template**: The model is instructed to output markdown in a fixed shape: **Executive Summary** (including what was asked and what was done), optional **Summary**, **Resources** (ranked list with links and short notes), and **Limits & Unknowns**. This is enforced in the system prompt used when streaming synthesis in the chat route (and in the workflow’s `buildSynthesisPrompt` in `lib/workflow/runner.ts` when using the full pipeline).
- **Plan component** (`components/ai-elements/plan.tsx`): A collapsible card template for showing a plan: `Plan`, `PlanHeader`, `PlanTitle`, `PlanDescription`, `PlanContent`, `PlanFooter`, etc. It supports a streaming state (e.g. shimmer) so the UI can show the plan as it’s produced.
- **Report display**: The timeline renders the stored report as markdown (e.g. via `MessageResponse`) and, when `reportJson` is present, derives a **Resources** list and renders it with the AI Elements **Sources** component (trigger + content with `Source` items). So the same structure (summary, resources, limits) is both the output template and the basis for the inline sources panel.

---

## Data Interactions

All durable state lives in **Convex**. The UI reads via **queries** (subscriptions) and the chat API (and optional workflow) write via **mutations** (using `ConvexHttpClient` in the route).

| Layer | What it stores | How the app uses it |
|-------|----------------|---------------------|
| **Chat** (`convex/chat.ts`) | `chatSessions` (threadId, title, timestamps), `chatMessages` (sessionId, threadId, role, text, parts, runId, jobId) | New message → `appendMessage`; list by thread → `listMessagesByThread`; session create/update → `upsertSession`, `touchSession`. Thread-scoped so the conversation is per session. |
| **Jobs** (`convex/jobs.ts`) | `researchJobs` (question, threadId, status, currentStage, config, timestamps), `jobEvents` (jobId, stage, level, message, payload) | Create run → `createJob`; progress → `setJobStatus`, `appendJobEvent`; list by thread → `listJobs`. Drives the status badge and stage progress. |
| **Artifacts** (`convex/artifacts.ts`) | `documents`, `passages`, `claims`, `citations`, `reports` (all keyed by job) | Fetched/gathered docs, extracted passages, claims with citations, and the final report (markdown + JSON). Report for the current job → `getReportByJob`; used to render the “Durable Report” card and the Resources list. |

**Flow in the UI**:

1. User submits a question → body includes `config` and `threadId`; chat route ensures session exists, appends user message, and (after optional clarification) runs search + synthesis.
2. Route creates/updates job and messages in Convex and streams the assistant reply. The client already has a subscription to `listMessagesByThread` and `listJobs` (and for the current job, `getReportByJob`).
3. **Timeline**: Built by merging persisted `chatMessages` for the thread, the **live** assistant message from the stream (if any), and the **durable report** for the latest job. So you see one ordered feed of user turns, assistant turns, and the saved report.
4. Export (Markdown/JSON) uses that same timeline and config/job/report data so you can snapshot the whole thread.

---

## Tech Stack

- **Next.js** (App Router) for the chat page and `/api/chat` stream.
- **Convex** for sessions, messages, jobs, events, and artifacts (single backend).
- **Vercel AI SDK** + **OpenRouter** for LLM calls and streaming; optional **Exa** (e.g. `webSearch`) for live search in the route.
- **AI Elements** (and shadcn-style components) for the chat UI: `Conversation`, `Message`, `PromptInput`, `Sources`, `Plan`, `Panel`, etc.
- **TypeScript** and **Zod** for request validation and stage contracts (`lib/ai/contracts.ts`, `lib/ai/clarify.ts`).

---

## Getting Started

```bash
pnpm install
pnpm run dev
```

Open [http://localhost:3000](http://localhost:3000). Configure `OPENROUTER_API_KEY` and, if using search, `EXA_API_KEY`; set `NEXT_PUBLIC_CONVEX_URL` for Convex.

- **Chat**: Pick or create a session from the sidebar, set depth/sources/model, and ask a research question. The timeline will show status, your message, the streamed reply, and (when ready) the durable report with sources.
