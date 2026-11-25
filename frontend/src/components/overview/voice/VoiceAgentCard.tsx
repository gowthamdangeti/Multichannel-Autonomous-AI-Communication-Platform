import Link from "next/link";

import type { VoiceAgentRow } from "@/client/types.gen";
import { fmtDuration } from "@/components/charts/DashboardCharts";

import { fmtNumber, fmtPercent, fmtRelative } from "../shared/format";
import { OverviewDelta } from "../shared/OverviewDelta";
import { OverviewStatusBadge } from "../shared/OverviewStatusBadge";
import { VOICE_ACTIVITY, voiceActivity, voiceAgentHref } from "./voiceData";

/** Phone layout of one roster row: the whole card opens the agent. */
export function VoiceAgentCard({ agent }: { agent: VoiceAgentRow }) {
  const hasCalls = agent.calls > 0;
  const status = VOICE_ACTIVITY[voiceActivity(agent)];
  const stats = [
    { label: "Calls", value: fmtNumber(agent.calls) },
    { label: "Avg length", value: hasCalls ? fmtDuration(agent.avg_duration_seconds) : "—" },
    { label: "Completed", value: fmtPercent(agent.completion_rate) },
  ];

  return (
    <li>
      <Link
        href={voiceAgentHref(agent)}
        className="flex min-h-11 flex-col gap-3 p-4 transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate font-semibold text-foreground">{agent.name}</p>
            <p className="truncate text-xs text-muted-foreground">
              {agent.folder_name ?? "Uncategorized"} · Last call {fmtRelative(agent.last_call_at).toLowerCase()}
            </p>
          </div>
          <OverviewStatusBadge tone={status.tone} label={status.label} />
        </div>
        <dl className="grid grid-cols-3 gap-2 text-sm">
          {stats.map((stat) => (
            <div key={stat.label} className="min-w-0">
              <dt className="text-xs text-muted-foreground">{stat.label}</dt>
              <dd className="font-medium tabular-nums text-foreground">{stat.value}</dd>
            </div>
          ))}
        </dl>
        <OverviewDelta current={agent.calls} previous={agent.prev_calls} />
      </Link>
    </li>
  );
}
