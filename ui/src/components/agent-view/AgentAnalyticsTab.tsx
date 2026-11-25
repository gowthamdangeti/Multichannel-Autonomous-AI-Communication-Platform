"use client";

import type { AgentAnalyticsResponse } from "@/client/types.gen";
import { RangeTabs } from "@/components/charts/RangeTabs";
import { Card } from "@/components/ui/card";
import { rangePhrase } from "@/lib/dateRange";

import { formatPercent, formatResponseTime, formatTokenCount } from "./agentAnalyticsFormat";
import { AgentBusyDaysCard, AgentBusyHoursCard } from "./AgentBusyTimesCards";
import { AgentOutcomesTrendCard } from "./AgentOutcomesTrendCard";
import {
  AgentCacheTrendCard,
  AgentCallsTrendCard,
  AgentResolutionTrendCard,
  AgentResponseTrendCard,
} from "./AgentTrendCharts";

interface AgentAnalyticsTabProps {
  analytics: AgentAnalyticsResponse | null;
  days: number;
  loading: boolean;
  onDaysChange: (days: number) => void;
}

export function AgentAnalyticsTab({ analytics, days, loading, onDaysChange }: AgentAnalyticsTabProps) {
  const isFirstLoad = loading && !analytics;
  const summary = analytics?.summary;
  const trends = analytics?.trends ?? [];
  const score = summary?.avg_resolution_score;
  const cacheRead = summary?.cache_read_tokens ?? 0;

  return (
    <div className="space-y-4">
      <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
        <p className="text-sm text-muted-foreground">Trends for {rangePhrase(days)}</p>
        <RangeTabs days={days} onChange={onDaysChange} />
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <AgentCallsTrendCard trends={trends} loading={isFirstLoad} />
        <AgentResponseTrendCard
          trends={trends}
          loading={isFirstLoad}
          summary={formatResponseTime(summary?.avg_response_ms)}
        />
        <AgentResolutionTrendCard
          trends={trends}
          loading={isFirstLoad}
          summary={score === null || score === undefined ? "—" : `${score}%`}
        />
        <AgentOutcomesTrendCard trends={trends} outcomes={analytics?.outcomes ?? []} loading={isFirstLoad} />
        <AgentBusyHoursCard hours={analytics?.hourly ?? []} loading={isFirstLoad} />
        <AgentBusyDaysCard weekdays={analytics?.weekdays ?? []} loading={isFirstLoad} />
        <div className="lg:col-span-2">
          <AgentCacheTrendCard
            trends={trends}
            loading={isFirstLoad}
            summary={`${formatPercent(cacheRead, summary?.prompt_tokens ?? 0)} · ${formatTokenCount(cacheRead)} cached`}
          />
        </div>
      </div>
    </div>
  );
}
