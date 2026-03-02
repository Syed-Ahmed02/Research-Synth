"use client";

import { useQuery } from "convex/react";
import { PanelLeft, PanelLeftClose } from "lucide-react";
import { useCallback, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { api } from "@/convex/_generated/api";
import { ChatSessionProvider, useChatSession } from "@/components/chat-session-context";
import { cn } from "@/lib/utils";

function SessionsSidebar({
  open,
  onToggle,
}: {
  open: boolean;
  onToggle: () => void;
}) {
  const { threadId, openSession, createNewChat } = useChatSession();
  const sessions = useQuery(api.chat.listSessions, { limit: 40 });

  return (
    <>
      <div
        className={cn(
          "bg-sidebar text-sidebar-foreground border-sidebar-border flex shrink-0 flex-col border-r transition-[width] duration-200 ease-in-out",
          open ? "w-72" : "w-0 overflow-hidden",
        )}
      >
        <SidebarHeader className="flex flex-row items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">Sessions</h2>
          <div className="flex items-center gap-1">
            <Button
              onClick={createNewChat}
              size="sm"
              type="button"
              variant="outline"
            >
              New chat
            </Button>
            <Button
              aria-label="Close sidebar"
              onClick={onToggle}
              size="icon-sm"
              type="button"
              variant="ghost"
            >
              <PanelLeftClose className="size-4" />
            </Button>
          </div>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel>Recent</SidebarGroupLabel>
            <SidebarMenu>
              {(sessions ?? []).map((session) => {
                const isActive = session.threadId === threadId;
                const fallbackLabel = `Session ${session.threadId.slice(0, 8)}`;
                return (
                  <SidebarMenuItem key={session._id}>
                    <SidebarMenuButton
                      isActive={isActive}
                      onClick={() => openSession(session.threadId)}
                    >
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="line-clamp-2 text-xs font-medium">
                          {session.title?.trim() || fallbackLabel}
                        </span>
                        <span className="text-sidebar-foreground/60 mt-1 text-[11px]">
                          {new Date(session.lastMessageAt).toLocaleString()}
                        </span>
                      </span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
              {(sessions?.length ?? 0) === 0 ? (
                <SidebarMenuItem>
                  <p className="text-sidebar-foreground/60 px-2 py-1 text-xs">
                    No sessions yet.
                  </p>
                </SidebarMenuItem>
              ) : null}
            </SidebarMenu>
          </SidebarGroup>
        </SidebarContent>
      </div>
      {!open && (
        <Button
          aria-label="Open sidebar"
          className="fixed left-0 top-4 z-50 rounded-r-md rounded-l-none border border-r-0 shadow-sm"
          onClick={onToggle}
          size="sm"
          type="button"
          variant="secondary"
        >
          <PanelLeft className="size-4" />
        </Button>
      )}
    </>
  );
}

function AppShellInner({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const toggleSidebar = useCallback(() => setSidebarOpen((o) => !o), []);

  return (
    <div className="flex min-h-screen w-full">
      <SessionsSidebar open={sidebarOpen} onToggle={toggleSidebar} />
      <main
        className={cn(
          "flex min-h-0 flex-1 flex-col transition-[margin] duration-200 ease-in-out",
          sidebarOpen && "md:ml-0",
        )}
      >
        {children}
      </main>
    </div>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <ChatSessionProvider>
      <AppShellInner>{children}</AppShellInner>
    </ChatSessionProvider>
  );
}
