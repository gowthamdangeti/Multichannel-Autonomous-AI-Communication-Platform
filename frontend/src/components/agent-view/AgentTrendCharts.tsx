"use client";

import { Bar, CartesianGrid, ComposedChart, Line, LineChart, Tooltip, XAxis, YAxis } from "recharts";

import type { AgentDailyTrend } from "@/client/types.gen";
import { fmtDate, fmtDuration } from "@/components/charts/DashboardCharts";

import { formatResponseTime } from "./agentAnalyticsFormat";
import { type CacheRow, toCacheRows } from "./agentAnalyticsTrends";
import { AgentChartCard, AgentChartTooltip, AgentLegendItem, AXIS_TICK } from "./AgentChartCard";

interface TrendChartProps {
  trends: AgentDailyTrend[];
  loading: boolean;
}

const formatDateLabel = (value: string | number) => fmtDate(String(value));

const DATE_AXIS = {
  dataKey: "date",
  tickFormatter: fmtDate,
  tick: AXIS_TICK,
  axisLine: false,
  tickLine: false,
  minTickGap: 32,
  tickMargin: 8,
};

export function AgentCallsTrendCard({ trends, loading }: TrendChartProps) {
  const isEmpty = !trends.some((row) => row.conversations > 0);

  return (
    <AgentChartCard
      title="Calls and duration"
      subtitle="Calls per day and their average length"
      loading={loading}
      isEmpty={isEmpty}
      emptyLabel="No calls in this period"
      legend={
        <>
          <AgentLegendItem color="var(--run-chart-1)" label="Calls" />
          <AgentLegendItem color="var(--run-chart-2)" label="Avg duration" />
        </>
      }
    >
      <ComposedChart data={trends} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
        <XAxis {...DATE_AXIS} />
        <YAxis yAxisId="calls" width={32} allowDecimals={false} tick={AXIS_TICK} axisLine={false} tickLine={false} />
        <YAxis
          yAxisId="duration"
          orientation="right"
          width={40}
          tickFormatter={(seconds: number) => `${Math.round(seconds / 60)}m`}
          tick={AXIS_TICK}
          axisLine={false}
          tickLine={false}
        />
        <Tooltip
          cursor={{ fill: "var(--muted)", fillOpacity: 0.5 }}
          content={
            <AgentChartTooltip
              formatLabel={formatDateLabel}
              formatValue={(value, name) => (name === "Calls" ? `${value} calls` : `${fmtDuration(value)} avg`)}
            />
          }
        />
        <Bar isAnimationActive={false} yAxisId="calls" dataKey="conversations" name="Calls" fill="var(--run-chart-1)" radius={[3, 3, 0, 0]} maxBarSize={32} />
        <Line isAnimationActive={false}
          yAxisId="duration"
          dataKey="avg_duration_seconds"
          name="Avg duration"
          stroke="var(--run-chart-2)"
          strokeWidth={2}
          dot={{ r: 3, fill: "var(--run-chart-2)" }}
          connectNulls
        />
      </ComposedChart>
    </AgentChartCard>
  );
}

interface LineTrendCardProps<Row> {
  title: string;
  subtitle: string;
  summary: string;
  emptyLabel: string;
  rows: Row[];
  dataKey: Extract<keyof Row, string>;
  seriesName: string;
  color: string;
  loading: boolean;
  domain?: [number, number];
  formatValue: (value: number) => string;
}

function LineTrendCard<Row extends { date: string }>({
  title,
  subtitle,
  summary,
  emptyLabel,
  rows,
  dataKey,
  seriesName,
  color,
  loading,
  domain,
  formatValue,
}: LineTrendCardProps<Row>) {
  const isEmpty = !rows.some((row) => row[dataKey] !== null);

  return (
    <AgentChartCard
      title={title}
      subtitle={subtitle}
      summary={summary}
      loading={loading}
      isEmpty={isEmpty}
      emptyLabel={emptyLabel}
    >
      <LineChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
        <XAxis {...DATE_AXIS} />
        <YAxis
          width={52}
          domain={domain}
          tickFormatter={formatValue}
          tick={AXIS_TICK}
          axisLine={false}
          tickLine={false}
        />
        <Tooltip
          cursor={{ stroke: "var(--border)" }}
          content={<AgentChartTooltip formatLabel={formatDateLabel} formatValue={formatValue} />}
        />
        <Line isAnimationActive={false} dataKey={dataKey} name={seriesName} stroke={color} strokeWidth={2} dot={{ r: 3, fill: color }} connectNulls />
      </LineChart>
    </AgentChartCard>
  );
}

interface SummaryTrendProps extends TrendChartProps {
  summary: string;
}

export function AgentResponseTrendCard({ trends, loading, summary }: SummaryTrendProps) {
  return (
    <LineTrendCard
      title="Response time trend"
      subtitle="Average time for the agent to respond, per day"
      summary={summary}
      emptyLabel="No response times in this period"
      rows={trends}
      dataKey="avg_response_ms"
      seriesName="Avg response"
      color="var(--run-chart-3)"
      loading={loading}
      formatValue={formatResponseTime}
    />
  );
}

export function AgentResolutionTrendCard({ trends, loading, summary }: SummaryTrendProps) {
  return (
    <LineTrendCard
      title="Resolution trend"
      subtitle="Average completeness score, per day"
      summary={summary}
      emptyLabel="No scored conversations in this period"
      rows={trends}
      dataKey="avg_resolution_score"
      seriesName="Score"
      color="var(--run-chart-2)"
      loading={loading}
      domain={[0, 100]}
      formatValue={(value) => `${value}%`}
    />
  );
}

export function AgentCacheTrendCard({ trends, loading, summary }: SummaryTrendProps) {
  const rows: CacheRow[] = toCacheRows(trends);

  return (
    <LineTrendCard
      title="Cache use"
      subtitle="Share of prompt tokens served from cache, per day"
      summary={summary}
      emptyLabel="No prompt tokens in this period"
      rows={rows}
      dataKey="cacheRate"
      seriesName="Cache rate"
      color="var(--run-chart-1)"
      loading={loading}
      domain={[0, 100]}
      formatValue={(value) => `${value}%`}
    />
  );
}
