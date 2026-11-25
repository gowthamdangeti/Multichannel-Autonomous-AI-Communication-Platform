"use client";

import type { ChatAgentAnalyticsResponse } from "@/client/types.gen";
import { AgentPerformanceRadarCard } from "@/components/agent-view/AgentPerformanceRadarCard";
import { AgentResolutionCard } from "@/components/agent-view/AgentResolutionCard";

import { ChatAgentTelemetryCard } from "./ChatAgentTelemetryCard";
import { ChatAgentTokenUsageCard } from "./ChatAgentTokenUsageCard";

interface ChatAgentDashboardTabProps {
  analytics: ChatAgentAnalyticsResponse | null;
  days: number;
  loading: boolean;
  /** The token usage card's own data and range, so its range never reloads the other cards. */
  tokenAnalytics: ChatAgentAnalyticsResponse | null;
  tokenDays: number;
  /** The range the token numbers on screen were loaded for (differs from `tokenDays` mid-switch). */
  tokenDataDays: number;
  tokenLoading: boolean;
  tokenRefreshing: boolean;
  onTokenDaysChange: (days: number) => void;
}

/** Same shape as the voice agent dashboard: telemetry, radar beside resolution, then token usage. */
export function ChatAgentDashboardTab({
  analytics,
  days,
  loading,
  tokenAnalytics,
  tokenDays,
  tokenDataDays,
  tokenLoading,
  tokenRefreshing,
  onTokenDaysChange,
}: ChatAgentDashboardTabProps) {
  const isFirstLoad = loading && !analytics;

  return (
    <div className="space-y-4">
      <ChatAgentTelemetryCard analytics={analytics} days={days} loading={isFirstLoad} />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <AgentPerformanceRadarCard performance={analytics?.performance} loading={isFirstLoad} />
        <AgentResolutionCard
          score={analytics?.resolution?.avg_score}
          verdicts={analytics?.resolution?.verdicts ?? []}
          outcomes={analytics?.resolution?.outcomes ?? []}
          outcomesTitle="Conversation outcomes"
          stacked
          loading={isFirstLoad}
        />
      </div>
      <ChatAgentTokenUsageCard
        analytics={tokenAnalytics}
        days={tokenDays}
        dataDays={tokenDataDays}
        loading={tokenLoading && !tokenAnalytics}
        refreshing={tokenRefreshing}
        onDaysChange={onTokenDaysChange}
      />
    </div>
  );
}
