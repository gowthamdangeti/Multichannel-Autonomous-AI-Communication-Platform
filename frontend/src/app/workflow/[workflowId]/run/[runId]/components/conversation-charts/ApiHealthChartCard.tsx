'use client';

import React from 'react';
import {
    Bar,
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

export interface PipelineErrorDetail {
    error: string;
    processor: string | null;
    fatal: boolean;
    exceptionType: string | null;
    code: string | null;
    status: string | null;
}

export interface ApiHealthChartCardProps {
    cardNumber: number;
    turnsData: TurnTelemetryItem[];
    totalRequests: number;
    overallSuccessRate: number | null;
    totalFailedReqs: number;
    pipelineErrorDetails: PipelineErrorDetail[];
}

export function ApiHealthChartCard({
    cardNumber,
    turnsData,
    totalRequests,
    overallSuccessRate,
    totalFailedReqs,
    pipelineErrorDetails,
}: ApiHealthChartCardProps) {
    return (
        <Card className="border-border/80 bg-card/70 backdrop-blur-sm overflow-hidden shadow-lg shadow-black/25 hover:shadow-xl transition-all duration-300">
            <CardHeader className="px-3.5 pt-3 pb-1.5">
                <div className="flex items-center justify-between gap-2">
                    <CardTitle className="text-xs font-bold uppercase tracking-wider text-foreground">
                        {cardNumber}. TOTAL API REQUESTS &amp; HEALTH
                    </CardTitle>
                    <Badge
                        variant="outline"
                        className={`h-5 px-2 text-[10px] font-mono font-medium ${
                            totalFailedReqs > 0
                                ? 'border-amber-500/30 bg-amber-500/10 text-amber-400'
                                : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
                        }`}
                    >
                        {totalRequests} Requests • {overallSuccessRate ?? 100}%{totalFailedReqs > 0 ? ` • ${totalFailedReqs} Failed` : ''}
                    </Badge>
                </div>
            </CardHeader>
            <CardContent className="px-2.5 pb-2.5 pt-0.5">
                <div className="h-64 sm:h-72 w-full cursor-pointer">
                    <ResponsiveContainer width="100%" height="100%">
                        <ComposedChart data={turnsData} margin={{ top: 8, right: 8, left: -22, bottom: 0 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                            <XAxis dataKey="turn" stroke="var(--muted-foreground)" fontSize={11} tickLine={false} />
                            <YAxis
                                yAxisId="left"
                                stroke="var(--muted-foreground)"
                                fontSize={11}
                                domain={[0, Math.max(1, ...turnsData.map((t) => t.apiRequests))]}
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
                            <Tooltip content={<CustomChartTooltip />} cursor={false} />
                            <Bar
                                yAxisId="left"
                                dataKey="successfulRequests"
                                name="Successful"
                                fill="var(--run-chart-2)"
                                stackId="requests"
                                barSize={22}
                                radius={totalFailedReqs > 0 ? undefined : [2, 2, 0, 0]}
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
                                dot={{ r: 3, fill: 'var(--run-chart-3)' }}
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
                        <span className="h-2 w-2 rounded-xs" style={{ backgroundColor: 'var(--chart-violet, #7915A0)' }} /> Failed
                    </span>
                    <span className="flex items-center gap-1.5">
                        <span className="h-2 w-2 rounded-full bg-run-chart-3" /> Success Rate (%)
                    </span>
                </div>
                {pipelineErrorDetails.length > 0 && (
                    <div className="mt-1.5 rounded-md border border-purple-500/20 bg-purple-500/5 p-2">
                        <p className="text-[10px] font-semibold text-purple-400 uppercase tracking-wider mb-1.5">
                            Pipeline Errors ({pipelineErrorDetails.length})
                        </p>
                        <div className="space-y-1 max-h-24 overflow-y-auto">
                            {pipelineErrorDetails.map((err, idx) => (
                                <div key={idx} className="flex items-start gap-1.5 text-[10px] text-muted-foreground">
                                    <span className="shrink-0 mt-0.5">•</span>
                                    <span className="font-mono break-all">
                                        {err.processor && <span className="text-foreground/80">[{err.processor}] </span>}
                                        {err.code && <span className="font-semibold text-foreground">{err.code}: </span>}
                                        {err.error}
                                        {err.fatal && (
                                            <Badge variant="outline" className="ml-1.5 h-3.5 px-1 text-[8px] border-purple-500/40 text-purple-400">
                                                FATAL
                                            </Badge>
                                        )}
                                    </span>
                                </div>
                            ))}
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

