"use client";

import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

import { type ChatReplyChartPoint, formatTokensCompact } from "./chatAnalyticsSeries";
import { ChatChartTooltip } from "./ChatChartTooltip";

export interface ChatTokenConsumptionCardProps {
  cardNumber: number;
  points: ChatReplyChartPoint[];
  /** Null when no reply reported the field; the badge then says so instead of showing 0. */
  totalPromptTokens: number | null;
  totalCompletionTokens: number | null;
}

const compactOrDash = (value: number | null) => (value === null ? "—" : formatTokensCompact(value));

/**
 * The voice run page's token chart, driven by the per-reply usage the provider
 * reported. Chat stores no cache tokens, so the cache trace stays absent and
 * its badge reports the honest zero.
 */
export function ChatTokenConsumptionCard({
  cardNumber,
  points,
  totalPromptTokens,
  totalCompletionTokens,
}: ChatTokenConsumptionCardProps) {
  const maxPrompt = Math.max(...points.map((p) => p.promptTokens ?? 0), 1);
  const maxCompletion = Math.max(...points.map((p) => p.completionTokens ?? 0), 1);
  const promptYMax = Math.ceil(maxPrompt * 1.25);
  const completionYMax = Math.ceil(maxCompletion * 1.25);

  return (
    <Card className="w-full overflow-hidden border border-border bg-card shadow-sm transition-shadow">
      <CardHeader className="px-3.5 pt-3 pb-1.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-xs font-bold uppercase tracking-wider text-foreground">
            {cardNumber}. LLM TOKEN CONSUMPTION
          </CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            <Badge
              variant="outline"
              className="h-5 px-2 text-[10px] font-mono font-medium border-sky-500/30 bg-sky-500/10 text-sky-400"
            >
              I/P: {compactOrDash(totalPromptTokens)} • O/P: {compactOrDash(totalCompletionTokens)}
            </Badge>
            <Badge
              variant="outline"
              className="h-5 px-2 text-[10px] font-mono font-medium border-border bg-muted/40 text-muted-foreground"
            >
              Cached: 0 • R/W: 0 / 0
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="px-3.5 pb-3 pt-0.5">
        <div className="h-64 sm:h-72 w-full cursor-pointer">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={points} margin={{ top: 8, right: 8, left: -10, bottom: 0 }}>
              <defs>
                <linearGradient id="chatPromptGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--run-chart-2)" stopOpacity={0.28} />
                  <stop offset="100%" stopColor="var(--run-chart-2)" stopOpacity={0.0} />
                </linearGradient>
                <linearGradient id="chatCompletionGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--chart-violet, #7915A0)" stopOpacity={0.24} />
                  <stop offset="100%" stopColor="var(--chart-violet, #7915A0)" stopOpacity={0.0} />
                </linearGradient>
                <filter id="chatGlowBlue" x="-20%" y="-20%" width="140%" height="140%">
                  <feDropShadow dx="0" dy="3" stdDeviation="3" floodColor="var(--run-chart-2)" floodOpacity={0.4} />
                </filter>
                <filter id="chatGlowViolet" x="-20%" y="-20%" width="140%" height="140%">
                  <feDropShadow dx="0" dy="3" stdDeviation="3" floodColor="var(--chart-violet, #7915A0)" floodOpacity={0.4} />
                </filter>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis dataKey="turn" stroke="var(--muted-foreground)" fontSize={11} tickLine={false} />
              <YAxis
                yAxisId="left"
                stroke="var(--muted-foreground)"
                fontSize={11}
                domain={[0, promptYMax]}
                tickFormatter={(v) => formatTokensCompact(v)}
                tickLine={false}
              />
              <YAxis
                yAxisId="right"
                orientation="right"
                stroke="var(--muted-foreground)"
                fontSize={11}
                domain={[0, completionYMax]}
                tickFormatter={(v) => formatTokensCompact(v)}
                tickLine={false}
              />
              <Tooltip content={<ChatChartTooltip />} cursor={false} />
              <Area yAxisId="left" type="monotone" dataKey="promptTokens" fill="url(#chatPromptGrad)" stroke="none" />
              <Area yAxisId="right" type="monotone" dataKey="completionTokens" fill="url(#chatCompletionGrad)" stroke="none" />
              <Line
                yAxisId="left"
                type="monotone"
                dataKey="promptTokens"
                name="Prompt Tokens (I/P)"
                stroke="var(--run-chart-2)"
                strokeWidth={2.5}
                dot={{ r: 3.5, fill: "var(--run-chart-2)", stroke: "var(--card)", strokeWidth: 1.5 }}
                activeDot={{ r: 6 }}
                filter="url(#chatGlowBlue)"
              />
              <Line
                yAxisId="right"
                type="monotone"
                dataKey="completionTokens"
                name="Completion Tokens (O/P)"
                stroke="var(--chart-violet, #7915A0)"
                strokeWidth={2.5}
                dot={{ r: 3.5, fill: "var(--chart-violet, #7915A0)", stroke: "var(--card)", strokeWidth: 1.5 }}
                activeDot={{ r: 6 }}
                filter="url(#chatGlowViolet)"
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        <div className="mt-2 flex flex-wrap items-center justify-center gap-4 text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-run-chart-2 shadow-xs shadow-blue-500/50" /> Prompt Tokens (I/P)
          </span>
          <span className="flex items-center gap-1.5">
            <span
              className="h-2 w-2 rounded-full shadow-xs shadow-purple-500/50"
              style={{ backgroundColor: "var(--chart-violet, #7915A0)" }}
            />{" "}
            Completion Tokens (O/P)
          </span>
        </div>

        <p className="mt-2.5 text-[10px] text-center text-muted-foreground/75 leading-relaxed">
          Tracks prompt context growth (left axis) against generated answer length (right axis) for
          every reply the provider reported usage for
        </p>
      </CardContent>
    </Card>
  );
}
