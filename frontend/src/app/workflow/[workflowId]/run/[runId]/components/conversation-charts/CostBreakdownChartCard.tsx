'use client';

import React from 'react';
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

import {
    formatUSD,
    type TurnTelemetryItem,
} from '../extractConversationTelemetry';

export interface CostBreakdownChartCardProps {
    cardNumber: number;
    pipelineLabel: string;
    turnsData: TurnTelemetryItem[];
    totalCosts: { llm: number; tts: number; stt: number; total: number };
    totalPromptTokens: number;
    totalCompletionTokens: number;
    totalTtsChars: number;
    totalSttSec: number;
    hasStt: boolean;
    hasTts: boolean;
}

interface SegmentData {
    name: string;
    shortName: string;
    value: number;
    pct: string;
    fill: string;
    color: string;
    detail: string;
}

function PieChartTooltip({
    active,
    payload,
}: {
    active?: boolean;
    payload?: Array<{ payload?: SegmentData }>;
}) {
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
            <div className="text-xs font-mono font-bold text-emerald-400">
                {formatUSD(data.value)}
            </div>
            <div className="text-[10px] text-muted-foreground mt-0.5">
                {data.detail}
            </div>
        </div>
    );
}

export function CostBreakdownChartCard({
    cardNumber,
    pipelineLabel,
    totalCosts,
    totalPromptTokens,
    totalCompletionTokens,
    totalTtsChars,
    totalSttSec,
    hasStt,
    hasTts,
}: CostBreakdownChartCardProps) {
    const totalCost = totalCosts.total > 0 ? totalCosts.total : 0;
    const llmPct = totalCost > 0 ? ((totalCosts.llm / totalCost) * 100).toFixed(1) : '0.0';
    const ttsPct = totalCost > 0 ? ((totalCosts.tts / totalCost) * 100).toFixed(1) : '0.0';
    const sttPct = totalCost > 0 ? ((totalCosts.stt / totalCost) * 100).toFixed(1) : '0.0';

    const segments: SegmentData[] = [
        {
            name: 'LLM Generation',
            shortName: 'LLM Cost',
            value: totalCosts.llm,
            pct: llmPct,
            fill: 'var(--run-chart-2)',
            color: 'var(--run-chart-2)',
            detail: `${totalPromptTokens.toLocaleString()} prompt / ${totalCompletionTokens.toLocaleString()} completion tokens`,
        },
        hasTts
            ? {
                  name: 'TTS Synthesis',
                  shortName: 'TTS Cost',
                  value: totalCosts.tts,
                  pct: ttsPct,
                  fill: 'var(--chart-violet, #7915A0)',
                  color: 'var(--chart-violet, #7915A0)',
                  detail: `${totalTtsChars.toLocaleString()} characters synthesized`,
              }
            : null,
        hasStt
            ? {
                  name: 'STT Transcription',
                  shortName: 'STT Cost',
                  value: totalCosts.stt,
                  pct: sttPct,
                  fill: 'var(--run-chart-3)',
                  color: 'var(--run-chart-3)',
                  detail: `${totalSttSec.toFixed(1)}s input audio duration`,
              }
            : null,
    ].filter(Boolean) as SegmentData[];

    const activeSegments = segments.filter((s) => s.value > 0);
    const chartData = activeSegments.length > 0 ? activeSegments : segments;

    return (
        <Card className="w-full border-border/80 bg-card/70 backdrop-blur-sm overflow-hidden shadow-lg shadow-black/25 hover:shadow-xl transition-all duration-300">
            <CardHeader className="px-3.5 pt-3 pb-1.5">
                <div className="flex items-center justify-between gap-2">
                    <CardTitle className="text-xs font-bold uppercase tracking-wider text-foreground">
                        {cardNumber}. COST BREAKDOWN ({pipelineLabel})
                    </CardTitle>
                    <div className="flex items-center gap-2">
                        <Badge variant="outline" className="h-5 px-2 text-[10px] font-mono border-border bg-muted/40 text-muted-foreground uppercase">
                            Pie Breakdown
                        </Badge>
                        <Badge variant="outline" className="h-5 px-2 text-[10px] font-mono font-bold border-emerald-500/30 bg-emerald-500/10 text-emerald-400">
                            Total: {formatUSD(totalCosts.total)}
                        </Badge>
                    </div>
                </div>
            </CardHeader>
            <CardContent className="px-3.5 pb-3 pt-1">
                <div className="grid grid-cols-1 md:grid-cols-12 gap-6 items-center">
                    {/* LEFT: Pie / Donut Chart with Centered Total */}
                    <div className="md:col-span-5 flex flex-col items-center justify-center">
                        <div className="relative w-56 h-56 sm:w-64 sm:h-64 cursor-pointer">
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
                            {/* Center Summary Inside Donut */}
                            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none select-none">
                                <span className="text-[10px] uppercase font-semibold tracking-wider text-muted-foreground">
                                    Total Cost
                                </span>
                                <span className="font-mono text-sm sm:text-base font-bold text-foreground">
                                    {formatUSD(totalCosts.total)}
                                </span>
                                <span className="text-[9px] font-mono text-muted-foreground">
                                    {chartData.length} Component{chartData.length > 1 ? 's' : ''}
                                </span>
                            </div>
                        </div>
                    </div>

                    {/* RIGHT: Complete Details Breakdown Cards */}
                    <div className="md:col-span-7 space-y-3">
                        <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-wider text-muted-foreground pb-1 border-b border-border/40">
                            <span>Component Details</span>
                            <span>Share / Amount</span>
                        </div>

                        <div className="space-y-2.5">
                            {segments.map((seg) => (
                                <div
                                    key={seg.name}
                                    className="p-2.5 rounded-lg border border-border/40 bg-muted/20 hover:bg-muted/30 transition-colors"
                                >
                                    <div className="flex items-center justify-between gap-2 mb-1.5">
                                        <div className="flex items-center gap-2">
                                            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: seg.color }} />
                                            <span className="text-xs font-semibold text-foreground">
                                                {seg.name}
                                            </span>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <Badge variant="outline" className="h-4 px-1.5 text-[9px] font-mono border-border bg-background/50">
                                                {seg.pct}%
                                            </Badge>
                                            <span className="font-mono text-xs font-bold text-emerald-400">
                                                {formatUSD(seg.value)}
                                            </span>
                                        </div>
                                    </div>

                                    {/* Progress Bar */}
                                    <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden mb-1.5">
                                        <div
                                            className="h-full rounded-full transition-all duration-500"
                                            style={{
                                                width: `${Math.max(Number(seg.pct), 0)}%`,
                                                backgroundColor: seg.color,
                                            }}
                                        />
                                    </div>

                                    <div className="text-[10px] text-muted-foreground/80 font-mono">
                                        {seg.detail}
                                    </div>
                                </div>
                            ))}
                        </div>

                        {/* Summary Footer */}
                        <div className="flex items-center justify-between pt-2 border-t border-border/40 text-xs font-medium">
                            <span className="text-muted-foreground">Combined Pipeline Total:</span>
                            <span className="font-mono font-bold text-foreground">
                                {formatUSD(totalCosts.total)} (100%)
                            </span>
                        </div>
                    </div>
                </div>

                <p className="mt-3 text-[10px] text-center text-muted-foreground/75 leading-relaxed">
                    Complete pie distribution and resource breakdown across {pipelineLabel} pipeline components
                </p>
            </CardContent>
        </Card>
    );
}
