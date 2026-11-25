"use client";

import type { WhatsAppAgentRow } from "@/client/types.gen";

import { useRosterFilter } from "../shared/hooks/useRosterFilter";
import { OverviewRosterFilters } from "../shared/OverviewRosterFilters";
import { OverviewRosterFrame } from "../shared/OverviewRosterFrame";
import { OverviewSection } from "../shared/OverviewSection";
import { WhatsAppAgentCard } from "./WhatsAppAgentCard";
import { WhatsAppAgentTable } from "./WhatsAppAgentTable";
import { WHATSAPP_FILTERS, whatsappActivity, whatsappSearchText } from "./whatsappData";

interface WhatsAppAgentRosterProps {
  id: string;
  title: string;
  description: string;
  agents: WhatsAppAgentRow[];
  loading: boolean;
}

export function WhatsAppAgentRoster({ id, title, description, agents, loading }: WhatsAppAgentRosterProps) {
  const roster = useRosterFilter(agents, whatsappActivity, whatsappSearchText);

  return (
    <OverviewSection
      id={id}
      title={title}
      description={description}
      actions={
        <OverviewRosterFilters
          options={WHATSAPP_FILTERS}
          filter={roster.filter}
          onFilterChange={roster.setFilter}
          counts={roster.counts}
          query={roster.query}
          onQueryChange={roster.setQuery}
          searchPlaceholder="Search agents"
        />
      }
    >
      <OverviewRosterFrame
        loading={loading}
        isEmpty={roster.visible.length === 0}
        onClearFilters={roster.clear}
        table={<WhatsAppAgentTable agents={roster.visible} />}
        cards={roster.visible.map((agent) => <WhatsAppAgentCard key={agent.id} agent={agent} />)}
      />
    </OverviewSection>
  );
}
