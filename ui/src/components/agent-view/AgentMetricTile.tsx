import { Skeleton } from "@/components/ui/skeleton";

interface AgentMetricTileProps {
  label: string;
  value: string;
  detail?: string;
  loading: boolean;
}

export function AgentMetricTile({ label, value, detail, loading }: AgentMetricTileProps) {
  return (
    <div className="min-w-0 rounded-lg border border-border bg-muted p-3">
      <p className="truncate text-xs font-medium text-muted-foreground">{label}</p>
      {loading ? (
        <Skeleton className="mt-2 h-6 w-16" />
      ) : (
        <p className="mt-1 text-xl font-semibold tracking-tight tabular-nums text-foreground">{value}</p>
      )}
      {detail && !loading && <p className="mt-1 truncate text-xs text-muted-foreground">{detail}</p>}
    </div>
  );
}
