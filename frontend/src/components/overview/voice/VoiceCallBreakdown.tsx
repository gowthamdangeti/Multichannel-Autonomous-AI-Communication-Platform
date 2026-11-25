"use client";

import { useMemo } from "react";

import type { VoiceAgentOverviewResponse } from "@/client/types.gen";
import { HorizontalBarChart, PieBreakdownChart, RadialBreakdownChart } from "@/components/charts/DashboardCharts";

import { mergeCounts, titleCase } from "../shared/format";
import { channelLabel, stateLabel } from "./voiceData";

interface VoiceCallBreakdownProps {
  overview: VoiceAgentOverviewResponse | null;
  loading: boolean;
}

export function VoiceCallBreakdown({ overview, loading }: VoiceCallBreakdownProps) {
  const { channels, outcomes, states } = useMemo(
    () => ({
      channels: mergeCounts(overview?.channels ?? [], (c) => channelLabel(c.key), (c) => c.calls),
      outcomes: mergeCounts(overview?.outcomes ?? [], (o) => titleCase(o.key), (o) => o.calls).map((o) => ({
        name: o.name,
        calls: o.count,
      })),
      states: mergeCounts(overview?.states ?? [], (s) => stateLabel(s.key), (s) => s.calls),
    }),
    [overview],
  );

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <PieBreakdownChart data={channels} title="Channel mix" subtitle="Web calls and each telephony provider" loading={loading} donut />
      <HorizontalBarChart data={outcomes} title="Call outcomes" subtitle="Disposition the agent recorded" loading={loading} />
      <RadialBreakdownChart data={states} title="How calls ended" subtitle="Completed, in progress or never connected" loading={loading} />
    </div>
  );
}
