"use client";

import type { ChatAgentAnalyticsResponse } from "@/client/types.gen";
import { formatResponseTime, formatTokenCount } from "@/components/agent-view/agentAnalyticsFormat";
import { AgentMetricTile } from "@/components/agent-view/AgentMetricTile";
import { Card } from "@/components/ui/card";
import { rangeTitle } from "@/lib/dateRange";

interface ChatAgentTelemetryCardProps {
  analytics: ChatAgentAnalyticsResponse | null;
  days: number;
  loading: boolean;
}

/** The chat agent's Executive Telemetry — same card the voice agent dashboard shows. */
export function ChatAgentTelemetryCard({ analytics, days, loading }: ChatAgentTelemetryCardProps) {
  const summary = analytics?.summary;
  const usage = analytics?.usage;
  const totalTokens = (usage?.prompt_tokens ?? 0) + (usage?.completion_tokens ?? 0);
  const tiles = [
    { label: "Total Prompt", value: formatTokenCount(usage?.prompt_tokens ?? 0) },
    { label: "Total Completion", value: formatTokenCount(usage?.completion_tokens ?? 0) },
    { label: "Total Tokens", value: formatTokenCount(totalTokens) },
    { label: "Total Turns", value: String(summary?.messages ?? 0) },
    { label: "Avg Response", value: formatResponseTime(usage?.avg_latency_ms) },
    { label: "Conversations", value: String(summary?.conversations ?? 0) },
    { label: "Replies", value: String(usage?.replies ?? 0) },
    {
      label: "Sessions Synced",
      value: `${usage?.conversations_with_usage ?? 0} / ${summary?.conversations ?? 0}`,
    },
  ];

  return (
    <Card className="p-5">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-lg font-semibold tracking-tight text-foreground">Executive Telemetry</h3>
        <span className="text-xs text-muted-foreground">{rangeTitle(days)}</span>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4 2xl:grid-cols-8">
        {tiles.map((tile) => (
          <AgentMetricTile key={tile.label} label={tile.label} value={tile.value} loading={loading} />
        ))}
      </div>
    </Card>
  );
}
