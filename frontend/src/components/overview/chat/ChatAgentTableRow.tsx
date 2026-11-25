"use client";

import { useRouter } from "next/navigation";

import type { ChatAgentRow } from "@/client/types.gen";
import { TableNameLink } from "@/components/layout/TableNameLink";
import { TableCell, TableRow } from "@/components/ui/table";

import { fmtNumber, fmtPercent, fmtRelative } from "../shared/format";
import { OverviewDelta } from "../shared/OverviewDelta";
import { OverviewShareBar } from "../shared/OverviewShareBar";
import { OverviewStatusBadge } from "../shared/OverviewStatusBadge";
import { CHAT_ACTIVITY, CHAT_AGENTS_HREF, chatActivity, websiteLabel } from "./chatData";

const CELL = "px-4 py-3";

export function ChatAgentTableRow({ agent }: { agent: ChatAgentRow }) {
  const router = useRouter();
  const hasChats = agent.conversations > 0;
  const status = CHAT_ACTIVITY[chatActivity(agent)];

  return (
    <TableRow className="cursor-pointer" onClick={() => router.push(CHAT_AGENTS_HREF)}>
      <TableCell className={`${CELL} max-w-64`}>
        <div className="min-w-0">
          <TableNameLink href={CHAT_AGENTS_HREF} className="block truncate">{agent.name}</TableNameLink>
          <p className="truncate text-xs text-muted-foreground">
            {agent.top_website ? websiteLabel(agent.top_website) : "No website yet"}
          </p>
        </div>
      </TableCell>
      <TableCell className={CELL}>
        <OverviewStatusBadge tone={status.tone} label={status.label} />
      </TableCell>
      <TableCell className={`${CELL} text-right`}>
        <div className="flex flex-col items-end">
          <span className="font-medium tabular-nums text-foreground">{fmtNumber(agent.conversations)}</span>
          <OverviewDelta current={agent.conversations} previous={agent.prev_conversations} />
        </div>
      </TableCell>
      <TableCell className={`${CELL} hidden lg:table-cell`}>
        <OverviewShareBar share={agent.conversation_share} label={`${agent.name} share of conversations`} />
      </TableCell>
      <TableCell className={`${CELL} hidden text-right tabular-nums lg:table-cell`}>{fmtNumber(agent.messages)}</TableCell>
      <TableCell className={`${CELL} hidden text-right tabular-nums xl:table-cell`}>
        {hasChats ? agent.avg_messages_per_conversation : "—"}
      </TableCell>
      <TableCell className={`${CELL} text-right tabular-nums`}>{fmtPercent(agent.engaged_rate)}</TableCell>
      <TableCell className={`${CELL} hidden text-right whitespace-nowrap text-muted-foreground lg:table-cell`}>
        <span title={agent.last_activity_at ? new Date(agent.last_activity_at).toLocaleString() : undefined}>
          {fmtRelative(agent.last_activity_at)}
        </span>
      </TableCell>
    </TableRow>
  );
}
