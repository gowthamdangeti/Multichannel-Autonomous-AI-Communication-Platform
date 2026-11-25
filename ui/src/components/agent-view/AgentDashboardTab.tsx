"use client";

import { useState } from "react";

import type { AgentAnalyticsResponse } from "@/client/types.gen";

import { AgentExecutionShareCard } from "./AgentExecutionShareCard";
import { AgentPerformanceRadarCard } from "./AgentPerformanceRadarCard";
import { AgentResolutionCard } from "./AgentResolutionCard";
import { AgentTelemetryCard } from "./AgentTelemetryCard";
import { ALL_STACKS, stackOptions } from "./agentTokenUsage";
import { AgentTokenUsageCard } from "./AgentTokenUsageCard";

interface AgentDashboardTabProps {
  analytics: AgentAnalyticsResponse | null;
  workflowId: number;
  days: number;
  loading: boolean;
  onDaysChange: (days: number) => void;
}

export function AgentDashboardTab({ analytics, workflowId, days, loading, onDaysChange }: AgentDashboardTabProps) {
  const isFirstLoad = loading && !analytics;
  const [stackValue, setStackValue] = useState(ALL_STACKS);

  const stacks = stackOptions(analytics);
  // The selected stack can vanish when the range changes; show all rather than blank out.
  const activeStack = stacks.some((stack) => stack.name === stackValue) ? stackValue : ALL_STACKS;

  return (
    <div className="space-y-4">
      <AgentTelemetryCard
        summary={analytics?.summary}
        byModel={analytics?.by_model}
        days={days}
        loading={isFirstLoad}
        onDaysChange={onDaysChange}
        stacks={stacks}
        selectedStack={activeStack}
        onStackChange={setStackValue}
      />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <AgentExecutionShareCard nodes={analytics?.by_node ?? []} loading={isFirstLoad} />
        <AgentPerformanceRadarCard performance={analytics?.performance} loading={isFirstLoad} />
      </div>
      <AgentResolutionCard
        score={analytics?.summary.avg_resolution_score}
        verdicts={analytics?.verdicts ?? []}
        outcomes={analytics?.outcomes ?? []}
        loading={isFirstLoad}
      />
      <AgentTokenUsageCard
        analytics={analytics}
        workflowId={workflowId}
        days={days}
        loading={isFirstLoad}
        activeStack={activeStack}
      />
    </div>
  );
}
