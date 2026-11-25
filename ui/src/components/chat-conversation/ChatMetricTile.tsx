"use client";

import { cn } from "@/lib/utils";

interface ChatMetricTileProps {
  label: string;
  value: string | number;
  className?: string;
}

/** One labelled figure in a metric grid. */
export function ChatMetricTile({ label, value, className }: ChatMetricTileProps) {
  return (
    <div className={cn("space-y-1 rounded-lg border border-border bg-muted p-3", className)}>
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="font-mono text-xl font-bold text-foreground">{value}</p>
    </div>
  );
}
