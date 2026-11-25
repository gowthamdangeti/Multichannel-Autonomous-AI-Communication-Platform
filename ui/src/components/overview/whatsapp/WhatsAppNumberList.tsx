import type { WhatsAppNumberRow } from "@/client/types.gen";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

import { fmtNumber } from "../shared/format";
import { OverviewStatusBadge } from "../shared/OverviewStatusBadge";
import { numberStatusLabel } from "./whatsappData";

interface WhatsAppNumberListProps {
  numbers: WhatsAppNumberRow[];
  loading: boolean;
}

/** Each connected number, the agent answering it, and how busy it is. */
export function WhatsAppNumberList({ numbers, loading }: WhatsAppNumberListProps) {
  return (
    <Card className="h-full gap-0 overflow-hidden p-0">
      <CardHeader className="space-y-1 px-5 pt-5 pb-3">
        <CardTitle className="text-sm font-semibold text-foreground">Numbers</CardTitle>
        <CardDescription className="text-xs">Active contacts on each number in this period</CardDescription>
      </CardHeader>
      {loading ? (
        <div className="flex flex-col gap-2 px-5 pb-5">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : numbers.length === 0 ? (
        <p className="px-5 pb-5 text-sm text-muted-foreground">No WhatsApp numbers connected yet.</p>
      ) : (
        <ul className="divide-y divide-border border-t border-border">
          {numbers.map((number) => (
            <li key={number.id} className="flex items-center justify-between gap-3 px-5 py-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-foreground">{number.name}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {number.phone_number ?? "Number not linked"} · {number.agent_name ?? "No agent assigned"}
                </p>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                <OverviewStatusBadge
                  tone={number.status === "connected" ? "on" : "off"}
                  label={numberStatusLabel(number.status)}
                />
                <span className="text-xs tabular-nums text-muted-foreground">
                  {fmtNumber(number.active_contacts)} active · {fmtNumber(number.awaiting_reply)} awaiting
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
