"use client";

import { useRouter } from "next/navigation";

import type { VoiceAgentRow } from "@/client/types.gen";
import { fmtDuration } from "@/components/charts/DashboardCharts";
import { TableNameLink } from "@/components/layout/TableNameLink";
import { TableCell, TableRow } from "@/components/ui/table";

import { fmtMinutes, fmtNumber, fmtPercent, fmtRelative } from "../shared/format";
import { OverviewDelta } from "../shared/OverviewDelta";
import { OverviewShareBar } from "../shared/OverviewShareBar";
import { OverviewStatusBadge } from "../shared/OverviewStatusBadge";
import { channelLabel, VOICE_ACTIVITY, voiceActivity, voiceAgentHref } from "./voiceData";

const CELL = "px-4 py-3";

export function VoiceAgentTableRow({ agent }: { agent: VoiceAgentRow }) {
  const router = useRouter();
  const href = voiceAgentHref(agent);
  const hasCalls = agent.calls > 0;
  const status = VOICE_ACTIVITY[voiceActivity(agent)];

  return (
    <TableRow className="cursor-pointer" onClick={() => router.push(href)}>
      <TableCell className={`${CELL} max-w-64`}>
        <div className="min-w-0">
          <TableNameLink href={href} className="block truncate">{agent.name}</TableNameLink>
          <p className="truncate text-xs text-muted-foreground">
            {agent.folder_name ?? "Uncategorized"}
            {agent.top_channel && ` · ${channelLabel(agent.top_channel)}`}
          </p>
        </div>
      </TableCell>
      <TableCell className={CELL}>
        <OverviewStatusBadge tone={status.tone} label={status.label} />
      </TableCell>
      <TableCell className={`${CELL} text-right`}>
        <div className="flex flex-col items-end">
          <span className="font-medium tabular-nums text-foreground">{fmtNumber(agent.calls)}</span>
          <OverviewDelta current={agent.calls} previous={agent.prev_calls} />
        </div>
      </TableCell>
      <TableCell className={`${CELL} hidden lg:table-cell`}>
        <OverviewShareBar share={agent.call_share} label={`${agent.name} share of calls`} />
      </TableCell>
      <TableCell className={`${CELL} hidden text-right tabular-nums lg:table-cell`}>
        {hasCalls ? fmtMinutes(agent.total_minutes) : "—"}
      </TableCell>
      <TableCell className={`${CELL} hidden text-right tabular-nums xl:table-cell`}>
        {hasCalls ? fmtDuration(agent.avg_duration_seconds) : "—"}
      </TableCell>
      <TableCell className={`${CELL} text-right tabular-nums`}>{fmtPercent(agent.completion_rate)}</TableCell>
      <TableCell className={`${CELL} hidden text-right tabular-nums text-muted-foreground xl:table-cell`}>
        {hasCalls ? `${fmtNumber(agent.inbound_calls)} / ${fmtNumber(agent.outbound_calls)}` : "—"}
      </TableCell>
      <TableCell className={`${CELL} hidden text-right whitespace-nowrap text-muted-foreground lg:table-cell`}>
        <span title={agent.last_call_at ? new Date(agent.last_call_at).toLocaleString() : undefined}>
          {fmtRelative(agent.last_call_at)}
        </span>
      </TableCell>
    </TableRow>
  );
}
