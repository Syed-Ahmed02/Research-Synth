---
name: Synthesizer UI (AI Elements)
overview: Define a chat-first Next.js UI using Vercel AI SDK AI Elements + shadcn/ui where new research starts in chat, stage/evidence updates appear in-chat, and synthesis streams token-by-token in real time.
todos:
  - id: ui-foundations
    content: Initialize shadcn/ui + Tailwind theme (light/dark), add AI Elements to the project, and set up a chat-first app shell.
    status: pending
  - id: ui-chat-home
    content: Implement the home route as the primary research chat interface with prompt input controls for depth/sources/model and immediate run creation.
    status: pending
  - id: ui-streaming-timeline
    content: Render a unified timeline that merges token stream output from `/api/chat` with Convex stage/events/artifact updates.
    status: pending
  - id: ui-citations-inline
    content: Surface citations and evidence inline in the chat stream with affordances to open detailed report views when needed.
    status: pending
  - id: ui-thread-history
    content: Implement chat thread/run history and restore behavior so prior research runs hydrate correctly after refresh.
    status: pending
  - id: ui-polish
    content: Add loading/empty/error states, streaming placeholders, responsive layout, and export actions (copy Markdown/JSON).
    status: pending
isProject: false
---

# Research Synthesizer UI Plan (Chat-First + AI Elements)

## Goal

Build a clean, production-quality UI for the research synthesizer that:

- Starts new research directly from a chat input
- Streams assistant synthesis token-by-token in real time
- Displays live stage/events/artifacts as chat-native timeline entries
- Keeps report/history as secondary drill-downs from chat

## UI foundations

- **UI kit**: shadcn/ui (base ui primitives + Tailwind)
- **AI UI**: Vercel AI SDK **AI Elements** (built on shadcn/ui)
  - Install via `npx ai-elements@latest` (or add the registry via shadcn)
- **Styling baseline**:
  - Tailwind + CSS variables theme (light/dark)
  - App typography for long-form report rendering
  - Consistent spacing, skeleton/loading states, empty states

## Key routes and screens (App Router)

- **Chat home (primary)**: `[app/page.tsx](app/page.tsx)`
  - Message list with user prompts, assistant streaming output, and stage/event cards
  - Prompt input controls for question, depth, source toggles, and model
- **Chat API stream**: `[app/api/chat/route.ts](app/api/chat/route.ts)`
  - Token stream transport for assistant response
  - Emits run identifiers so Convex subscriptions can attach durable updates
- **Report (secondary)**: `[app/jobs/[jobId]/report/page.tsx](app/jobs/[jobId]/report/page.tsx)` (optional drill-down)
- **History (secondary)**: `[app/history/page.tsx](app/history/page.tsx)` for thread/run discovery

## Shared components (suggested)

- `[components/layout/AppShell.tsx](components/layout/AppShell.tsx)`: app frame, nav, theme toggle
- `[components/jobs/JobStatusPill.tsx](components/jobs/JobStatusPill.tsx)`: status + stage
- `[components/jobs/JobProgressFeed.tsx](components/jobs/JobProgressFeed.tsx)`: renders `jobEvents`
- `[components/report/ReportRenderer.tsx](components/report/ReportRenderer.tsx)`: markdown + linkable citations
- `[components/report/CitationsDrawer.tsx](components/report/CitationsDrawer.tsx)`: evidence viewer
- `[components/common/EmptyState.tsx](components/common/EmptyState.tsx)`, `[components/common/Skeletons.tsx](components/common/Skeletons.tsx)`

## Real-time data flow (Chat stream + Convex → UI)

- **Stream source**:
  - `/api/chat` token stream for immediate assistant output
- **Durable source (subscriptions)**:
  - job metadata: status/currentStage
  - `jobEvents` ordered by timestamp
  - artifacts lists (docs/passages/claims/report)
- **Write path**:
  - chat request creates/updates run in Convex
  - workflow stages append events/artifacts while response keeps streaming

## AI Elements usage (where it fits)

AI Elements are the primary interaction layer:

- **Chat timeline**: user + assistant + tool/event/status entries in one flow
- **Response actions**: copy excerpt, open source, jump to claim, export report
- **Code/markdown blocks**: consistent styling for report sections and quoted evidence

## UX requirements

- **Progress clarity**: stage timeline appears in chat (plan → gather → extract → critique → xval → synthesize)
- **Trust**: every claim in report links to stored citations; show quote + locator + source
- **Interruptibility**: stop/cancel run from chat; resume/re-run with tweaks
- **Speed**: immediate token stream + incremental artifact reveal

## Non-goals (for MVP)

- User accounts/teams
- Payments
- Complex editor for report rewriting

## Test plan (manual)

- Send a new research prompt and verify token-by-token assistant streaming starts immediately.
- Confirm stage and artifact updates appear as in-chat entries without refresh.
- Refresh and confirm the chat thread/runs hydrate from Convex correctly.
- Verify citation links and report drill-downs resolve to stored evidence.

