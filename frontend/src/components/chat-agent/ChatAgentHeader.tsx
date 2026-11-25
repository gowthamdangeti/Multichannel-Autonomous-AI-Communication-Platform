"use client";

import { Calendar, Cpu, MessageSquare } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export type ChatAgentTab = "dashboard" | "conversations" | "analytics";

export const CHAT_AGENT_TAB_LABELS: Record<ChatAgentTab, string> = {
  dashboard: "Dashboard View",
  conversations: "Conversations",
  analytics: "Analytics",
};

interface ChatAgentHeaderProps {
  name?: string;
  description?: string | null;
  createdAt?: string | null;
  conversations: number | null;
  modelConfigName?: string | null;
  activeTab: ChatAgentTab;
  isRefreshing?: boolean;
  onTabChange: (tab: ChatAgentTab) => void;
  onRefresh?: () => void;
  /** Opens the agent's editor drawer in place. */
  onCustomize?: () => void;
  /** Opens the website embed snippet popup. */
  onEmbed?: () => void;
}

export function ChatAgentHeader({
  name,
  description,
  createdAt,
  conversations,
  modelConfigName,
  activeTab,
  onTabChange,
}: ChatAgentHeaderProps) {
  const created = createdAt
    ? new Date(createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
    : null;
  const tabs = (Object.keys(CHAT_AGENT_TAB_LABELS) as ChatAgentTab[]).map((id) => ({
    id,
    label:
      id === "conversations" && conversations !== null
        ? `${CHAT_AGENT_TAB_LABELS[id]} (${conversations})`
        : CHAT_AGENT_TAB_LABELS[id],
  }));

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
        <Badge variant="outline">Chat</Badge>
        {created && (
          <>
            <span className="text-muted-foreground/40 select-none" aria-hidden="true">|</span>
            <span className="inline-flex items-center gap-1.5">
              <Calendar className="size-3.5" />
              Created {created}
            </span>
          </>
        )}
        {conversations !== null && (
          <>
            <span className="text-muted-foreground/40 select-none" aria-hidden="true">|</span>
            <span className="inline-flex items-center gap-1.5">
              <MessageSquare className="size-3.5" />
              {conversations} {conversations === 1 ? "conversation" : "conversations"}
            </span>
          </>
        )}
        {modelConfigName && (
          <>
            <span className="text-muted-foreground/40 select-none" aria-hidden="true">|</span>
            <span className="inline-flex items-center gap-1.5">
              <Cpu className="size-3.5" />
              Stack: {modelConfigName}
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
              activeTab === tab.id ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>
    </Card>
  );
}
