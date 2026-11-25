"use client";

import { Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

import type { ChatRequestChartPoint } from "./chatAnalyticsSeries";
import { ChatChartTooltip } from "./ChatChartTooltip";

export interface ChatApiHealthCardProps {
  cardNumber: number;
  points: ChatRequestChartPoint[];
  /** Why the latest reply failed, when it did. */
  errorDetail?: { message: string; model?: string | null } | null;
}

/**
 * The voice run page's request-health chart for a chat conversation. Each
 * visitor message is one request; it succeeded when the assistant answered it
 * and failed when the model could not (the message is saved, the reply is not).
 */
export function ChatApiHealthCard({ cardNumber, points, errorDetail }: ChatApiHealthCardProps) {
  const total = points.length;
  const failed = points.filter((p) => p.failedRequests > 0).length;
  const rate = total > 0 ? Math.round(((total - failed) / total) * 100) : 100;

  return (
    <Card className="overflow-hidden border border-border bg-card shadow-sm transition-shadow">
      <CardHeader className="px-3.5 pt-3 pb-1.5">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-xs font-bold uppercase tracking-wider text-foreground">
            {cardNumber}. TOTAL API REQUESTS &amp; HEALTH
          </CardTitle>
          <Badge
            variant="outline"
            className={`h-5 px-2 text-[10px] font-mono font-medium ${
              failed > 0
                ? "border-amber-500/30 bg-amber-500/10 text-amber-400"
                : "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
            }`}
          >
            {total} Requests • {rate}%{failed > 0 ? ` • ${failed} Failed` : ""}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="px-2.5 pb-2.5 pt-0.5">
        <div className="h-64 sm:h-72 w-full cursor-pointer">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={points} margin={{ top: 8, right: 8, left: -22, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis dataKey="turn" stroke="var(--muted-foreground)" fontSize={11} tickLine={false} />
              <YAxis
                yAxisId="left"
                stroke="var(--muted-foreground)"
                fontSize={11}
                domain={[0, 1]}
                tickLine={false}
                allowDecimals={false}
              />
              <YAxis
                yAxisId="right"
                orientation="right"
                stroke="var(--muted-foreground)"
                fontSize={11}
                domain={[0, 100]}
                unit="%"
                tickLine={false}
              />
              <Tooltip content={<ChatChartTooltip noun="Request" />} cursor={false} />
              <Bar
                yAxisId="left"
                dataKey="successfulRequests"
                name="Successful"
                fill="var(--run-chart-2)"
                stackId="requests"
                barSize={22}
                radius={failed > 0 ? undefined : [2, 2, 0, 0]}
                opacity={0.85}
              />
              <Bar
                yAxisId="left"
                dataKey="failedRequests"
                name="Failed"
                fill="var(--chart-violet, #7915A0)"
                stackId="requests"
                barSize={22}
                radius={[2, 2, 0, 0]}
                opacity={0.85}
              />
              <Line
                yAxisId="right"
                type="monotone"
                dataKey="successRate"
                name="Success Rate (%)"
                stroke="var(--run-chart-3)"
                strokeWidth={2}
                dot={{ r: 3, fill: "var(--run-chart-3)" }}
                connectNulls
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <div className="mt-1.5 flex items-center justify-center gap-4 text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-xs bg-run-chart-2" /> Successful
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-xs" style={{ backgroundColor: "var(--chart-violet, #7915A0)" }} /> Failed
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-run-chart-3" /> Success Rate (%)
          </span>
        </div>
        {errorDetail && (
          <div className="mt-1.5 rounded-md border border-purple-500/20 bg-purple-500/5 p-2">
            <p className="text-[10px] font-semibold text-purple-400 uppercase tracking-wider mb-1.5">
              Pipeline Errors (1)
            </p>
            <div className="flex items-start gap-1.5 text-[10px] text-muted-foreground">
              <span className="shrink-0 mt-0.5">•</span>
              <span className="font-mono break-all">
                {errorDetail.model && <span className="text-foreground/80">[{errorDetail.model}] </span>}
                {errorDetail.message}
              </span>
            </div>
          </div>
        )}
        <p className="mt-0.5 text-[10px] text-center text-muted-foreground/75 leading-relaxed">
          Tracks successful vs failed API requests per turn with real-time success rate (%)
        </p>
      </CardContent>
    </Card>
  );
}
