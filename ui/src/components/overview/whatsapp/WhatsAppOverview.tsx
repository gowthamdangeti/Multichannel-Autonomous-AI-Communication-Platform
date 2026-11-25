"use client";

import { MessageCircle } from "lucide-react";
import { type ReactNode, useMemo } from "react";

import { PieBreakdownChart } from "@/components/charts/DashboardCharts";
import { rangePhrase, rangeTitle } from "@/lib/dateRange";

import { mergeCounts } from "../shared/format";
import { OverviewEmptyState } from "../shared/OverviewEmptyState";
import { OverviewErrorCard } from "../shared/OverviewErrorCard";
import { OverviewHeader } from "../shared/OverviewHeader";
import { OverviewSection } from "../shared/OverviewSection";
import { OverviewTiming } from "../shared/OverviewTiming";
import { OverviewTrendChart } from "../shared/OverviewTrendChart";
import { useWhatsAppOverview } from "./hooks/useWhatsAppOverview";
import { WhatsAppAgentRoster } from "./WhatsAppAgentRoster";
import { numberStatusLabel } from "./whatsappData";
import { WhatsAppKpiGrid } from "./WhatsAppKpiGrid";
import { WhatsAppNumberList } from "./WhatsAppNumberList";

export function WhatsAppOverview({ days, headerControls }: { days: number; headerControls: ReactNode }) {
  const { data: overview, isLoading, isRefreshing, error, reload } = useWhatsAppOverview(days);
  const trend = useMemo(() => (overview?.daily ?? []).map((d) => ({ date: d.date, primary: d.new_contacts })), [overview]);
  const statuses = useMemo(
    () => mergeCounts(overview?.number_statuses ?? [], (s) => numberStatusLabel(s.key), (s) => s.count),
    [overview],
  );

  return (
    <>
      <OverviewHeader
        subtitle={`${rangeTitle(days)} of WhatsApp contacts across every agent`}
        onRefresh={reload}
        isRefreshing={isRefreshing}
        headerControls={headerControls}
      />
      {error && !overview ? (
        <OverviewErrorCard message={error} onRetry={reload} />
      ) : overview && overview.agents.length === 0 ? (
        <OverviewEmptyState
          icon={MessageCircle}
          title="No WhatsApp agents yet"
          body="Create a WhatsApp agent from the WhatsApp Agents page and assign it a number. Its contacts will show up here."
        />
      ) : (
        <>
          <OverviewSection id="whatsapp-glance" title="At a glance" description={`How your WhatsApp agents did over ${rangePhrase(days)}`}>
            <WhatsAppKpiGrid summary={overview?.summary ?? null} days={days} loading={isLoading} />
          </OverviewSection>
          <OverviewSection id="whatsapp-activity" title="New contacts" description="People who messaged a number for the first time, per day">
            <OverviewTrendChart rows={trend} primaryLabel="New contacts" emptyLabel="No new contacts in this period" loading={isLoading} />
          </OverviewSection>
          <WhatsAppAgentRoster
            id="whatsapp-agents"
            title="Your WhatsApp agents"
            description="Each number's contacts count towards the agent assigned to it now"
            agents={overview?.agents ?? []}
            loading={isLoading}
          />
          <OverviewSection id="whatsapp-numbers" title="Numbers" description="Connection status and load on each WhatsApp number">
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
              <PieBreakdownChart data={statuses} title="Connection status" subtitle="All numbers in your organization" loading={isLoading} donut unit="numbers" />
              <div className="lg:col-span-2">
                <WhatsAppNumberList numbers={overview?.numbers ?? []} loading={isLoading} />
              </div>
            </div>
          </OverviewSection>
          <OverviewSection id="whatsapp-timing" title="When new contacts reach out" description="Times are each contact's first message">
            <OverviewTiming hourly={overview?.hourly ?? []} weekday={overview?.weekday ?? []} unit="contacts" loading={isLoading} />
          </OverviewSection>
        </>
      )}
    </>
  );
}
