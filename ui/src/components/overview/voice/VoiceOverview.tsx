"use client";

import { AudioLines } from "lucide-react";
import { type ReactNode, useMemo } from "react";

import { rangePhrase, rangeTitle } from "@/lib/dateRange";

import { OverviewEmptyState } from "../shared/OverviewEmptyState";
import { OverviewErrorCard } from "../shared/OverviewErrorCard";
import { OverviewHeader } from "../shared/OverviewHeader";
import { OverviewSection } from "../shared/OverviewSection";
import { OverviewTiming } from "../shared/OverviewTiming";
import { OverviewTrendChart } from "../shared/OverviewTrendChart";
import { useVoiceOverview } from "./hooks/useVoiceOverview";
import { VoiceAgentRoster } from "./VoiceAgentRoster";
import { VoiceCallBreakdown } from "./VoiceCallBreakdown";
import { VoiceKpiGrid } from "./VoiceKpiGrid";

export function VoiceOverview({ days, headerControls }: { days: number; headerControls: ReactNode }) {
  const { data: overview, isLoading, isRefreshing, error, reload } = useVoiceOverview(days);
  const trend = useMemo(
    () => (overview?.daily ?? []).map((d) => ({ date: d.date, primary: d.calls, secondary: d.minutes })),
    [overview],
  );
  const hourly = useMemo(() => (overview?.hourly ?? []).map((h) => ({ hour: h.hour, count: h.calls })), [overview]);
  const weekday = useMemo(() => (overview?.weekday ?? []).map((w) => ({ day: w.day, count: w.calls })), [overview]);

  return (
    <>
      <OverviewHeader
        subtitle={`${rangeTitle(days)} of calls across every voice agent`}
        onRefresh={reload}
        isRefreshing={isRefreshing}
        headerControls={headerControls}
      />
      {error && !overview ? (
        <OverviewErrorCard message={error} onRetry={reload} />
      ) : overview && overview.agents.length === 0 ? (
        <OverviewEmptyState
          icon={AudioLines}
          title="No voice agents yet"
          body="Create a voice agent from the Voice Agents page. Its calls, talk time and outcomes will show up here."
        />
      ) : (
        <>
          <OverviewSection id="voice-glance" title="At a glance" description={`How your voice agents did over ${rangePhrase(days)}`}>
            <VoiceKpiGrid summary={overview?.summary ?? null} days={days} loading={isLoading} />
          </OverviewSection>
          <OverviewSection id="voice-activity" title="Call activity" description="Calls and talk time per day">
            <OverviewTrendChart rows={trend} primaryLabel="Calls" secondaryLabel="Talk time (min)" emptyLabel="No voice calls in this period" loading={isLoading} />
          </OverviewSection>
          <VoiceAgentRoster
            id="voice-agents"
            title="Your voice agents"
            description="Every agent, busiest first. Open one to see its calls."
            agents={overview?.agents ?? []}
            loading={isLoading}
          />
          <OverviewSection id="voice-outcomes" title="How calls connect and end" description="Channels, recorded outcomes and call status">
            <VoiceCallBreakdown overview={overview} loading={isLoading} />
          </OverviewSection>
          <OverviewSection id="voice-timing" title="When calls happen" description="Spot the hours and days that need the most capacity">
            <OverviewTiming hourly={hourly} weekday={weekday} unit="calls" loading={isLoading} />
          </OverviewSection>
        </>
      )}
    </>
  );
}
