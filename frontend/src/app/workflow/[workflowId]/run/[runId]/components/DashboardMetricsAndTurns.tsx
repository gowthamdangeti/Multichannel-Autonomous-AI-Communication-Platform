'use client';

import {
    RefreshCw,
    Zap,
} from 'lucide-react';
import React, { useMemo, useState } from 'react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';

import {
    type ParsedTurn,
    parseTurns,
    TurnMetricsCard,
    type TurnMetricsCardProps,
} from './TurnMetricsCard';
import type { RealtimeFeedbackEvent, WorkflowRunResponse } from './types';

export {
    type ParsedTurn,
    parseTurns,
    TurnMetricsCard,
    type TurnMetricsCardProps,
};

export interface DashboardMetricsAndTurnsProps {
    workflowRun?: WorkflowRunResponse | null;
    onRefresh?: () => void;
    showTurnMetrics?: boolean;
}

export function formatUSD(num: number): string {
    if (num <= 0) return '$0.0000';
    if (num < 0.0001) return '< $0.0001';
    return `$${num.toFixed(4)}`;
}

export function DashboardMetricsAndTurns({
    workflowRun,
    onRefresh,
    showTurnMetrics = false,
}: DashboardMetricsAndTurnsProps) {
    const [isRefreshing, setIsRefreshing] = useState(false);

    const handleRefresh = async () => {
        setIsRefreshing(true);
        if (onRefresh) {
            await onRefresh();
        }
        setTimeout(() => {
            setIsRefreshing(false);
            toast.success('Metrics refreshed');
        }, 600);
    };

    // Extract turns and metrics from real event data
    const { turns, nodeStats, overall } = useMemo(() => {
        const events = (workflowRun?.logs?.realtime_feedback_events ?? []) as RealtimeFeedbackEvent[];
        const rawTokens = Number(workflowRun?.cost_info?.convozent_token_usage) || 0;
        const parsedTurns = parseTurns(workflowRun);

        // Count unique nodes visited via node-transition events
        const visitedNodes = new Set<string>();
        let toolCallCount = 0;
        let kbCallCount = 0;

        // Per-node aggregates from turn data
        const nodesMap = new Map<string, { turns: number; responseMs: number; sttMs: number; llmMs: number; ttsMs: number }>();

        events.forEach((ev: RealtimeFeedbackEvent) => {
            const nodeName = ev.node_name || ev.payload?.node_name;
            if (ev.type === 'rtf-node-transition' && ev.payload?.node_name) {
                visitedNodes.add(ev.payload.node_name);
            }
            if (ev.type === 'rtf-function-call-start') {
                toolCallCount += 1;
                const fnName = ((ev.payload as { function_name?: string })?.function_name || '').toLowerCase();
                if (fnName.includes('knowledge') || fnName.includes('kb') || fnName.includes('rag') || fnName.includes('search')) {
                    kbCallCount += 1;
                }
            }
            if (nodeName) visitedNodes.add(nodeName);
        });

        parsedTurns.forEach((t) => {
            if (!t.nodeName) return;
            const name = t.nodeName;
            if (!nodesMap.has(name)) {
                nodesMap.set(name, { turns: 0, responseMs: 0, sttMs: 0, llmMs: 0, ttsMs: 0 });
            }
            const n = nodesMap.get(name)!;
            n.turns += 1;
            n.responseMs += t.totalLatencyMs;
            n.sttMs += t.sttLatencyMs;
            n.llmMs += t.llmLatencyMs;
            n.ttsMs += t.ttsLatencyMs;
        });

        // Also include nodes from transitions that had no turn data
        visitedNodes.forEach((name) => {
            if (!nodesMap.has(name)) {
                nodesMap.set(name, { turns: 0, responseMs: 0, sttMs: 0, llmMs: 0, ttsMs: 0 });
            }
        });

        const nodeStatsList = Array.from(nodesMap.entries()).map(([node, data]) => ({
            node,
            turns: data.turns,
            responseMs: data.responseMs,
            sttMs: data.sttMs,
            llmMs: data.llmMs,
            ttsMs: data.ttsMs,
        }));

        const totalUserTurns = parsedTurns.filter((t) => Boolean(t.userText)).length;
        const totalBotTurns = parsedTurns.filter((t) => Boolean(t.botText)).length;

        return {
            turns: parsedTurns,
            nodeStats: nodeStatsList,
            overall: {
                kbCalls: kbCallCount,
                tokenUsage: rawTokens,
                userTurns: totalUserTurns,
                botTurns: totalBotTurns,
                toolCalls: toolCallCount,
                nodesVisited: visitedNodes.size || nodeStatsList.length,
            },
        };
    }, [workflowRun]);

    return (
        <div className="w-full space-y-4">

            {/* ── CARD 1: RUN METRICS ── */}
            <Card className="border-border/70 bg-card/60 backdrop-blur-sm shadow-sm overflow-hidden">
                <CardHeader className="p-4 pb-3 flex flex-row items-center justify-between border-b border-border/40">
                    <CardTitle className="text-xs font-bold uppercase tracking-wider text-foreground">
                        Run Metrics
                    </CardTitle>
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={handleRefresh}
                        disabled={isRefreshing}
                        className="h-6 px-2 text-[10px] font-mono uppercase tracking-wider gap-1 border-border/60 hover:bg-muted/60"
                    >
                        <RefreshCw className={cn("h-3 w-3", isRefreshing && "animate-spin")} />
                        Refresh
                    </Button>
                </CardHeader>
                <CardContent className="p-4 pt-3">
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                        {/* KB Calls */}
                        <div className="rounded-lg border border-border/40 bg-muted/20 p-3 space-y-1">
                            <p className="text-[10px] uppercase font-semibold text-muted-foreground tracking-wider">
                                Knowledge Base Calls
                            </p>
                            <p className="text-xl font-bold font-mono text-foreground">
                                {overall.kbCalls}
                            </p>
                        </div>

                        {/* Token Usage */}
                        <div className="rounded-lg border border-border/40 bg-muted/20 p-3 space-y-1">
                            <p className="text-[10px] uppercase font-semibold text-muted-foreground tracking-wider">
                                Token Usage
                            </p>
                            <p className="text-xl font-bold font-mono text-foreground">
                                {overall.tokenUsage.toLocaleString()}
                            </p>
                        </div>

                        {/* User Turns */}
                        <div className="rounded-lg border border-border/40 bg-muted/20 p-3 space-y-1">
                            <p className="text-[10px] uppercase font-semibold text-muted-foreground tracking-wider">
                                User Turns
                            </p>
                            <p className="text-xl font-bold font-mono text-foreground">
                                {overall.userTurns}
                            </p>
                        </div>

                        {/* Bot Turns */}
                        <div className="rounded-lg border border-border/40 bg-muted/20 p-3 space-y-1">
                            <p className="text-[10px] uppercase font-semibold text-muted-foreground tracking-wider">
                                Bot Turns
                            </p>
                            <p className="text-xl font-bold font-mono text-foreground">
                                {overall.botTurns}
                            </p>
                        </div>

                        {/* Tool Calls */}
                        <div className="rounded-lg border border-border/40 bg-muted/20 p-3 space-y-1">
                            <p className="text-[10px] uppercase font-semibold text-muted-foreground tracking-wider">
                                Tool Calls
                            </p>
                            <p className="text-xl font-bold font-mono text-foreground">
                                {overall.toolCalls}
                            </p>
                        </div>

                        {/* Nodes Visited */}
                        <div className="rounded-lg border border-border/40 bg-muted/20 p-3 space-y-1">
                            <p className="text-[10px] uppercase font-semibold text-muted-foreground tracking-wider">
                                Nodes Visited
                            </p>
                            <p className="text-xl font-bold font-mono text-foreground">
                                {overall.nodesVisited}
                            </p>
                        </div>
                    </div>
                </CardContent>
            </Card>

            {/* ── CARD 2: PER-NODE PERFORMANCE ── */}
            <Card className="border-border/70 bg-card/60 backdrop-blur-sm shadow-sm overflow-hidden">
                <CardHeader className="p-4 pb-3 flex flex-row items-center justify-between border-b border-border/40">
                    <div className="flex items-center gap-2">
                        <Zap className="h-3.5 w-3.5 text-primary" />
                        <CardTitle className="text-xs font-bold uppercase tracking-wider text-foreground">
                            Per-Node Performance
                        </CardTitle>
                    </div>
                    <Badge variant="outline" className="h-5 px-2 text-[10px] font-mono border-border/60 bg-muted/50 text-foreground">
                        {nodeStats.length} active nodes
                    </Badge>
                </CardHeader>
                <CardContent className="p-4 pt-0 overflow-x-auto">
                    <table className="w-full text-xs">
                        <thead className="text-[10px] uppercase font-semibold text-muted-foreground tracking-wider border-b border-border/40">
                            <tr>
                                <th className="py-2.5 px-3 text-left">Node</th>
                                <th className="py-2.5 px-3 text-center">Turns</th>
                                <th className="py-2.5 px-3 text-center">Response</th>
                                <th className="py-2.5 px-3 text-center">STT</th>
                                <th className="py-2.5 px-3 text-center">LLM</th>
                                <th className="py-2.5 px-3 text-center">TTS</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-border/30 font-mono">
                            {nodeStats.length === 0 && (
                                <tr>
                                    <td colSpan={6} className="py-4 text-center text-muted-foreground font-sans text-[11px]">
                                        No node activity recorded yet. Data will appear as the conversation proceeds.
                                    </td>
                                </tr>
                            )}
                            {nodeStats.map((item, idx) => (
                                <tr key={idx} className="hover:bg-muted/20 transition-colors">
                                    <td className="py-2.5 px-3 font-sans font-medium text-foreground">{item.node}</td>
                                    <td className="py-2.5 px-3 text-center text-foreground">{item.turns}</td>
                                    <td className="py-2.5 px-3 text-center text-muted-foreground">{item.responseMs > 0 ? `${item.responseMs}ms` : '—'}</td>
                                    <td className="py-2.5 px-3 text-center text-muted-foreground">{item.sttMs > 0 ? `${item.sttMs}ms` : '—'}</td>
                                    <td className="py-2.5 px-3 text-center text-muted-foreground">{item.llmMs > 0 ? `${item.llmMs}ms` : '—'}</td>
                                    <td className="py-2.5 px-3 text-center text-muted-foreground">{item.ttsMs > 0 ? `${item.ttsMs}ms` : '—'}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </CardContent>
            </Card>

            {/* ── CARD 3: TURN METRICS (CONDITIONAL) ── */}
            {showTurnMetrics && <TurnMetricsCard turns={turns} />}
        </div>
    );
}
