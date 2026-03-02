"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";

const THREAD_STORAGE_KEY = "research-synthesizer:thread-id";

type ChatSessionContextValue = {
  threadId: string | null;
  openSession: (threadId: string) => void;
  createNewChat: () => void;
};

const ChatSessionContext = createContext<ChatSessionContextValue | null>(null);

function readStoredOrCreateThreadId(): string {
  const stored = window.localStorage.getItem(THREAD_STORAGE_KEY);
  if (stored) return stored;
  const created = crypto.randomUUID();
  window.localStorage.setItem(THREAD_STORAGE_KEY, created);
  return created;
}

export function ChatSessionProvider({ children }: { children: React.ReactNode }) {
  const [threadId, setThreadId] = useState<string | null>(null);

  useEffect(() => {
    setThreadId(readStoredOrCreateThreadId());
  }, []);

  const openSession = useCallback((nextThreadId: string) => {
    window.localStorage.setItem(THREAD_STORAGE_KEY, nextThreadId);
    setThreadId(nextThreadId);
  }, []);

  const createNewChat = useCallback(() => {
    const nextThreadId = crypto.randomUUID();
    window.localStorage.setItem(THREAD_STORAGE_KEY, nextThreadId);
    setThreadId(nextThreadId);
  }, []);

  return (
    <ChatSessionContext.Provider value={{ threadId, openSession, createNewChat }}>
      {children}
    </ChatSessionContext.Provider>
  );
}

export function useChatSession() {
  const ctx = useContext(ChatSessionContext);
  if (!ctx) throw new Error("useChatSession must be used within ChatSessionProvider");
  return ctx;
}
