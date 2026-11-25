"use client";

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatTotalCost,PRICE_UNAVAILABLE } from "@/lib/modelPricing";

import { formatUSD } from "./chatAnalyticsSeries";

export interface ChatCostBreakdownCardProps {
  cardNumber: number;
  promptTokens: number | null;
  completionTokens: number | null;
  /** Sum over replies whose model matched an organization pricing rule. */
  llmCostUsd: number;
  /** Distinct models that produced replies and matched no rule. */
  unpricedModels: number;
}

interface SegmentData {
  name: string;
  value: number;
  pct: string;
  fill: string;
  color: string;
  detail: string;
}

function PieChartTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload?: SegmentData }> }) {
  if (!active || !payload || !payload.length) return null;
  const data = payload[0]?.payload;
  if (!data) return null;

  return (
    <div className="rounded-lg border border-border bg-popover/95 px-3 py-2 text-xs shadow-xl backdrop-blur-md">
      <div className="flex items-center gap-2 mb-1">
        <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: data.fill }} />
        <span className="font-semibold text-foreground">{data.name}</span>
        <span className="font-mono text-muted-foreground text-[10px]">({data.pct}%)</span>
      </div>
      <div className="text-xs font-mono font-bold text-emerald-400">{formatUSD(data.value)}</div>
      <div className="text-[10px] text-muted-foreground mt-0.5">{data.detail}</div>
    </div>
  );
}

/**
 * The voice run page's cost card for a pipeline that has one billable
 * component: the LLM. A model with no organization rate keeps the same frame
 * and reports the price as unavailable rather than guessing one.
 */
export function ChatCostBreakdownCard({
  cardNumber,
  promptTokens,
  completionTokens,
  llmCostUsd,
  unpricedModels,
}: ChatCostBreakdownCardProps) {
  const priced = unpricedModels === 0;
  const total = llmCostUsd;
  const segments: SegmentData[] = [
    {
      name: "LLM Generation",
      value: total,
      pct: priced ? "100.0" : "0.0",
      fill: "var(--run-chart-2)",
      color: "var(--run-chart-2)",
      detail:
        promptTokens === null && completionTokens === null
          ? "no token usage was reported by the model provider"
          : `${(promptTokens ?? 0).toLocaleString()} prompt / ${(completionTokens ?? 0).toLocaleString()} completion tokens`,
    },
  ];
  const chartData = segments;

  return (
    <Card className="w-full overflow-hidden border border-border bg-card shadow-sm transition-shadow">
      <CardHeader className="px-3.5 pt-3 pb-1.5">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-xs font-bold uppercase tracking-wider text-foreground">
            {cardNumber}. COST BREAKDOWN (LLM)
          </CardTitle>
          <div className="flex items-center gap-2">
            <Badge
              variant="outline"
              className="h-5 px-2 text-[10px] font-mono border-border bg-muted/40 text-muted-foreground uppercase"
            >
              Pie Breakdown
            </Badge>
            <Badge
              variant="outline"
              className="h-5 px-2 text-[10px] font-mono font-bold border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
            >
              Total: {formatTotalCost(formatUSD, total, unpricedModels)}
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="px-3.5 pb-3 pt-1">
        <div className="grid grid-cols-1 md:grid-cols-12 gap-6 items-center">
          {/* LEFT: the donut, or a ring when no rate matched */}
          <div className="md:col-span-5 flex flex-col items-center justify-center">
            <div className="relative w-56 h-56 sm:w-64 sm:h-64 cursor-pointer">
              {total > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={chartData}
                      cx="50%"
                      cy="50%"
                      innerRadius={65}
                      outerRadius={95}
                      paddingAngle={3}
                      dataKey="value"
                      stroke="var(--card)"
                      strokeWidth={2}
                    >
                      {chartData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.fill} />
                      ))}
                    </Pie>
                    <Tooltip content={<PieChartTooltip />} />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <div className="absolute inset-0 flex items-center justify-center">
                  <div
                    className="h-40 w-40 sm:h-44 sm:w-44 rounded-full border-4"
                    style={{ borderColor: "oklch(from var(--run-chart-2) l c h / 0.25)" }}
                  />
                </div>
              )}
              <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none select-none">
                <span className="text-[10px] uppercase font-semibold tracking-wider text-muted-foreground">
                  Total Cost
                </span>
                <span className="font-mono text-sm sm:text-base font-bold text-foreground">
                  {priced ? formatUSD(total) : PRICE_UNAVAILABLE}
                </span>
                <span className="text-[9px] font-mono text-muted-foreground">
                  {unpricedModels > 0
                    ? `${unpricedModels} unpriced model${unpricedModels > 1 ? "s" : ""}`
                    : "1 Component"}
                </span>
              </div>
            </div>
          </div>

          {/* RIGHT: component detail */}
          <div className="md:col-span-7 space-y-3">
            <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-wider text-muted-foreground pb-1 border-b border-border">
              <span>Component Details</span>
              <span>Share / Amount</span>
            </div>

            <div className="space-y-2.5">
              {segments.map((seg) => (
                <div
                  key={seg.name}
                  className="p-2.5 rounded-lg border border-border bg-muted hover:bg-muted/80 transition-colors"
                >
                  <div className="flex items-center justify-between gap-2 mb-1.5">
                    <div className="flex items-center gap-2">
                      <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: seg.color }} />
                      <span className="text-xs font-semibold text-foreground">{seg.name}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="h-4 px-1.5 text-[9px] font-mono border-border bg-background/50">
                        {seg.pct}%
                      </Badge>
                      <span className="font-mono text-xs font-bold text-emerald-400">
                        {priced ? formatUSD(seg.value) : PRICE_UNAVAILABLE}
                      </span>
                    </div>
                  </div>

                  <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden mb-1.5">
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{
                        width: `${Math.max(Number(seg.pct), 0)}%`,
                        backgroundColor: seg.color,
                      }}
                    />
                  </div>

                  <div className="text-[10px] text-muted-foreground/80 font-mono">{seg.detail}</div>
                </div>
              ))}
            </div>

            <div className="flex items-center justify-between pt-2 border-t border-border text-xs font-medium">
              <span className="text-muted-foreground">Session Total:</span>
              <span className="font-mono font-bold text-foreground">
                {formatTotalCost(formatUSD, total, unpricedModels)}
                {priced ? " (100%)" : ""}
              </span>
            </div>
          </div>
        </div>
        <p className="mt-3 text-[10px] text-center text-muted-foreground/75 leading-relaxed">
          LLM Generation is the only billable component of the LLM pipeline; speech and telephony
          components do not exist for website chat
        </p>
      </CardContent>
    </Card>
  );
}
