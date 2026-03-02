---
name: Enrich Arxiv + Exa
overview: Add Exa-backed web gathering to the existing staged research workflow, and enrich arXiv document metadata so author/description fields are used during extraction/summarization and preserved in passage vector metadata.
todos:
  - id: expand-arxiv-metadata
    content: Enhance arXiv parser to extract and persist authors/summary/dates/categories/pdf metadata.
    status: pending
  - id: metadata-aware-extraction
    content: Update extract-stage prompt context to include structured document metadata for better LLM summarization.
    status: pending
  - id: add-exa-source
    content: Implement Exa gather module and route `web` source through it with env-based safeguards.
    status: pending
  - id: enrich-vector-metadata
    content: Add selected document metadata fields to passage vector metadata at indexing time.
    status: pending
  - id: index-in-workflow
    content: Invoke vector backfill from the workflow after passage creation to ensure automatic indexing.
    status: pending
  - id: verify-end-to-end
    content: Run lint/typecheck and do an end-to-end smoke test for arXiv+Exa ingestion and vector persistence.
    status: pending
isProject: false
---

# Enrich arXiv Metadata and Add Exa Source

## Goals

- Capture richer arXiv fields (authors, abstract/summary, published/updated, categories, pdf link when available).
- Use enriched fields in extraction/synthesis context so LLM summaries are grounded in structured paper metadata.
- Ensure this metadata is persisted and propagated into passage vector records.
- Implement Exa as the `web` source in the existing gather stage.

## Current Integration Points

- arXiv parsing currently only stores `published` and summary text in [C:\Users\syeda\OneDrive\Desktop\Syed\Dev\research-synthesizer\lib\sources\arxiv.ts](C:\Users\syeda\OneDrive\Desktop\Syed\Dev\research-synthesizer\lib\sources\arxiv.ts).
- Source dispatch only supports `wikipedia` and `arxiv` in [C:\Users\syeda\OneDrive\Desktop\Syed\Dev\research-synthesizer\lib\workflow\runner.ts](C:\Users\syeda\OneDrive\Desktop\Syed\Dev\research-synthesizer\lib\workflow\runner.ts).
- Documents already allow freeform metadata in [C:\Users\syeda\OneDrive\Desktop\Syed\Dev\research-synthesizer\convex\schema.ts](C:\Users\syeda\OneDrive\Desktop\Syed\Dev\research-synthesizer\convex\schema.ts) (`metadata: v.optional(v.any())`).
- Passage vectors are created in [C:\Users\syeda\OneDrive\Desktop\Syed\Dev\research-synthesizer\convex\retrieval.ts](C:\Users\syeda\OneDrive\Desktop\Syed\Dev\research-synthesizer\convex\retrieval.ts) and can be extended with additional metadata fields.

## Planned Changes

- **Expand arXiv document metadata extraction**
  - Update [C:\Users\syeda\OneDrive\Desktop\Syed\Dev\research-synthesizer\lib\sources\arxiv.ts](C:\Users\syeda\OneDrive\Desktop\Syed\Dev\research-synthesizer\lib\sources\arxiv.ts) to parse and store:
    - `authors: string[]`
    - `summary` (explicitly in metadata, while keeping `text` as abstract)
    - `published`, `updated`
    - `categories: string[]`
    - `pdfUrl` when available
  - Keep existing dedupe-by-url behavior.
- **Inject metadata into extraction prompts**
  - Update extraction prompt composition in [C:\Users\syeda\OneDrive\Desktop\Syed\Dev\research-synthesizer\lib\workflow\runner.ts](C:\Users\syeda\OneDrive\Desktop\Syed\Dev\research-synthesizer\lib\workflow\runner.ts) to include a compact metadata block (authors, dates, categories) before document text.
  - This preserves the existing workflow while improving summary relevance from richer paper context.
- **Add Exa-backed `web` source gatherer**
  - Create a new source module (e.g. `lib/sources/exa.ts`) that queries Exa and maps results to `GatheredDocument`.
  - Wire `gatherForSource` in [C:\Users\syeda\OneDrive\Desktop\Syed\Dev\research-synthesizer\lib\workflow\runner.ts](C:\Users\syeda\OneDrive\Desktop\Syed\Dev\research-synthesizer\lib\workflow\runner.ts) so `source === "web"` calls Exa gatherer.
  - Add API-key/runtime guard in [C:\Users\syeda\OneDrive\Desktop\Syed\Dev\research-synthesizer\app\api\chat\route.ts](C:\Users\syeda\OneDrive\Desktop\Syed\Dev\research-synthesizer\app\api\chat\route.ts) and graceful handling when key is missing.
- **Propagate enriched metadata into vector records**
  - Extend vector metadata creation in [C:\Users\syeda\OneDrive\Desktop\Syed\Dev\research-synthesizer\convex\retrieval.ts](C:\Users\syeda\OneDrive\Desktop\Syed\Dev\research-synthesizer\convex\retrieval.ts): include selected document metadata fields (e.g., `authors`, `published`, `updated`, `categories`) on passage vectors.
  - Keep passage-level indexing model unchanged, as requested.
- **Ensure indexing runs in main workflow**
  - Add an indexing step after extraction in [C:\Users\syeda\OneDrive\Desktop\Syed\Dev\research-synthesizer\lib\workflow\runner.ts](C:\Users\syeda\OneDrive\Desktop\Syed\Dev\research-synthesizer\lib\workflow\runner.ts) by invoking existing `api.retrieval.backfillPassagesForJob`.
  - This guarantees both arXiv and Exa-derived passages are inserted into the vector store during normal runs.

## Validation

- Run typecheck/lint for touched files.
- Smoke-test with:
  - arXiv enabled: verify docs include enriched metadata and extraction prompt consumes it.
  - `web` enabled with Exa key: verify Exa docs are gathered and persisted.
  - verify passages are indexed and vector metadata includes enriched fields.
- Confirm no regressions in synthesis output and job status transitions.

