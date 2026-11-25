"use client";

import { Bar, BarChart, CartesianGrid, Tooltip, XAxis, YAxis } from "recharts";

import type { AgentHourCount, AgentWeekdayCount } from "@/client/types.gen";

import { formatHour } from "./agentAnalyticsTrends";
import { AgentChartCard, AgentChartTooltip, AXIS_TICK } from "./AgentChartCard";

interface BusyChartProps<Row> {
  title: string;
  subtitle: string;
  summary: string;
  rows: Row[];
  dataKey: Extract<keyof Row, string>;
  color: string;
  loading: boolean;
  formatLabel?: (value: string | number) => string;
}

function BusyChart<Row extends { conversations: number }>({
  title,
  subtitle,
  summary,
  rows,
  dataKey,
  color,
  loading,
  formatLabel,
}: BusyChartProps<Row>) {
  return (
    <AgentChartCard
      title={title}
      subtitle={subtitle}
      summary={summary}
      loading={loading}
      isEmpty={!rows.some((row) => row.conversations > 0)}
      emptyLabel="No calls in this period"
    >
      <BarChart data={rows} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
        <XAxis
          dataKey={dataKey}
          tickFormatter={formatLabel}
          tick={AXIS_TICK}
          axisLine={false}
          tickLine={false}
          minTickGap={16}
          tickMargin={8}
        />
        <YAxis width={32} allowDecimals={false} tick={AXIS_TICK} axisLine={false} tickLine={false} />
        <Tooltip
          cursor={{ fill: "var(--muted)", fillOpacity: 0.5 }}
          content={<AgentChartTooltip formatLabel={formatLabel} formatValue={(value) => `${value} calls`} />}
        />
        <Bar isAnimationActive={false} dataKey="conversations" name="Calls" fill={color} radius={[3, 3, 0, 0]} maxBarSize={32} />
      </BarChart>
    </AgentChartCard>
  );
}

function busiest<Row extends { conversations: number }>(rows: Row[]): Row | null {
  const top = rows.reduce<Row | null>((best, row) => (!best || row.conversations > best.conversations ? row : best), null);
  return top && top.conversations > 0 ? top : null;
}

export function AgentBusyHoursCard({ hours, loading }: { hours: AgentHourCount[]; loading: boolean }) {
  const top = busiest(hours);
  return (
    <BusyChart
      title="Busiest hours"
      subtitle="Calls by hour, in your local time"
      summary={top ? `Peak ${formatHour(top.hour)}` : "—"}
      rows={hours}
      dataKey="hour"
      color="var(--run-chart-1)"
      loading={loading}
      formatLabel={(value) => formatHour(Number(value))}
    />
  );
}

export function AgentBusyDaysCard({ weekdays, loading }: { weekdays: AgentWeekdayCount[]; loading: boolean }) {
  const top = busiest(weekdays);
  return (
    <BusyChart
      title="Busiest days"
      subtitle="Calls by day of the week"
      summary={top ? `Peak ${top.day}` : "—"}
      rows={weekdays}
      dataKey="day"
      color="var(--run-chart-2)"
      loading={loading}
    />
  );
}
