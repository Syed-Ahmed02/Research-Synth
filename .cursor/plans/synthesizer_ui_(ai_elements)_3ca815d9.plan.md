---
name: Synthesizer UI (AI Elements)
overview: "Define the Next.js UI using Vercel AI SDK AI Elements + shadcn/ui: core pages (New/Run/Report/History), real-time progress via Convex subscriptions, and polished styling/UX for evidence-backed reports."
todos:
  - id: ui-foundations
    content: Initialize shadcn/ui + Tailwind theme (light/dark), add AI Elements to the project, and set up the shared app shell layout.
    status: pending
  - id: ui-new-research
    content: Implement New Research page form (question/depth/sources/model) that creates a job and navigates to the job run route.
    status: pending
  - id: ui-run-page
    content: Implement Run page with stage timeline + live progress feed from `jobEvents` and artifact panels (docs/passages/claims).
    status: pending
  - id: ui-report-page
    content: Implement Report page with markdown rendering and a citations/evidence drawer that links claim references to stored `citations` entries.
    status: pending
  - id: ui-history
    content: Implement History page listing prior jobs with status and navigation to run/report.
    status: pending
  - id: ui-polish
    content: Add loading/empty/error states, skeletons, responsive layout, and export actions (copy Markdown/JSON).
    status: pending
isProject: false
---

# Research Synthesizer UI Plan (AI Elements + shadcn)

## Goal

Build a clean, production-quality UI for the research synthesizer that:

- Starts a research job with configurable depth/sources/models
- Streams live progress/events from Convex in real time
- Displays artifacts (docs/passages/claims) during execution
- Renders the final report with a first-class citations/evidence experience

## UI foundations

- **UI kit**: shadcn/ui (base ui primitives + Tailwind)
- **AI UI**: Vercel AI SDK **AI Elements** (built on shadcn/ui)
  - Install via `npx ai-elements@latest` (or add the registry via shadcn)
- **Styling baseline**:
  - Tailwind + CSS variables theme (light/dark)
  - App typography for long-form report rendering
  - Consistent spacing, skeleton/loading states, empty states

## Key routes and screens (App Router)

- **New research**: `[app/page.tsx](app/page.tsx)`
  - Form fields: question, depth preset, source toggles, model choice
  - Submit creates job (Convex mutation) then navigates to run page
- **Run (job detail)**: `[app/jobs/[jobId]/page.tsx](app/jobs/[jobId]/page.tsx)`
  - Live stage indicator + progress feed (subscribed)
  - Tabs/panels for artifacts as they arrive (docs/passages/claims)
- **Report**: `[app/jobs/[jobId]/report/page.tsx](app/jobs/[jobId]/report/page.tsx)`
  - Render Markdown report
  - Citations drawer/side panel: quote + source link + locator
- **History**: `[app/history/page.tsx](app/history/page.tsx)`
  - List of prior jobs, status, timestamps, quick-open

## Shared components (suggested)

- `[components/layout/AppShell.tsx](components/layout/AppShell.tsx)`: app frame, nav, theme toggle
- `[components/jobs/JobStatusPill.tsx](components/jobs/JobStatusPill.tsx)`: status + stage
- `[components/jobs/JobProgressFeed.tsx](components/jobs/JobProgressFeed.tsx)`: renders `jobEvents`
- `[components/report/ReportRenderer.tsx](components/report/ReportRenderer.tsx)`: markdown + linkable citations
- `[components/report/CitationsDrawer.tsx](components/report/CitationsDrawer.tsx)`: evidence viewer
- `[components/common/EmptyState.tsx](components/common/EmptyState.tsx)`, `[components/common/Skeletons.tsx](components/common/Skeletons.tsx)`

## Real-time data flow (Convex → UI)

- **Subscriptions**:
  - job metadata: status/currentStage
  - `jobEvents` ordered by timestamp
  - artifacts lists (docs/passages/claims/report)
- **Mutations/actions**:
  - create job
  - start/run job (route handler or directly via Convex action, depending on auth/deployment)

## AI Elements usage (where it fits)

Even though the workflow is “job-based” (not pure chat), AI Elements are useful for:

- **Thread-like progress + reasoning presentation**: event feed that feels AI-native
- **Response actions**: copy excerpt, open source, jump to claim, export report
- **Code/markdown blocks**: consistent styling for report sections and quoted evidence

## UX requirements

- **Progress clarity**: stage timeline (plan → gather → extract → critique → xval → synthesize)
- **Trust**: every claim in report links to stored citations; show quote + locator + source
- **Interruptibility**: cancel job; resume/re-run with tweaks
- **Speed**: optimistic navigation after job creation; skeletons; incremental artifact reveal

## Non-goals (for MVP)

- User accounts/teams
- Payments
- Complex editor for report rewriting

## Test plan (manual)

- Create a job and watch events stream in without refresh
- Confirm artifacts appear as stages complete
- Open report page and verify citations drawer shows correct quote + URL
- Verify empty/error states for failed fetches and missing artifacts

