'use client';

import {
    Activity,
    Bot,
    CheckCircle2,
    Coins,
    Cpu,
    FileSpreadsheet,
    FileText,
    Layers,
    Mic,
    Sparkles,
    TrendingUp,
    Volume2,
    Zap,
} from 'lucide-react';
import React, { useMemo, useState } from 'react';
import {
    Bar,
    BarChart,
    CartesianGrid,
    Cell,
    Pie,
    PieChart,
    ResponsiveContainer,
    Tooltip as RechartsTooltip,
    XAxis,
    YAxis,
} from 'recharts';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { ModelPricingRule } from '@/context/OrgConfigContext';
import { formatItemCost, formatTotalCost, resolveLLMPricing, resolveSTTPricing, resolveTTSPricing } from '@/lib/modelPricing';
import { cn } from '@/lib/utils';

// ============================================================================
// Types
// ============================================================================
export interface LLMUsageItem {
    rawKey: string;
    category: 'agent_llm' | 'report_generation' | 'qa_analysis';
    processorName: string;
    modelName: string;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    cacheReadTokens: number;
    cacheCreationTokens: number;
    inputRatePer1M: number;
    outputRatePer1M: number;
    inputCostUSD: number;
    outputCostUSD: number;
    totalCostUSD: number;
    priced: boolean;
}

export interface TTSUsageItem {
    rawKey: string;
    serviceName: string;
    voiceOrModel: string;
    characters: number;
    tokensEquivalent: number;
    ratePer1MChars: number;
    costUSD: number;
    priced: boolean;
}

export interface STTUsageItem {
    rawKey: string;
    serviceName: string;
    model: string;
    durationSeconds: number;
    durationMinutes: number;
    ratePerMinute: number;
    costUSD: number;
    priced: boolean;
}

export interface DetailedUsageBreakdownProps {
    usageInfo?: {
        llm?: Record<string, {
            prompt_tokens?: number;
            completion_tokens?: number;
            total_tokens?: number;
            cache_read_input_tokens?: number;
            cache_creation_input_tokens?: number;
        }>;
        tts?: Record<string, number>;
        stt?: Record<string, number>;
        call_duration_seconds?: number | null;
    } | null;
    costInfo?: {
        autonomous_ai_os_token_usage?: number | null;
        call_duration_seconds?: number | null;
        charge_usd?: number | null;
    } | null;
    gatheredContext?: Record<string, unknown> | null;
    reportStatus?: string | null;
    reportS3Key?: string | null;
    isCompleted?: boolean;
    organizationPricing?: {
        price_per_second_usd?: number | null;
    } | null;
    modelPricingRules?: ModelPricingRule[];
}

// ============================================================================
// Helpers
// ============================================================================
function formatUSD(amount: number): string {
    if (amount <= 0) return '$0.00';
    if (amount < 0.0001) return '< $0.0001';
    if (amount < 0.01) return `$${amount.toFixed(4)}`;
    return `$${amount.toFixed(2)}`;
}

function formatTokens(n: number): string {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
    return n.toLocaleString();
}

function parseCompositeKey(key: string): { service: string; model: string } {
    if (key.includes('|||')) {
        const [service, model] = key.split('|||');
        return {
            service: service.replace(/Service#\d+/i, '').replace(/#\d+/g, '').trim(),
            model: (model || 'Standard').trim(),
        };
    }
    return { service: key, model: 'Default' };
}

function pct(part: number, total: number): number {
    if (total <= 0) return 0;
    return Math.round((part / total) * 100);
}

// ============================================================================
// Sub-components
// ============================================================================

function MetricTile({
    label,
    value,
    subValue,
    icon: Icon,
    color,
    trend,
}: {
    label: string;
    value: string;
    subValue?: string;
    icon: React.ElementType;
    color: string;
    trend?: string;
}) {
    const colorMap: Record<string, { bg: string; text: string; icon: string }> = {
        slate: { bg: 'bg-slate-500/8 dark:bg-slate-400/10', text: 'text-slate-700 dark:text-slate-300', icon: 'text-slate-500 dark:text-slate-400' },
        blue: { bg: 'bg-blue-500/8 dark:bg-blue-400/10', text: 'text-blue-700 dark:text-blue-300', icon: 'text-blue-500 dark:text-blue-400' },
        amber: { bg: 'bg-amber-500/8 dark:bg-amber-400/10', text: 'text-amber-700 dark:text-amber-300', icon: 'text-amber-500 dark:text-amber-400' },
        purple: { bg: 'bg-purple-500/8 dark:bg-purple-400/10', text: 'text-purple-700 dark:text-purple-300', icon: 'text-purple-500 dark:text-purple-400' },
        emerald: { bg: 'bg-emerald-500/8 dark:bg-emerald-400/10', text: 'text-emerald-700 dark:text-emerald-300', icon: 'text-emerald-500 dark:text-emerald-400' },
    };
    const c = colorMap[color] || colorMap.slate;

    return (
        <div className={cn('relative rounded-lg border border-border/50 p-3 overflow-hidden', c.bg)}>
            <div className="flex items-center justify-between mb-1.5">
                <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">{label}</span>
                <Icon className={cn('h-3.5 w-3.5', c.icon)} />
            </div>
            <div className={cn('text-lg font-bold font-mono leading-none', c.text)}>{value}</div>
            {(subValue || trend) && (
                <div className="flex items-center justify-between mt-1.5">
                    {subValue && <span className="text-[10px] text-muted-foreground font-medium">{subValue}</span>}
                    {trend && <span className={cn('text-[10px] font-mono font-semibold', c.text)}>{trend}</span>}
                </div>
            )}
        </div>
    );
}

// Recharts theme-aware colors
const CHART_COLORS = {
    cachedInput: '#f59e0b',
    newInput: '#3b82f6',
    output: '#a855f7',
    ttsEquiv: '#10b981',
    stt: '#f59e0b',
    agent: '#3b82f6',
    report: '#a855f7',
    qa: '#6366f1',
    tts: '#10b981',
};

function ChartTooltipContent({ active, payload }: { active?: boolean; payload?: Array<{ name: string; value: number; payload: { fill?: string } }> }) {
    if (!active || !payload?.length) return null;
    return (
        <div className="rounded-lg border border-border bg-popover px-3 py-2 shadow-md">
            {payload.map((entry, i) => (
                <div key={i} className="flex items-center gap-2 text-xs">
                    <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: entry.payload.fill || '#888' }} />
                    <span className="text-muted-foreground">{entry.name}:</span>
                    <span className="font-mono font-semibold text-foreground">{typeof entry.value === 'number' ? entry.value.toLocaleString() : entry.value}</span>
                </div>
            ))}
        </div>
    );
}

function TokenDonutChart({
    segments,
}: {
    segments: { name: string; value: number; fill: string }[];
}) {
    const filtered = segments.filter(s => s.value > 0);
    const total = filtered.reduce((acc, s) => acc + s.value, 0);
    if (total <= 0) return null;

    return (
        <div className="flex items-center gap-4">
            <div className="w-[140px] h-[140px] shrink-0">
                <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                        <Pie
                            data={filtered}
                            cx="50%"
                            cy="50%"
                            innerRadius={38}
                            outerRadius={62}
                            paddingAngle={2}
                            dataKey="value"
                            strokeWidth={0}
                        >
                            {filtered.map((entry, i) => (
                                <Cell key={i} fill={entry.fill} />
                            ))}
                        </Pie>
                        <RechartsTooltip content={<ChartTooltipContent />} />
                    </PieChart>
                </ResponsiveContainer>
            </div>
            <div className="flex-1 space-y-1.5">
                <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-2">
                    Token Distribution
                </div>
                {filtered.map((seg, i) => (
                    <div key={i} className="flex items-center gap-2">
                        <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: seg.fill }} />
                        <span className="text-[11px] text-muted-foreground flex-1">{seg.name}</span>
                        <span className="text-[11px] font-mono font-semibold text-foreground">{formatTokens(seg.value)}</span>
                        <span className="text-[10px] font-mono text-muted-foreground w-10 text-right">{pct(seg.value, total)}%</span>
                    </div>
                ))}
                <div className="flex items-center gap-2 pt-1.5 border-t border-border/40 mt-1.5">
                    <span className="text-[11px] font-semibold text-foreground flex-1">Total</span>
                    <span className="text-[11px] font-mono font-bold text-foreground">{formatTokens(total)}</span>
                    <span className="text-[10px] font-mono text-muted-foreground w-10 text-right">100%</span>
                </div>
            </div>
        </div>
    );
}

function CostBreakdownChart({
    stages,
}: {
    stages: { name: string; cost: number; tokens: string; fill: string }[];
}) {
    const filtered = stages.filter(s => s.cost > 0);
    if (filtered.length === 0) return null;

    return (
        <div className="space-y-3">
            <div className="h-[180px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={filtered} layout="vertical" margin={{ top: 0, right: 8, bottom: 0, left: 0 }} barSize={20}>
                        <CartesianGrid horizontal={false} strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} />
                        <XAxis
                            type="number"
                            tickFormatter={(v: number) => `$${v < 0.01 ? v.toFixed(4) : v.toFixed(2)}`}
                            tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                            axisLine={false}
                            tickLine={false}
                        />
                        <YAxis
                            type="category"
                            dataKey="name"
                            width={110}
                            tick={{ fontSize: 11, fill: 'hsl(var(--foreground))' }}
                            axisLine={false}
                            tickLine={false}
                        />
                        <RechartsTooltip
                            content={({ active, payload }) => {
                                if (!active || !payload?.length) return null;
                                const d = payload[0].payload as { name: string; cost: number; tokens: string; fill: string };
                                return (
                                    <div className="rounded-lg border border-border bg-popover px-3 py-2 shadow-md space-y-1">
                                        <div className="flex items-center gap-2">
                                            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: d.fill }} />
                                            <span className="text-xs font-semibold text-foreground">{d.name}</span>
                                        </div>
                                        <div className="text-[11px] text-muted-foreground">{d.tokens}</div>
                                        <div className="text-xs font-mono font-bold text-foreground">{formatUSD(d.cost)}</div>
                                    </div>
                                );
                            }}
                        />
                        <Bar dataKey="cost" radius={[0, 4, 4, 0]}>
                            {filtered.map((entry, i) => (
                                <Cell key={i} fill={entry.fill} />
                            ))}
                        </Bar>
                    </BarChart>
                </ResponsiveContainer>
            </div>
            <div className="flex flex-wrap gap-x-5 gap-y-1.5">
                {filtered.map((s, i) => (
                    <div key={i} className="flex items-center gap-1.5">
                        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: s.fill }} />
                        <span className="text-[10px] text-muted-foreground">{s.name}</span>
                        <span className="text-[10px] font-mono font-medium text-foreground">{formatUSD(s.cost)}</span>
                    </div>
                ))}
            </div>
        </div>
    );
}

function ModelStackedBarChart({
    items,
}: {
    items: LLMUsageItem[];
}) {
    if (items.length === 0) return null;

    const data = items.map(item => ({
        model: item.modelName.length > 18 ? item.modelName.slice(0, 16) + '…' : item.modelName,
        fullModel: item.modelName,
        'New Input': Math.max(0, item.promptTokens - item.cacheReadTokens),
        'Cached': item.cacheReadTokens,
        'Output': item.completionTokens,
    }));

    return (
        <div className="h-[160px] w-full">
            <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 0 }} barSize={24}>
                    <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} />
                    <XAxis
                        dataKey="model"
                        tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                        axisLine={false}
                        tickLine={false}
                    />
                    <YAxis
                        tickFormatter={(v: number) => formatTokens(v)}
                        tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                        axisLine={false}
                        tickLine={false}
                        width={50}
                    />
                    <RechartsTooltip
                        content={({ active, payload, label }) => {
                            if (!active || !payload?.length) return null;
                            const d = payload[0]?.payload as Record<string, unknown>;
                            return (
                                <div className="rounded-lg border border-border bg-popover px-3 py-2 shadow-md space-y-1">
                                    <div className="text-xs font-semibold text-foreground">{(d?.fullModel as string) || label}</div>
                                    {payload.map((entry, i) => (
                                        <div key={i} className="flex items-center gap-2 text-[11px]">
                                            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: entry.color }} />
                                            <span className="text-muted-foreground">{entry.name}</span>
                                            <span className="font-mono font-semibold">{(entry.value as number).toLocaleString()}</span>
                                        </div>
                                    ))}
                                </div>
                            );
                        }}
                    />
                    <Bar dataKey="New Input" stackId="tokens" fill={CHART_COLORS.newInput} radius={[0, 0, 0, 0]} />
                    <Bar dataKey="Cached" stackId="tokens" fill={CHART_COLORS.cachedInput} radius={[0, 0, 0, 0]} />
                    <Bar dataKey="Output" stackId="tokens" fill={CHART_COLORS.output} radius={[4, 4, 0, 0]} />
                </BarChart>
            </ResponsiveContainer>
        </div>
    );
}

function VoiceDonutChart({
    ttsChars,
    ttsCost,
    sttSeconds,
    sttCost,
}: {
    ttsChars: number;
    ttsCost: number;
    sttSeconds: number;
    sttCost: number;
}) {
    const data = [
        { name: `TTS (${ttsChars.toLocaleString()} chars)`, value: ttsCost, fill: CHART_COLORS.tts },
        { name: `STT (${sttSeconds.toFixed(1)}s)`, value: sttCost, fill: CHART_COLORS.stt },
    ].filter(d => d.value > 0);

    if (data.length === 0) return null;
    const total = data.reduce((a, d) => a + d.value, 0);

    return (
        <div className="flex items-center gap-3">
            <div className="w-[80px] h-[80px] shrink-0">
                <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                        <Pie
                            data={data}
                            cx="50%"
                            cy="50%"
                            innerRadius={22}
                            outerRadius={36}
                            paddingAngle={3}
                            dataKey="value"
                            strokeWidth={0}
                        >
                            {data.map((entry, i) => (
                                <Cell key={i} fill={entry.fill} />
                            ))}
                        </Pie>
                    </PieChart>
                </ResponsiveContainer>
            </div>
            <div className="space-y-1">
                {data.map((d, i) => (
                    <div key={i} className="flex items-center gap-1.5">
                        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: d.fill }} />
                        <span className="text-[10px] text-muted-foreground">{d.name}</span>
                        <span className="text-[10px] font-mono font-semibold">{formatUSD(d.value)}</span>
                    </div>
                ))}
                <div className="text-[10px] font-mono font-bold text-foreground pt-0.5 border-t border-border/40">
                    Total: {formatUSD(total)}
                </div>
            </div>
        </div>
    );
}

// ============================================================================
// Main Component
// ============================================================================
export function DetailedUsageBreakdown({
    usageInfo,
    costInfo,
    gatheredContext,
    reportStatus,
    reportS3Key,
    isCompleted = true,
    organizationPricing,
    modelPricingRules,
}: DetailedUsageBreakdownProps) {
    const [activeTab, setActiveTab] = useState<string>('overview');

    // 1. Parse LLM usage
    const {
        agentLLMItems,
        reportLLMItems,
        qaLLMItems,
        totalLLMPromptTokens,
        totalLLMCompletionTokens,
        totalLLMTokens,
        totalLLMCacheReadTokens,
        totalLLMCacheCreationTokens,
        totalLLMCostUSD,
    } = useMemo(() => {
        const agentItems: LLMUsageItem[] = [];
        const reportItems: LLMUsageItem[] = [];
        const qaItems: LLMUsageItem[] = [];

        const llmDict = usageInfo?.llm || {};

        for (const [key, data] of Object.entries(llmDict)) {
            const { service, model } = parseCompositeKey(key);
            const prompt = Number(data?.prompt_tokens ?? 0);
            const completion = Number(data?.completion_tokens ?? 0);
            const total = Number(data?.total_tokens ?? (prompt + completion));
            const cacheRead = Number(data?.cache_read_input_tokens ?? 0);
            const cacheCreation = Number(data?.cache_creation_input_tokens ?? 0);

            const pricing = resolveLLMPricing(model || service, modelPricingRules);
            const inputCost = (prompt * pricing.inputPer1M) / 1_000_000;
            const outputCost = (completion * pricing.outputPer1M) / 1_000_000;

            const isReport = key.startsWith('ReportGeneration') || service.toLowerCase().includes('report');
            const isQA = key.startsWith('QAAnalysis') || service.toLowerCase().includes('qa');

            const item: LLMUsageItem = {
                rawKey: key,
                category: isReport ? 'report_generation' : isQA ? 'qa_analysis' : 'agent_llm',
                processorName: isReport ? 'Report Generation Engine' : isQA ? 'QA Analysis Evaluator' : service || 'Agent LLM',
                modelName: model || 'Default Model',
                promptTokens: prompt,
                completionTokens: completion,
                totalTokens: total,
                cacheReadTokens: cacheRead,
                cacheCreationTokens: cacheCreation,
                inputRatePer1M: pricing.inputPer1M,
                outputRatePer1M: pricing.outputPer1M,
                inputCostUSD: inputCost,
                outputCostUSD: outputCost,
                totalCostUSD: inputCost + outputCost,
                priced: pricing.priced,
            };

            if (isReport) reportItems.push(item);
            else if (isQA) qaItems.push(item);
            else agentItems.push(item);
        }

        if (reportItems.length === 0) {
            const reportMeta = gatheredContext?.report_variables_meta as Record<string, unknown> | undefined;
            const metaTokens = reportMeta?.token_usage as { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | undefined;
            if (metaTokens && (metaTokens.total_tokens || metaTokens.prompt_tokens)) {
                const prompt = Number(metaTokens.prompt_tokens ?? 0);
                const completion = Number(metaTokens.completion_tokens ?? 0);
                const total = Number(metaTokens.total_tokens ?? (prompt + completion));
                reportItems.push({
                    rawKey: 'ReportGeneration|||unknown',
                    category: 'report_generation',
                    processorName: 'Report Variable Extraction',
                    modelName: 'Model not recorded',
                    promptTokens: prompt,
                    completionTokens: completion,
                    totalTokens: total,
                    cacheReadTokens: 0,
                    cacheCreationTokens: 0,
                    inputRatePer1M: 0,
                    outputRatePer1M: 0,
                    inputCostUSD: 0,
                    outputCostUSD: 0,
                    totalCostUSD: 0,
                    priced: false,
                });
            }
        }

        const allItems = [...agentItems, ...reportItems, ...qaItems];
        return {
            agentLLMItems: agentItems,
            reportLLMItems: reportItems,
            qaLLMItems: qaItems,
            totalLLMPromptTokens: allItems.reduce((a, i) => a + i.promptTokens, 0),
            totalLLMCompletionTokens: allItems.reduce((a, i) => a + i.completionTokens, 0),
            totalLLMTokens: allItems.reduce((a, i) => a + i.totalTokens, 0),
            totalLLMCacheReadTokens: allItems.reduce((a, i) => a + i.cacheReadTokens, 0),
            totalLLMCacheCreationTokens: allItems.reduce((a, i) => a + i.cacheCreationTokens, 0),
            totalLLMCostUSD: allItems.reduce((a, i) => a + i.totalCostUSD, 0),
        };
    }, [usageInfo, gatheredContext, modelPricingRules]);

    // 2. Parse TTS
    const { ttsItems, totalTTSChars, totalTTSTokens, totalTTSCostUSD } = useMemo(() => {
        const items: TTSUsageItem[] = [];
        const ttsDict = usageInfo?.tts || {};

        for (const [key, charsVal] of Object.entries(ttsDict)) {
            const { service, model } = parseCompositeKey(key);
            const characters = Number(charsVal ?? 0);
            const tokens = Math.ceil(characters / 4);
            const pricing = resolveTTSPricing(service, modelPricingRules);
            const cost = (characters * pricing.per1MChars) / 1_000_000;

            items.push({
                rawKey: key,
                serviceName: service || 'Text-to-Speech',
                voiceOrModel: model || 'Default Voice',
                characters,
                tokensEquivalent: tokens,
                ratePer1MChars: pricing.per1MChars,
                costUSD: cost,
                priced: pricing.priced,
            });
        }

        return {
            ttsItems: items,
            totalTTSChars: items.reduce((a, i) => a + i.characters, 0),
            totalTTSTokens: items.reduce((a, i) => a + i.tokensEquivalent, 0),
            totalTTSCostUSD: items.reduce((a, i) => a + i.costUSD, 0),
        };
    }, [usageInfo, modelPricingRules]);

    // 3. Parse STT
    const { sttItems, totalSTTSeconds, totalSTTCostUSD } = useMemo(() => {
        const items: STTUsageItem[] = [];
        const sttDict = usageInfo?.stt || {};

        for (const [key, durVal] of Object.entries(sttDict)) {
            const { service, model } = parseCompositeKey(key);
            const sec = Number(durVal ?? 0);
            const min = sec / 60;
            const pricing = resolveSTTPricing(service, modelPricingRules);
            const cost = min * pricing.perMinute;

            items.push({
                rawKey: key,
                serviceName: service || 'Speech-to-Text',
                model: model || 'Standard',
                durationSeconds: sec,
                durationMinutes: min,
                ratePerMinute: pricing.perMinute,
                costUSD: cost,
                priced: pricing.priced,
            });
        }

        return {
            sttItems: items,
            totalSTTSeconds: items.reduce((a, i) => a + i.durationSeconds, 0),
            totalSTTCostUSD: items.reduce((a, i) => a + i.costUSD, 0),
        };
    }, [usageInfo, modelPricingRules]);

    // 4. Overall totals
    const grandTotalTokens = (costInfo?.autonomous_ai_os_token_usage != null && costInfo.autonomous_ai_os_token_usage > 0)
        ? costInfo.autonomous_ai_os_token_usage
        : (totalLLMTokens + totalTTSTokens);

    const grandTotalServiceCostUSD = totalLLMCostUSD + totalTTSCostUSD + totalSTTCostUSD;
    const unpricedCount = [...agentLLMItems, ...reportLLMItems, ...qaLLMItems, ...ttsItems, ...sttItems]
        .filter((item) => !item.priced).length;
    const formatTotal = (amount: number) => formatTotalCost(formatUSD, amount, unpricedCount);

    const orgDurationCharge = useMemo(() => {
        if (costInfo?.charge_usd != null) return costInfo.charge_usd;
        if (organizationPricing?.price_per_second_usd && costInfo?.call_duration_seconds) {
            return costInfo.call_duration_seconds * organizationPricing.price_per_second_usd;
        }
        return null;
    }, [costInfo, organizationPricing]);

    const hasAnyUsageData =
        agentLLMItems.length > 0 ||
        reportLLMItems.length > 0 ||
        qaLLMItems.length > 0 ||
        ttsItems.length > 0 ||
        sttItems.length > 0;

    // Stage-level cost aggregation for waterfall
    const agentCost = agentLLMItems.reduce((a, i) => a + i.totalCostUSD, 0);
    const reportCost = reportLLMItems.reduce((a, i) => a + i.totalCostUSD, 0);
    const qaCost = qaLLMItems.reduce((a, i) => a + i.totalCostUSD, 0);


    // Effective (non-cached) input tokens
    const effectiveInputTokens = totalLLMPromptTokens - totalLLMCacheReadTokens;

    return (
        <Card className="border-border shadow-sm overflow-hidden mt-4">
            {/* ── Header ─────────────────────────────────────────────── */}
            <CardHeader className="px-4 py-3.5 border-b border-border">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                    <div className="space-y-0.5">
                        <div className="flex items-center gap-2">
                            <span className="p-1.5 rounded-md bg-primary/10 text-primary">
                                <Coins className="h-4 w-4" />
                            </span>
                            <CardTitle className="text-sm font-bold uppercase tracking-wide text-foreground">
                                Usage & Token Breakdown
                            </CardTitle>
                            {isCompleted ? (
                                <Badge
                                    variant="outline"
                                    className="gap-1 text-[10px] font-mono font-medium text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border-emerald-500/30"
                                >
                                    <CheckCircle2 className="h-3 w-3" />
                                    FINALIZED
                                </Badge>
                            ) : (
                                <Badge
                                    variant="outline"
                                    className="gap-1.5 text-[10px] font-mono font-medium text-amber-600 dark:text-amber-400 bg-amber-500/10 border-amber-500/30 animate-pulse"
                                >
                                    <span className="h-1.5 w-1.5 rounded-full bg-amber-500 animate-ping" />
                                    LIVE METERING
                                </Badge>
                            )}
                        </div>
                        <p className="text-[11px] text-muted-foreground">
                            Granular input/output tokens, character counts, and model rates across all call services
                        </p>
                    </div>

                    <div className="flex items-center gap-3 self-start sm:self-auto">
                        <div className="text-right">
                            <div className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">Billed Tokens</div>
                            <div className="text-base font-bold font-mono text-foreground">{grandTotalTokens.toLocaleString()}</div>
                        </div>
                        <div className="h-7 w-px bg-border/60" />
                        <div className="text-right">
                            <div className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">Provider Cost</div>
                            <div className="text-base font-bold font-mono text-primary">{formatTotal(grandTotalServiceCostUSD)}</div>
                        </div>
                        {orgDurationCharge != null && (
                            <>
                                <div className="h-7 w-px bg-border/60" />
                                <div className="text-right">
                                    <div className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">Wallet Debit</div>
                                    <div className="text-base font-bold font-mono text-emerald-600 dark:text-emerald-400">
                                        ${orgDurationCharge.toFixed(2)}
                                    </div>
                                </div>
                            </>
                        )}
                    </div>
                </div>
            </CardHeader>

            <CardContent className="p-4 space-y-4">
                {/* ── 5 Metric Tiles ─────────────────────────────────── */}
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5">
                    <MetricTile
                        label="Total Tokens"
                        value={formatTokens(grandTotalTokens)}
                        subValue="LLM + TTS equiv."
                        icon={Layers}
                        color="slate"
                        trend={formatTotal(grandTotalServiceCostUSD)}
                    />
                    <MetricTile
                        label="Input (Prompt)"
                        value={formatTokens(totalLLMPromptTokens)}
                        subValue={totalLLMCacheReadTokens > 0 ? `${formatTokens(effectiveInputTokens)} new + ${formatTokens(totalLLMCacheReadTokens)} cached` : 'All new tokens'}
                        icon={Cpu}
                        color="blue"
                        trend={formatTotal(agentLLMItems.reduce((a, i) => a + i.inputCostUSD, 0) + reportLLMItems.reduce((a, i) => a + i.inputCostUSD, 0) + qaLLMItems.reduce((a, i) => a + i.inputCostUSD, 0))}
                    />
                    <MetricTile
                        label="Cached Reads"
                        value={formatTokens(totalLLMCacheReadTokens)}
                        subValue={totalLLMCacheCreationTokens > 0 ? `${formatTokens(totalLLMCacheCreationTokens)} cache writes` : totalLLMCacheReadTokens > 0 ? `${pct(totalLLMCacheReadTokens, totalLLMPromptTokens)}% of input` : 'No cache hits'}
                        icon={Zap}
                        color="amber"
                        trend={totalLLMCacheReadTokens > 0 ? `${pct(totalLLMCacheReadTokens, totalLLMPromptTokens)}% hit` : '—'}
                    />
                    <MetricTile
                        label="Output (Generated)"
                        value={formatTokens(totalLLMCompletionTokens)}
                        subValue="Model completions"
                        icon={Sparkles}
                        color="purple"
                        trend={formatTotal(agentLLMItems.reduce((a, i) => a + i.outputCostUSD, 0) + reportLLMItems.reduce((a, i) => a + i.outputCostUSD, 0) + qaLLMItems.reduce((a, i) => a + i.outputCostUSD, 0))}
                    />
                    <MetricTile
                        label="Voice Audio"
                        value={`${totalTTSChars.toLocaleString()} ch`}
                        subValue={`${totalTTSTokens.toLocaleString()} tok eq · ${totalSTTSeconds.toFixed(1)}s STT`}
                        icon={Volume2}
                        color="emerald"
                        trend={formatTotal(totalTTSCostUSD + totalSTTCostUSD)}
                    />
                </div>

                {/* ── Token Distribution Donut Chart ────────────────── */}
                <div className="rounded-lg border border-border/40 bg-muted/10 p-4">
                    <TokenDonutChart
                        segments={[
                            { name: 'Cached Input', value: totalLLMCacheReadTokens, fill: CHART_COLORS.cachedInput },
                            { name: 'New Input', value: effectiveInputTokens, fill: CHART_COLORS.newInput },
                            { name: 'Output', value: totalLLMCompletionTokens, fill: CHART_COLORS.output },
                            { name: 'TTS (equiv.)', value: totalTTSTokens, fill: CHART_COLORS.ttsEquiv },
                        ]}
                    />
                </div>

                {/* ── Tabbed Detail Views ─────────────────────────────── */}
                <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
                    <TabsList className="bg-muted/40 p-0.5 border border-border/40 w-full sm:w-auto flex flex-wrap h-auto gap-0.5">
                        <TabsTrigger value="overview" className="text-[11px] gap-1 font-medium px-2.5 py-1.5">
                            <TrendingUp className="h-3 w-3" />
                            Cost Breakdown
                        </TabsTrigger>
                        <TabsTrigger value="all" className="text-[11px] gap-1 font-medium px-2.5 py-1.5">
                            <Layers className="h-3 w-3" />
                            All Services
                        </TabsTrigger>
                        <TabsTrigger value="agent_llm" className="text-[11px] gap-1 font-medium px-2.5 py-1.5">
                            <Bot className="h-3 w-3 text-blue-500" />
                            Conversation
                            {agentLLMItems.length > 0 && (
                                <Badge variant="secondary" className="h-3.5 px-1 text-[9px] ml-0.5">{agentLLMItems.length}</Badge>
                            )}
                        </TabsTrigger>
                        <TabsTrigger value="report" className="text-[11px] gap-1 font-medium px-2.5 py-1.5 relative">
                            <FileSpreadsheet className="h-3 w-3 text-purple-500" />
                            Report
                            {reportLLMItems.length > 0 && (
                                <span className="h-1.5 w-1.5 rounded-full bg-purple-500 absolute top-1 right-1" />
                            )}
                        </TabsTrigger>
                        <TabsTrigger value="voice" className="text-[11px] gap-1 font-medium px-2.5 py-1.5">
                            <Volume2 className="h-3 w-3 text-emerald-500" />
                            Voice
                        </TabsTrigger>
                        {qaLLMItems.length > 0 && (
                            <TabsTrigger value="qa" className="text-[11px] gap-1 font-medium px-2.5 py-1.5">
                                <Activity className="h-3 w-3 text-indigo-500" />
                                QA
                            </TabsTrigger>
                        )}
                    </TabsList>

                    {/* ── TAB: Cost Breakdown (Chart) ─────────────────── */}
                    <TabsContent value="overview" className="mt-3">
                        <div className="rounded-lg border border-border/50 bg-muted/10 p-4 space-y-3">
                            <div className="flex items-center justify-between">
                                <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                                    Cost by Processing Stage
                                </div>
                                {hasAnyUsageData && (
                                    <div className="text-sm font-bold font-mono text-primary">{formatTotal(grandTotalServiceCostUSD)}</div>
                                )}
                            </div>
                            {hasAnyUsageData ? (
                                <CostBreakdownChart
                                    stages={[
                                        ...(agentLLMItems.length > 0 ? [{ name: 'Conversation LLM', cost: agentCost, tokens: `${formatTokens(agentLLMItems.reduce((a, i) => a + i.totalTokens, 0))} tokens`, fill: CHART_COLORS.agent }] : []),
                                        ...(reportLLMItems.length > 0 ? [{ name: 'Report Generation', cost: reportCost, tokens: `${formatTokens(reportLLMItems.reduce((a, i) => a + i.totalTokens, 0))} tokens`, fill: CHART_COLORS.report }] : []),
                                        ...(qaLLMItems.length > 0 ? [{ name: 'QA Analysis', cost: qaCost, tokens: `${formatTokens(qaLLMItems.reduce((a, i) => a + i.totalTokens, 0))} tokens`, fill: CHART_COLORS.qa }] : []),
                                        ...(ttsItems.length > 0 ? [{ name: 'Text-to-Speech', cost: totalTTSCostUSD, tokens: `${totalTTSChars.toLocaleString()} chars`, fill: CHART_COLORS.tts }] : []),
                                        ...(sttItems.length > 0 ? [{ name: 'Speech-to-Text', cost: totalSTTCostUSD, tokens: `${totalSTTSeconds.toFixed(1)}s audio`, fill: CHART_COLORS.stt }] : []),
                                    ]}
                                />
                            ) : (
                                <div className="text-center py-8 text-muted-foreground text-xs">
                                    No usage data recorded for this session.
                                </div>
                            )}
                        </div>
                    </TabsContent>

                    {/* ── TAB: All Services Table ─────────────────────── */}
                    <TabsContent value="all" className="mt-3">
                        <div className="rounded-lg border border-border/50 overflow-hidden">
                            <Table>
                                <TableHeader className="bg-muted/40">
                                    <TableRow className="hover:bg-transparent">
                                        <TableHead className="text-[10px] font-semibold uppercase w-[160px]">Service / Model</TableHead>
                                        <TableHead className="text-[10px] font-semibold uppercase">Type</TableHead>
                                        <TableHead className="text-right text-[10px] font-semibold uppercase">Input</TableHead>
                                        <TableHead className="text-right text-[10px] font-semibold uppercase">Cached</TableHead>
                                        <TableHead className="text-right text-[10px] font-semibold uppercase">Output</TableHead>
                                        <TableHead className="text-right text-[10px] font-semibold uppercase">Rate</TableHead>
                                        <TableHead className="text-right text-[10px] font-semibold uppercase">Amount</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {agentLLMItems.map((item) => (
                                        <TableRow key={item.rawKey} className="text-xs">
                                            <TableCell className="font-medium">
                                                <div className="flex items-center gap-1.5">
                                                    <Bot className="h-3 w-3 text-blue-500 shrink-0" />
                                                    <span className="truncate max-w-[140px]" title={item.modelName}>{item.modelName}</span>
                                                </div>
                                            </TableCell>
                                            <TableCell>
                                                <Badge variant="outline" className="text-[9px] py-0 px-1.5 bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/30">LLM</Badge>
                                            </TableCell>
                                            <TableCell className="text-right font-mono text-[11px]">{item.promptTokens.toLocaleString()}</TableCell>
                                            <TableCell className="text-right font-mono text-[11px]">
                                                {item.cacheReadTokens > 0 ? (
                                                    <span className="text-amber-600 dark:text-amber-400">{item.cacheReadTokens.toLocaleString()}</span>
                                                ) : (
                                                    <span className="text-muted-foreground/50">—</span>
                                                )}
                                            </TableCell>
                                            <TableCell className="text-right font-mono text-[11px]">{item.completionTokens.toLocaleString()}</TableCell>
                                            <TableCell className="text-right font-mono text-[10px] text-muted-foreground">
                                                {item.priced ? `$${item.inputRatePer1M.toFixed(2)} / $${item.outputRatePer1M.toFixed(2)}` : '—'}
                                            </TableCell>
                                            <TableCell className="text-right font-mono font-bold text-[11px]">{formatItemCost(formatUSD, item.totalCostUSD, item.priced)}</TableCell>
                                        </TableRow>
                                    ))}

                                    {reportLLMItems.map((item) => (
                                        <TableRow key={item.rawKey} className="text-xs bg-purple-500/[0.03]">
                                            <TableCell className="font-medium">
                                                <div className="flex items-center gap-1.5">
                                                    <FileSpreadsheet className="h-3 w-3 text-purple-500 shrink-0" />
                                                    <span className="truncate max-w-[140px]" title={item.modelName}>{item.modelName}</span>
                                                </div>
                                            </TableCell>
                                            <TableCell>
                                                <Badge variant="outline" className="text-[9px] py-0 px-1.5 bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/30">Report</Badge>
                                            </TableCell>
                                            <TableCell className="text-right font-mono text-[11px]">{item.promptTokens.toLocaleString()}</TableCell>
                                            <TableCell className="text-right font-mono text-[11px]">
                                                {item.cacheReadTokens > 0 ? (
                                                    <span className="text-amber-600 dark:text-amber-400">{item.cacheReadTokens.toLocaleString()}</span>
                                                ) : (
                                                    <span className="text-muted-foreground/50">—</span>
                                                )}
                                            </TableCell>
                                            <TableCell className="text-right font-mono text-[11px]">{item.completionTokens.toLocaleString()}</TableCell>
                                            <TableCell className="text-right font-mono text-[10px] text-muted-foreground">
                                                {item.priced ? `$${item.inputRatePer1M.toFixed(2)} / $${item.outputRatePer1M.toFixed(2)}` : '—'}
                                            </TableCell>
                                            <TableCell className="text-right font-mono font-bold text-[11px]">{formatItemCost(formatUSD, item.totalCostUSD, item.priced)}</TableCell>
                                        </TableRow>
                                    ))}

                                    {qaLLMItems.map((item) => (
                                        <TableRow key={item.rawKey} className="text-xs">
                                            <TableCell className="font-medium">
                                                <div className="flex items-center gap-1.5">
                                                    <Activity className="h-3 w-3 text-indigo-500 shrink-0" />
                                                    <span className="truncate max-w-[140px]" title={item.modelName}>{item.modelName}</span>
                                                </div>
                                            </TableCell>
                                            <TableCell>
                                                <Badge variant="outline" className="text-[9px] py-0 px-1.5 bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border-indigo-500/30">QA</Badge>
                                            </TableCell>
                                            <TableCell className="text-right font-mono text-[11px]">{item.promptTokens.toLocaleString()}</TableCell>
                                            <TableCell className="text-right font-mono text-[11px]">
                                                {item.cacheReadTokens > 0 ? (
                                                    <span className="text-amber-600 dark:text-amber-400">{item.cacheReadTokens.toLocaleString()}</span>
                                                ) : (
                                                    <span className="text-muted-foreground/50">—</span>
                                                )}
                                            </TableCell>
                                            <TableCell className="text-right font-mono text-[11px]">{item.completionTokens.toLocaleString()}</TableCell>
                                            <TableCell className="text-right font-mono text-[10px] text-muted-foreground">
                                                {item.priced ? `$${item.inputRatePer1M.toFixed(2)} / $${item.outputRatePer1M.toFixed(2)}` : '—'}
                                            </TableCell>
                                            <TableCell className="text-right font-mono font-bold text-[11px]">{formatItemCost(formatUSD, item.totalCostUSD, item.priced)}</TableCell>
                                        </TableRow>
                                    ))}

                                    {ttsItems.map((item) => (
                                        <TableRow key={item.rawKey} className="text-xs">
                                            <TableCell className="font-medium">
                                                <div className="flex items-center gap-1.5">
                                                    <Volume2 className="h-3 w-3 text-emerald-500 shrink-0" />
                                                    <span className="truncate max-w-[140px]" title={`${item.serviceName} · ${item.voiceOrModel}`}>
                                                        {item.serviceName}
                                                    </span>
                                                </div>
                                            </TableCell>
                                            <TableCell>
                                                <Badge variant="outline" className="text-[9px] py-0 px-1.5 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30">TTS</Badge>
                                            </TableCell>
                                            <TableCell className="text-right font-mono text-[11px]">{item.characters.toLocaleString()} ch</TableCell>
                                            <TableCell className="text-right text-muted-foreground/50">—</TableCell>
                                            <TableCell className="text-right font-mono text-[11px]">{item.tokensEquivalent.toLocaleString()} eq</TableCell>
                                            <TableCell className="text-right font-mono text-[10px] text-muted-foreground">{item.priced ? `$${item.ratePer1MChars.toFixed(2)}/1M` : '—'}</TableCell>
                                            <TableCell className="text-right font-mono font-bold text-[11px]">{formatItemCost(formatUSD, item.costUSD, item.priced)}</TableCell>
                                        </TableRow>
                                    ))}

                                    {sttItems.map((item) => (
                                        <TableRow key={item.rawKey} className="text-xs">
                                            <TableCell className="font-medium">
                                                <div className="flex items-center gap-1.5">
                                                    <Mic className="h-3 w-3 text-amber-500 shrink-0" />
                                                    <span className="truncate max-w-[140px]" title={`${item.serviceName} · ${item.model}`}>
                                                        {item.serviceName}
                                                    </span>
                                                </div>
                                            </TableCell>
                                            <TableCell>
                                                <Badge variant="outline" className="text-[9px] py-0 px-1.5 bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30">STT</Badge>
                                            </TableCell>
                                            <TableCell className="text-right font-mono text-[11px]">{item.durationSeconds.toFixed(1)}s</TableCell>
                                            <TableCell className="text-right text-muted-foreground/50">—</TableCell>
                                            <TableCell className="text-right font-mono text-[11px]">{item.durationMinutes.toFixed(2)} min</TableCell>
                                            <TableCell className="text-right font-mono text-[10px] text-muted-foreground">{item.priced ? `$${item.ratePerMinute.toFixed(4)}/min` : '—'}</TableCell>
                                            <TableCell className="text-right font-mono font-bold text-[11px]">{formatItemCost(formatUSD, item.costUSD, item.priced)}</TableCell>
                                        </TableRow>
                                    ))}

                                    {!hasAnyUsageData && (
                                        <TableRow>
                                            <TableCell colSpan={7} className="text-center py-5 text-muted-foreground text-xs">
                                                No service usage metrics recorded for this session yet.
                                            </TableCell>
                                        </TableRow>
                                    )}

                                    {hasAnyUsageData && (
                                        <TableRow className="bg-muted/30 font-semibold hover:bg-muted/30">
                                            <TableCell colSpan={2} className="text-xs uppercase tracking-wider">Total</TableCell>
                                            <TableCell className="text-right font-mono text-[11px]">{totalLLMPromptTokens.toLocaleString()}</TableCell>
                                            <TableCell className="text-right font-mono text-[11px] text-amber-600 dark:text-amber-400">
                                                {totalLLMCacheReadTokens > 0 ? totalLLMCacheReadTokens.toLocaleString() : '—'}
                                            </TableCell>
                                            <TableCell className="text-right font-mono text-[11px]">{totalLLMCompletionTokens.toLocaleString()}</TableCell>
                                            <TableCell className="text-right" />
                                            <TableCell className="text-right font-mono font-bold text-[11px] text-primary">{formatTotal(grandTotalServiceCostUSD)}</TableCell>
                                        </TableRow>
                                    )}
                                </TableBody>
                            </Table>
                        </div>
                    </TabsContent>

                    {/* ── TAB: Conversation LLM ──────────────────────── */}
                    <TabsContent value="agent_llm" className="mt-3">
                        <div className="rounded-lg border border-border/50 p-4 bg-muted/10 space-y-3">
                            <div className="flex items-center justify-between">
                                <div className="space-y-0.5">
                                    <h4 className="text-xs font-bold uppercase tracking-wider text-foreground flex items-center gap-1.5">
                                        <Bot className="h-3.5 w-3.5 text-blue-500" />
                                        Conversational AI Agent Models
                                    </h4>
                                    <p className="text-[11px] text-muted-foreground">
                                        Turn-by-turn prompt context and response generation
                                    </p>
                                </div>
                                <div className="flex items-center gap-2">
                                    {agentLLMItems.some(i => i.cacheReadTokens > 0) && (
                                        <Badge variant="outline" className="text-[9px] font-mono text-amber-600 dark:text-amber-400 bg-amber-500/10 border-amber-500/30">
                                            <Zap className="h-2.5 w-2.5 mr-0.5" />
                                            {formatTokens(agentLLMItems.reduce((a, i) => a + i.cacheReadTokens, 0))} cached
                                        </Badge>
                                    )}
                                    <Badge variant="secondary" className="font-mono text-[10px]">
                                        {agentLLMItems.reduce((a, i) => a + i.totalTokens, 0).toLocaleString()} tokens
                                    </Badge>
                                </div>
                            </div>

                            {/* Stacked bar chart: Input vs Cached vs Output per model */}
                            {agentLLMItems.length > 0 && (
                                <div className="rounded-md border border-border/40 bg-background p-3">
                                    <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-2">Tokens per Model</div>
                                    <ModelStackedBarChart items={agentLLMItems} />
                                    <div className="flex items-center justify-center gap-4 mt-2">
                                        <div className="flex items-center gap-1.5">
                                            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: CHART_COLORS.newInput }} />
                                            <span className="text-[10px] text-muted-foreground">New Input</span>
                                        </div>
                                        <div className="flex items-center gap-1.5">
                                            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: CHART_COLORS.cachedInput }} />
                                            <span className="text-[10px] text-muted-foreground">Cached</span>
                                        </div>
                                        <div className="flex items-center gap-1.5">
                                            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: CHART_COLORS.output }} />
                                            <span className="text-[10px] text-muted-foreground">Output</span>
                                        </div>
                                    </div>
                                </div>
                            )}

                            <div className="rounded-md border border-border/40 overflow-hidden">
                                <Table>
                                    <TableHeader className="bg-muted/40">
                                        <TableRow>
                                            <TableHead className="text-[10px] font-semibold uppercase">Model</TableHead>
                                            <TableHead className="text-right text-[10px] font-semibold uppercase">Input</TableHead>
                                            <TableHead className="text-right text-[10px] font-semibold uppercase">Cached</TableHead>
                                            <TableHead className="text-right text-[10px] font-semibold uppercase">Input Cost</TableHead>
                                            <TableHead className="text-right text-[10px] font-semibold uppercase">Output</TableHead>
                                            <TableHead className="text-right text-[10px] font-semibold uppercase">Output Cost</TableHead>
                                            <TableHead className="text-right text-[10px] font-semibold uppercase">Total</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {agentLLMItems.map((item) => (
                                            <TableRow key={item.rawKey} className="text-xs">
                                                <TableCell className="font-medium">
                                                    <div className="text-foreground">{item.modelName}</div>
                                                    <div className="text-[10px] text-muted-foreground">{item.processorName}</div>
                                                </TableCell>
                                                <TableCell className="text-right font-mono text-[11px]">
                                                    {item.promptTokens.toLocaleString()}
                                                    <div className="text-[9px] text-muted-foreground">{item.priced ? `$${item.inputRatePer1M.toFixed(2)}/1M` : '—'}</div>
                                                </TableCell>
                                                <TableCell className="text-right font-mono text-[11px]">
                                                    {item.cacheReadTokens > 0 ? (
                                                        <div>
                                                            <span className="text-amber-600 dark:text-amber-400">{item.cacheReadTokens.toLocaleString()}</span>
                                                            {item.cacheCreationTokens > 0 && (
                                                                <div className="text-[9px] text-muted-foreground">{item.cacheCreationTokens.toLocaleString()} written</div>
                                                            )}
                                                        </div>
                                                    ) : (
                                                        <span className="text-muted-foreground/50">—</span>
                                                    )}
                                                </TableCell>
                                                <TableCell className="text-right font-mono text-[11px] text-blue-600 dark:text-blue-400">{formatItemCost(formatUSD, item.inputCostUSD, item.priced)}</TableCell>
                                                <TableCell className="text-right font-mono text-[11px]">
                                                    {item.completionTokens.toLocaleString()}
                                                    <div className="text-[9px] text-muted-foreground">{item.priced ? `$${item.outputRatePer1M.toFixed(2)}/1M` : '—'}</div>
                                                </TableCell>
                                                <TableCell className="text-right font-mono text-[11px] text-purple-600 dark:text-purple-400">{formatItemCost(formatUSD, item.outputCostUSD, item.priced)}</TableCell>
                                                <TableCell className="text-right font-mono font-bold text-[11px]">{formatItemCost(formatUSD, item.totalCostUSD, item.priced)}</TableCell>
                                            </TableRow>
                                        ))}
                                        {agentLLMItems.length === 0 && (
                                            <TableRow>
                                                <TableCell colSpan={7} className="text-center py-4 text-muted-foreground text-xs">
                                                    No agent LLM usage recorded.
                                                </TableCell>
                                            </TableRow>
                                        )}
                                    </TableBody>
                                </Table>
                            </div>
                        </div>
                    </TabsContent>

                    {/* ── TAB: Report Generation ──────────────────────── */}
                    <TabsContent value="report" className="mt-3">
                        <div className="rounded-lg border border-purple-500/30 bg-purple-500/[0.04] p-4 space-y-3">
                            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-purple-500/20 pb-3">
                                <div className="space-y-0.5">
                                    <div className="flex items-center gap-2">
                                        <span className="p-1 rounded-md bg-purple-500/10 text-purple-600 dark:text-purple-400">
                                            <FileSpreadsheet className="h-3.5 w-3.5" />
                                        </span>
                                        <h4 className="text-xs font-bold uppercase tracking-wider text-foreground">
                                            Report Generation Token Usage
                                        </h4>
                                        <Badge variant="outline" className="text-[9px] bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/30 font-mono">
                                            SEPARATED ENGINE
                                        </Badge>
                                        {reportStatus && (
                                            <Badge
                                                variant="secondary"
                                                className={cn(
                                                    'text-[9px] font-mono uppercase',
                                                    reportStatus === 'completed'
                                                        ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30'
                                                        : reportStatus === 'processing'
                                                        ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30'
                                                        : 'bg-muted text-muted-foreground'
                                                )}
                                            >
                                                {reportStatus}
                                            </Badge>
                                        )}
                                    </div>
                                    <p className="text-[11px] text-muted-foreground">
                                        Token accounting for variable extraction, scorecard derivations, and PDF generation
                                    </p>
                                </div>
                                <div className="flex items-center gap-2.5">
                                    <div className="text-right">
                                        <div className="text-[10px] text-muted-foreground font-medium">Tokens</div>
                                        <div className="text-sm font-bold font-mono text-purple-600 dark:text-purple-400">
                                            {reportLLMItems.reduce((a, i) => a + i.totalTokens, 0).toLocaleString()}
                                        </div>
                                    </div>
                                    <div className="h-6 w-px bg-purple-500/20" />
                                    <div className="text-right">
                                        <div className="text-[10px] text-muted-foreground font-medium">Cost</div>
                                        <div className="text-sm font-bold font-mono text-foreground">
                                            {formatTotal(reportLLMItems.reduce((a, i) => a + i.totalCostUSD, 0))}
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {reportLLMItems.length > 0 ? (
                                <div className="rounded-md border border-purple-500/20 bg-background overflow-hidden">
                                    <Table>
                                        <TableHeader className="bg-purple-500/5">
                                            <TableRow>
                                                <TableHead className="text-[10px] font-semibold uppercase">Extraction Model</TableHead>
                                                <TableHead className="text-right text-[10px] font-semibold uppercase">Input</TableHead>
                                                <TableHead className="text-right text-[10px] font-semibold uppercase">Cached</TableHead>
                                                <TableHead className="text-right text-[10px] font-semibold uppercase">Input Cost</TableHead>
                                                <TableHead className="text-right text-[10px] font-semibold uppercase">Output</TableHead>
                                                <TableHead className="text-right text-[10px] font-semibold uppercase">Output Cost</TableHead>
                                                <TableHead className="text-right text-[10px] font-semibold uppercase">Subtotal</TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {reportLLMItems.map((item) => (
                                                <TableRow key={item.rawKey} className="text-xs">
                                                    <TableCell className="font-medium">
                                                        <div className="flex items-center gap-1.5">
                                                            <FileText className="h-3 w-3 text-purple-500" />
                                                            <span>{item.modelName}</span>
                                                        </div>
                                                        <div className="text-[10px] text-muted-foreground pl-[18px]">{item.processorName}</div>
                                                    </TableCell>
                                                    <TableCell className="text-right font-mono text-[11px]">
                                                        {item.promptTokens.toLocaleString()}
                                                        <div className="text-[9px] text-muted-foreground">{item.priced ? `$${item.inputRatePer1M.toFixed(2)}/1M` : '—'}</div>
                                                    </TableCell>
                                                    <TableCell className="text-right font-mono text-[11px]">
                                                        {item.cacheReadTokens > 0 ? (
                                                            <span className="text-amber-600 dark:text-amber-400">{item.cacheReadTokens.toLocaleString()}</span>
                                                        ) : (
                                                            <span className="text-muted-foreground/50">—</span>
                                                        )}
                                                    </TableCell>
                                                    <TableCell className="text-right font-mono text-[11px] text-blue-600 dark:text-blue-400">{formatItemCost(formatUSD, item.inputCostUSD, item.priced)}</TableCell>
                                                    <TableCell className="text-right font-mono text-[11px]">
                                                        {item.completionTokens.toLocaleString()}
                                                        <div className="text-[9px] text-muted-foreground">{item.priced ? `$${item.outputRatePer1M.toFixed(2)}/1M` : '—'}</div>
                                                    </TableCell>
                                                    <TableCell className="text-right font-mono text-[11px] text-purple-600 dark:text-purple-400">{formatItemCost(formatUSD, item.outputCostUSD, item.priced)}</TableCell>
                                                    <TableCell className="text-right font-mono font-bold text-[11px]">{formatItemCost(formatUSD, item.totalCostUSD, item.priced)}</TableCell>
                                                </TableRow>
                                            ))}
                                        </TableBody>
                                    </Table>
                                </div>
                            ) : (
                                <div className="p-3.5 rounded-md border border-dashed border-purple-500/30 bg-purple-500/[0.02] text-xs text-muted-foreground flex items-center justify-between">
                                    <div className="space-y-0.5">
                                        <span className="font-medium text-foreground">
                                            {reportS3Key || reportStatus === 'completed'
                                                ? 'Report generated with deterministic extraction'
                                                : 'No report generation tokens recorded'}
                                        </span>
                                        <p className="text-[10px]">
                                            Report token consumption is metered separately when triggered.
                                        </p>
                                    </div>
                                    <Badge variant="outline" className="text-[9px] shrink-0 font-mono">
                                        {reportStatus ? reportStatus.toUpperCase() : 'IDLE'}
                                    </Badge>
                                </div>
                            )}
                        </div>
                    </TabsContent>

                    {/* ── TAB: Voice (TTS + STT combined) ────────────── */}
                    <TabsContent value="voice" className="mt-3 space-y-3">
                        {/* Voice cost split donut */}
                        {(totalTTSCostUSD > 0 || totalSTTCostUSD > 0) && (
                            <div className="rounded-lg border border-border/50 p-4 bg-muted/10">
                                <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-3">Voice Cost Split</div>
                                <VoiceDonutChart
                                    ttsChars={totalTTSChars}
                                    ttsCost={totalTTSCostUSD}
                                    sttSeconds={totalSTTSeconds}
                                    sttCost={totalSTTCostUSD}
                                />
                            </div>
                        )}
                        {/* TTS Section */}
                        <div className="rounded-lg border border-border/50 p-4 bg-muted/10 space-y-3">
                            <div className="flex items-center justify-between">
                                <div className="space-y-0.5">
                                    <h4 className="text-xs font-bold uppercase tracking-wider text-foreground flex items-center gap-1.5">
                                        <Volume2 className="h-3.5 w-3.5 text-emerald-500" />
                                        Text-to-Speech (TTS)
                                    </h4>
                                    <p className="text-[11px] text-muted-foreground">1 token equiv. = 4 characters</p>
                                </div>
                                <Badge variant="secondary" className="font-mono text-[10px]">
                                    {totalTTSChars.toLocaleString()} chars · {totalTTSTokens.toLocaleString()} tok eq
                                </Badge>
                            </div>
                            <div className="rounded-md border border-border/40 overflow-hidden">
                                <Table>
                                    <TableHeader className="bg-muted/40">
                                        <TableRow>
                                            <TableHead className="text-[10px] font-semibold uppercase">Service & Voice</TableHead>
                                            <TableHead className="text-right text-[10px] font-semibold uppercase">Characters</TableHead>
                                            <TableHead className="text-right text-[10px] font-semibold uppercase">Token Equiv.</TableHead>
                                            <TableHead className="text-right text-[10px] font-semibold uppercase">Rate / 1M</TableHead>
                                            <TableHead className="text-right text-[10px] font-semibold uppercase">Amount</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {ttsItems.map((item) => (
                                            <TableRow key={item.rawKey} className="text-xs">
                                                <TableCell className="font-medium">
                                                    <div>{item.serviceName}</div>
                                                    <div className="text-[10px] text-muted-foreground">{item.voiceOrModel}</div>
                                                </TableCell>
                                                <TableCell className="text-right font-mono text-[11px]">{item.characters.toLocaleString()}</TableCell>
                                                <TableCell className="text-right font-mono font-bold text-[11px]">{item.tokensEquivalent.toLocaleString()}</TableCell>
                                                <TableCell className="text-right font-mono text-[10px] text-muted-foreground">{item.priced ? `$${item.ratePer1MChars.toFixed(2)}` : '—'}</TableCell>
                                                <TableCell className="text-right font-mono font-bold text-[11px] text-emerald-600 dark:text-emerald-400">{formatItemCost(formatUSD, item.costUSD, item.priced)}</TableCell>
                                            </TableRow>
                                        ))}
                                        {ttsItems.length === 0 && (
                                            <TableRow>
                                                <TableCell colSpan={5} className="text-center py-4 text-muted-foreground text-xs">No TTS usage recorded.</TableCell>
                                            </TableRow>
                                        )}
                                    </TableBody>
                                </Table>
                            </div>
                        </div>

                        {/* STT Section */}
                        <div className="rounded-lg border border-border/50 p-4 bg-muted/10 space-y-3">
                            <div className="flex items-center justify-between">
                                <div className="space-y-0.5">
                                    <h4 className="text-xs font-bold uppercase tracking-wider text-foreground flex items-center gap-1.5">
                                        <Mic className="h-3.5 w-3.5 text-amber-500" />
                                        Speech-to-Text (STT)
                                    </h4>
                                    <p className="text-[11px] text-muted-foreground">Billed by duration in minutes</p>
                                </div>
                                <Badge variant="secondary" className="font-mono text-[10px]">
                                    {totalSTTSeconds.toFixed(1)}s · {(totalSTTSeconds / 60).toFixed(2)} min
                                </Badge>
                            </div>
                            <div className="rounded-md border border-border/40 overflow-hidden">
                                <Table>
                                    <TableHeader className="bg-muted/40">
                                        <TableRow>
                                            <TableHead className="text-[10px] font-semibold uppercase">Provider & Model</TableHead>
                                            <TableHead className="text-right text-[10px] font-semibold uppercase">Seconds</TableHead>
                                            <TableHead className="text-right text-[10px] font-semibold uppercase">Minutes</TableHead>
                                            <TableHead className="text-right text-[10px] font-semibold uppercase">Rate / min</TableHead>
                                            <TableHead className="text-right text-[10px] font-semibold uppercase">Amount</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {sttItems.map((item) => (
                                            <TableRow key={item.rawKey} className="text-xs">
                                                <TableCell className="font-medium">
                                                    <div>{item.serviceName}</div>
                                                    <div className="text-[10px] text-muted-foreground">{item.model}</div>
                                                </TableCell>
                                                <TableCell className="text-right font-mono text-[11px]">{item.durationSeconds.toFixed(1)}s</TableCell>
                                                <TableCell className="text-right font-mono text-[11px]">{item.durationMinutes.toFixed(2)}</TableCell>
                                                <TableCell className="text-right font-mono text-[10px] text-muted-foreground">{item.priced ? `$${item.ratePerMinute.toFixed(4)}` : '—'}</TableCell>
                                                <TableCell className="text-right font-mono font-bold text-[11px] text-amber-600 dark:text-amber-400">{formatItemCost(formatUSD, item.costUSD, item.priced)}</TableCell>
                                            </TableRow>
                                        ))}
                                        {sttItems.length === 0 && (
                                            <TableRow>
                                                <TableCell colSpan={5} className="text-center py-4 text-muted-foreground text-xs">No STT usage recorded.</TableCell>
                                            </TableRow>
                                        )}
                                    </TableBody>
                                </Table>
                            </div>
                        </div>
                    </TabsContent>

                    {/* ── TAB: QA Analysis ────────────────────────────── */}
                    {qaLLMItems.length > 0 && (
                        <TabsContent value="qa" className="mt-3">
                            <div className="rounded-lg border border-indigo-500/30 bg-indigo-500/[0.04] p-4 space-y-3">
                                <div className="flex items-center justify-between">
                                    <div className="space-y-0.5">
                                        <h4 className="text-xs font-bold uppercase tracking-wider text-foreground flex items-center gap-1.5">
                                            <Activity className="h-3.5 w-3.5 text-indigo-500" />
                                            QA Evaluator Tokens
                                        </h4>
                                        <p className="text-[11px] text-muted-foreground">
                                            Post-call evaluations, sentiment scoring, and checklist audits
                                        </p>
                                    </div>
                                    <Badge variant="secondary" className="font-mono text-[10px]">
                                        {qaLLMItems.reduce((a, i) => a + i.totalTokens, 0).toLocaleString()} tokens
                                    </Badge>
                                </div>
                                <div className="rounded-md border border-indigo-500/20 bg-background overflow-hidden">
                                    <Table>
                                        <TableHeader className="bg-indigo-500/5">
                                            <TableRow>
                                                <TableHead className="text-[10px] font-semibold uppercase">QA Model</TableHead>
                                                <TableHead className="text-right text-[10px] font-semibold uppercase">Input</TableHead>
                                                <TableHead className="text-right text-[10px] font-semibold uppercase">Cached</TableHead>
                                                <TableHead className="text-right text-[10px] font-semibold uppercase">Output</TableHead>
                                                <TableHead className="text-right text-[10px] font-semibold uppercase">Total</TableHead>
                                                <TableHead className="text-right text-[10px] font-semibold uppercase">Amount</TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {qaLLMItems.map((item) => (
                                                <TableRow key={item.rawKey} className="text-xs">
                                                    <TableCell className="font-medium text-foreground">{item.modelName}</TableCell>
                                                    <TableCell className="text-right font-mono text-[11px]">
                                                        {item.promptTokens.toLocaleString()}
                                                        <div className="text-[9px] text-muted-foreground">{item.priced ? `$${item.inputRatePer1M.toFixed(2)}/1M` : '—'}</div>
                                                    </TableCell>
                                                    <TableCell className="text-right font-mono text-[11px]">
                                                        {item.cacheReadTokens > 0 ? (
                                                            <span className="text-amber-600 dark:text-amber-400">{item.cacheReadTokens.toLocaleString()}</span>
                                                        ) : (
                                                            <span className="text-muted-foreground/50">—</span>
                                                        )}
                                                    </TableCell>
                                                    <TableCell className="text-right font-mono text-[11px]">
                                                        {item.completionTokens.toLocaleString()}
                                                        <div className="text-[9px] text-muted-foreground">{item.priced ? `$${item.outputRatePer1M.toFixed(2)}/1M` : '—'}</div>
                                                    </TableCell>
                                                    <TableCell className="text-right font-mono font-bold text-[11px]">{item.totalTokens.toLocaleString()}</TableCell>
                                                    <TableCell className="text-right font-mono font-bold text-[11px]">{formatItemCost(formatUSD, item.totalCostUSD, item.priced)}</TableCell>
                                                </TableRow>
                                            ))}
                                        </TableBody>
                                    </Table>
                                </div>
                            </div>
                        </TabsContent>
                    )}
                </Tabs>
            </CardContent>
        </Card>
    );
}
