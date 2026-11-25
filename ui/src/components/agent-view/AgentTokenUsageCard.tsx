"use client";

import { Coins } from "lucide-react";

import type { AgentAnalyticsResponse } from "@/client/types.gen";
import { Card } from "@/components/ui/card";
import { rangeTitle } from "@/lib/dateRange";

import { formatAverage, formatPercent, formatTokenCount } from "./agentAnalyticsFormat";
import { AgentDailyTokensChart } from "./AgentDailyTokensChart";
import { AgentMetricTile } from "./AgentMetricTile";
import { ALL_STACKS, tokenUsageFigures } from "./agentTokenUsage";
import { AgentHeaviestList, AgentModelList, AgentNodeList } from "./AgentUsageLists";

interface AgentTokenUsageCardProps {
  analytics: AgentAnalyticsResponse | null;
  workflowId: number;
  days: number;
  loading: boolean;
  activeStack?: string;
  onDaysChange?: (days: number) => void;
}

export function AgentTokenUsageCard({
  analytics,
  workflowId,
  days,
  loading,
  activeStack = ALL_STACKS,
}: AgentTokenUsageCardProps) {
  const { total, prompt, completion, sessions, turns, daily } = tokenUsageFigures(analytics, activeStack);

  const tiles = [
    { label: "Total Tokens", value: formatTokenCount(total), detail: rangeTitle(days) },
    { label: "Prompt", value: formatTokenCount(prompt), detail: formatPercent(prompt, total) },
    { label: "Completion", value: formatTokenCount(completion), detail: formatPercent(completion, total) },
    { label: "Avg / Conversation", value: formatAverage(total, sessions), detail: `${sessions} conversations` },
    { label: "Avg / Turn", value: formatAverage(total, turns), detail: `${turns} turns` },
  ];

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="flex items-center gap-2 text-lg font-semibold tracking-tight text-foreground">
          <Coins className="size-5 text-muted-foreground" />
          Token Usage Breakdown
        </h3>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
        {tiles.map((tile) => (
          <AgentMetricTile key={tile.label} {...tile} loading={loading} />
        ))}
      </div>

      <div className="mt-4">
        <AgentDailyTokensChart daily={daily} loading={loading} />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-3">
        <AgentModelList models={analytics?.by_model ?? []} />
        <AgentNodeList nodes={analytics?.by_node ?? []} />
        <AgentHeaviestList conversations={analytics?.heaviest ?? []} workflowId={workflowId} />
      </div>
    </Card>
  );
}
