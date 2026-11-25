'use client';

import {
    Check,
    Copy,
    Cpu,
    Info,
} from 'lucide-react';
import React, { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';

import {
    getModelConfigurationOptionsApiV1OrganizationsModelConfigurationOptionsGet,
    getWorkflowApiV1WorkflowFetchWorkflowIdGet,
} from '@/client/sdk.gen';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { ModelPricingRule } from '@/context/OrgConfigContext';
import { formatExactUsd, formatTotalCost, resolveLLMPricing, resolveSTTPricing, resolveTTSPricing } from '@/lib/modelPricing';
import { cn } from '@/lib/utils';

import { billedCostFor } from './providerUsage';
import type { RealtimeFeedbackEvent, WorkflowRunResponse } from './types';
import { mergeCanonicalUsage } from './usageBreakdown';

export interface AnalyticsSidebarProps {
    workflowRun: WorkflowRunResponse | null | undefined;
    runId: number | string;
    organizationName?: string;
    totalPromptTokens?: number;
    totalCompletionTokens?: number;
    totalCachedTokens?: number;
    totalCostUsd?: number;
    totalTurns?: number;
    durationSeconds?: number;
    maxCallDuration?: number;
    totalWorkflowNodes?: number;
    modelPricingRules?: ModelPricingRule[];
}

const formatUSD = formatExactUsd;

export function extractPresetName(run: WorkflowRunResponse | null | undefined): string | null {
    if (!run) return null;
    return (
        (run?.initial_context?.runtime_configuration as { preset_name?: string } | undefined)?.preset_name ||
        (run?.runtime_configuration as { preset_name?: string } | undefined)?.preset_name ||
        (run?.initial_context as { preset_name?: string } | undefined)?.preset_name ||
        run?.preset_name ||
        run?.model_preset_name ||
        run?.preset?.name ||
        run?.workflow?.preset_name ||
        null
    );
}

export function AnalyticsSidebar({
    workflowRun,
    runId,
    organizationName,
    totalPromptTokens,
    totalCompletionTokens,
    totalCachedTokens,
    totalCostUsd,
    totalTurns,
    durationSeconds,
    maxCallDuration = 600,
    totalWorkflowNodes = 0,
    modelPricingRules,
}: AnalyticsSidebarProps) {
    const [copiedField, setCopiedField] = useState<string | null>(null);

    const handleCopy = (text: string, fieldName: string) => {
        navigator.clipboard.writeText(text);
        setCopiedField(fieldName);
        toast.success(`Copied ${fieldName} to clipboard`);
        setTimeout(() => setCopiedField(null), 2000);
    };

    const realRunId = workflowRun?.id != null && workflowRun.id !== 0
        ? String(workflowRun.id)
        : runId != null && runId !== 0 && runId !== '0'
            ? String(runId)
            : '—';
    const convoIdDisplay = realRunId;

    const [agentUuid, setAgentUuid] = useState<string | null>(
        workflowRun?.workflow_uuid ||
        workflowRun?.agent_uuid ||
        workflowRun?.workflow?.workflow_uuid ||
        null
    );

    useEffect(() => {
        if (workflowRun?.workflow_uuid) {
            setAgentUuid(workflowRun.workflow_uuid);
            return;
        }
        if (agentUuid) return;
        const targetWfId = workflowRun?.workflow_id;
        if (!targetWfId) return;

        let isActive = true;
        getWorkflowApiV1WorkflowFetchWorkflowIdGet({
            path: { workflow_id: Number(targetWfId) },
        })
            .then((res) => {
                if (isActive && res.data?.workflow_uuid) {
                    setAgentUuid(res.data.workflow_uuid);
                }
            })
            .catch(() => {});

        return () => {
            isActive = false;
        };
    }, [workflowRun?.workflow_id, workflowRun?.workflow_uuid, agentUuid]);

    const agentUuidDisplay = agentUuid || '—';

    const initialPresetName = useMemo(() => extractPresetName(workflowRun), [workflowRun]);
    const [modelStackName, setModelStackName] = useState<string | null>(initialPresetName);

    useEffect(() => {
        const direct = extractPresetName(workflowRun);
        if (direct) {
            setModelStackName(direct);
            return;
        }

        let isActive = true;
        getModelConfigurationOptionsApiV1OrganizationsModelConfigurationOptionsGet()
            .then(async (res) => {
                if (!isActive || !res.data || res.data.length === 0) return;
                const options = res.data;

                const initCtx = workflowRun?.initial_context as Record<string, unknown> | undefined;
                const gathCtx = workflowRun?.gathered_context as Record<string, unknown> | undefined;
                const rtConf = initCtx?.runtime_configuration as Record<string, unknown> | undefined;

                const runPresetId =
                    workflowRun?.platform_model_configuration_id ??
                    initCtx?.platform_model_configuration_id ??
                    rtConf?.platform_model_configuration_id ??
                    gathCtx?.platform_model_configuration_id;

                if (runPresetId != null) {
                    const match = options.find((p) => p.id === Number(runPresetId));
                    if (match?.name) {
                        setModelStackName(match.name);
                        return;
                    }
                }

                const targetWfId = workflowRun?.workflow_id;
                if (targetWfId) {
                    try {
                        const wfRes = await getWorkflowApiV1WorkflowFetchWorkflowIdGet({
                            path: { workflow_id: Number(targetWfId) },
                        });
                        if (!isActive) return;
                        const wfConfigs = (wfRes.data?.workflow_configurations ?? {}) as Record<string, unknown>;
                        const wfPresetId = wfConfigs.platform_model_configuration_id;
                        if (wfPresetId != null) {
                            const match = options.find((p) => p.id === Number(wfPresetId));
                            if (match?.name) {
                                setModelStackName(match.name);
                                return;
                            }
                        }
                    } catch {
                        // ignore
                    }
                }

                if (!isActive) return;
                const def = options.find((p) => (p as { is_default?: boolean }).is_default) || options[0];
                if (def?.name) {
                    setModelStackName(def.name);
                }
            })
            .catch(() => {});

        return () => {
            isActive = false;
        };
    }, [workflowRun]);

    const displayModelStackName = modelStackName;

    const accountHolderDisplay =
        workflowRun?.account_holder ||
        workflowRun?.organization_name ||
        organizationName ||
        '—';

    // Real TTFB from events
    const ttfbMetrics = useMemo(() => {
        const events = (workflowRun?.logs?.realtime_feedback_events ?? []) as RealtimeFeedbackEvent[];
        const ttfbs = events
            .filter((e) => e.type === 'rtf-ttfb-metric' && e.payload?.ttfb_seconds)
            .map((e) => Math.round(Number(e.payload!.ttfb_seconds) * 1000));
        if (ttfbs.length === 0) return { avg: 0, total: 0 };
        const sum = ttfbs.reduce((a: number, b: number) => a + b, 0);
        return { avg: Math.round(sum / ttfbs.length), total: sum };
    }, [workflowRun?.logs?.realtime_feedback_events]);

    // Real node data from gathered_context.nodes_visited (backend engine tracks this)
    const nodeTransitions = useMemo(() => {
        const nodesVisited: string[] = Array.isArray(workflowRun?.gathered_context?.nodes_visited)
            ? workflowRun.gathered_context.nodes_visited
            : [];

        // Count actual transitions from rtf-node-transition events
        const events = (workflowRun?.logs?.realtime_feedback_events ?? []) as RealtimeFeedbackEvent[];
        const transitionEvents = events.filter((e) => e.type === 'rtf-node-transition');
        const transitionCount = transitionEvents.length;

        // If no explicit transition events, derive switch count from visited nodes
        // (first node is entry, each additional node = 1 switch)
        const switchCount = transitionCount > 0
            ? transitionCount
            : Math.max(0, nodesVisited.length - 1);

        // Build list of unique nodes visited
        const uniqueNodesMap = new Map<string, { id: string; name: string }>();

        transitionEvents.forEach((e, idx: number) => {
            const name = e.payload?.node_name || (e as { node_name?: string }).node_name || 'Node';
            const id = e.payload?.node_id || `node_${idx + 1}`;
            if (!uniqueNodesMap.has(name)) {
                uniqueNodesMap.set(name, { id: String(id), name: String(name) });
            }
        });

        nodesVisited.forEach((nodeItem: unknown, idx: number) => {
            if (typeof nodeItem === 'string') {
                if (!uniqueNodesMap.has(nodeItem)) {
                    uniqueNodesMap.set(nodeItem, { id: `node_${idx + 1}`, name: nodeItem });
                }
            } else if (nodeItem && typeof nodeItem === 'object') {
                const item = nodeItem as { name?: string; node_name?: string; id?: string | number; node_id?: string | number };
                const name = item.name || item.node_name || `Node ${idx + 1}`;
                const id = item.id || item.node_id || `node_${idx + 1}`;
                if (!uniqueNodesMap.has(name)) {
                    uniqueNodesMap.set(name, { id: String(id), name: String(name) });
                }
            }
        });

        const uniqueNodes = Array.from(uniqueNodesMap.values());

        return {
            count: switchCount,
            switchCount,
            uniqueNodes,
            visitedNodes: nodesVisited,
            totalNodes: totalWorkflowNodes,
        };
    }, [workflowRun?.gathered_context?.nodes_visited, workflowRun?.logs?.realtime_feedback_events, totalWorkflowNodes]);

    // Usage info & canonical usage
    const canonicalEntries = useMemo(
        () => workflowRun?.canonical_usage?.entries ?? [],
        [workflowRun?.canonical_usage?.entries],
    );
    const mergedUsageInfo = useMemo(
        () => mergeCanonicalUsage(workflowRun?.usage_info, canonicalEntries),
        [workflowRun?.usage_info, canonicalEntries],
    );

    const activeUsage = mergedUsageInfo;
    const llmUsage = useMemo(
        () => (activeUsage.llm ?? {}) as Record<string, { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number; cache_read_input_tokens?: number }>,
        [activeUsage.llm],
    );
    const ttsUsage = useMemo(
        () => (activeUsage.tts ?? {}) as Record<string, number>,
        [activeUsage.tts],
    );
    const sttUsage = useMemo(
        () => (activeUsage.stt ?? {}) as Record<string, number>,
        [activeUsage.stt],
    );

    const effectivePromptTokens = useMemo(() => {
        if (totalPromptTokens !== undefined) return totalPromptTokens;
        let sum = 0;
        Object.values(llmUsage).forEach((v) => {
            const p = Number(v?.prompt_tokens) || 0;
            const t = Number(v?.total_tokens) || 0;
            sum += p || t;
        });
        return sum;
    }, [totalPromptTokens, llmUsage]);

    const effectiveCompletionTokens = useMemo(() => {
        if (totalCompletionTokens !== undefined) return totalCompletionTokens;
        let sum = 0;
        Object.values(llmUsage).forEach((v) => {
            sum += Number(v?.completion_tokens) || 0;
        });
        return sum;
    }, [totalCompletionTokens, llmUsage]);

    const effectiveCachedTokens = useMemo(() => {
        if (totalCachedTokens !== undefined) return totalCachedTokens;
        let sum = 0;
        Object.values(llmUsage).forEach((v) => {
            sum += Number(v?.cache_read_input_tokens) || 0;
        });
        return sum;
    }, [totalCachedTokens, llmUsage]);

    const providerUsage = workflowRun?.canonical_usage?.provider_usage;
    const { effectiveCostUsd, unpricedCount } = useMemo(() => {
        if (totalCostUsd !== undefined) return { effectiveCostUsd: totalCostUsd, unpricedCount: 0 };
        let unpriced = 0;
        let llm = 0;
        for (const [key, val] of Object.entries(llmUsage)) {
            const modelName = key.split('|||')[1] || key;
            const pricing = resolveLLMPricing(modelName, modelPricingRules);
            if (!pricing.priced) unpriced += 1;
            const prompt = Number(val?.prompt_tokens) || Number(val?.total_tokens) || 0;
            const completion = Number(val?.completion_tokens) || 0;
            llm += (prompt / 1_000_000) * pricing.inputPer1M + (completion / 1_000_000) * pricing.outputPer1M;
        }
        let tts = 0;
        for (const [key, chars] of Object.entries(ttsUsage)) {
            const providerName = key.split('|||')[0] || key;
            const pricing = resolveTTSPricing(providerName, modelPricingRules);
            const billedCost = billedCostFor(providerUsage, 'TTS', key);
            if (!pricing.priced && billedCost === null) unpriced += 1;
            tts += billedCost ?? (Number(chars) / 1_000_000) * pricing.per1MChars;
        }
        let stt = 0;
        for (const [key, sec] of Object.entries(sttUsage)) {
            const providerName = key.split('|||')[0] || key;
            const pricing = resolveSTTPricing(providerName, modelPricingRules);
            const billedCost = billedCostFor(providerUsage, 'STT', key);
            if (!pricing.priced && billedCost === null) unpriced += 1;
            stt += billedCost ?? (Number(sec) / 60) * pricing.perMinute;
        }
        return { effectiveCostUsd: llm + tts + stt, unpricedCount: unpriced };
    }, [totalCostUsd, llmUsage, ttsUsage, sttUsage, modelPricingRules, providerUsage]);

    const effectiveDurationSeconds = useMemo(() => {
        if (durationSeconds !== undefined) return durationSeconds;
        return Number(workflowRun?.cost_info?.call_duration_seconds) || 0;
    }, [durationSeconds, workflowRun?.cost_info?.call_duration_seconds]);

    const effectiveTurns = useMemo(() => {
        if (totalTurns !== undefined) return totalTurns;
        const events = (workflowRun?.logs?.realtime_feedback_events ?? []) as RealtimeFeedbackEvent[];
        const userTurns = events.filter((ev) => ev.type === 'rtf-user-transcription' && ev.payload?.final).length;
        const botTurns = events.filter((ev) => ev.type === 'rtf-bot-text').length;
        const count = Math.max(userTurns, botTurns);
        return count > 0 ? count : (events.length > 0 ? 1 : 0);
    }, [totalTurns, workflowRun?.logs?.realtime_feedback_events]);

    // Model snapshot
    const runtimeConfig = (workflowRun?.initial_context?.runtime_configuration ?? {}) as Record<string, string>;
    const llmKeys = Object.keys(llmUsage);
    const ttsKeys = Object.keys(ttsUsage);
    const sttKeys = Object.keys(sttUsage);

    const sttDisplay = sttKeys.length > 0
        ? sttKeys[0].split('|||').join(' / ')
        : runtimeConfig.stt_model ? `${runtimeConfig.stt_provider ?? ''} / ${runtimeConfig.stt_model}`.replace(/^\/ /, '') : '—';
    const llmDisplay = llmKeys.length > 0
        ? llmKeys.filter(k => !k.startsWith('ReportGeneration') && !k.startsWith('QAAnalysis'))[0]?.split('|||').join(' / ') || llmKeys[0].split('|||').join(' / ')
        : runtimeConfig.llm_model ? `${runtimeConfig.llm_provider ?? ''} / ${runtimeConfig.llm_model}`.replace(/^\/ /, '')
            : runtimeConfig.realtime_model ? `${runtimeConfig.realtime_provider ?? ''} / ${runtimeConfig.realtime_model}`.replace(/^\/ /, '') : '—';
    const ttsDisplay = ttsKeys.length > 0
        ? ttsKeys[0].split('|||').join(' / ')
        : runtimeConfig.tts_model ? `${runtimeConfig.tts_provider ?? ''} / ${runtimeConfig.tts_model}`.replace(/^\/ /, '') : '—';

    const isCompleted = workflowRun?.is_completed === true;
    const reportStatus = workflowRun?.report_generation_status;
    const isProcessing = !isCompleted || reportStatus === 'processing' || reportStatus === 'pending';

    // Completeness / Overall Conversation Resolution
    const annotationsRecord = workflowRun?.annotations as Record<string, unknown> | null | undefined;
    const completeness = (workflowRun?.completeness || (annotationsRecord?.completeness as { score?: number | null; verdict?: string | null } | undefined)) as
        | { score?: number | null; verdict?: string | null }
        | null
        | undefined;
    const completenessScore =
        typeof completeness?.score === 'number'
            ? Math.max(0, Math.min(100, Math.round(completeness.score)))
            : null;
    const completenessVerdict = completeness?.verdict ? String(completeness.verdict).replace(/_/g, ' ') : null;

    const durationMins = Math.ceil(effectiveDurationSeconds / 60) || 0;
    const durationFormatted = effectiveDurationSeconds > 0
        ? `${effectiveDurationSeconds.toFixed(1)}s • ${durationMins} min`
        : '—';

    // Progress: percentage of max_call_duration consumed
    const progressPct = maxCallDuration > 0
        ? Math.min(100, Math.round((effectiveDurationSeconds / maxCallDuration) * 100))
        : (isCompleted ? 100 : 0);
    const maxDurationFormatted = maxCallDuration >= 60
        ? `${Math.floor(maxCallDuration / 60)}m ${maxCallDuration % 60 > 0 ? `${maxCallDuration % 60}s` : ''}`
        : `${maxCallDuration}s`;

    return (
        <div className="w-full space-y-4">

            {/* ── CARD 1: USAGE ── */}
            <Card className="border-border/70 bg-card/60 backdrop-blur-sm shadow-sm overflow-hidden">
                <CardHeader className="p-4 pb-2.5 flex flex-row items-center justify-between border-b border-border/40">
                    <CardTitle className="text-xs font-bold uppercase tracking-wider text-foreground">
                        Usage
                    </CardTitle>
                </CardHeader>
                <CardContent className="p-4 pt-3 space-y-3.5">
                    {/* Duration & Progress */}
                    <div className="space-y-1.5">
                        <div className="flex items-center justify-between text-xs">
                            <span className="font-semibold text-muted-foreground">Conversation duration</span>
                            <span className="font-mono font-bold text-foreground">{durationFormatted}</span>
                        </div>
                        {/* Progress bar — duration vs session target */}
                        <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
                            <div
                                className={cn(
                                    "h-full rounded-full transition-all duration-500",
                                    isCompleted
                                        ? progressPct >= 90 ? "bg-amber-500" : "bg-emerald-500"
                                        : "bg-blue-500 animate-pulse"
                                )}
                                style={{ width: `${Math.max(progressPct, 2)}%` }}
                            />
                        </div>
                        <p className="text-[10px] text-muted-foreground">
                            {isCompleted
                                ? `Completed • ${progressPct}% of ${maxDurationFormatted.trim()} target`
                                : isProcessing
                                    ? `${progressPct}% of ${maxDurationFormatted.trim()} target • In progress…`
                                    : `${progressPct}% of ${maxDurationFormatted.trim()} session target`}
                        </p>
                    </div>

                    {/* Table: Feature / This conversation / Status */}
                    <div className="rounded-lg border border-border/40 bg-muted/20 overflow-hidden">
                        <table className="w-full text-xs">
                            <thead className="bg-muted/40 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground border-b border-border/40">
                                <tr>
                                    <th className="py-2 px-3 text-left">Feature</th>
                                    <th className="py-2 px-3 text-center">This conversation</th>
                                    <th className="py-2 px-3 text-right">Status</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-border/30 text-xs">
                                <tr>
                                    <td className="py-2 px-3 font-medium text-foreground">Turns</td>
                                    <td className="py-2 px-3 text-center font-mono text-foreground">{effectiveTurns}</td>
                                    <td className="py-2 px-3 text-right">
                                        <Badge variant="outline" className="h-4 px-1.5 text-[9px] font-mono border-emerald-500/30 bg-emerald-500/15 text-emerald-400">
                                            live
                                        </Badge>
                                    </td>
                                </tr>
                                <tr>
                                    <td className="py-2 px-3 font-medium text-foreground">Node switches</td>
                                    <td className="py-2 px-3 text-center font-mono text-foreground">
                                        {nodeTransitions.visitedNodes.length} / {nodeTransitions.totalNodes > 0 ? nodeTransitions.totalNodes : nodeTransitions.visitedNodes.length}
                                    </td>
                                    <td className="py-2 px-3 text-right">
                                        <Badge variant="outline" className={cn(
                                            "h-4 px-1.5 text-[9px] font-mono",
                                            nodeTransitions.visitedNodes.length > 0
                                                ? "border-emerald-500/30 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                                                : "border-border bg-muted text-foreground"
                                        )}>
                                            {nodeTransitions.visitedNodes.length > 0 ? 'live' : 'tracked'}
                                        </Badge>
                                    </td>
                                </tr>
                                <tr>
                                    <td className="py-2 px-3 font-medium text-foreground">Tokens (prompt / completion)</td>
                                    <td className="py-2 px-3 text-center font-mono text-foreground">{effectivePromptTokens.toLocaleString()} / {effectiveCompletionTokens.toLocaleString()}</td>
                                    <td className="py-2 px-3 text-right">
                                        <Badge variant="outline" className="h-4 px-1.5 text-[9px] font-mono border-emerald-500/30 bg-emerald-500/15 text-emerald-400">
                                            live
                                        </Badge>
                                    </td>
                                </tr>
                                {effectiveCachedTokens > 0 && (
                                    <tr>
                                        <td className="py-2 px-3 font-medium text-foreground">Cached tokens</td>
                                        <td className="py-2 px-3 text-center font-mono text-amber-400">{effectiveCachedTokens.toLocaleString()}</td>
                                        <td className="py-2 px-3 text-right">
                                            <Badge variant="outline" className="h-4 px-1.5 text-[9px] font-mono border-amber-500/30 bg-amber-500/15 text-amber-400">
                                                cached
                                            </Badge>
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>

                    <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground pt-1">
                        {workflowRun?.created_at
                            ? new Date(workflowRun.created_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
                            : '—'}
                    </p>

                    {/* 2x2 Grid of Metrics */}
                    <div className="grid grid-cols-2 gap-2.5">
                        {/* Total Cost */}
                        <div className="rounded-lg border border-border/40 bg-muted/20 p-2.5 space-y-1">
                            <div className="flex items-center justify-between text-[10px] uppercase font-semibold text-muted-foreground">
                                <span>Estimated Cost</span>
                                <Info className="h-3 w-3 text-muted-foreground/60" />
                            </div>
                            <p className="text-base font-bold font-mono text-foreground">
                                {formatTotalCost(formatUSD, effectiveCostUsd, unpricedCount)}
                            </p>
                            <p className="text-[9px] text-muted-foreground truncate">
                                {effectiveCostUsd > 0 || unpricedCount > 0
                                    ? `Across ${Object.keys(llmUsage).length + Object.keys(ttsUsage).length + Object.keys(sttUsage).length} model(s)`
                                    : 'No usage data yet'}
                            </p>
                        </div>

                        {/* Response Time */}
                        <div className="rounded-lg border border-border/40 bg-muted/20 p-2.5 space-y-1">
                            <div className="flex items-center justify-between text-[10px] uppercase font-semibold text-muted-foreground">
                                <span>Response Time</span>
                                <Info className="h-3 w-3 text-muted-foreground/60" />
                            </div>
                            <p className="text-base font-bold font-mono text-foreground">
                                {ttfbMetrics.total > 0 ? `${ttfbMetrics.total}ms` : '—'}
                            </p>
                            <p className="text-[9px] text-muted-foreground truncate">
                                {ttfbMetrics.avg > 0 ? `${ttfbMetrics.avg}ms avg • Total ${ttfbMetrics.total}ms` : 'No TTFB data'}
                            </p>
                        </div>

                        {/* Success Rate / Overall Conversation Resolution */}
                        <div className="rounded-lg border border-border/40 bg-muted/20 p-2.5 space-y-1">
                            <div className="flex items-center justify-between text-[10px] uppercase font-semibold text-muted-foreground">
                                <span>Conversation Success Rate</span>
                                <Info className="h-3 w-3 text-muted-foreground/60" />
                            </div>
                            <p className={cn(
                                "text-base font-bold font-mono",
                                completenessScore !== null
                                    ? completenessScore >= 75
                                        ? "text-emerald-400"
                                        : completenessScore >= 40
                                            ? "text-amber-400"
                                            : "text-rose-400"
                                    : "text-foreground"
                            )}>
                                {completenessScore !== null ? `${completenessScore}%` : '—'}
                            </p>
                            <p className="text-[9px] text-muted-foreground truncate capitalize" title={completenessVerdict ? `${completenessVerdict} • Overall Conversation Resolution` : 'Overall Conversation Resolution'}>
                                {completenessScore !== null
                                    ? (completenessVerdict ? `${completenessVerdict} • Resolution` : 'Overall Resolution')
                                    : 'Not evaluated'}
                            </p>
                        </div>

                        {/* Model Stack */}
                        <div className="rounded-lg border border-border/40 bg-muted/20 p-2.5 space-y-1">
                            <div className="flex items-center justify-between text-[10px] uppercase font-semibold text-muted-foreground">
                                <span>Model Stack</span>
                                <Info className="h-3 w-3 text-muted-foreground/60" />
                            </div>
                            <p className="text-base font-bold text-foreground truncate" title={displayModelStackName ?? undefined}>
                                {displayModelStackName ?? '—'}
                            </p>
                            <p className="text-[9px] text-muted-foreground truncate">
                                Active Model Preset
                            </p>
                        </div>
                    </div>
                </CardContent>
            </Card>

            {/* ── CARD 2: NODE SWITCHES ── */}
            <Card className="border-border/70 bg-card/60 backdrop-blur-sm shadow-sm overflow-hidden">
                <CardHeader className="p-4 pb-2.5 border-b border-border/40">
                    <CardTitle className="text-xs font-bold uppercase tracking-wider text-foreground">
                        Node Switches ({nodeTransitions.count ?? 0})
                    </CardTitle>
                </CardHeader>
                <CardContent className="p-4 pt-3 space-y-1.5">
                    {(nodeTransitions.uniqueNodes?.length ?? 0) > 0 ? (
                        nodeTransitions.uniqueNodes?.map((node) => (
                            <div key={node.id} className="flex items-center justify-between rounded-lg border border-border/40 bg-muted/20 px-3 py-2 text-xs">
                                <span className="font-medium text-foreground truncate">{node.name}</span>
                                <Badge variant="outline" className="h-5 px-2 text-[9px] font-mono border-border bg-muted text-foreground shrink-0 ml-2">
                                    {node.id.length > 12 ? node.id.slice(0, 12) + '…' : node.id.toUpperCase()}
                                </Badge>
                            </div>
                        ))
                    ) : (
                        <div className="text-xs text-muted-foreground text-center py-2">
                            No node transitions recorded
                        </div>
                    )}
                </CardContent>
            </Card>

            {/* ── CARD 3: ACCOUNT DETAILS ── */}
            <Card className="border-border/70 bg-card/60 backdrop-blur-sm shadow-sm overflow-hidden">
                <CardHeader className="p-4 pb-3">
                    <CardTitle className="text-sm font-bold text-foreground">
                        Account Details
                    </CardTitle>
                </CardHeader>
                <CardContent className="p-4 pt-0 space-y-2.5">
                    {/* Conversation ID */}
                    <div className="flex items-center justify-between rounded-lg border border-border/40 bg-muted/20 px-3 py-2.5">
                        <div className="min-w-0 flex-1 space-y-1">
                            <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                                Conversation ID
                            </div>
                            <div className="font-mono text-xs font-medium text-foreground truncate pr-2">
                                {convoIdDisplay}
                            </div>
                        </div>
                        <button
                            type="button"
                            onClick={() => handleCopy(convoIdDisplay, 'Conversation ID')}
                            className="text-muted-foreground hover:text-foreground transition-colors shrink-0 ml-2"
                            aria-label="Copy Conversation ID"
                        >
                            {copiedField === 'Conversation ID' ? (
                                <Check className="h-4 w-4 text-emerald-400" />
                            ) : (
                                <Copy className="h-4 w-4" />
                            )}
                        </button>
                    </div>

                    {/* Agent UUID */}
                    <div className="flex items-center justify-between rounded-lg border border-border/40 bg-muted/20 px-3 py-2.5">
                        <div className="min-w-0 flex-1 space-y-1">
                            <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                                Agent UUID
                            </div>
                            <div className="font-mono text-xs font-medium text-foreground truncate pr-2">
                                {agentUuidDisplay}
                            </div>
                        </div>
                        <button
                            type="button"
                            onClick={() => handleCopy(agentUuidDisplay, 'Agent UUID')}
                            className="text-muted-foreground hover:text-foreground transition-colors shrink-0 ml-2"
                            aria-label="Copy Agent UUID"
                        >
                            {copiedField === 'Agent UUID' ? (
                                <Check className="h-4 w-4 text-emerald-400" />
                            ) : (
                                <Copy className="h-4 w-4" />
                            )}
                        </button>
                    </div>

                    {/* Account Holder */}
                    <div className="rounded-lg border border-border/40 bg-muted/20 px-3 py-2.5 space-y-1">
                        <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                            Account holder
                        </div>
                        <div className="text-xs font-medium text-foreground truncate">
                            {accountHolderDisplay}
                        </div>
                    </div>
                </CardContent>
            </Card>

            {/* ── CARD 4: Model stack snapshot ── */}
            <Card className="border-border/70 bg-card/60 backdrop-blur-sm shadow-sm overflow-hidden">
                <CardHeader className="p-4 pb-3 flex flex-row items-center justify-between border-b border-border/40">
                    <div className="flex items-center gap-2">
                        <Cpu className="h-4 w-4 text-purple-400 shrink-0" />
                        <CardTitle className="text-xs font-bold uppercase tracking-wider text-foreground">
                            Model stack snapshot
                        </CardTitle>
                    </div>
                    {displayModelStackName && (
                        <Badge variant="outline" className="h-5 px-2 text-[10px] font-medium border-purple-500/30 bg-purple-500/10 text-purple-300 truncate max-w-[160px]" title={displayModelStackName}>
                            {displayModelStackName}
                        </Badge>
                    )}
                </CardHeader>
                <CardContent className="p-4 pt-3.5 space-y-2.5">
                    {/* STT */}
                    <div className="rounded-lg border border-border/40 bg-muted/20 px-3 py-2.5 space-y-1">
                        <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                            STT
                        </div>
                        <div className="text-xs font-bold text-foreground truncate">
                            {sttDisplay}
                        </div>
                    </div>

                    {/* LLM */}
                    <div className="rounded-lg border border-border/40 bg-muted/20 px-3 py-2.5 space-y-1">
                        <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                            LLM
                        </div>
                        <div className="text-xs font-bold text-foreground truncate">
                            {llmDisplay}
                        </div>
                    </div>

                    {/* TTS */}
                    <div className="rounded-lg border border-border/40 bg-muted/20 px-3 py-2.5 space-y-1">
                        <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                            TTS
                        </div>
                        <div className="text-xs font-bold text-foreground truncate">
                            {ttsDisplay}
                        </div>
                    </div>
                </CardContent>
            </Card>

        </div>
    );
}
