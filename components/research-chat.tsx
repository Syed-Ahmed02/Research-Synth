"use client";

import { useChat } from "@ai-sdk/react";
import { useQuery } from "convex/react";
import { useState, type FormEvent } from "react";

import { api } from "@/convex/_generated/api";
import type { DepthPreset, SourceType } from "@/lib/ai/contracts";

type ChatConfig = {
  depthPreset: DepthPreset;
  limits: {
    maxDocs: number;
    maxPassagesPerDoc: number;
  };
  model: string;
  sourcesEnabled: SourceType[];
};

const defaultConfig: ChatConfig = {
  depthPreset: "standard",
  limits: {
    maxDocs: 8,
    maxPassagesPerDoc: 4,
  },
  model: "anthropic/claude-3.5-sonnet",
  sourcesEnabled: ["wikipedia", "arxiv"],
};

const textFromParts = (message: unknown) => {
  if (!message || typeof message !== "object") {
    return "";
  }
  const parts = (message as { parts?: unknown }).parts;
  if (!Array.isArray(parts)) {
    return "";
  }
  return parts
    .map((part) => {
      if (!part || typeof part !== "object") {
        return "";
      }
      if ((part as { type?: unknown }).type !== "text") {
        return "";
      }
      return typeof (part as { text?: unknown }).text === "string"
        ? (part as { text: string }).text
        : "";
    })
    .filter(Boolean)
    .join("");
};

export function ResearchChat() {
  const [input, setInput] = useState("");
  const [config, setConfig] = useState<ChatConfig>(defaultConfig);

  const { id, messages, sendMessage, status } = useChat();
  const latestJobs = useQuery(api.jobs.listJobs, { limit: 1, threadId: id });
  const job = latestJobs?.[0];
  const events = useQuery(
    api.jobs.listJobEvents,
    job ? { jobId: job._id, limit: 120 } : "skip",
  );
  const report = useQuery(api.artifacts.getReportByJob, job ? { jobId: job._id } : "skip");

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    const text = input.trim();
    if (!text || status !== "ready") {
      return;
    }
    sendMessage({ text }, { body: { config } });
    setInput("");
  };

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-6xl gap-6 px-6 py-8">
      <section className="flex min-w-0 flex-1 flex-col gap-4">
        <h1 className="text-2xl font-semibold">Research Synthesizer</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Ask a question. The agent pipeline runs durably and streams synthesis output in chat.
        </p>

        <div className="flex flex-wrap gap-3 rounded-lg border p-3 text-sm">
          <label className="flex items-center gap-2">
            Depth
            <select
              className="rounded border bg-background px-2 py-1"
              onChange={(e) =>
                setConfig((prev) => ({ ...prev, depthPreset: e.target.value as DepthPreset }))
              }
              value={config.depthPreset}
            >
              <option value="fast">fast</option>
              <option value="standard">standard</option>
              <option value="deep">deep</option>
            </select>
          </label>
          <label className="flex items-center gap-2">
            Model
            <input
              className="w-64 rounded border bg-background px-2 py-1"
              onChange={(e) => setConfig((prev) => ({ ...prev, model: e.target.value }))}
              value={config.model}
            />
          </label>
          <label className="flex items-center gap-2">
            Max docs
            <input
              className="w-20 rounded border bg-background px-2 py-1"
              min={1}
              onChange={(e) =>
                setConfig((prev) => ({
                  ...prev,
                  limits: {
                    ...prev.limits,
                    maxDocs: Number(e.target.value || 1),
                  },
                }))
              }
              type="number"
              value={config.limits.maxDocs}
            />
          </label>
        </div>

        <div className="flex min-h-[360px] flex-col gap-3 rounded-lg border p-4">
          {messages.map((message) => (
            <article
              className="rounded-md border p-3"
              key={(message as { id: string }).id}
            >
              <header className="mb-2 text-xs font-medium uppercase text-zinc-500">
                {(message as { role: string }).role}
              </header>
              <pre className="whitespace-pre-wrap text-sm">{textFromParts(message)}</pre>
            </article>
          ))}
          {messages.length === 0 ? (
            <p className="text-sm text-zinc-500">
              Start with a question like “What is the current state of federated learning in healthcare?”
            </p>
          ) : null}
        </div>

        <form className="flex gap-2" onSubmit={handleSubmit}>
          <input
            className="flex-1 rounded-md border bg-background px-3 py-2 text-sm"
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask a research question..."
            value={input}
          />
          <button
            className="rounded-md border px-4 py-2 text-sm disabled:opacity-50"
            disabled={status !== "ready"}
            type="submit"
          >
            {status === "ready" ? "Run" : "Running..."}
          </button>
        </form>
      </section>

      <aside className="w-full max-w-md space-y-4">
        <section className="rounded-lg border p-4">
          <h2 className="mb-2 text-sm font-semibold">Run State</h2>
          {job ? (
            <div className="space-y-1 text-sm">
              <p>
                <span className="font-medium">Status:</span> {job.status}
              </p>
              <p>
                <span className="font-medium">Stage:</span> {job.currentStage}
              </p>
              <p className="line-clamp-3 text-zinc-600 dark:text-zinc-400">{job.question}</p>
            </div>
          ) : (
            <p className="text-sm text-zinc-500">No run yet for this chat thread.</p>
          )}
        </section>

        <section className="rounded-lg border p-4">
          <h2 className="mb-2 text-sm font-semibold">Stage Events</h2>
          <div className="max-h-72 space-y-2 overflow-auto pr-1 text-xs">
            {(events ?? []).map((event) => (
              <div className="rounded border p-2" key={event._id}>
                <p className="font-medium">
                  {event.stage} · {event.level}
                </p>
                <p className="text-zinc-600 dark:text-zinc-400">{event.message}</p>
              </div>
            ))}
            {!events?.length ? (
              <p className="text-zinc-500">Events will appear here as stages run.</p>
            ) : null}
          </div>
        </section>

        <section className="rounded-lg border p-4">
          <h2 className="mb-2 text-sm font-semibold">Durable Report</h2>
          {report ? (
            <pre className="max-h-72 overflow-auto whitespace-pre-wrap text-xs">{report.reportMd}</pre>
          ) : (
            <p className="text-xs text-zinc-500">Report appears after synthesis completes.</p>
          )}
        </section>
      </aside>
    </main>
  );
}
