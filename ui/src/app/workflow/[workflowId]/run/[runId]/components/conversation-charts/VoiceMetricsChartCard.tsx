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

export interface VoiceMetricsChartCardProps {
    cardNumber: number;
    turnsData: TurnTelemetryItem[];
    totalSttSec: number;
    totalTtsChars: number;
    hasStt: boolean;
    hasTts: boolean;
}

export function VoiceMetricsChartCard({
    cardNumber,
    turnsData,
    totalSttSec,
    totalTtsChars,
    hasStt,
    hasTts,
}: VoiceMetricsChartCardProps) {
    return (
        <Card className="border-border/80 bg-card/70 backdrop-blur-sm overflow-hidden shadow-lg shadow-black/25 hover:shadow-xl transition-all duration-300">
            <CardHeader className="px-3.5 pt-3 pb-1.5">
                <div className="flex items-center justify-between gap-2">
                    <CardTitle className="text-xs font-bold uppercase tracking-wider text-foreground">
                        {cardNumber}. VOICE &amp; SPEECH METRICS
                    </CardTitle>
                    <Badge variant="outline" className="h-5 px-2 text-[10px] font-mono font-medium border-amber-500/30 bg-amber-500/10 text-amber-400">
                        {hasStt ? `STT: ${totalSttSec.toFixed(1)}s` : ''}
                        {hasStt && hasTts ? ' • ' : ''}
                        {hasTts ? `TTS: ${totalTtsChars.toLocaleString()} chars` : ''}
                    </Badge>
                </div>
            </CardHeader>
            <CardContent className="px-2.5 pb-2.5 pt-0.5">
                <div className="h-64 sm:h-72 w-full cursor-pointer">
                    <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={turnsData} margin={{ top: 8, right: 8, left: -22, bottom: 0 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                            <XAxis dataKey="turn" stroke="var(--muted-foreground)" fontSize={11} tickLine={false} />
                            {hasStt && <YAxis yAxisId="sec" stroke="var(--muted-foreground)" fontSize={11} tickFormatter={(v) => `${v}s`} tickLine={false} />}
                            {hasTts && <YAxis yAxisId="chars" orientation={hasStt ? 'right' : 'left'} stroke="var(--muted-foreground)" fontSize={11} tickLine={false} />}
                            <Tooltip content={<CustomChartTooltip />} cursor={false} />
                            {hasStt && <Bar yAxisId="sec" dataKey="sttDurationSec" name="STT Audio (Sec)" fill="var(--run-chart-2)" barSize={16} radius={[2, 2, 0, 0]} />}
                            {hasTts && <Bar yAxisId="chars" dataKey="ttsChars" name="TTS Synthesized (Chars)" fill="var(--chart-violet, #7915A0)" barSize={16} radius={[2, 2, 0, 0]} />}
                        </BarChart>
                    </ResponsiveContainer>
                </div>
                <div className="mt-1.5 flex items-center justify-center gap-4 text-[11px] text-muted-foreground">
                    {hasStt && (
                        <span className="flex items-center gap-1.5">
                            <span className="h-2 w-2 rounded-xs bg-run-chart-2" /> STT Audio (Sec)
                        </span>
                    )}
                    {hasTts && (
                        <span className="flex items-center gap-1.5">
                            <span className="h-2 w-2 rounded-xs" style={{ backgroundColor: 'var(--chart-violet, #7915A0)' }} /> TTS Synthesized (Chars)
                        </span>
                    )}
                </div>
                <p className="mt-0.5 text-[10px] text-center text-muted-foreground/75 leading-relaxed">
                    Actual speech billing units: {hasStt ? 'processed input audio duration' : ''}
                    {hasStt && hasTts ? ' and ' : ''}
                    {hasTts ? 'synthesized text character counts' : ''}
                </p>
            </CardContent>
        </Card>
    );
}

