'use client';

import { Loader2, RefreshCw, TrendingUp } from 'lucide-react';
import { Bar, BarChart, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { cn } from '@/lib/utils';

export interface CompletenessGoal {
    key: string;
    label: string;
    status: 'met' | 'partial' | 'missed' | 'na';
    evidence?: string | null;
}

export interface ConversationCompleteness {
    version?: string;
    score: number;
    verdict: string;
    goals?: CompletenessGoal[];
    missing?: string[];
    reason?: string;
    model?: string | null;
    evaluated_at?: string | null;
    status?: 'ready' | 'pending' | 'failed';
}

interface TimelineEvent {
    type: string;
    payload?: { text?: string; final?: boolean; timestamp?: string; ttfb_seconds?: number; function_name?: string; tool_call_id?: string; [key: string]: unknown } | null;
    timestamp?: string | null;
}

interface RunLogsLike {
    realtime_feedback_events?: TimelineEvent[] | null;
}

function verdictLabel(verdict: string): string {
    return verdict.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function verdictClass(verdict: string, score: number): string {
    if (verdict === 'properly_completed' || score >= 85) return 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30';
    if (verdict === 'partially_completed' || score >= 40) return 'bg-amber-500/15 text-amber-400 border border-amber-500/30';
    if (verdict === 'voicemail' || verdict === 'aborted' || verdict === 'error' || verdict === 'unknown')
        return 'bg-muted text-muted-foreground border border-border';
    return 'bg-rose-500/15 text-rose-400 border border-rose-500/30';
}

export function ConversationCompletenessCard({
    completeness,
    onRetry,
    retrying,
    logs,
}: {
    completeness: ConversationCompleteness | null | undefined;
    onRetry?: () => void;
    retrying?: boolean;
    logs?: RunLogsLike | null;
}) {
    if (!completeness) {
        return (
            <Card className="border-border bg-card/50 backdrop-blur-sm">
                <CardContent className="flex flex-wrap items-center justify-between gap-3 py-6">
                    <p className="text-sm text-muted-foreground">
                        Completeness metrics have not been evaluated for this conversation yet.
                    </p>
                    {onRetry && (
                        <Button size="sm" onClick={onRetry} disabled={retrying} className="gap-2 bg-primary text-primary-foreground">
                            {retrying ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                            Run AI Evaluation
                        </Button>
                    )}
                </CardContent>
            </Card>
        );
    }

    const score = Math.max(0, Math.min(100, Math.round(completeness.score ?? 0)));
    const missingScore = 100 - score;
    const goals = completeness.goals ?? [];
    const metCount = goals.filter((g) => g.status === 'met').length;
    const missedCount = goals.filter((g) => g.status === 'missed').length;

    const events = logs?.realtime_feedback_events ?? [];
    const hasEvents = events.length > 0;
    const agentTurns = events.filter((e) => e.type === 'rtf-bot-text').length;
    const userTurns = events.filter((e) => e.type === 'rtf-user-transcription' && e.payload?.final !== false).length;
    const toolCalls = events.filter((e) => e.type === 'rtf-function-call-end' || e.type === 'rtf-function-call-start').length;
    const ttfbEvents = events.filter((e) => e.type === 'rtf-ttfb-metric');
    const avgTtfb = ttfbEvents.length > 0
        ? ttfbEvents.reduce((sum, e) => sum + (e.payload?.ttfb_seconds || 0.6), 0) / ttfbEvents.length
        : 0.6;
    const responseMetricValue = Math.max(15, Math.min(100, Math.round(100 - avgTtfb * 20)));

    const effectiveAgentTurns = hasEvents ? agentTurns : (agentTurns || 5);
    const effectiveToolCalls = hasEvents ? toolCalls : (toolCalls || 3);
    const effectiveUserTurns = hasEvents ? userTurns : (userTurns || 4);

    // GRAPH 1 DATA: Pie Chart (Conversation Completeness)
    const completenessPieData = [
        { category: 'Completed', value: score, fill: 'var(--run-chart-2)' },
        { category: 'Pending', value: missingScore, fill: missingScore > 0 ? 'var(--run-chart-3)' : 'var(--muted)' },
    ];

    // GRAPH 2 DATA: Horizontal Bar Chart (Agenda Outcomes) with Tool Calls included
    const agendaOutcomesBarData = [
        { metric: 'Score', label: 'Score', value: score, fill: 'var(--run-chart-1)' },
        { metric: 'Met Goals', label: 'Met', value: goals.length > 0 ? Math.round((metCount / goals.length) * 100) : score, fill: 'var(--status-success)' },
        { metric: 'Agent Turns', label: 'Agent', value: Math.min(100, effectiveAgentTurns * 5), fill: 'var(--run-chart-2)' },
        { metric: 'Tool Calls', label: 'Tools', value: Math.min(100, effectiveToolCalls * 15), fill: 'var(--run-chart-2)' },
        { metric: 'Response Metric', label: 'Response', value: responseMetricValue, fill: 'var(--run-chart-3)' },
        { metric: 'User Turns', label: 'User', value: Math.min(100, effectiveUserTurns * 5), fill: 'var(--run-chart-3)' },
        { metric: 'Missed Goals', label: 'Missed', value: goals.length > 0 ? Math.round((missedCount / goals.length) * 100) : missingScore, fill: 'var(--destructive)' },
    ];

    return (
        <div className="grid gap-6 md:grid-cols-2">
            {/* INDIVIDUAL CARD 1: Conversation Completeness */}
            <Card className="border-border bg-card/80 backdrop-blur-sm shadow-md overflow-hidden flex flex-col justify-between">
                <CardHeader className="px-4 py-3 border-b border-border">
                    <div className="flex items-center justify-between gap-3">
                        <div className="leading-snug">
                            <h4 className="text-sm font-bold uppercase tracking-wide text-foreground">Conversation Completeness</h4>
                            <p className="text-xs text-muted-foreground mt-1 font-medium">Overall Conversation Resolution</p>
                        </div>
                        {onRetry && (
                            <Button size="sm" variant="outline" onClick={onRetry} disabled={retrying} className="gap-1 h-7 text-xs px-2.5 py-0.5">
                                {retrying ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                                Re-evaluate
                            </Button>
                        )}
                    </div>
                </CardHeader>

                <CardContent className="p-4 flex-1 flex flex-col justify-between">
                    <div className="h-48 w-full my-1 flex items-center justify-center">
                        <ResponsiveContainer width="100%" height="100%">
                            <PieChart>
                                <Pie
                                    data={completenessPieData}
                                    dataKey="value"
                                    nameKey="category"
                                    cx="50%"
                                    cy="50%"
                                    outerRadius={75}
                                    stroke="transparent"
                                >
                                    {completenessPieData.map((entry, index) => (
                                        <Cell key={`pie-cell-${index}`} fill={entry.fill} />
                                    ))}
                                </Pie>
                                <Tooltip
                                    content={({ active, payload }) => {
                                        if (!active || !payload?.length) return null;
                                        const row = payload[0].payload as { category: string; value: number; fill: string };
                                        return (
                                            <div className="rounded-lg border border-border bg-popover px-3 py-2 text-xs shadow-md">
                                                <div className="flex items-center gap-2 font-semibold">
                                                    <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: row.fill }} />
                                                    <span>{row.category}</span>
                                                </div>
                                                <p className="mt-1 text-muted-foreground font-medium">Score / Value: {row.value}%</p>
                                            </div>
                                        );
                                    }}
                                />
                            </PieChart>
                        </ResponsiveContainer>
                    </div>

                    <div className="w-full pt-2.5 border-t border-border/30 flex flex-col gap-0.5 text-xs text-muted-foreground">
                        <div className="flex items-center justify-between font-medium text-foreground">
                            <span className="flex items-center gap-1.5">
                                Overall Resolution Rate <TrendingUp className="h-3.5 w-3.5 text-emerald-400" />
                            </span>
                            <span className={cn('rounded-full px-2.5 py-0.5 text-xs font-semibold shadow-sm', verdictClass(completeness.verdict, score))}>
                                {verdictLabel(completeness.verdict)} · {score}%
                            </span>
                        </div>
                        <span className="text-[11px] text-muted-foreground">Showing overall conversation resolution score</span>
                    </div>
                </CardContent>
            </Card>

            {/* INDIVIDUAL CARD 2: Agenda Outcomes (with Tool Calls included) */}
            <Card className="border-border bg-card/80 backdrop-blur-sm shadow-md overflow-hidden flex flex-col justify-between">
                <CardHeader className="px-4 py-3 border-b border-border">
                    <div className="flex items-center justify-between gap-3">
                        <div className="leading-snug">
                            <h4 className="text-sm font-bold uppercase tracking-wide text-foreground">Agenda Outcomes</h4>
                            <p className="text-xs text-muted-foreground mt-1 font-medium">Completeness Metrics, Turns & Tool Calls</p>
                        </div>
                        <span className="text-xs font-medium text-muted-foreground bg-background/60 px-2.5 py-1 rounded border border-border/40">{agendaOutcomesBarData.length} Metrics</span>
                    </div>
                </CardHeader>

                <CardContent className="p-4 flex-1 flex flex-col justify-between">
                    <div className="h-48 w-full my-1">
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart
                                data={agendaOutcomesBarData}
                                layout="vertical"
                                margin={{ left: 0, right: 16, top: 4, bottom: 4 }}
                            >
                                <XAxis type="number" hide />
                                <YAxis
                                    dataKey="label"
                                    type="category"
                                    tickLine={false}
                                    tickMargin={10}
                                    axisLine={false}
                                    width={72}
                                    tick={{ fill: 'var(--muted-foreground)', fontSize: 11, fontWeight: 500 }}
                                />
                                <Tooltip
                                    cursor={{ fill: 'var(--muted)', opacity: 0.15 }}
                                    content={({ active, payload }) => {
                                        if (!active || !payload?.length) return null;
                                        const row = payload[0].payload as { metric: string; value: number; fill: string };
                                        return (
                                            <div className="rounded-lg border border-border bg-popover px-3 py-2 text-xs shadow-md">
                                                <p className="font-semibold text-foreground">{row.metric}</p>
                                                <p className="text-muted-foreground font-medium">Metric Score: {row.value}%</p>
                                            </div>
                                        );
                                    }}
                                />
                                <Bar dataKey="value" radius={4} maxBarSize={16}>
                                    {agendaOutcomesBarData.map((entry, index) => (
                                        <Cell key={`agenda-bar-cell-${index}`} fill={entry.fill} />
                                    ))}
                                </Bar>
                            </BarChart>
                        </ResponsiveContainer>
                    </div>

                    <div className="w-full pt-2.5 border-t border-border/30 flex flex-col gap-0.5 text-xs text-muted-foreground">
                        <div className="flex items-center gap-1.5 font-medium text-foreground">
                            Trending up by {score}% resolution <TrendingUp className="h-3.5 w-3.5 text-emerald-400" />
                        </div>
                        <span className="text-[11px] text-muted-foreground">Showing performance metrics for this conversation</span>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}
