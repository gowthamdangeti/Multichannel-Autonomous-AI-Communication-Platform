"use client";

import type { VoiceAgentRow } from "@/client/types.gen";

import { useRosterFilter } from "../shared/hooks/useRosterFilter";
import { OverviewRosterFilters } from "../shared/OverviewRosterFilters";
import { OverviewRosterFrame } from "../shared/OverviewRosterFrame";
import { OverviewSection } from "../shared/OverviewSection";
import { VoiceAgentCard } from "./VoiceAgentCard";
import { VoiceAgentTable } from "./VoiceAgentTable";
import { VOICE_FILTERS, voiceActivity, voiceSearchText } from "./voiceData";

interface VoiceAgentRosterProps {
  id: string;
  title: string;
  description: string;
  agents: VoiceAgentRow[];
  loading: boolean;
}

export function VoiceAgentRoster({ id, title, description, agents, loading }: VoiceAgentRosterProps) {
  const roster = useRosterFilter(agents, voiceActivity, voiceSearchText);

  return (
    <OverviewSection
      id={id}
      title={title}
      description={description}
      actions={
        <OverviewRosterFilters
          options={VOICE_FILTERS}
          filter={roster.filter}
          onFilterChange={roster.setFilter}
          counts={roster.counts}
          query={roster.query}
          onQueryChange={roster.setQuery}
          searchPlaceholder="Search agents or folders"
        />
      }
    >
      <OverviewRosterFrame
        loading={loading}
        isEmpty={roster.visible.length === 0}
        onClearFilters={roster.clear}
        table={<VoiceAgentTable agents={roster.visible} />}
        cards={roster.visible.map((agent) => <VoiceAgentCard key={agent.id} agent={agent} />)}
      />
    </OverviewSection>
  );
}
