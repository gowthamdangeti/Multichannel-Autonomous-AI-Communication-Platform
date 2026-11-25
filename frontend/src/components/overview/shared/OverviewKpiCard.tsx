import { TrendingDown, TrendingUp } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

interface OverviewKpiCardProps {
  label: string;
  value: string | number;
  headline: string;
  detail: string;
  delta?: number | null;
  loading: boolean;
}

export function OverviewKpiCard({ label, value, headline, detail, delta, loading }: OverviewKpiCardProps) {
  if (loading) {
    return (
      <Card className="flex h-full flex-col gap-3 p-6">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-8 w-28" />
        <Skeleton className="mt-3 h-4 w-40" />
        <Skeleton className="h-4 w-32" />
      </Card>
    );
  }

  const hasDelta = delta !== null && delta !== undefined;
  const TrendIcon = hasDelta && delta < 0 ? TrendingDown : TrendingUp;

  return (
    <Card className="flex h-full flex-col gap-6 p-6">
      <div>
        <div className="flex items-start justify-between gap-2">
          <p className="text-sm text-muted-foreground">{label}</p>
          {hasDelta && (
            <Badge variant="outline" className="gap-1 tabular-nums">
              <TrendIcon className="size-3" />
              {delta > 0 ? "+" : ""}
              {delta}%
            </Badge>
          )}
        </div>
        <p className="mt-1 text-3xl font-semibold tracking-tight tabular-nums">{value}</p>
      </div>
      <div className="mt-auto text-sm">
        <p className="flex items-center gap-2 font-medium">
          {headline}
          {hasDelta && <TrendIcon className="size-4" />}
        </p>
        <p className="mt-1 text-muted-foreground">{detail}</p>
      </div>
    </Card>
  );
}
