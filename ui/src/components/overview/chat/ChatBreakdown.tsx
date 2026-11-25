"use client";

import { useMemo } from "react";

import type { ChatAgentOverviewResponse } from "@/client/types.gen";
import { HorizontalBarChart, PieBreakdownChart } from "@/components/charts/DashboardCharts";

import { mergeCounts } from "../shared/format";
import { toLengthBands, websiteLabel } from "./chatData";

interface ChatBreakdownProps {
  overview: ChatAgentOverviewResponse | null;
  loading: boolean;
}

export function ChatBreakdown({ overview, loading }: ChatBreakdownProps) {
  const { websites, lengths } = useMemo(
    () => ({
      websites: mergeCounts(overview?.websites ?? [], (w) => websiteLabel(w.key), (w) => w.count),
      lengths: toLengthBands(overview?.lengths ?? []),
    }),
    [overview],
  );
  const hasLengths = lengths.some((band) => band.calls > 0);

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <PieBreakdownChart data={websites} title="Websites" subtitle="Where visitors started the chat" loading={loading} donut unit="conversations" />
      <HorizontalBarChart
        data={hasLengths ? lengths : []}
        title="Conversation length"
        subtitle="How many messages each visitor sent"
        loading={loading}
        unit="conversations"
      />
    </div>
  );
}
