"use client";

import { useMemo } from "react";

import { ChannelRadarChart, HourlyBarChart } from "@/components/charts/DashboardCharts";

interface OverviewTimingProps {
  hourly: Array<{ hour: number; count: number }>;
  weekday: Array<{ day: string; count: number }>;
  /** Plural noun in tooltips, e.g. "calls" or "conversations". */
  unit: string;
  loading: boolean;
}

export function OverviewTiming({ hourly, weekday, unit, loading }: OverviewTimingProps) {
  const hours = useMemo(() => hourly.map((h) => ({ hour: h.hour, calls: h.count })), [hourly]);
  const days = useMemo(() => weekday.map((w) => ({ name: w.day, count: w.count })), [weekday]);

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <div className="lg:col-span-2">
        <HourlyBarChart data={hours} title="By hour of day" subtitle="Hours shown in UTC" loading={loading} unit={unit} />
      </div>
      <ChannelRadarChart data={days} title="By weekday" subtitle="Which days keep your agents busy" loading={loading} unit={unit} />
    </div>
  );
}
