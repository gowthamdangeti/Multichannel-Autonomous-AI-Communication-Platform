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

import {
    formatTokensCompact,
    type TurnTelemetryItem,
} from '../extractConversationTelemetry';
import { CustomChartTooltip } from './ChartTooltip';

export interface TokenConsumptionChartCardProps {
    cardNumber: number;
    turnsData: TurnTelemetryItem[];
    totalPromptTokens: number;
    totalCompletionTokens: number;
    totalCacheReadTokens?: number;
    totalCacheCreationTokens?: number;
}

export function TokenConsumptionChartCard({
    cardNumber,
    turnsData,
    totalPromptTokens,
    totalCompletionTokens,
    totalCacheReadTokens = 0,
    totalCacheCreationTokens = 0,
}: TokenConsumptionChartCardProps) {
    const derivedCacheRead =
        totalCacheReadTokens > 0
            ? totalCacheReadTokens
            : turnsData.reduce((sum, t) => sum + (t.cacheReadTokens || 0), 0);
    const derivedCacheCreation =
        totalCacheCreationTokens > 0
            ? totalCacheCreationTokens
            : turnsData.reduce((sum, t) => sum + (t.cacheCreationTokens || 0), 0);

    const hasCacheRead = derivedCacheRead > 0;
    const hasCacheCreation = derivedCacheCreation > 0;
    const hasCache = hasCacheRead || hasCacheCreation;

    const maxPrompt = Math.max(...turnsData.map((t) => t.promptTokens), 1);
    const maxCompletion = Math.max(...turnsData.map((t) => t.completionTokens), 1);
    const promptYMax = Math.ceil(maxPrompt * 1.25);
    const completionYMax = Math.ceil(maxCompletion * 1.25);

    return (
        <Card className="w-full border-border/80 bg-card/70 backdrop-blur-sm overflow-hidden shadow-lg shadow-black/25 hover:shadow-xl transition-all duration-300">
            <CardHeader className="px-3.5 pt-3 pb-1.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <CardTitle className="text-xs font-bold uppercase tracking-wider text-foreground">
                        {cardNumber}. LLM TOKEN CONSUMPTION
                    </CardTitle>
                    <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="outline" className="h-5 px-2 text-[10px] font-mono font-medium border-sky-500/30 bg-sky-500/10 text-sky-400">
                            I/P: {formatTokensCompact(totalPromptTokens)} • O/P: {formatTokensCompact(totalCompletionTokens)}
                        </Badge>
                        <Badge
                            variant="outline"
                            className={`h-5 px-2 text-[10px] font-mono font-medium ${
                                hasCache
                                    ? 'border-amber-500/30 bg-amber-500/10 text-amber-400'
                                    : 'border-border bg-muted/40 text-muted-foreground'
                            }`}
                        >
                            Cached: {formatTokensCompact(derivedCacheRead)} • R/W: {formatTokensCompact(derivedCacheRead)} / {formatTokensCompact(derivedCacheCreation)}
                        </Badge>
                    </div>
                </div>
            </CardHeader>
            <CardContent className="px-3.5 pb-3 pt-0.5">
                <div className="h-64 sm:h-72 w-full cursor-pointer">
                    <ResponsiveContainer width="100%" height="100%">
                        <ComposedChart data={turnsData} margin={{ top: 8, right: 8, left: -10, bottom: 0 }}>
                            <defs>
                                <linearGradient id="promptGrad" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="0%" stopColor="var(--run-chart-2)" stopOpacity={0.28} />
                                    <stop offset="100%" stopColor="var(--run-chart-2)" stopOpacity={0.0} />
                                </linearGradient>
                                <linearGradient id="completionGrad" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="0%" stopColor="var(--chart-violet, #7915A0)" stopOpacity={0.24} />
                                    <stop offset="100%" stopColor="var(--chart-violet, #7915A0)" stopOpacity={0.0} />
                                </linearGradient>
                                <linearGradient id="cachedGrad" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="0%" stopColor="var(--run-chart-3)" stopOpacity={0.22} />
                                    <stop offset="100%" stopColor="var(--run-chart-3)" stopOpacity={0.0} />
                                </linearGradient>
                                <filter id="glowBlue" x="-20%" y="-20%" width="140%" height="140%">
                                    <feDropShadow dx="0" dy="3" stdDeviation="3" floodColor="var(--run-chart-2)" floodOpacity={0.4} />
                                </filter>
                                <filter id="glowViolet" x="-20%" y="-20%" width="140%" height="140%">
                                    <feDropShadow dx="0" dy="3" stdDeviation="3" floodColor="var(--chart-violet, #7915A0)" floodOpacity={0.4} />
                                </filter>
                                <filter id="glowAmber" x="-20%" y="-20%" width="140%" height="140%">
                                    <feDropShadow dx="0" dy="3" stdDeviation="3" floodColor="var(--run-chart-3)" floodOpacity={0.4} />
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
                            <Tooltip content={<CustomChartTooltip />} cursor={false} />
                            <Area yAxisId="left" type="monotone" dataKey="promptTokens" fill="url(#promptGrad)" stroke="none" />
                            <Area yAxisId="right" type="monotone" dataKey="completionTokens" fill="url(#completionGrad)" stroke="none" />
                            {hasCacheRead && (
                                <Area yAxisId="left" type="monotone" dataKey="cacheReadTokens" fill="url(#cachedGrad)" stroke="none" opacity={0.6} />
                            )}
                            <Line
                                yAxisId="left"
                                type="monotone"
                                dataKey="promptTokens"
                                name="Prompt Tokens (I/P)"
                                stroke="var(--run-chart-2)"
                                strokeWidth={2.5}
                                dot={{ r: 3.5, fill: 'var(--run-chart-2)', stroke: 'var(--card)', strokeWidth: 1.5 }}
                                activeDot={{ r: 6 }}
                                filter="url(#glowBlue)"
                            />
                            <Line
                                yAxisId="right"
                                type="monotone"
                                dataKey="completionTokens"
                                name="Completion Tokens (O/P)"
                                stroke="var(--chart-violet, #7915A0)"
                                strokeWidth={2.5}
                                dot={{ r: 3.5, fill: 'var(--chart-violet, #7915A0)', stroke: 'var(--card)', strokeWidth: 1.5 }}
                                activeDot={{ r: 6 }}
                                filter="url(#glowViolet)"
                            />
                            {hasCacheRead && (
                                <Line
                                    yAxisId="left"
                                    type="monotone"
                                    dataKey="cacheReadTokens"
                                    name="Cache Read (R)"
                                    stroke="var(--run-chart-3)"
                                    strokeWidth={2}
                                    dot={{ r: 3, fill: 'var(--run-chart-3)', stroke: 'var(--card)', strokeWidth: 1.5 }}
                                    activeDot={{ r: 5 }}
                                    filter="url(#glowAmber)"
                                />
                            )}
                            {hasCacheCreation && (
                                <Line
                                    yAxisId="left"
                                    type="monotone"
                                    dataKey="cacheCreationTokens"
                                    name="Cache Write (W)"
                                    stroke="var(--chart-2)"
                                    strokeWidth={1.5}
                                    strokeDasharray="4 3"
                                    dot={{ r: 2.5, fill: 'var(--chart-2)', stroke: 'var(--card)', strokeWidth: 1 }}
                                />
                            )}
                        </ComposedChart>
                    </ResponsiveContainer>
                </div>

                {/* Legend Pills */}
                <div className="mt-2 flex flex-wrap items-center justify-center gap-4 text-[11px] text-muted-foreground">
                    <span className="flex items-center gap-1.5">
                        <span className="h-2 w-2 rounded-full bg-run-chart-2 shadow-xs shadow-blue-500/50" /> Prompt Tokens (I/P)
                    </span>
                    <span className="flex items-center gap-1.5">
                        <span className="h-2 w-2 rounded-full shadow-xs shadow-purple-500/50" style={{ backgroundColor: 'var(--chart-violet, #7915A0)' }} /> Completion Tokens (O/P)
                    </span>
                    {hasCacheRead && (
                        <span className="flex items-center gap-1.5">
                            <span className="h-2 w-2 rounded-full bg-run-chart-3 shadow-xs shadow-amber-500/50" /> Cache Read (R): {formatTokensCompact(derivedCacheRead)}
                        </span>
                    )}
                    {hasCacheCreation && (
                        <span className="flex items-center gap-1.5">
                            <span className="h-2 w-2 rounded-full bg-chart-2" /> Cache Write (W): {formatTokensCompact(derivedCacheCreation)}
                        </span>
                    )}
                </div>

                {/* Caption */}
                <p className="mt-2.5 text-[10px] text-center text-muted-foreground/75 leading-relaxed">
                    Tracks prompt context growth (left axis), generated answer length (right axis), and cache R/W efficiency across turns
                </p>
            </CardContent>
        </Card>
    );
}
