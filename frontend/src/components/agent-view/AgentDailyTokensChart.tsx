"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import type { AgentDailyTokens } from "@/client/types.gen";
import { fmtDate } from "@/components/charts/DashboardCharts";
import { Skeleton } from "@/components/ui/skeleton";

import { formatTokenCount } from "./agentAnalyticsFormat";

const CHART_HEIGHT = 240;

interface DailyTooltipProps {
  active?: boolean;
  payload?: Array<{ payload: AgentDailyTokens }>;
}

function DailyTooltip({ active, payload }: DailyTooltipProps) {
  const row = payload?.[0]?.payload;
  if (!active || !row) return null;
  return (
    <div className="rounded-lg border border-border bg-popover px-3 py-2 text-sm text-popover-foreground">
      <p className="font-medium">{fmtDate(row.date)}</p>
      <p className="text-muted-foreground">Prompt: {row.prompt_tokens.toLocaleString()}</p>
      <p className="text-muted-foreground">Completion: {row.completion_tokens.toLocaleString()}</p>
      <p className="text-muted-foreground">{row.conversations} conversations</p>
    </div>
  );
}

export function AgentDailyTokensChart({ daily, loading }: { daily: AgentDailyTokens[]; loading: boolean }) {
  const isEmpty = !daily.some((row) => row.prompt_tokens + row.completion_tokens > 0);

  return (
    <div className="rounded-lg border border-border bg-muted p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold text-foreground">Daily Tokens</p>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <span className="size-2.5 rounded-xs bg-run-chart-1" /> Prompt
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="size-2.5 rounded-xs bg-run-chart-2" /> Completion
          </span>
        </div>
      </div>
      <div className="mt-3">
        {loading ? (
          <Skeleton className="w-full" style={{ height: CHART_HEIGHT }} />
        ) : isEmpty ? (
          <div className="flex items-center justify-center text-sm text-muted-foreground" style={{ height: CHART_HEIGHT }}>
            No token usage in this period
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
            <BarChart data={daily} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
              <XAxis
                dataKey="date"
                tickFormatter={fmtDate}
                tick={{ fontSize: 12, fill: "var(--muted-foreground)" }}
                axisLine={false}
                tickLine={false}
                minTickGap={32}
                tickMargin={8}
              />
              <YAxis
                width={48}
                tickFormatter={formatTokenCount}
                tick={{ fontSize: 12, fill: "var(--muted-foreground)" }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip content={<DailyTooltip />} cursor={{ fill: "var(--muted)", fillOpacity: 0.5 }} />
              <Bar isAnimationActive={false} dataKey="prompt_tokens" stackId="tokens" fill="var(--run-chart-1)" maxBarSize={32} />
              <Bar isAnimationActive={false} dataKey="completion_tokens" stackId="tokens" fill="var(--run-chart-2)" radius={[3, 3, 0, 0]} maxBarSize={32} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
