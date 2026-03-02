"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

function SidebarProvider({
  className,
  children,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      className={cn("group/sidebar-wrapper flex min-h-screen w-full", className)}
      data-slot="sidebar-provider"
      {...props}
    >
      {children}
    </div>
  );
}

function Sidebar({ className, children, ...props }: React.ComponentProps<"aside">) {
  return (
    <aside
      className={cn(
        "bg-sidebar text-sidebar-foreground border-sidebar-border hidden border-r md:flex md:w-72 md:flex-col",
        className,
      )}
      data-slot="sidebar"
      {...props}
    >
      {children}
    </aside>
  );
}

function SidebarHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn("border-sidebar-border border-b p-3", className)}
      data-slot="sidebar-header"
      {...props}
    />
  );
}

function SidebarContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn("flex min-h-0 flex-1 flex-col gap-2 overflow-auto p-2", className)}
      data-slot="sidebar-content"
      {...props}
    />
  );
}

function SidebarInset({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn("min-w-0 flex-1", className)}
      data-slot="sidebar-inset"
      {...props}
    />
  );
}

function SidebarGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div className={cn("flex flex-col gap-1", className)} data-slot="sidebar-group" {...props} />
  );
}

function SidebarGroupLabel({
  className,
  ...props
}: React.ComponentProps<"p">) {
  return (
    <p
      className={cn("text-sidebar-foreground/70 px-2 py-1 text-xs font-medium", className)}
      data-slot="sidebar-group-label"
      {...props}
    />
  );
}

function SidebarMenu({ className, ...props }: React.ComponentProps<"ul">) {
  return (
    <ul
      className={cn("flex list-none flex-col gap-1", className)}
      data-slot="sidebar-menu"
      {...props}
    />
  );
}

function SidebarMenuItem({ className, ...props }: React.ComponentProps<"li">) {
  return <li className={cn("", className)} data-slot="sidebar-menu-item" {...props} />;
}

function SidebarMenuButton({
  className,
  isActive = false,
  ...props
}: React.ComponentProps<"button"> & { isActive?: boolean }) {
  return (
    <button
      className={cn(
        "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground text-sidebar-foreground flex w-full items-center justify-between rounded-md px-2 py-2 text-left text-sm transition-colors",
        isActive && "bg-sidebar-accent text-sidebar-accent-foreground",
        className,
      )}
      data-active={isActive}
      data-slot="sidebar-menu-button"
      type="button"
      {...props}
    />
  );
}

export {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
};
