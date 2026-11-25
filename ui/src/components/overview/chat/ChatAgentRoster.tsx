"use client";

import type { ChatAgentRow } from "@/client/types.gen";

import { useRosterFilter } from "../shared/hooks/useRosterFilter";
import { OverviewRosterFilters } from "../shared/OverviewRosterFilters";
import { OverviewRosterFrame } from "../shared/OverviewRosterFrame";
import { OverviewSection } from "../shared/OverviewSection";
import { ChatAgentCard } from "./ChatAgentCard";
import { ChatAgentTable } from "./ChatAgentTable";
import { CHAT_FILTERS, chatActivity, chatSearchText } from "./chatData";

interface ChatAgentRosterProps {
  id: string;
  title: string;
  description: string;
  agents: ChatAgentRow[];
  loading: boolean;
}

export function ChatAgentRoster({ id, title, description, agents, loading }: ChatAgentRosterProps) {
  const roster = useRosterFilter(agents, chatActivity, chatSearchText);

  return (
    <OverviewSection
      id={id}
      title={title}
      description={description}
      actions={
        <OverviewRosterFilters
          options={CHAT_FILTERS}
          filter={roster.filter}
          onFilterChange={roster.setFilter}
          counts={roster.counts}
          query={roster.query}
          onQueryChange={roster.setQuery}
          searchPlaceholder="Search agents or websites"
        />
      }
    >
      <OverviewRosterFrame
        loading={loading}
        isEmpty={roster.visible.length === 0}
        onClearFilters={roster.clear}
        table={<ChatAgentTable agents={roster.visible} />}
        cards={roster.visible.map((agent) => <ChatAgentCard key={agent.id} agent={agent} />)}
      />
    </OverviewSection>
  );
}
