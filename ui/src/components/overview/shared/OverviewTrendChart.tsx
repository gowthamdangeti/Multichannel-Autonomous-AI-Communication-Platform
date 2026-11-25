"use client";

import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { fmtDate } from "@/components/charts/DashboardCharts";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export interface TrendRow {
  date: string;
  primary: number;
  secondary?: number;
}

interface TrendTooltipProps {
  active?: boolean;
  payload?: Array<{ payload: TrendRow }>;
  primaryLabel: string;
  secondaryLabel?: string;
}

function TrendTooltip({ active, payload, primaryLabel, secondaryLabel }: TrendTooltipProps) {
  const row = payload?.[0]?.payload;
  if (!active || !row) return null;
  return (
    <div className="rounded-lg border border-border bg-popover px-3 py-2 text-sm text-popover-foreground">
      <p className="font-medium">{fmtDate(row.date)}</p>
      <p className="text-muted-foreground">{row.primary} {primaryLabel.toLowerCase()}</p>
      {secondaryLabel && (
        <p className="text-muted-foreground">{Math.round(row.secondary ?? 0)} {secondaryLabel.toLowerCase()}</p>
      )}
    </div>
  );
}

interface OverviewTrendChartProps {
  rows: TrendRow[];
  primaryLabel: string;
  /** Leave out for a single series. */
  secondaryLabel?: string;
  emptyLabel: string;
  loading: boolean;
}

/** Volume per day, optionally with the effort behind it on its own hidden scale. */
export function OverviewTrendChart({ rows, primaryLabel, secondaryLabel, emptyLabel, loading }: OverviewTrendChartProps) {
  const isEmpty = !rows.some((row) => row.primary > 0);

  return (
    <Card className="gap-4 p-4 md:p-6">
      <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5"><span aria-hidden className="size-2 rounded-full bg-chart-1" />{primaryLabel}</span>
        {secondaryLabel && (
          <span className="inline-flex items-center gap-1.5"><span aria-hidden className="size-2 rounded-full bg-chart-2" />{secondaryLabel}</span>
        )}
      </div>
      <div className="h-56 md:h-72">
        {loading ? (
          <Skeleton className="h-full w-full" />
        ) : isEmpty ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">{emptyLabel}</div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={rows} margin={{ top: 8, right: 4, left: 4, bottom: 0 }}>
              <defs>
                <linearGradient id="overviewPrimary" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--chart-1)" stopOpacity={0.7} />
                  <stop offset="95%" stopColor="var(--chart-1)" stopOpacity={0.05} />
                </linearGradient>
                <linearGradient id="overviewSecondary" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--chart-2)" stopOpacity={0.6} />
                  <stop offset="95%" stopColor="var(--chart-2)" stopOpacity={0.05} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
              <XAxis
                dataKey="date"
                tickFormatter={fmtDate}
                tick={{ fontSize: 12, fill: "var(--muted-foreground)" }}
                axisLine={false}
                tickLine={false}
                minTickGap={32}
                tickMargin={8}
              />
              <YAxis yAxisId="primary" hide allowDecimals={false} domain={[0, "auto"]} />
              <YAxis yAxisId="secondary" hide allowDecimals={false} domain={[0, "auto"]} />
              <Tooltip
                content={<TrendTooltip primaryLabel={primaryLabel} secondaryLabel={secondaryLabel} />}
                cursor={{ stroke: "var(--border)" }}
              />
              {secondaryLabel && <Area isAnimationActive={false} yAxisId="secondary" type="monotone" dataKey="secondary" stroke="var(--chart-2)" strokeWidth={1} fill="url(#overviewSecondary)" />}
              <Area isAnimationActive={false} yAxisId="primary" type="monotone" dataKey="primary" stroke="var(--chart-1)" strokeWidth={1} fill="url(#overviewPrimary)" />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </Card>
  );
}
