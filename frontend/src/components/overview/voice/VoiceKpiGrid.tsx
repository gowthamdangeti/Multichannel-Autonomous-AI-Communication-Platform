import type { VoiceOverviewSummary } from "@/client/types.gen";
import { fmtDuration } from "@/components/charts/DashboardCharts";
import { rangeComparison, rangePhrase } from "@/lib/dateRange";

import { deltaHeadline, fmtMinutes, fmtNumber, fmtPercent, percentDelta } from "../shared/format";
import { OverviewKpiCard } from "../shared/OverviewKpiCard";

interface VoiceKpiGridProps {
  summary: VoiceOverviewSummary | null;
  days: number;
  loading: boolean;
}

export function VoiceKpiGrid({ summary, days, loading }: VoiceKpiGridProps) {
  const calls = summary?.calls ?? 0;
  const hasPrevious = summary?.prev_calls !== null && summary?.prev_calls !== undefined;
  const delta = percentDelta(calls, summary?.prev_calls);
  const period = `Across ${rangePhrase(days)}`;

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <OverviewKpiCard
        label="Voice agents"
        value={summary?.active_agents ?? 0}
        headline={`${summary?.agents_with_calls ?? 0} took calls`}
        detail={period}
        loading={loading}
      />
      <OverviewKpiCard
        label="Calls handled"
        value={fmtNumber(calls)}
        delta={delta}
        headline={deltaHeadline(delta, hasPrevious)}
        detail={rangeComparison(days)}
        loading={loading}
      />
      <OverviewKpiCard
        label="Talk time"
        value={fmtMinutes(summary?.total_minutes ?? 0)}
        headline={`${fmtDuration(summary?.avg_duration_seconds ?? 0)} per call on average`}
        detail={period}
        loading={loading}
      />
      <OverviewKpiCard
        label="Completion rate"
        value={fmtPercent(summary?.completion_rate)}
        headline={`${fmtNumber(summary?.inbound_calls ?? 0)} inbound · ${fmtNumber(summary?.outbound_calls ?? 0)} outbound`}
        detail="Calls that reached the end of the conversation"
        loading={loading}
      />
    </div>
  );
}
