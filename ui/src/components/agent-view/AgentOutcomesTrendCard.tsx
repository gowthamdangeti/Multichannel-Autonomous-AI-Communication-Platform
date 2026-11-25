"use client";

import { Bar, BarChart, CartesianGrid, Tooltip, XAxis, YAxis } from "recharts";

import type { AgentCount, AgentDailyTrend } from "@/client/types.gen";
import { fmtDate } from "@/components/charts/DashboardCharts";
import { toFilterLabel } from "@/lib/searchFilter";

import { toOutcomeRows, toOutcomeSeries } from "./agentAnalyticsTrends";
import { AgentChartCard, AgentChartTooltip, AgentLegendItem, AXIS_TICK } from "./AgentChartCard";

const SERIES_COLORS = [1, 2, 3, 4, 5].map((n) => `var(--chart-palette-${n})`);

// Failures read as failures in any position in the list.
function outcomeColor(name: string, index: number): string {
  return /error|fail/i.test(name) ? "var(--destructive)" : SERIES_COLORS[index % SERIES_COLORS.length];
}

interface AgentOutcomesTrendCardProps {
  trends: AgentDailyTrend[];
  outcomes: AgentCount[];
  loading: boolean;
}

export function AgentOutcomesTrendCard({ trends, outcomes, loading }: AgentOutcomesTrendCardProps) {
  const series = toOutcomeSeries(outcomes);
  const rows = toOutcomeRows(trends, series);

  return (
    <AgentChartCard
      title="Outcomes over time"
      subtitle="How calls ended, per day"
      loading={loading}
      isEmpty={series.length === 0}
      emptyLabel="No call outcomes in this period"
      legend={series.map((name, index) => (
        <AgentLegendItem key={name} color={outcomeColor(name, index)} label={toFilterLabel(name)} />
      ))}
    >
      <BarChart data={rows} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
        <XAxis
          dataKey="date"
          tickFormatter={fmtDate}
          tick={AXIS_TICK}
          axisLine={false}
          tickLine={false}
          minTickGap={32}
          tickMargin={8}
        />
        <YAxis width={32} allowDecimals={false} tick={AXIS_TICK} axisLine={false} tickLine={false} />
        <Tooltip
          cursor={{ fill: "var(--muted)", fillOpacity: 0.5 }}
          content={
            <AgentChartTooltip
              formatLabel={(value) => fmtDate(String(value))}
              formatValue={(value, name) => `${toFilterLabel(name)}: ${value}`}
            />
          }
        />
        {series.map((name, index) => (
          <Bar isAnimationActive={false} key={name} dataKey={name} name={name} stackId="outcomes" fill={outcomeColor(name, index)} maxBarSize={32} />
        ))}
      </BarChart>
    </AgentChartCard>
  );
}
