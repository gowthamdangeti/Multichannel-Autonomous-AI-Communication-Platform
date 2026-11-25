import { Target } from "lucide-react";

import type { AgentCount } from "@/client/types.gen";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { toFilterLabel } from "@/lib/searchFilter";

interface AgentResolutionCardProps {
  score?: number | null;
  verdicts: AgentCount[];
  outcomes: AgentCount[];
  loading: boolean;
  /** Heading of the outcomes panel; voice calls them "Call outcomes". */
  outcomesTitle?: string;
  /** Small line under the heading, e.g. how many conversations were scored. */
  note?: string | null;
  /** Stack the two panels in one column instead of side by side. */
  stacked?: boolean;
}

function CountBars({ title, rows }: { title: string; rows: AgentCount[] }) {
  const total = rows.reduce((sum, row) => sum + row.count, 0);
  return (
    <div className="min-w-0 rounded-lg border border-border bg-muted p-3">
      <p className="text-xs font-medium text-muted-foreground">{title}</p>
      {rows.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">No data yet</p>
      ) : (
        <ul className="mt-2 space-y-2">
          {rows.slice(0, 5).map((row) => (
            <li key={row.name}>
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="truncate text-foreground">{toFilterLabel(row.name)}</span>
                <span className="shrink-0 tabular-nums text-muted-foreground">{row.count}</span>
              </div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-border">
                <div className="h-full rounded-full bg-run-chart-1" style={{ width: `${(row.count / total) * 100}%` }} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function AgentResolutionCard({
  score,
  verdicts,
  outcomes,
  loading,
  outcomesTitle = "Call outcomes",
  note,
  stacked = false,
}: AgentResolutionCardProps) {
  return (
    <Card className="flex flex-col p-5">
      <div className="flex items-center justify-between gap-3">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <Target className="size-4 text-muted-foreground" />
          Resolution
        </h3>
        {!loading && (
          <span className="text-sm font-semibold tabular-nums text-foreground">
            {score === null || score === undefined ? "—" : `${score} / 100`}
          </span>
        )}
      </div>
      {note && !loading && <p className="mt-1 text-xs text-muted-foreground">{note}</p>}
      {loading ? (
        <Skeleton className="mt-4 h-56 w-full" />
      ) : (
        <div className={`mt-4 grid flex-1 grid-cols-1 gap-3 ${stacked ? "" : "sm:grid-cols-2"}`}>
          <CountBars title="Completeness verdicts" rows={verdicts} />
          <CountBars title={outcomesTitle} rows={outcomes} />
        </div>
      )}
    </Card>
  );
}
