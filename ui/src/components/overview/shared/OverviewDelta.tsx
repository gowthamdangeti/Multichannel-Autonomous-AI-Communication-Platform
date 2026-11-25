import { TrendingDown, TrendingUp } from "lucide-react";

import { cn } from "@/lib/utils";

import { percentDelta } from "./format";

interface OverviewDeltaProps {
  current: number;
  previous: number | null | undefined;
  className?: string;
}

/** Change against the previous period, "New" when it started from zero, or nothing. */
export function OverviewDelta({ current, previous, className }: OverviewDeltaProps) {
  const delta = percentDelta(current, previous);
  if (delta === null) {
    if (current > 0 && previous === 0) {
      return <span className={cn("text-xs text-muted-foreground", className)}>New</span>;
    }
    return null;
  }
  const Icon = delta < 0 ? TrendingDown : TrendingUp;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 text-xs tabular-nums",
        delta < 0 ? "text-destructive" : "text-muted-foreground",
        className,
      )}
    >
      <Icon className="size-3" aria-hidden />
      {delta > 0 ? "+" : ""}
      {delta}%
    </span>
  );
}
