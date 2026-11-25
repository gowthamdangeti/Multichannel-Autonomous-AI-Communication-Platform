"use client";

import { useMemo, useState } from "react";

import type { ChatConversationSummary } from "@/client/types.gen";
import {
  ChatConversationsTable,
  useChatConversationsTable,
} from "@/components/chat-conversation/ChatConversationsTable";
import { PageFilterSelect } from "@/components/layout/PageFilterSelect";
import { PageSearchInput } from "@/components/layout/PageSearchInput";
import { Card } from "@/components/ui/card";
import { ALL_FILTER, matchesFilter, toFilterLabel, toFilterOptions } from "@/lib/searchFilter";

const STATUS_LABELS: Record<string, string> = {
  completed: "Completed",
  in_progress: "In progress",
  disconnected: "Disconnected",
  error: "Error",
};

interface ChatAgentConversationsTabProps {
  conversations: ChatConversationSummary[];
  loading: boolean;
  error: string | null;
  agentId: number;
}

/**
 * Body of a single chat agent's Conversations tab.
 * Renders the search box, status filter dropdown, and conversations table.
 */
export function ChatAgentConversationsTab({
  conversations,
  loading,
  error,
  agentId,
}: ChatAgentConversationsTabProps) {
  const [statusFilter, setStatusFilter] = useState(ALL_FILTER);

  const filtered = useMemo(
    () => conversations.filter((r) => matchesFilter(r.status ?? "completed", statusFilter)),
    [conversations, statusFilter],
  );

  const table = useChatConversationsTable(filtered, {
    showAgent: false,
    storageKey: "chat-agent-conversations-columns-v4",
    returnTo: `/chat/agents/${agentId}/view?tab=conversations`,
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-bold text-foreground">
            Conversations Table
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            All chat sessions for this agent.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          <div className="w-48 sm:w-64">
            <PageSearchInput
              placeholder="Search conversations..."
              value={table.search}
              onChange={table.setSearch}
            />
          </div>
          <PageFilterSelect
            allLabel="All statuses"
            value={statusFilter}
            options={toFilterOptions(
              conversations,
              (r) => r.status ?? "completed",
              (status) => STATUS_LABELS[status] ?? toFilterLabel(status),
            )}
            onChange={setStatusFilter}
          />
        </div>
      </div>

      {error && loading ? (
        <Card className="p-6 text-sm text-destructive">{error}</Card>
      ) : (
        <ChatConversationsTable
          table={table}
          loading={loading}
          emptyMessage="No conversations yet. Embed this agent on your site and its conversations will show up here."
        />
      )}
    </div>
  );
}
