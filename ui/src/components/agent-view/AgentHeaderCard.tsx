"use client";

import { Calendar, Cpu, MessageSquare } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export type AgentTab = "dashboard" | "conversations" | "analytics" | "nodes";

// One source for tab names: the header tabs and the breadcrumb both read it.
export const AGENT_TAB_LABELS: Record<AgentTab, string> = {
  dashboard: "Dashboard View",
  conversations: "Conversations",
  analytics: "Analytics",
  nodes: "Nodes",
};

interface AgentHeaderCardProps {
  name?: string;
  description?: string | null;
  createdAt?: string | null;
  sessions: number | null;
  stack?: string | null;
  workflowId?: number;
  activeTab: AgentTab;
  isRefreshing?: boolean;
  onTabChange: (tab: AgentTab) => void;
  onRefresh?: () => void;
  onPhoneCall?: () => void;
}

function formatCreatedAt(value?: string | null): string | null {
  if (!value) return null;
  return new Date(value).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function AgentHeaderCard({
  name,
  description,
  createdAt,
  sessions,
  stack,
  activeTab,
  onTabChange,
}: AgentHeaderCardProps) {
  const tabs: Array<{ id: AgentTab; label: string }> = [
    { id: "dashboard", label: AGENT_TAB_LABELS.dashboard },
    {
      id: "conversations",
      label: sessions === null ? AGENT_TAB_LABELS.conversations : `${AGENT_TAB_LABELS.conversations} (${sessions})`,
    },
    { id: "analytics", label: AGENT_TAB_LABELS.analytics },
    { id: "nodes", label: AGENT_TAB_LABELS.nodes },
  ];
  const created = formatCreatedAt(createdAt);

  return (
    <Card className="px-5 pt-5">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
        <div className="min-w-0">
          {name ? (
            <h2 className="truncate text-xl font-semibold tracking-tight text-foreground">{name}</h2>
          ) : (
            <Skeleton className="h-7 w-56" />
          )}
          {description && <p className="mt-1 truncate text-sm text-muted-foreground">{description}</p>}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2.5 text-xs text-muted-foreground">
        <Badge variant="outline">Voice</Badge>
        {created && (
          <>
            <span className="text-muted-foreground/40 select-none" aria-hidden="true">|</span>
            <span className="inline-flex items-center gap-1.5">
              <Calendar className="size-3.5" />
              Created {created}
            </span>
          </>
        )}
        {sessions !== null && (
          <>
            <span className="text-muted-foreground/40 select-none" aria-hidden="true">|</span>
            <span className="inline-flex items-center gap-1.5">
              <MessageSquare className="size-3.5" />
              {sessions} {sessions === 1 ? "session" : "sessions"}
            </span>
          </>
        )}
        {stack && (
          <>
            <span className="text-muted-foreground/40 select-none" aria-hidden="true">|</span>
            <span className="inline-flex items-center gap-1.5">
              <Cpu className="size-3.5" />
              Stack: {stack}
            </span>
          </>
        )}
      </div>

      <div role="tablist" aria-label="Agent sections" className="mt-4 flex items-center gap-6 overflow-x-auto text-xs">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            onClick={() => onTabChange(tab.id)}
            className={cn(
              "shrink-0 border-b-2 pb-2.5 font-semibold transition-colors",
              activeTab === tab.id
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>
    </Card>
  );
}
