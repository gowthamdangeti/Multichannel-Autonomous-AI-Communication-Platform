"use client";

import { Radar as RadarIcon } from "lucide-react";
import { PolarAngleAxis, PolarGrid, PolarRadiusAxis, Radar, RadarChart, ResponsiveContainer, Tooltip } from "recharts";

import type { AgentPerformance } from "@/client/types.gen";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

import { MIN_RADAR_AXES, type RadarRow, toRadarRows, toUnmeasuredLabels } from "./agentPerformance";

interface RadarTooltipProps {
  active?: boolean;
  payload?: Array<{ payload: RadarRow }>;
}

function RadarTooltip({ active, payload }: RadarTooltipProps) {
  const row = payload?.[0]?.payload;
  if (!active || !row) return null;
  return (
    <div className="rounded-lg border border-border bg-popover px-3 py-2 text-sm text-popover-foreground">
      <p className="font-medium">
        {row.label}: {row.score}/100
      </p>
      <p className="text-muted-foreground">From {row.sampleLabel}</p>
    </div>
  );
}

interface AgentPerformanceRadarCardProps {
  performance?: AgentPerformance;
  loading: boolean;
}

export function AgentPerformanceRadarCard({ performance, loading }: AgentPerformanceRadarCardProps) {
  const metrics = performance?.metrics ?? [];
  const rows = toRadarRows(metrics);
  const unmeasured = toUnmeasuredLabels(metrics);
  const hasRadar = rows.length >= MIN_RADAR_AXES;
  const overall = performance?.overall;
  const showScore = hasRadar && !loading && overall !== null && overall !== undefined;

  return (
    <Card className="flex flex-col p-5">
      <div className="flex items-center justify-between gap-3">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <RadarIcon className="size-4 text-muted-foreground" />
          Agent Performance Radar
        </h3>
        {showScore && (
          <span className="shrink-0 rounded-full border border-border bg-muted px-2.5 py-0.5 text-xs font-semibold tabular-nums text-foreground">
            {overall}% Rating
          </span>
        )}
      </div>
      <div className="mt-4 h-72 shrink-0">
        {loading ? (
          <Skeleton className="size-full" />
        ) : !hasRadar ? (
          <p className="flex h-full items-center justify-center text-sm text-muted-foreground">
            Not enough data to score this period
          </p>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <RadarChart data={rows} outerRadius="76%">
              <PolarGrid stroke="var(--chart-grid)" />
              <PolarAngleAxis
                dataKey="label"
                tickSize={14}
                tickFormatter={(label: string, index: number) => `${label} ${rows[index]?.score ?? ""}`}
                tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
              />
              <PolarRadiusAxis domain={[0, 100]} tickCount={5} axisLine={false} tick={false} />
              <Tooltip content={<RadarTooltip />} />
              <Radar
                dataKey="score"
                stroke="var(--run-chart-1)"
                fill="var(--run-chart-1)"
                fillOpacity={0.3}
                strokeWidth={2}
                dot={{ r: 4, fill: "var(--card)", stroke: "var(--run-chart-1)", strokeWidth: 2 }}
                isAnimationActive={false}
              />
            </RadarChart>
          </ResponsiveContainer>
        )}
      </div>
      {showScore && (
        <div className="mt-auto space-y-1 border-t border-border pt-3 text-xs text-muted-foreground">
          <div className="flex items-center justify-between gap-3">
            <span>Overall Score</span>
            <span className="font-medium tabular-nums text-foreground">{overall}/100</span>
          </div>
          {unmeasured.length > 0 && <p className="truncate">Not measured: {unmeasured.join(", ")}</p>}
        </div>
      )}
    </Card>
  );
}
