"use client";

import type { AgentAnalyticsSummary, AgentModelUsage } from "@/client/types.gen";
import { Card } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RANGE_OPTIONS, rangeTitle } from "@/lib/dateRange";

import { formatResponseTime, formatTokenCount, formatTotalDuration } from "./agentAnalyticsFormat";
import { AgentMetricTile } from "./AgentMetricTile";
import { ALL_STACKS, type StackOption } from "./agentTokenUsage";

interface AgentTelemetryCardProps {
  summary?: AgentAnalyticsSummary;
  byModel?: AgentModelUsage[];
  days: number;
  loading: boolean;
  onDaysChange?: (days: number) => void;
  stacks?: StackOption[];
  selectedStack?: string;
  onStackChange?: (stack: string) => void;
}

export function AgentTelemetryCard({
  summary,
  byModel,
  days,
  loading,
  onDaysChange,
  stacks = [],
  selectedStack = ALL_STACKS,
  onStackChange,
}: AgentTelemetryCardProps) {
  const score = summary?.avg_resolution_score;
  const selectedModelUsage =
    selectedStack !== ALL_STACKS ? byModel?.find((m) => m.name === selectedStack) : null;

  const promptTokens = selectedModelUsage ? selectedModelUsage.prompt_tokens : (summary?.prompt_tokens ?? 0);
  const completionTokens = selectedModelUsage
    ? selectedModelUsage.completion_tokens
    : (summary?.completion_tokens ?? 0);

  const tiles = [
    { label: "Total Duration", value: formatTotalDuration(summary?.total_duration_seconds ?? 0) },
    { label: "Total Prompt", value: formatTokenCount(promptTokens) },
    { label: "Total Completion", value: formatTokenCount(completionTokens) },
    { label: "Total Turns", value: String(summary?.turns ?? 0) },
    { label: "Avg Response", value: formatResponseTime(summary?.avg_response_ms) },
    { label: "Tool Calls", value: String(summary?.tool_calls ?? 0) },
    { label: "Sessions Synced", value: `${summary?.sessions_with_usage ?? 0} / ${summary?.sessions ?? 0}` },
    { label: "Avg Resolution", value: score === null || score === undefined ? "—" : `${score}%` },
  ];

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-lg font-semibold tracking-tight text-foreground">Executive Telemetry</h3>
        <div className="flex flex-wrap items-center gap-2">
          {onDaysChange ? (
            <Select value={String(days)} onValueChange={(val) => onDaysChange(Number(val))}>
              <SelectTrigger aria-label="Date range" className="h-9 w-[130px] sm:w-[140px]">
                <SelectValue placeholder="Date range" />
              </SelectTrigger>
              <SelectContent>
                {RANGE_OPTIONS.map((option) => (
                  <SelectItem key={option.days} value={String(option.days)}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <span className="text-xs text-muted-foreground">{rangeTitle(days)}</span>
          )}
          {stacks.length > 0 && onStackChange && (
            <Select value={selectedStack} onValueChange={onStackChange}>
              <SelectTrigger aria-label="Model select" className="h-9 w-[180px] sm:w-[200px]">
                <SelectValue placeholder="All models" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_STACKS}>All models</SelectItem>
                {stacks.map((stack) => (
                  <SelectItem key={stack.name} value={stack.name}>
                    {stack.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4 2xl:grid-cols-8">
        {tiles.map((tile) => (
          <AgentMetricTile key={tile.label} label={tile.label} value={tile.value} loading={loading} />
        ))}
      </div>
    </Card>
  );
}
