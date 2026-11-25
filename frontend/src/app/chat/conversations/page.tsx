"use client";

import { useMemo, useState } from "react";

import {
  ChatConversationsTable,
  useChatConversationsTable,
} from "@/components/chat-conversation/ChatConversationsTable";
import { useChatConversations } from "@/components/chat-conversation/hooks/useChatConversations";
import { PageFilterSelect } from "@/components/layout/PageFilterSelect";
import { PageSearchInput } from "@/components/layout/PageSearchInput";
import { PageHeader } from "@/context/HeaderContext";
import { ALL_FILTER, matchesFilter, toFilterLabel, toFilterOptions } from "@/lib/searchFilter";

const STATUS_LABELS: Record<string, string> = {
  completed: "Completed",
  in_progress: "In progress",
  disconnected: "Disconnected",
  error: "Error",
};

export default function ChatConversationsPage() {
    const { rows, error, isRefreshing, reload } = useChatConversations();
    const [agentFilter, setAgentFilter] = useState(ALL_FILTER);
    const [statusFilter, setStatusFilter] = useState(ALL_FILTER);

    const all = useMemo(() => rows ?? [], [rows]);
    const filtered = useMemo(
        () => all.filter((r) => matchesFilter(r.agent_name, agentFilter) && matchesFilter(r.status ?? "completed", statusFilter)),
        [all, agentFilter, statusFilter],
    );
    // The header owns the controls, exactly like the voice and WhatsApp lists.
    const table = useChatConversationsTable(filtered);

    return (
        <div className="px-4 lg:px-6 pt-2 pb-6 space-y-4">
            <PageHeader
                title="Chat Conversations"
                subtitle="Every conversation your website chat agents have had"
                onRefresh={() => void reload()}
                isRefreshing={isRefreshing}
                toolbar={
                    <>
                        <PageSearchInput
                            placeholder="Search conversations..."
                            value={table.search}
                            onChange={table.setSearch}
                        />
                        <PageFilterSelect
                            allLabel="All agents"
                            value={agentFilter}
                            options={toFilterOptions(all, (r) => r.agent_name, (name) => name)}
                            onChange={setAgentFilter}
                        />
                        <PageFilterSelect
                            allLabel="All statuses"
                            value={statusFilter}
                            options={toFilterOptions(
                                all,
                                (r) => r.status ?? "completed",
                                (status) => STATUS_LABELS[status] ?? toFilterLabel(status),
                            )}
                            onChange={setStatusFilter}
                        />
                    </>
                }
            />
            {error && !rows ? (
                <div className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</div>
            ) : (
                <ChatConversationsTable
                    table={table}
                    loading={rows === null}
                    emptyMessage="No conversations found. Create an agent, then embed it on your site with a script tag."
                />
            )}
        </div>
    );
}
