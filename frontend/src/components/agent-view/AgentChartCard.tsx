import type { ReactElement, ReactNode } from "react";
import { ResponsiveContainer } from "recharts";

import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

const CHART_HEIGHT = 240;

interface AgentChartCardProps {
  title: string;
  subtitle: string;
  summary?: string;
  legend?: ReactNode;
  loading: boolean;
  isEmpty: boolean;
  emptyLabel: string;
  children: ReactElement;
}

export function AgentChartCard({
  title,
  subtitle,
  summary,
  legend,
  loading,
  isEmpty,
  emptyLabel,
  children,
}: AgentChartCardProps) {
  return (
    <Card className="min-w-0 p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-foreground">{title}</h3>
          <p className="mt-1 text-xs text-muted-foreground">{subtitle}</p>
        </div>
        {summary && !loading && <span className="shrink-0 text-sm font-semibold tabular-nums text-foreground">{summary}</span>}
      </div>
      {legend && !loading && !isEmpty && (
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">{legend}</div>
      )}
      <div className="mt-4">
        {loading ? (
          <Skeleton className="w-full" style={{ height: CHART_HEIGHT }} />
        ) : isEmpty ? (
          <div className="flex items-center justify-center text-sm text-muted-foreground" style={{ height: CHART_HEIGHT }}>
            {emptyLabel}
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
            {children}
          </ResponsiveContainer>
        )}
      </div>
    </Card>
  );
}

export function AgentLegendItem({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="size-2.5 rounded-xs" style={{ backgroundColor: color }} />
      {label}
    </span>
  );
}

export const AXIS_TICK = { fontSize: 12, fill: "var(--muted-foreground)" };

interface AgentChartTooltipProps {
  active?: boolean;
  label?: string | number;
  payload?: Array<{ name?: string; value?: number | string | null }>;
  formatLabel?: (label: string | number) => string;
  formatValue?: (value: number, name: string) => string;
}

export function AgentChartTooltip({ active, label, payload, formatLabel, formatValue }: AgentChartTooltipProps) {
  if (!active || !payload?.length || label === undefined) return null;
  return (
    <div className="rounded-lg border border-border bg-popover px-3 py-2 text-sm text-popover-foreground">
      <p className="font-medium">{formatLabel ? formatLabel(label) : label}</p>
      {payload.map((entry) => {
        const name = entry.name ?? "";
        const value = Number(entry.value ?? 0);
        return (
          <p key={name} className="text-muted-foreground">
            {formatValue ? formatValue(value, name) : `${name}: ${value}`}
          </p>
        );
      })}
    </div>
  );
}
