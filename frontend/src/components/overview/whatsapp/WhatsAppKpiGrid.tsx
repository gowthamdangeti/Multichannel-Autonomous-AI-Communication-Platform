import type { WhatsAppOverviewSummary } from "@/client/types.gen";
import { rangeComparison, rangePhrase } from "@/lib/dateRange";

import { deltaHeadline, fmtNumber, percentDelta } from "../shared/format";
import { OverviewKpiCard } from "../shared/OverviewKpiCard";

interface WhatsAppKpiGridProps {
  summary: WhatsAppOverviewSummary | null;
  days: number;
  loading: boolean;
}

export function WhatsAppKpiGrid({ summary, days, loading }: WhatsAppKpiGridProps) {
  const newContacts = summary?.new_contacts ?? 0;
  const hasPrevious = summary?.prev_new_contacts !== null && summary?.prev_new_contacts !== undefined;
  const delta = percentDelta(newContacts, summary?.prev_new_contacts);
  const period = `Across ${rangePhrase(days)}`;
  const unassigned = summary?.unassigned_active_contacts ?? 0;

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <OverviewKpiCard
        label="WhatsApp agents"
        value={summary?.active_agents ?? 0}
        headline={`${summary?.connected_numbers ?? 0} of ${summary?.numbers ?? 0} numbers connected`}
        detail={`${summary?.agents_with_contacts ?? 0} agents chatted ${rangePhrase(days)}`}
        loading={loading}
      />
      <OverviewKpiCard
        label="New contacts"
        value={fmtNumber(newContacts)}
        delta={delta}
        headline={deltaHeadline(delta, hasPrevious)}
        detail={rangeComparison(days)}
        loading={loading}
      />
      <OverviewKpiCard
        label="Contacts active"
        value={fmtNumber(summary?.active_contacts ?? 0)}
        headline="Last message in this period"
        detail={unassigned > 0 ? `${fmtNumber(unassigned)} on numbers with no agent` : period}
        loading={loading}
      />
      <OverviewKpiCard
        label="Awaiting reply"
        value={fmtNumber(summary?.awaiting_reply ?? 0)}
        headline="Contact sent the last message"
        detail="The agent hasn't answered yet"
        loading={loading}
      />
    </div>
  );
}
