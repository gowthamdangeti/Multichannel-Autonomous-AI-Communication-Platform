"use client";

import { useRouter } from "next/navigation";

import type { WhatsAppAgentRow } from "@/client/types.gen";
import { TableNameLink } from "@/components/layout/TableNameLink";
import { TableCell, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

import { fmtNumber, fmtRelative } from "../shared/format";
import { OverviewDelta } from "../shared/OverviewDelta";
import { OverviewShareBar } from "../shared/OverviewShareBar";
import { OverviewStatusBadge } from "../shared/OverviewStatusBadge";
import { numbersLabel, WHATSAPP_ACTIVITY, whatsappActivity, whatsappAgentHref } from "./whatsappData";

const CELL = "px-4 py-3";

export function WhatsAppAgentTableRow({ agent }: { agent: WhatsAppAgentRow }) {
  const router = useRouter();
  const href = whatsappAgentHref(agent);
  const status = WHATSAPP_ACTIVITY[whatsappActivity(agent)];

  return (
    <TableRow className="cursor-pointer" onClick={() => router.push(href)}>
      <TableCell className={`${CELL} max-w-64`}>
        <div className="min-w-0">
          <TableNameLink href={href} className="block truncate">{agent.name}</TableNameLink>
          <p className="truncate text-xs text-muted-foreground">{numbersLabel(agent)}</p>
        </div>
      </TableCell>
      <TableCell className={CELL}>
        <OverviewStatusBadge tone={status.tone} label={status.label} />
      </TableCell>
      <TableCell className={`${CELL} text-right`}>
        <div className="flex flex-col items-end">
          <span className="font-medium tabular-nums text-foreground">{fmtNumber(agent.new_contacts)}</span>
          <OverviewDelta current={agent.new_contacts} previous={agent.prev_new_contacts} />
        </div>
      </TableCell>
      <TableCell className={`${CELL} text-right tabular-nums`}>{fmtNumber(agent.active_contacts)}</TableCell>
      <TableCell className={`${CELL} hidden lg:table-cell`}>
        <OverviewShareBar share={agent.active_share} label={`${agent.name} share of active contacts`} />
      </TableCell>
      <TableCell
        className={cn(`${CELL} hidden text-right tabular-nums lg:table-cell`, agent.awaiting_reply > 0 && "font-medium text-destructive")}
      >
        {fmtNumber(agent.awaiting_reply)}
      </TableCell>
      <TableCell className={`${CELL} hidden text-right whitespace-nowrap text-muted-foreground lg:table-cell`}>
        <span title={agent.last_activity_at ? new Date(agent.last_activity_at).toLocaleString() : undefined}>
          {fmtRelative(agent.last_activity_at)}
        </span>
      </TableCell>
    </TableRow>
  );
}
