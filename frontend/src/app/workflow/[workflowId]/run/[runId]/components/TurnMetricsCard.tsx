'use client';

import {
    MessageSquare,
} from 'lucide-react';
import React, { useMemo } from 'react';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';

import type { RealtimeFeedbackEvent, WorkflowRunResponse } from './types';

export interface ParsedTurn {
    index: number;
    nodeName: string;
    userText: string;
    botText: string;
    sttLatencyMs: number;
    llmLatencyMs: number;
    ttsLatencyMs: number;
    totalLatencyMs: number;
    costUsd: number;
}

export function parseTurns(workflowRun?: WorkflowRunResponse | null): ParsedTurn[] {
    const events = (workflowRun?.logs?.realtime_feedback_events ?? []) as RealtimeFeedbackEvent[];
    const turnMap = new Map<number, Partial<ParsedTurn>>();

    events.forEach((ev) => {
        if (typeof ev.turn !== 'number') return;
        const t = ev.turn;
        const evNodeName = ev.node_name || ev.payload?.node_name || '';
        if (!turnMap.has(t)) {
            turnMap.set(t, {
                index: t,
                nodeName: evNodeName,
                userText: '',
                botText: '',
                sttLatencyMs: 0,
                llmLatencyMs: 0,
                ttsLatencyMs: 0,
                totalLatencyMs: 0,
                costUsd: 0,
            });
        }
        const cur = turnMap.get(t)!;
        if (ev.type === 'rtf-user-transcription' && ev.payload?.text) {
            cur.userText = (cur.userText ? cur.userText + ' ' : '') + ev.payload.text;
            if (ev.payload.duration_seconds) {
                cur.sttLatencyMs = Math.round(Number(ev.payload.duration_seconds) * 1000);
            }
        } else if (ev.type === 'rtf-bot-text' && ev.payload?.text) {
            cur.botText = (cur.botText ? cur.botText + ' ' : '') + ev.payload.text;
        } else if (ev.type === 'rtf-ttfb-metric' && ev.payload?.ttfb_seconds) {
            cur.llmLatencyMs = Math.round(ev.payload.ttfb_seconds * 1000);
        } else if (ev.type === 'rtf-latency-measured' && ev.payload?.latency_seconds) {
            cur.totalLatencyMs = Math.round(ev.payload.latency_seconds * 1000);
        }
        if (evNodeName) {
            cur.nodeName = evNodeName;
        }
    });

    return Array.from(turnMap.values()).map((t, idx) => ({
        index: typeof t.index === 'number' ? t.index : idx + 1,
        nodeName: t.nodeName || '',
        userText: t.userText || '',
        botText: t.botText || '',
        sttLatencyMs: t.sttLatencyMs || 0,
        llmLatencyMs: t.llmLatencyMs || 0,
        ttsLatencyMs: t.ttsLatencyMs || 0,
        totalLatencyMs: t.totalLatencyMs || 0,
        costUsd: t.costUsd || 0,
    }));
}

export interface TurnMetricsCardProps {
    workflowRun?: WorkflowRunResponse | null;
    turns?: ParsedTurn[];
    className?: string;
}

export function TurnMetricsCard({
    workflowRun,
    turns: providedTurns,
    className,
}: TurnMetricsCardProps) {
    const turns = useMemo(() => providedTurns || parseTurns(workflowRun), [providedTurns, workflowRun]);

    return (
        <Card className={cn("border-border/70 bg-card/60 backdrop-blur-sm shadow-sm overflow-hidden", className)}>
            <CardHeader className="p-4 pb-3 border-b border-border/40">
                <div className="flex items-center gap-2">
                    <MessageSquare className="h-3.5 w-3.5 text-primary" />
                    <CardTitle className="text-xs font-bold uppercase tracking-wider text-foreground">
                        Turn Metrics ({turns.length} Turns)
                    </CardTitle>
                </div>
            </CardHeader>
            <CardContent className="p-4 space-y-3 max-h-[460px] overflow-y-auto">
                {turns.length === 0 && (
                    <p className="text-xs text-muted-foreground text-center py-4">
                        No turn telemetry recorded yet. Events will populate as the conversation proceeds.
                    </p>
                )}
                {turns.map((turn) => (
                    <div
                        key={turn.index}
                        className="rounded-lg border border-border/50 bg-muted/15 p-3 space-y-2 hover:border-border/80 transition-colors"
                    >
                        {/* Turn header */}
                        <div className="flex items-center justify-between text-xs pb-1 border-b border-border/30">
                            <span className="font-bold font-mono text-foreground uppercase tracking-wider">
                                Turn #{turn.index}
                            </span>
                            {turn.nodeName && (
                                <Badge variant="outline" className="h-5 px-2 text-[10px] font-mono border-border/60 bg-muted/50 text-foreground">
                                    {turn.nodeName}
                                </Badge>
                            )}
                        </div>

                        {/* Dialogue text — distinct role tags and normal weight body text */}
                        <div className="space-y-2 text-xs sm:text-[13px] leading-relaxed">
                            {turn.userText && (
                                <div className="flex items-start gap-2">
                                    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider bg-sky-500/10 border border-sky-500/30 text-sky-600 dark:text-sky-400 shrink-0 select-none">
                                        User
                                    </span>
                                    <p className="font-normal text-foreground flex-1 min-w-0">
                                        {turn.userText}
                                    </p>
                                </div>
                            )}
                            {turn.botText && (
                                <div className="flex items-start gap-2">
                                    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider bg-primary/10 border border-primary/30 text-primary shrink-0 select-none">
                                        Agent
                                    </span>
                                    <p className="font-normal text-foreground flex-1 min-w-0">
                                        {turn.botText}
                                    </p>
                                </div>
                            )}
                        </div>

                        {/* Turn footer metrics */}
                        <div className="flex flex-wrap items-center justify-between pt-1.5 border-t border-border/30 text-[10px] font-mono text-muted-foreground">
                            <div className="flex items-center gap-2 sm:gap-3">
                                {turn.sttLatencyMs > 0 && <span>STT: <span className="font-medium text-foreground">{turn.sttLatencyMs}ms</span></span>}
                                {turn.llmLatencyMs > 0 && <span>LLM: <span className="font-medium text-foreground">{turn.llmLatencyMs}ms</span></span>}
                                {turn.ttsLatencyMs > 0 && <span>TTS: <span className="font-medium text-foreground">{turn.ttsLatencyMs}ms</span></span>}
                                {turn.totalLatencyMs > 0 && <span>Total: <span className="font-medium text-foreground">{turn.totalLatencyMs}ms</span></span>}
                            </div>
                        </div>
                    </div>
                ))}
            </CardContent>
        </Card>
    );
}

