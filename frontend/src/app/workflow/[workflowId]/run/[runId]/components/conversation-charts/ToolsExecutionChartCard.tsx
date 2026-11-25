'use client';

import React from 'react';
import {
    Bar,
    BarChart,
    CartesianGrid,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
} from 'recharts';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

import type { TurnTelemetryItem } from '../extractConversationTelemetry';
import { CustomChartTooltip } from './ChartTooltip';

export interface ToolsExecutionChartCardProps {
    cardNumber: number;
    turnsData: TurnTelemetryItem[];
    totalToolCalls: number;
    fullWidth?: boolean;
}

export function ToolsExecutionChartCard({
    cardNumber,
    turnsData,
    totalToolCalls,
    fullWidth = false,
}: ToolsExecutionChartCardProps) {
    return (
        <Card className={`${fullWidth ? 'md:col-span-2' : ''} border-border/80 bg-card/70 backdrop-blur-sm overflow-hidden shadow-lg shadow-black/25 hover:shadow-xl transition-all duration-300`}>
            <CardHeader className="px-3.5 pt-3 pb-1.5">
                <div className="flex items-center justify-between gap-2">
                    <CardTitle className="text-xs font-bold uppercase tracking-wider text-foreground">
                        {cardNumber}. TOOLS &amp; RAG EXECUTION
                    </CardTitle>
                    <Badge variant="outline" className="h-5 px-2 text-[10px] font-mono font-medium border-purple-500/30 bg-purple-500/10 text-purple-400">
                        Calls: {totalToolCalls}
                    </Badge>
                </div>
            </CardHeader>
            <CardContent className="px-2.5 pb-2.5 pt-0.5">
                {totalToolCalls > 0 ? (
                    <>
                        <div className="h-64 sm:h-72 w-full cursor-pointer">
                            <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={turnsData} margin={{ top: 8, right: 8, left: -22, bottom: 0 }}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                                    <XAxis dataKey="turn" stroke="var(--muted-foreground)" fontSize={11} tickLine={false} />
                                    <YAxis stroke="var(--muted-foreground)" fontSize={11} tickLine={false} allowDecimals={false} />
                                    <Tooltip content={<CustomChartTooltip />} cursor={false} />
                                    <Bar dataKey="toolCalls" name="Tool Calls" fill="var(--chart-violet, #7915A0)" barSize={22} radius={[2, 2, 0, 0]} opacity={0.85} />
                                </BarChart>
                            </ResponsiveContainer>
                        </div>
                        <div className="mt-1.5 flex items-center justify-center gap-4 text-[11px] text-muted-foreground">
                            <span className="flex items-center gap-1.5">
                                <span className="h-2 w-2 rounded-xs" style={{ backgroundColor: 'var(--chart-violet, #7915A0)' }} /> Tool Calls
                            </span>
                        </div>
                    </>
                ) : (
                    <div className="h-64 sm:h-72 w-full flex flex-col items-center justify-center text-center p-2">
                        <div className="h-10 w-10 rounded-full border flex items-center justify-center mb-2" style={{ backgroundColor: 'oklch(from var(--chart-violet, #7915A0) l c h / 0.15)', borderColor: 'oklch(from var(--chart-violet, #7915A0) l c h / 0.3)' }}>
                            <div className="h-3 w-3 rounded-full" style={{ backgroundColor: 'var(--chart-violet, #7915A0)' }} />
                        </div>
                        <p className="text-xs font-bold text-foreground">Direct Conversation Flow</p>
                        <p className="text-[11px] text-muted-foreground max-w-xs mt-1">
                            No external tool calls or Knowledge Base searches were triggered in this session.
                        </p>
                    </div>
                )}
                <p className="mt-0.5 text-[10px] text-center text-muted-foreground/75 leading-relaxed">
                    Tracks Knowledge Base retrievals and external tool/webhook execution frequency per turn
                </p>
            </CardContent>
        </Card>
    );
}

