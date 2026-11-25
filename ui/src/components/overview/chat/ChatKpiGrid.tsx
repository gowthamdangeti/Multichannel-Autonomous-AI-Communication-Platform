import type { ChatOverviewSummary } from "@/client/types.gen";
import { rangeComparison, rangePhrase } from "@/lib/dateRange";

import { deltaHeadline, fmtNumber, fmtPercent, percentDelta } from "../shared/format";
import { OverviewKpiCard } from "../shared/OverviewKpiCard";

interface ChatKpiGridProps {
  summary: ChatOverviewSummary | null;
  days: number;
  loading: boolean;
}

export function ChatKpiGrid({ summary, days, loading }: ChatKpiGridProps) {
  const conversations = summary?.conversations ?? 0;
  const hasPrevious = summary?.prev_conversations !== null && summary?.prev_conversations !== undefined;
  const delta = percentDelta(conversations, summary?.prev_conversations);
  const period = `Across ${rangePhrase(days)}`;

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <OverviewKpiCard
        label="Chat agents"
        value={summary?.active_agents ?? 0}
        headline={`${summary?.agents_with_conversations ?? 0} had conversations`}
        detail={period}
        loading={loading}
      />
      <OverviewKpiCard
        label="Conversations"
        value={fmtNumber(conversations)}
        delta={delta}
        headline={deltaHeadline(delta, hasPrevious)}
        detail={rangeComparison(days)}
        loading={loading}
      />
      <OverviewKpiCard
        label="Messages"
        value={fmtNumber(summary?.messages ?? 0)}
        headline={`${summary?.avg_messages_per_conversation ?? 0} per conversation on average`}
        detail={`${fmtNumber(summary?.visitor_messages ?? 0)} sent by visitors`}
        loading={loading}
      />
      <OverviewKpiCard
        label="Engaged rate"
        value={fmtPercent(summary?.engaged_rate)}
        headline="Visitor replied at least once"
        detail="The rest only saw the greeting"
        loading={loading}
      />
    </div>
  );
}
