import Link from "next/link";

import type { ChatAgentRow } from "@/client/types.gen";

import { fmtNumber, fmtPercent, fmtRelative } from "../shared/format";
import { OverviewDelta } from "../shared/OverviewDelta";
import { OverviewStatusBadge } from "../shared/OverviewStatusBadge";
import { CHAT_ACTIVITY, CHAT_AGENTS_HREF, chatActivity, websiteLabel } from "./chatData";

/** Phone layout of one roster row: the whole card opens the chat agents page. */
export function ChatAgentCard({ agent }: { agent: ChatAgentRow }) {
  const status = CHAT_ACTIVITY[chatActivity(agent)];
  const stats = [
    { label: "Chats", value: fmtNumber(agent.conversations) },
    { label: "Messages", value: fmtNumber(agent.messages) },
    { label: "Engaged", value: fmtPercent(agent.engaged_rate) },
  ];

  return (
    <li>
      <Link
        href={CHAT_AGENTS_HREF}
        className="flex min-h-11 flex-col gap-3 p-4 transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate font-semibold text-foreground">{agent.name}</p>
            <p className="truncate text-xs text-muted-foreground">
              {agent.top_website ? websiteLabel(agent.top_website) : "No website yet"} · Last chat{" "}
              {fmtRelative(agent.last_activity_at).toLowerCase()}
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
        <OverviewDelta current={agent.conversations} previous={agent.prev_conversations} />
      </Link>
    </li>
  );
}
