import Link from "next/link";

import type { WhatsAppAgentRow } from "@/client/types.gen";

import { fmtNumber, fmtRelative } from "../shared/format";
import { OverviewDelta } from "../shared/OverviewDelta";
import { OverviewStatusBadge } from "../shared/OverviewStatusBadge";
import { numbersLabel, WHATSAPP_ACTIVITY, whatsappActivity, whatsappAgentHref } from "./whatsappData";

/** Phone layout of one roster row: the whole card opens the agent. */
export function WhatsAppAgentCard({ agent }: { agent: WhatsAppAgentRow }) {
  const status = WHATSAPP_ACTIVITY[whatsappActivity(agent)];
  const stats = [
    { label: "New", value: fmtNumber(agent.new_contacts) },
    { label: "Active", value: fmtNumber(agent.active_contacts) },
    { label: "Awaiting", value: fmtNumber(agent.awaiting_reply) },
  ];

  return (
    <li>
      <Link
        href={whatsappAgentHref(agent)}
        className="flex min-h-11 flex-col gap-3 p-4 transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate font-semibold text-foreground">{agent.name}</p>
            <p className="truncate text-xs text-muted-foreground">
              {numbersLabel(agent)} · Last message {fmtRelative(agent.last_activity_at).toLowerCase()}
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
        <OverviewDelta current={agent.new_contacts} previous={agent.prev_new_contacts} />
      </Link>
    </li>
  );
}
