'use client';

import React from 'react';
import {
    Area,
    CartesianGrid,
    ComposedChart,
    Line,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
} from 'recharts';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

import type { TurnTelemetryItem } from '../extractConversationTelemetry';
import { CustomChartTooltip } from './ChartTooltip';

export interface PipelineLatencyChartCardProps {
    cardNumber: number;
    pipelineLabel: string;
    turnsData: TurnTelemetryItem[];
    ttfbMetrics: { avg: number; min: number; max: number; avgPipeline: number };
    hasStt: boolean;
    hasTts: boolean;
}

export function PipelineLatencyChartCard({
    cardNumber,
    pipelineLabel,
    turnsData,
    ttfbMetrics,
    hasStt,
    hasTts,
}: PipelineLatencyChartCardProps) {
    return (
        <Card className="border-border/80 bg-card/70 backdrop-blur-sm overflow-hidden shadow-lg shadow-black/25 hover:shadow-xl transition-all duration-300">
            <CardHeader className="px-3.5 pt-3 pb-1.5">
                <div className="flex items-center justify-between gap-2">
                    <CardTitle className="text-xs font-bold uppercase tracking-wider text-foreground">
                        {cardNumber}. PIPELINE LATENCY ({pipelineLabel})
                    </CardTitle>
                    <Badge variant="outline" className="h-5 px-2 text-[10px] font-mono font-medium border-amber-500/30 bg-amber-500/10 text-amber-400">
                        {ttfbMetrics.avgPipeline > 0 ? `Pipeline: ${ttfbMetrics.avgPipeline}ms` : ttfbMetrics.avg > 0 ? `LLM TTFB: ${ttfbMetrics.avg}ms` : '—'}
                    </Badge>
                </div>
            </CardHeader>
            <CardContent className="px-2.5 pb-2.5 pt-0.5">
                <div className="h-64 sm:h-72 w-full cursor-pointer">
                    <ResponsiveContainer width="100%" height="100%">
                        <ComposedChart data={turnsData} margin={{ top: 8, right: 8, left: -10, bottom: 0 }}>
                            <defs>
                                <linearGradient id="llmLatencyGrad" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="0%" stopColor="var(--chart-violet, #7915A0)" stopOpacity={0.25} />
                                    <stop offset="100%" stopColor="var(--chart-violet, #7915A0)" stopOpacity={0.0} />
                                </linearGradient>
                                <linearGradient id="sttLatencyGrad" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="0%" stopColor="var(--run-chart-3)" stopOpacity={0.22} />
                                    <stop offset="100%" stopColor="var(--run-chart-3)" stopOpacity={0.0} />
                                </linearGradient>
                                <linearGradient id="ttsLatencyGrad" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="0%" stopColor="var(--run-chart-2)" stopOpacity={0.22} />
                                    <stop offset="100%" stopColor="var(--run-chart-2)" stopOpacity={0.0} />
                                </linearGradient>
                                <filter id="glowViolet" x="-20%" y="-20%" width="140%" height="140%">
                                    <feDropShadow dx="0" dy="3" stdDeviation="3" floodColor="var(--chart-violet, #7915A0)" floodOpacity={0.4} />
                                </filter>
                                <filter id="glowAmber" x="-20%" y="-20%" width="140%" height="140%">
                                    <feDropShadow dx="0" dy="3" stdDeviation="3" floodColor="var(--run-chart-3)" floodOpacity={0.4} />
                                </filter>
                                <filter id="glowBlue" x="-20%" y="-20%" width="140%" height="140%">
                                    <feDropShadow dx="0" dy="3" stdDeviation="3" floodColor="var(--run-chart-2)" floodOpacity={0.4} />
                                </filter>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                            <XAxis dataKey="turn" stroke="var(--muted-foreground)" fontSize={11} tickLine={false} />
                            <YAxis stroke="var(--muted-foreground)" fontSize={11} tickFormatter={(v) => `${v}ms`} tickLine={false} />
                            <Tooltip content={<CustomChartTooltip />} cursor={false} />
                            {hasStt && <Area type="monotone" dataKey="sttLatencyMs" fill="url(#sttLatencyGrad)" stroke="none" />}
                            <Area type="monotone" dataKey="llmLatencyMs" fill="url(#llmLatencyGrad)" stroke="none" />
                            {hasTts && <Area type="monotone" dataKey="ttsLatencyMs" fill="url(#ttsLatencyGrad)" stroke="none" />}
                            {hasStt && (
                                <Line
                                    type="monotone"
                                    dataKey="sttLatencyMs"
                                    name="STT Latency"
                                    stroke="var(--run-chart-3)"
                                    strokeWidth={2.5}
                                    dot={{ r: 3.5, fill: 'var(--run-chart-3)', stroke: 'var(--card)', strokeWidth: 1.5 }}
                                    activeDot={{ r: 6 }}
                                    filter="url(#glowAmber)"
                                />
                            )}
                            <Line
                                type="monotone"
                                dataKey="llmLatencyMs"
                                name="LLM TTFB"
                                stroke="var(--chart-violet, #7915A0)"
                                strokeWidth={2.5}
                                dot={{ r: 3.5, fill: 'var(--chart-violet, #7915A0)', stroke: 'var(--card)', strokeWidth: 1.5 }}
                                activeDot={{ r: 6 }}
                                filter="url(#glowViolet)"
                            />
                            {hasTts && (
                                <Line
                                    type="monotone"
                                    dataKey="ttsLatencyMs"
                                    name="TTS Latency"
                                    stroke="var(--run-chart-2)"
                                    strokeWidth={2.5}
                                    dot={{ r: 3.5, fill: 'var(--run-chart-2)', stroke: 'var(--card)', strokeWidth: 1.5 }}
                                    activeDot={{ r: 6 }}
                                    filter="url(#glowBlue)"
                                />
                            )}
                        </ComposedChart>
                    </ResponsiveContainer>
                </div>
                <div className="mt-1.5 flex flex-wrap items-center justify-center gap-3 text-[11px] text-muted-foreground">
                    {hasStt && (
                        <span className="flex items-center gap-1.5">
                            <span className="h-2 w-2 rounded-full bg-run-chart-3 shadow-xs shadow-amber-500/50" /> STT Latency
                        </span>
                    )}
                    <span className="flex items-center gap-1.5">
                        <span className="h-2 w-2 rounded-full shadow-xs shadow-purple-500/50" style={{ backgroundColor: 'var(--chart-violet, #7915A0)' }} /> LLM TTFB
                    </span>
                    {hasTts && (
                        <span className="flex items-center gap-1.5">
                            <span className="h-2 w-2 rounded-full bg-run-chart-2 shadow-xs shadow-blue-500/50" /> TTS Latency
                        </span>
                    )}
                </div>
                <p className="mt-0.5 text-[10px] text-center text-muted-foreground/75 leading-relaxed">
                    Pipeline: {pipelineLabel} — component execution times per turn based on active services
                </p>
            </CardContent>
        </Card>
    );
}

