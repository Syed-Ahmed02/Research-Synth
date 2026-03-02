"use client";

import { useChat } from "@ai-sdk/react";
import { useQuery } from "convex/react";
import { useCallback, useMemo, useState } from "react";

import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
} from "@/components/ai-elements/conversation";
import {
  Message,
  MessageContent,
  MessageResponse,
} from "@/components/ai-elements/message";
import {
  Source,
  Sources,
  SourcesContent,
  SourcesTrigger,
} from "@/components/ai-elements/sources";
import {
  PromptInput,
  PromptInputBody,
  PromptInputFooter,
  PromptInputSelect,
  PromptInputSelectContent,
  PromptInputSelectItem,
  PromptInputSelectTrigger,
  PromptInputSelectValue,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
} from "@/components/ai-elements/prompt-input";
import { useChatSession } from "@/components/chat-session-context";
import { Button } from "@/components/ui/button";
import { api } from "@/convex/_generated/api";
import { DEFAULT_MODEL_BY_DEPTH, type DepthPreset, type SourceType } from "@/lib/ai/contracts";
import { cn } from "@/lib/utils";

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
  model: "anthropic/claude-opus-4.6",
  sourcesEnabled: ["web"],
};

type TimelineItem =
  | {
      key: string;
      kind: "chat";
      role: string;
      sort: number;
      text: string;
    }
  | {
      key: string;
      kind: "report";
      sort: number;
      reportMd: string;
      reportJson?: unknown;
    };
type ChatTimelineItem = Extract<TimelineItem, { kind: "chat" }>;

const ALL_SOURCES: SourceType[] = ["wikipedia", "arxiv", "news", "gov", "web"];
const STAGE_LABELS: Record<string, string> = {
  cross_validate: "Cross-validating",
  critique: "Critiquing",
  extract: "Extracting",
  gather: "Gathering",
  plan: "Planning",
  synthesize: "Synthesizing",
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
  const { threadId, openSession, createNewChat } = useChatSession();
  const [config, setConfig] = useState<ChatConfig>(defaultConfig);
  const [sessionBaseTs] = useState(() => Date.now());

  const { messages, sendMessage, status, stop } = useChat({
    id: threadId ?? undefined,
  });

  const sessionMessages = useQuery(
    api.chat.listMessagesByThread,
    threadId ? { threadId, limit: 200 } : "skip",
  );
  const jobs = useQuery(api.jobs.listJobs, threadId ? { threadId, limit: 20 } : "skip");
  const job = jobs?.[0];
  const report = useQuery(
    api.artifacts.getReportByJob,
    job ? { jobId: job._id } : "skip",
  );

  const stageLabel = useMemo(() => {
    if (!job?.currentStage) {
      return null;
    }
    return STAGE_LABELS[job.currentStage] ?? job.currentStage;
  }, [job?.currentStage]);

  const liveStatusText = useMemo(() => {
    if (job?.status === "running") {
      return stageLabel ? `${stageLabel}...` : "Thinking...";
    }
    if (job?.status === "queued") {
      return "Queued...";
    }
    if (job?.status === "succeeded") {
      return "Complete";
    }
    if (job?.status === "failed") {
      return "Failed";
    }
    if (status === "submitted" || status === "streaming") {
      return "Thinking...";
    }
    return "Ready";
  }, [job?.status, stageLabel, status]);

  const toggleSource = useCallback((source: SourceType) => {
    setConfig((prev) => {
      const enabled = prev.sourcesEnabled.includes(source);
      const next = enabled
        ? prev.sourcesEnabled.filter((item) => item !== source)
        : [...prev.sourcesEnabled, source];
      return {
        ...prev,
        sourcesEnabled: next.length > 0 ? next : [source],
      };
    });
  }, []);

  const timeline = useMemo<TimelineItem[]>(() => {
    const baseTs = job?.createdAt ?? sessionBaseTs;
    const persistedChatItems: ChatTimelineItem[] = (sessionMessages ?? []).map((message, index) => ({
      key: `persisted-${message._id}`,
      kind: "chat",
      role: message.role,
      sort: message.createdAt ?? baseTs + index,
      text: message.text,
    }));

    const latestPersistedAssistant = [...persistedChatItems]
      .reverse()
      .find((item) => item.role === "assistant");
    const latestLiveAssistant = [...messages]
      .reverse()
      .find(
        (message) =>
          (message as { role?: string }).role === "assistant" &&
          textFromParts(message).trim().length > 0,
      );
    const transientAssistantText = latestLiveAssistant
      ? textFromParts(latestLiveAssistant).trim()
      : "";
    const shouldShowTransientAssistant =
      (status === "streaming" || status === "submitted") &&
      transientAssistantText.length > 0 &&
      transientAssistantText !== (latestPersistedAssistant?.text ?? "").trim();
    const transientSortBase = (sessionMessages?.at(-1)?.createdAt ?? baseTs) + 1;

    const liveOverlayItems: ChatTimelineItem[] = shouldShowTransientAssistant
      ? [
          {
            key: "chat-live-assistant",
            kind: "chat",
            role: "assistant",
            sort: transientSortBase,
            text: transientAssistantText,
          },
        ]
      : [];

    const chatItems: ChatTimelineItem[] = [...persistedChatItems, ...liveOverlayItems];
    const liveUserMessages = messages.filter((message) => (message as { role?: string }).role === "user");
    const latestLiveUser = liveUserMessages.at(-1);
    const latestPersistedUser = [...persistedChatItems]
      .reverse()
      .find((item) => item.role === "user");
    const latestLiveUserText = latestLiveUser ? textFromParts(latestLiveUser).trim() : "";
    if (
      latestLiveUserText &&
      latestLiveUserText !== (latestPersistedUser?.text ?? "").trim()
    ) {
      chatItems.push({
        key: "chat-live-user",
        kind: "chat",
        role: "user",
        sort: transientSortBase - 1,
        text: latestLiveUserText,
      });
    }

    const reportItem: TimelineItem[] =
      report?.reportMd && report.reportMd.trim()
        ? [
            {
              key: `report-${report._id}`,
              kind: "report",
              sort: report.createdAt ?? sessionBaseTs,
              reportMd: report.reportMd,
              reportJson: (report as { reportJson?: unknown }).reportJson,
            },
          ]
        : [];

    return [...chatItems, ...reportItem].sort(
      (a, b) => a.sort - b.sort,
    );
  }, [job?.createdAt, messages, report, sessionBaseTs, sessionMessages, status]);

  const resourcesForReport = useCallback((reportJson: unknown) => {
    if (!reportJson || typeof reportJson !== "object") {
      return [];
    }
    const raw = (reportJson as { resources?: unknown }).resources;
    if (!Array.isArray(raw)) {
      return [];
    }
    return raw
      .map((item) => {
        if (!item || typeof item !== "object") {
          return null;
        }
        const url = typeof (item as { url?: unknown }).url === "string" ? (item as { url: string }).url : "";
        const title =
          typeof (item as { title?: unknown }).title === "string" ? (item as { title: string }).title : undefined;
        const sourceType =
          typeof (item as { sourceType?: unknown }).sourceType === "string"
            ? (item as { sourceType: string }).sourceType
            : undefined;
        if (!url) {
          return null;
        }
        return { url, title, sourceType };
      })
      .filter(
        (
          item,
        ): item is { url: string; title: string | undefined; sourceType: string | undefined } =>
          item !== null,
      )
      .slice(0, 12);
  }, []);

  const exportMarkdown = useCallback(() => {
    const markdown = timeline
      .map((item) => {
        if (item.kind === "chat") {
          const label = item.role === "user" ? "User" : "Assistant";
          return `### ${label}\n\n${item.text}`;
        }
        return `### Durable Report\n\n${item.reportMd}`;
      })
      .join("\n\n---\n\n");

    const blob = new Blob([markdown], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "research-thread.md";
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }, [timeline]);

  const exportJson = useCallback(() => {
    const payload = {
      config,
      job: job ?? null,
      liveStatusText,
      report: report ?? null,
      threadId,
      timeline,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "research-thread.json";
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }, [config, job, liveStatusText, report, threadId, timeline]);

  const handleSubmit = useCallback(
    async ({ text }: { text: string }) => {
      const prompt = text.trim();
      if (!prompt || status !== "ready" || !threadId) {
        return;
      }
      sendMessage(
        { text: prompt },
        {
          body: {
            config,
            threadId,
          },
        },
      );
    },
    [config, sendMessage, status, threadId],
  );

  if (!threadId) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-5xl items-center justify-center px-4 py-8">
        <p className="text-sm text-zinc-500">Preparing research chat...</p>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-0 min-w-0 max-w-5xl flex-1 flex-col gap-4 px-4 py-6 sm:px-6">
      <section className="flex min-h-0 min-w-0 flex-1 flex-col gap-4">
        <header className="shrink-0 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">Research Synthesizer</h1>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              One unified chat: prompts, streaming synthesis, stage updates, and report output.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button onClick={exportMarkdown} size="sm" type="button" variant="outline">
              Export Markdown
            </Button>
            <Button onClick={exportJson} size="sm" type="button" variant="outline">
              Export JSON
            </Button>
          </div>
        </header>

        <div className="shrink-0 flex flex-wrap gap-2 rounded-lg border p-3 text-sm">
        <label className="flex items-center gap-2">
          Depth
          <PromptInputSelect
            onValueChange={(value) => {
              const preset = value as DepthPreset;
              setConfig((prev) => ({
                ...prev,
                depthPreset: preset,
                model: DEFAULT_MODEL_BY_DEPTH[preset],
              }));
            }}
            value={config.depthPreset}
          >
            <PromptInputSelectTrigger className="h-8 border px-2 text-xs">
              <PromptInputSelectValue />
            </PromptInputSelectTrigger>
            <PromptInputSelectContent>
              <PromptInputSelectItem value="fast">fast</PromptInputSelectItem>
              <PromptInputSelectItem value="standard">standard</PromptInputSelectItem>
              <PromptInputSelectItem value="deep">deep</PromptInputSelectItem>
            </PromptInputSelectContent>
          </PromptInputSelect>
        </label>
        <label className="flex items-center gap-2">
          Model
          <input
            className="h-8 w-64 rounded border bg-background px-2 text-xs"
            onChange={(event) =>
              setConfig((prev) => ({ ...prev, model: event.currentTarget.value }))
            }
            value={config.model}
          />
        </label>
        <label className="flex items-center gap-2">
          Max docs
          <input
            className="h-8 w-20 rounded border bg-background px-2 text-xs"
            min={1}
            onChange={(event) =>
              setConfig((prev) => ({
                ...prev,
                limits: {
                  ...prev.limits,
                  maxDocs: Number(event.currentTarget.value || 1),
                },
              }))
            }
            type="number"
            value={config.limits.maxDocs}
          />
        </label>
        <div className="flex items-center gap-1">
          {ALL_SOURCES.map((source) => {
            const isEnabled = config.sourcesEnabled.includes(source);
            return (
              <button
                className={cn(
                  "rounded-full border px-2 py-1 text-xs capitalize",
                  isEnabled
                    ? "border-foreground bg-foreground text-background"
                    : "border-zinc-300 text-zinc-600 dark:border-zinc-700 dark:text-zinc-300",
                )}
                key={source}
                onClick={() => toggleSource(source)}
                type="button"
              >
                {source}
              </button>
            );
          })}
        </div>
        </div>

        <Conversation className="min-h-0 flex-1 overflow-auto rounded-lg border">
        <ConversationContent className="flex flex-col gap-4 p-4">
          <div className="sticky top-0 z-10 -mx-1 flex items-center justify-between rounded-md border bg-background/90 px-3 py-2 text-xs backdrop-blur">
            <span className="text-zinc-500">Research status</span>
            <span
              className={cn(
                "rounded-full border px-2 py-1 font-medium",
                liveStatusText === "Complete" &&
                  "border-emerald-400 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
                liveStatusText === "Failed" &&
                  "border-red-400 bg-red-500/10 text-red-700 dark:text-red-300",
                (liveStatusText.endsWith("...") || liveStatusText === "Ready") &&
                  "border-blue-400 bg-blue-500/10 text-blue-700 dark:text-blue-300",
              )}
            >
              {liveStatusText}
            </span>
          </div>

          {timeline.length === 0 ? (
            <ConversationEmptyState
              description="Ask a question to start a run. You will see one live status badge update as stages progress."
              title="Start your first research thread"
            />
          ) : null}

          {timeline.map((item) => {
            if (item.kind === "chat") {
              const from = item.role === "user" ? "user" : "assistant";
              return (
                <Message from={from} key={item.key}>
                  <MessageContent>
                    {from === "assistant" ? (
                      <MessageResponse>{item.text}</MessageResponse>
                    ) : (
                      <p className="whitespace-pre-wrap">{item.text}</p>
                    )}
                  </MessageContent>
                </Message>
              );
            }

            return (
              <Message from="assistant" key={item.key}>
                <MessageContent className="rounded-md border border-emerald-500/30 bg-emerald-500/5 p-3">
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-300">
                    Durable Report
                  </p>
                  {item.reportJson ? (() => {
                    const resources = resourcesForReport(item.reportJson);
                    if (resources.length === 0) {
                      return null;
                    }
                    return (
                      <Sources className="mb-3">
                        <SourcesTrigger count={resources.length} />
                        <SourcesContent>
                          {resources.map((resource) => (
                            <Source href={resource.url} key={resource.url} title={resource.title ?? resource.url}>
                              <span className="block font-medium">
                                {(resource.title ?? resource.url).trim()}
                                {resource.sourceType ? (
                                  <span className="ml-2 text-muted-foreground">
                                    ({resource.sourceType})
                                  </span>
                                ) : null}
                              </span>
                            </Source>
                          ))}
                        </SourcesContent>
                      </Sources>
                    );
                  })() : null}
                  <MessageResponse>{item.reportMd}</MessageResponse>
                </MessageContent>
              </Message>
            );
          })}
        </ConversationContent>
        </Conversation>

        <PromptInput className="shrink-0 w-full" onSubmit={handleSubmit}>
        <PromptInputBody>
          <PromptInputTextarea placeholder="Ask a research question..." />
        </PromptInputBody>
        <PromptInputFooter>
          <PromptInputTools>
            <p className="px-2 text-xs text-zinc-500">
              {liveStatusText}
            </p>
          </PromptInputTools>
          <PromptInputSubmit onStop={stop} status={status} />
        </PromptInputFooter>
        </PromptInput>
      </section>
    </main>
  );
}
