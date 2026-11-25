"use client";

import { Area, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

import type { ChatReplyChartPoint } from "./chatAnalyticsSeries";
import { ChatChartTooltip } from "./ChatChartTooltip";

export interface ChatPipelineLatencyCardProps {
  cardNumber: number;
  points: ChatReplyChartPoint[];
  avgLatencyMs: number | null;
}

/**
 * Website chat's pipeline is the LLM leg alone — there is no STT or TTS stage —
 * so this is the voice latency chart with a single series.
 */
export function ChatPipelineLatencyCard({ cardNumber, points, avgLatencyMs }: ChatPipelineLatencyCardProps) {
  return (
    <Card className="overflow-hidden border border-border bg-card shadow-sm transition-shadow">
      <CardHeader className="px-3.5 pt-3 pb-1.5">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-xs font-bold uppercase tracking-wider text-foreground">
            {cardNumber}. PIPELINE LATENCY (LLM)
          </CardTitle>
          <Badge
            variant="outline"
            className="h-5 px-2 text-[10px] font-mono font-medium border-amber-500/30 bg-amber-500/10 text-amber-400"
          >
            {avgLatencyMs !== null ? `LLM TTFB: ${avgLatencyMs}ms` : "—"}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="px-2.5 pb-2.5 pt-0.5">
        <div className="h-64 sm:h-72 w-full cursor-pointer">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={points} margin={{ top: 8, right: 8, left: -10, bottom: 0 }}>
              <defs>
                <linearGradient id="chatLlmLatencyGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--chart-violet, #7915A0)" stopOpacity={0.25} />
                  <stop offset="100%" stopColor="var(--chart-violet, #7915A0)" stopOpacity={0.0} />
                </linearGradient>
                <filter id="chatGlowLatency" x="-20%" y="-20%" width="140%" height="140%">
                  <feDropShadow dx="0" dy="3" stdDeviation="3" floodColor="var(--chart-violet, #7915A0)" floodOpacity={0.4} />
                </filter>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis dataKey="turn" stroke="var(--muted-foreground)" fontSize={11} tickLine={false} />
              <YAxis stroke="var(--muted-foreground)" fontSize={11} tickFormatter={(v) => `${v}ms`} tickLine={false} />
              <Tooltip content={<ChatChartTooltip />} cursor={false} />
              <Area type="monotone" dataKey="llmLatencyMs" fill="url(#chatLlmLatencyGrad)" stroke="none" />
              <Line
                type="monotone"
                dataKey="llmLatencyMs"
                name="LLM TTFB"
                stroke="var(--chart-violet, #7915A0)"
                strokeWidth={2.5}
                dot={{ r: 3.5, fill: "var(--chart-violet, #7915A0)", stroke: "var(--card)", strokeWidth: 1.5 }}
                activeDot={{ r: 6 }}
                filter="url(#chatGlowLatency)"
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <div className="mt-1.5 flex flex-wrap items-center justify-center gap-3 text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span
              className="h-2 w-2 rounded-full shadow-xs shadow-purple-500/50"
              style={{ backgroundColor: "var(--chart-violet, #7915A0)" }}
            />{" "}
            LLM TTFB
          </span>
        </div>
        <p className="mt-0.5 text-[10px] text-center text-muted-foreground/75 leading-relaxed">
          Pipeline: LLM — model response time per reply; website chat has no speech stages
        </p>
      </CardContent>
    </Card>
  );
}
