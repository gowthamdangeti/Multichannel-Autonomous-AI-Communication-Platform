'use client';

import { Activity } from 'lucide-react';
import React, { useMemo } from 'react';

import { Card, CardContent } from '@/components/ui/card';
import type { ModelPricingRule } from '@/context/OrgConfigContext';
import { resolveLLMPricing, resolveSTTPricing, resolveTTSPricing } from '@/lib/modelPricing';

import { AnalyticsSidebar } from './AnalyticsSidebar';
import { ConversationAnalyticsCharts } from './ConversationAnalyticsCharts';
import {
    extractConversationTelemetry,
    readLlmTokenParts,
    type RealTimeEvent,
} from './extractConversationTelemetry';
import { findBilledService, toUnreportedLlmNote } from './providerUsage';
import type { RealtimeFeedbackEvent, WorkflowRunResponse } from './types';
import {
    buildTokenBreakdown,
    mergeCanonicalUsage,
    type PricingFns,
    summarizeQaResults,
    validateBreakdown,
} from './usageBreakdown';
import { TokenUsageBreakdownTable, ValidationNotes } from './UsageTables';

// ============================================================================
// Types
// ============================================================================

export interface ConversationAnalyticsTabProps {
    workflowRun: WorkflowRunResponse | null | undefined;
    targetWorkflowId: number | string;
    runId: number | string;
    organizationName?: string;
    agentName?: string;
    modelPricingRules?: ModelPricingRule[];
    maxCallDuration?: number;
    totalWorkflowNodes?: number;
}

// ============================================================================
// Main Component
// ============================================================================

export function ConversationAnalyticsTab({
    workflowRun,
    runId,
    organizationName = '',
    modelPricingRules,
    maxCallDuration = 600,
    totalWorkflowNodes = 0,
}: ConversationAnalyticsTabProps) {
    const canonicalEntries = useMemo(
        () => workflowRun?.canonical_usage?.entries ?? [],
        [workflowRun?.canonical_usage?.entries],
    );
    const usageInfo = useMemo(
        () => mergeCanonicalUsage(workflowRun?.usage_info, canonicalEntries),
        [workflowRun?.usage_info, canonicalEntries],
    );

    const turnsData = useMemo(
        () => extractConversationTelemetry(workflowRun, modelPricingRules, usageInfo),
        [workflowRun, modelPricingRules, usageInfo],
    );

    const llmUsage = useMemo(
        () => (usageInfo.llm ?? {}) as Record<string, { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number; cache_read_input_tokens?: number }>,
        [usageInfo.llm],
    );
    const ttsUsage = useMemo(
        () => (usageInfo.tts ?? {}) as Record<string, number>,
        [usageInfo.tts],
    );
    const sttUsage = useMemo(
        () => (usageInfo.stt ?? {}) as Record<string, number>,
        [usageInfo.stt],
    );

    // ── Token tables: single derivation shared by both analytics tables ──
    const pricing = useMemo<PricingFns>(
        () => ({
            llm: (model: string) => resolveLLMPricing(model, modelPricingRules),
            tts: (service: string) => resolveTTSPricing(service, modelPricingRules),
            stt: (service: string) => resolveSTTPricing(service, modelPricingRules),
        }),
        [modelPricingRules],
    );

    const providerUsage = workflowRun?.canonical_usage?.provider_usage;
    const breakdown = useMemo(
        () => buildTokenBreakdown(usageInfo, pricing, (type, model) => findBilledService(providerUsage, type, model)),
        [usageInfo, pricing, providerUsage],
    );

    const usageIssues = useMemo(() => {
        const issues = validateBreakdown(breakdown, {
            autonomous_ai_osTokenUsage: workflowRun?.cost_info?.autonomous_ai_os_token_usage,
        });
        const unreportedNote = toUnreportedLlmNote(providerUsage);
        return unreportedNote
            ? [...issues, { severity: 'warn' as const, code: 'llm_usage_unreported', detail: unreportedNote }]
            : issues;
    }, [breakdown, workflowRun?.cost_info?.autonomous_ai_os_token_usage, providerUsage]);

    const qaSummary = useMemo(
        () => summarizeQaResults(workflowRun?.annotations),
        [workflowRun?.annotations],
    );

    const totalPromptTokens = useMemo(() => {
        let sum = 0;
        Object.values(llmUsage).forEach((value: unknown) => { sum += readLlmTokenParts(value).prompt; });
        return sum;
    }, [llmUsage]);

    const totalCompletionTokens = useMemo(() => {
        let sum = 0;
        Object.values(llmUsage).forEach((value: unknown) => { sum += readLlmTokenParts(value).completion; });
        return sum;
    }, [llmUsage]);

    const totalTtsChars = useMemo(() => {
        let sum = 0;
        Object.values(ttsUsage).forEach((v: unknown) => { sum += Number(v) || 0; });
        return sum;
    }, [ttsUsage]);

    const totalSttSec = useMemo(() => {
        let sum = 0;
        Object.values(sttUsage).forEach((v: unknown) => { sum += Number(v) || 0; });
        return sum;
    }, [sttUsage]);

    const totalCachedTokens = useMemo(() => {
        let sum = 0;
        Object.values(llmUsage).forEach((v: unknown) => {
            const entry = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
            sum += Number(entry.cache_read_input_tokens ?? entry.cache_read_tokens) || 0;
        });
        return sum;
    }, [llmUsage]);

    const totalCacheReadTokens = breakdown.totals.cacheReadTokens || totalCachedTokens;
    const totalCacheCreationTokens = breakdown.totals.cacheCreationTokens || 0;

    const totalRequests = turnsData.reduce((sum, t) => sum + t.apiRequests, 0);
    const totalSuccessfulReqs = turnsData.reduce((sum, t) => sum + t.successfulRequests, 0);
    const totalFailedReqs = turnsData.reduce((sum, t) => sum + t.failedRequests, 0);
    const overallSuccessRate = totalRequests > 0 ? Math.round((totalSuccessfulReqs / totalRequests) * 100) : null;

    // Extract error details from pipeline error events
    const pipelineErrorDetails = useMemo(() => {
        const events = (workflowRun?.logs?.realtime_feedback_events ?? []) as RealtimeFeedbackEvent[];
        return events
            .filter((e) => e.type === 'rtf-pipeline-error')
            .map((e) => ({
                error: String(e.payload?.error ?? 'Unknown error'),
                processor: e.payload?.processor ? String(e.payload.processor) : null,
                fatal: Boolean(e.payload?.fatal),
                exceptionType: e.payload?.exception_type ? String(e.payload.exception_type) : null,
                code: e.payload?.code ? String(e.payload.code) : null,
                status: e.payload?.status ? String(e.payload.status) : null,
            }));
    }, [workflowRun?.logs]);

    // Real TTFB metrics from events
    const ttfbMetrics = useMemo(() => {
        const events = (workflowRun?.logs?.realtime_feedback_events ?? []) as RealTimeEvent[];
        const ttfbs = events
            .filter((e) => e.type === 'rtf-ttfb-metric' && e.payload?.ttfb_seconds)
            .map((e) => Math.round(Number(e.payload!.ttfb_seconds) * 1000));
        const pipelines = events
            .filter((e) => e.type === 'rtf-latency-measured' && e.payload?.latency_seconds)
            .map((e) => Math.round(Number(e.payload!.latency_seconds) * 1000));
        if (ttfbs.length === 0 && pipelines.length === 0) return { avg: 0, min: 0, max: 0, avgPipeline: 0 };
        const sum = ttfbs.reduce((a, b) => a + b, 0);
        const pipeSum = pipelines.reduce((a, b) => a + b, 0);
        return {
            avg: ttfbs.length > 0 ? Math.round(sum / ttfbs.length) : 0,
            min: ttfbs.length > 0 ? Math.min(...ttfbs) : 0,
            max: ttfbs.length > 0 ? Math.max(...ttfbs) : 0,
            avgPipeline: pipelines.length > 0 ? Math.round(pipeSum / pipelines.length) : 0,
        };
    }, [workflowRun?.logs?.realtime_feedback_events]);

    const totalToolCalls = useMemo(() => {
        const events = (workflowRun?.logs?.realtime_feedback_events ?? []) as RealTimeEvent[];
        return events.filter((e) => e.type === 'rtf-function-call-end').length;
    }, [workflowRun?.logs?.realtime_feedback_events]);

    // Total costs computed with dynamic pricing
    const totalCosts = useMemo(() => {
        let llm = 0;
        for (const [key, val] of Object.entries(llmUsage)) {
            const modelName = key.split('|||')[1] || key;
            const pricingRule = resolveLLMPricing(modelName, modelPricingRules);
            const prompt = Number((val as { prompt_tokens?: number; total_tokens?: number })?.prompt_tokens) || Number((val as { total_tokens?: number })?.total_tokens) || 0;
            const completion = Number((val as { completion_tokens?: number })?.completion_tokens) || 0;
            llm += (prompt / 1_000_000) * pricingRule.inputPer1M + (completion / 1_000_000) * pricingRule.outputPer1M;
        }
        let tts = 0;
        for (const [key, chars] of Object.entries(ttsUsage)) {
            const providerName = key.split('|||')[0] || key;
            const pricingRule = resolveTTSPricing(providerName, modelPricingRules);
            tts += (Number(chars) / 1_000_000) * pricingRule.per1MChars;
        }
        let stt = 0;
        for (const [key, sec] of Object.entries(sttUsage)) {
            const providerName = key.split('|||')[0] || key;
            const pricingRule = resolveSTTPricing(providerName, modelPricingRules);
            stt += (Number(sec) / 60) * pricingRule.perMinute;
        }
        return { llm, tts, stt, total: llm + tts + stt };
    }, [llmUsage, ttsUsage, sttUsage, modelPricingRules]);

    const durationSeconds = Number(workflowRun?.cost_info?.call_duration_seconds) || 0;
    const hasData = turnsData.length > 0 || totalPromptTokens > 0 || totalCompletionTokens > 0 || totalTtsChars > 0 || totalSttSec > 0;

    // Detect which pipeline components are active
    const hasLlm = totalPromptTokens > 0 || totalCompletionTokens > 0;
    const hasStt = totalSttSec > 0 || Object.keys(sttUsage).length > 0;
    const hasTts = totalTtsChars > 0 || Object.keys(ttsUsage).length > 0;
    const pipelineComponents = [hasStt && 'STT', hasLlm && 'LLM', hasTts && 'TTS'].filter(Boolean);
    const pipelineLabel = pipelineComponents.length > 0 ? pipelineComponents.join(' → ') : 'LLM';

    return (
        <div className="w-full space-y-6 [&_.recharts-tooltip-cursor]:!fill-transparent [&_.recharts-tooltip-cursor]:!stroke-transparent [&_.recharts-tooltip-cursor]:opacity-0 [&_.recharts-wrapper]:!cursor-pointer [&_.recharts-surface]:!cursor-pointer [&_.recharts-surface_*]:!cursor-pointer">
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
                {/* LEFT COLUMN: Analytics Charts */}
                <div className="space-y-4 lg:col-span-8">
                    {!hasData && (
                        <Card className="border-border/70 bg-card/60 backdrop-blur-sm overflow-hidden shadow-sm">
                            <CardContent className="p-8 text-center">
                                <Activity className="h-8 w-8 text-muted-foreground/40 mx-auto mb-3" />
                                <p className="text-sm font-medium text-muted-foreground">No analytics data</p>
                                <p className="text-xs text-muted-foreground/70 mt-1">
                                    Usage data will appear here once the conversation processes tokens.
                                </p>
                            </CardContent>
                        </Card>
                    )}

                    {hasData && (
                        <div className="space-y-4">
                            {/* Validation Notes */}
                            <ValidationNotes issues={usageIssues} />

                            {/* Case-wise Token Usage Breakdown Table */}
                            <TokenUsageBreakdownTable
                                breakdown={breakdown}
                                providerUsage={providerUsage}
                                qaSummary={qaSummary}
                                reportStatus={workflowRun?.report_generation_status ?? null}
                                reportReady={Boolean(workflowRun?.report_s3_key)}
                            />

                            {/* 6 Grid Charts */}
                            <ConversationAnalyticsCharts
                                turnsData={turnsData}
                                pipelineLabel={pipelineLabel}
                                hasStt={hasStt}
                                hasTts={hasTts}
                                totalRequests={totalRequests}
                                overallSuccessRate={overallSuccessRate}
                                totalFailedReqs={totalFailedReqs}
                                pipelineErrorDetails={pipelineErrorDetails}
                                totalPromptTokens={totalPromptTokens}
                                totalCompletionTokens={totalCompletionTokens}
                                totalCacheReadTokens={totalCacheReadTokens}
                                totalCacheCreationTokens={totalCacheCreationTokens}
                                ttfbMetrics={ttfbMetrics}
                                totalSttSec={totalSttSec}
                                totalTtsChars={totalTtsChars}
                                totalCosts={totalCosts}
                                totalToolCalls={totalToolCalls}
                            />

                            {/* Centered Footer */}
                            <div className="pt-2 text-center">
                                <p className="text-[11px] font-medium tracking-wide text-muted-foreground/70">
                                    Production Real Time Telemetry • Multi-Channel Model-Aware Analytics Suite
                                </p>
                            </div>
                        </div>
                    )}
                </div>

                {/* RIGHT COLUMN: Analytics Sidebar */}
                <div className="space-y-4 lg:col-span-4">
                    <AnalyticsSidebar
                        workflowRun={workflowRun}
                        runId={runId}
                        organizationName={organizationName}
                        totalPromptTokens={totalPromptTokens}
                        totalCompletionTokens={totalCompletionTokens}
                        totalCachedTokens={totalCachedTokens}
                        totalCostUsd={totalCosts.total}
                        totalTurns={totalRequests}
                        durationSeconds={durationSeconds}
                        maxCallDuration={maxCallDuration}
                        totalWorkflowNodes={totalWorkflowNodes}
                    />
                </div>
            </div>
        </div>
    );
}
