import type { ModelPricingRule } from '@/context/OrgConfigContext';
import { resolveLLMPricing, resolveSTTPricing, resolveTTSPricing } from '@/lib/modelPricing';

import type { WorkflowRunResponse } from './types';
import type { UsageInfoLike } from './usageBreakdown';

export interface TurnTelemetryItem {
    turn: string;
    turnIndex: number;
    apiRequests: number;
    successfulRequests: number;
    failedRequests: number;
    successRate: number;
    promptTokens: number;
    completionTokens: number;
    cacheReadTokens: number;
    cacheCreationTokens: number;
    sttLatencyMs: number;
    llmLatencyMs: number;
    ttsLatencyMs: number;
    sttDurationSec: number;
    ttsChars: number;
    llmCost: number;
    sttCost: number;
    ttsCost: number;
    totalCost: number;
    toolCalls: number;
}

export interface RealTimeEvent {
    type: string;
    payload?: Record<string, unknown>;
    timestamp?: string;
}

export function formatUSD(num: number): string {
    if (num <= 0) return '$0.0000';
    if (num < 0.0001) return '< $0.0001';
    return `$${num.toFixed(4)}`;
}

export function formatTokensCompact(n: number): string {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
    return n.toLocaleString();
}

export function readLlmTokenParts(value: unknown): { prompt: number; completion: number } {
    if (!value || typeof value !== 'object') return { prompt: 0, completion: 0 };
    const entry = value as Record<string, unknown>;
    const prompt = Number(entry.prompt_tokens) || 0;
    const completion = Number(entry.completion_tokens) || 0;
    const total = Number(entry.total_tokens) || 0;
    if (prompt === 0 && completion === 0 && total > 0) {
        return { prompt: total, completion: 0 };
    }
    return { prompt, completion };
}

export function extractConversationTelemetry(
    workflowRun: WorkflowRunResponse | null | undefined,
    modelPricingRules?: ModelPricingRule[],
    mergedUsage?: UsageInfoLike | null,
): TurnTelemetryItem[] {
    const rawEvents: RealTimeEvent[] = (workflowRun?.logs?.realtime_feedback_events ?? []) as RealTimeEvent[];
    const usageInfo = mergedUsage ?? workflowRun?.usage_info ?? {};
    const llmUsage = usageInfo.llm ?? {};
    const ttsUsage = usageInfo.tts ?? {};
    const sttUsage = usageInfo.stt ?? {};

    // ── Aggregate totals from usage_info / canonical usage ──
    let totalPrompt = 0;
    let totalCompletion = 0;
    let totalCacheRead = 0;
    let totalCacheCreation = 0;
    Object.values(llmUsage).forEach((val: unknown) => {
        const parts = readLlmTokenParts(val);
        totalPrompt += parts.prompt;
        totalCompletion += parts.completion;
        const entry = (val && typeof val === 'object' ? val : {}) as Record<string, unknown>;
        totalCacheRead += Number(entry.cache_read_input_tokens ?? entry.cache_read_tokens) || 0;
        totalCacheCreation += Number(entry.cache_creation_input_tokens ?? entry.cache_write_tokens) || 0;
    });

    let totalTtsChars = 0;
    Object.values(ttsUsage).forEach((c: unknown) => {
        totalTtsChars += Number(c) || 0;
    });

    let totalSttSec = 0;
    Object.values(sttUsage).forEach((s: unknown) => {
        totalSttSec += Number(s) || 0;
    });

    const fallbackConvoTokens = Number(workflowRun?.cost_info?.autonomous_ai_os_token_usage) || 0;
    if (totalPrompt === 0 && totalCompletion === 0 && fallbackConvoTokens > 0) {
        totalPrompt = Math.round(fallbackConvoTokens * 0.85);
        totalCompletion = Math.max(1, fallbackConvoTokens - totalPrompt);
    }

    if (totalPrompt === 0 && totalCompletion === 0 && rawEvents.length === 0 && fallbackConvoTokens === 0) {
        return [];
    }

    // ── Group events into turns ──
    const userUtterances: RealTimeEvent[] = [];
    const botResponses: RealTimeEvent[] = [];
    const toolCallEvents: RealTimeEvent[] = [];
    const ttfbEvents: RealTimeEvent[] = [];
    const pipelineErrors: RealTimeEvent[] = [];

    for (const ev of rawEvents) {
        switch (ev.type) {
            case 'rtf-user-transcription':
                if (ev.payload?.final) userUtterances.push(ev);
                break;
            case 'rtf-bot-text':
                botResponses.push(ev);
                break;
            case 'rtf-function-call-end':
                toolCallEvents.push(ev);
                break;
            case 'rtf-ttfb-metric':
                ttfbEvents.push(ev);
                break;
            case 'rtf-pipeline-error':
                pipelineErrors.push(ev);
                break;
        }
    }

    const numTurns = Math.max(1, Math.max(userUtterances.length, botResponses.length));

    // Persisted usage can outlive or outnumber realtime events. Keep the
    // charts populated from usage_info instead of returning an empty series.
    const hasUsage = totalPrompt > 0 || totalCompletion > 0 || totalTtsChars > 0 || totalSttSec > 0;
    if (rawEvents.length === 0 && !hasUsage) return [];
    const effectiveTurns = rawEvents.length === 0 ? 1 : numTurns;

    // ── Compute per-model costs using dynamic pricing ──
    let totalLlmCost = 0;
    for (const [key, val] of Object.entries(llmUsage)) {
        const modelName = key.split('|||')[1] || key;
        const pricing = resolveLLMPricing(modelName, modelPricingRules);
        const parts = readLlmTokenParts(val);
        totalLlmCost += (parts.prompt / 1_000_000) * pricing.inputPer1M + (parts.completion / 1_000_000) * pricing.outputPer1M;
    }

    let totalTtsCost = 0;
    for (const [key, chars] of Object.entries(ttsUsage)) {
        const providerName = key.split('|||')[0] || key;
        const pricing = resolveTTSPricing(providerName, modelPricingRules);
        totalTtsCost += (Number(chars) / 1_000_000) * pricing.per1MChars;
    }

    let totalSttCost = 0;
    for (const [key, sec] of Object.entries(sttUsage)) {
        const providerName = key.split('|||')[0] || key;
        const pricing = resolveSTTPricing(providerName, modelPricingRules);
        totalSttCost += (Number(sec) / 60) * pricing.perMinute;
    }

    // ── Extract real TTFB latencies per turn ──
    const llmTtfbs = ttfbEvents
        .filter((e) => e.payload?.processor && String(e.payload.processor).includes('LLM'))
        .map((e) => Math.round((Number(e.payload?.ttfb_seconds) || 0) * 1000));

    // ── Extract full pipeline latency from rtf-latency-measured events ──
    const pipelineLatencies = rawEvents
        .filter((e) => e.type === 'rtf-latency-measured' && e.payload?.latency_seconds)
        .map((e) => Math.round(Number(e.payload!.latency_seconds) * 1000));

    // ── Count real API requests ──
    const totalSuccessful = Math.max(ttfbEvents.length, effectiveTurns);
    const totalFailed = pipelineErrors.length;

    // ── Build per-turn items, distributing totals proportionally ──
    const turns: TurnTelemetryItem[] = [];

    // If only 1 turn, add a starting baseline point so a proper line segment is rendered
    if (effectiveTurns === 1) {
        turns.push({
            turn: 'Start',
            turnIndex: 0,
            apiRequests: 0,
            successfulRequests: 0,
            failedRequests: 0,
            successRate: 100,
            promptTokens: 0,
            completionTokens: 0,
            cacheReadTokens: 0,
            cacheCreationTokens: 0,
            sttLatencyMs: 0,
            llmLatencyMs: 0,
            ttsLatencyMs: 0,
            sttDurationSec: 0,
            ttsChars: 0,
            llmCost: 0,
            sttCost: 0,
            ttsCost: 0,
            totalCost: 0,
            toolCalls: 0,
        });
    }

    for (let i = 0; i < effectiveTurns; i++) {
        const turnLabel = `T${i + 1}`;

        // Distribution is only a chart fallback; persisted usage is aggregate.
        const promptWeight = (i + 1) / ((effectiveTurns * (effectiveTurns + 1)) / 2);
        const evenWeight = 1 / effectiveTurns;

        const turnPrompt = Math.round(totalPrompt * promptWeight);
        const turnCompletion = Math.round(totalCompletion * evenWeight);
        const turnCacheRead = Math.round(totalCacheRead * promptWeight);
        const turnCacheCreation = Math.round(totalCacheCreation * evenWeight);
        const turnTtsChars = Math.round(totalTtsChars * evenWeight);
        const turnSttSec = parseFloat((totalSttSec * evenWeight).toFixed(1));

        // Use real TTFB if available, else estimate
        const llmLatency = llmTtfbs[i] ?? (llmTtfbs.length > 0 ? llmTtfbs[llmTtfbs.length - 1] : 0);

        // Derive STT/TTS latency from pipeline round-trip minus LLM TTFB
        const pipelineTotal = pipelineLatencies[i] ?? (pipelineLatencies.length > 0 ? pipelineLatencies[pipelineLatencies.length - 1] : 0);
        const remaining = Math.max(0, pipelineTotal - llmLatency);
        const hasSttService = totalSttSec > 0 || Object.keys(sttUsage).length > 0;
        const hasTtsService = totalTtsChars > 0 || Object.keys(ttsUsage).length > 0;
        const bothActive = hasSttService && hasTtsService;
        const sttLatency = pipelineTotal > 0 && remaining > 0 && hasSttService ? Math.round(remaining * (bothActive ? 0.4 : 1.0)) : 0;
        const ttsLatency = pipelineTotal > 0 && remaining > 0 && hasTtsService ? Math.round(remaining * (bothActive ? 0.6 : 1.0)) : 0;

        // Distribute costs proportionally
        const turnLlmCost = totalLlmCost * promptWeight;
        const turnTtsCost = totalTtsCost * evenWeight;
        const turnSttCost = totalSttCost * evenWeight;

        // Count tool calls for this turn (distributed evenly)
        const turnToolCalls = Math.floor(toolCallEvents.length / effectiveTurns) + (i < toolCallEvents.length % effectiveTurns ? 1 : 0);

        // Distribute errors across turns
        const turnErrors = Math.floor(totalFailed / effectiveTurns) + (i < totalFailed % effectiveTurns ? 1 : 0);
        const turnSuccessful = Math.floor(totalSuccessful / effectiveTurns) + (i < totalSuccessful % effectiveTurns ? 1 : 0);
        const turnApiRequests = turnSuccessful + turnErrors;
        const turnSuccessRate = turnApiRequests > 0 ? Math.round((turnSuccessful / turnApiRequests) * 100) : 100;

        turns.push({
            turn: turnLabel,
            turnIndex: i,
            apiRequests: turnApiRequests,
            successfulRequests: turnSuccessful,
            failedRequests: turnErrors,
            successRate: turnSuccessRate,
            promptTokens: turnPrompt,
            completionTokens: turnCompletion,
            cacheReadTokens: turnCacheRead,
            cacheCreationTokens: turnCacheCreation,
            sttLatencyMs: sttLatency,
            llmLatencyMs: llmLatency,
            ttsLatencyMs: ttsLatency,
            sttDurationSec: turnSttSec,
            ttsChars: turnTtsChars,
            llmCost: turnLlmCost,
            sttCost: turnSttCost,
            ttsCost: turnTtsCost,
            totalCost: turnLlmCost + turnSttCost + turnTtsCost,
            toolCalls: turnToolCalls,
        });
    }

    return turns;
}
