'use client';

import React from 'react';

import {
    ApiHealthChartCard,
    type PipelineErrorDetail,
} from './conversation-charts/ApiHealthChartCard';
import { CostBreakdownChartCard } from './conversation-charts/CostBreakdownChartCard';
import { PipelineLatencyChartCard } from './conversation-charts/PipelineLatencyChartCard';
import { TokenConsumptionChartCard } from './conversation-charts/TokenConsumptionChartCard';
import { ToolsExecutionChartCard } from './conversation-charts/ToolsExecutionChartCard';
import { VoiceMetricsChartCard } from './conversation-charts/VoiceMetricsChartCard';
import type { TurnTelemetryItem } from './extractConversationTelemetry';

export type { PipelineErrorDetail };

export interface ConversationAnalyticsChartsProps {
    turnsData: TurnTelemetryItem[];
    pipelineLabel: string;
    hasStt: boolean;
    hasTts: boolean;
    totalRequests: number;
    overallSuccessRate: number | null;
    totalFailedReqs: number;
    pipelineErrorDetails: PipelineErrorDetail[];
    totalPromptTokens: number;
    totalCompletionTokens: number;
    totalCacheReadTokens?: number;
    totalCacheCreationTokens?: number;
    ttfbMetrics: { avg: number; min: number; max: number; avgPipeline: number };
    totalSttSec: number;
    totalTtsChars: number;
    totalCosts: { llm: number; tts: number; stt: number; total: number };
    totalToolCalls: number;
}

export function ConversationAnalyticsCharts({
    turnsData,
    pipelineLabel,
    hasStt,
    hasTts,
    totalRequests,
    overallSuccessRate,
    totalFailedReqs,
    pipelineErrorDetails,
    totalPromptTokens,
    totalCompletionTokens,
    totalCacheReadTokens,
    totalCacheCreationTokens,
    ttfbMetrics,
    totalSttSec,
    totalTtsChars,
    totalCosts,
    totalToolCalls,
}: ConversationAnalyticsChartsProps) {
    const hasVoice = hasStt || hasTts;
    const cardNum = {
        api: 1,
        tokens: 2,
        latency: 3,
        voice: 4,
        cost: hasVoice ? 5 : 4,
        tools: hasVoice ? 6 : 5,
    };

    return (
        <div className="flex flex-col gap-4">
            {/* CARD 1: Total API Requests & Health */}
            <ApiHealthChartCard
                cardNumber={cardNum.api}
                turnsData={turnsData}
                totalRequests={totalRequests}
                overallSuccessRate={overallSuccessRate}
                totalFailedReqs={totalFailedReqs}
                pipelineErrorDetails={pipelineErrorDetails}
            />

            {/* CARD 2: LLM Token Consumption */}
            <TokenConsumptionChartCard
                cardNumber={cardNum.tokens}
                turnsData={turnsData}
                totalPromptTokens={totalPromptTokens}
                totalCompletionTokens={totalCompletionTokens}
                totalCacheReadTokens={totalCacheReadTokens}
                totalCacheCreationTokens={totalCacheCreationTokens}
            />

            {/* CARD 3: Pipeline Latency */}
            <PipelineLatencyChartCard
                cardNumber={cardNum.latency}
                pipelineLabel={pipelineLabel}
                turnsData={turnsData}
                ttfbMetrics={ttfbMetrics}
                hasStt={hasStt}
                hasTts={hasTts}
            />

            {/* CARD 4: Voice & Speech Metrics (Active when STT or TTS present) */}
            {hasVoice && (
                <VoiceMetricsChartCard
                    cardNumber={cardNum.voice}
                    turnsData={turnsData}
                    totalSttSec={totalSttSec}
                    totalTtsChars={totalTtsChars}
                    hasStt={hasStt}
                    hasTts={hasTts}
                />
            )}

            {/* CARD 5: Cost Breakdown - Full-width Pie Chart with Complete Details */}
            <CostBreakdownChartCard
                cardNumber={cardNum.cost}
                pipelineLabel={pipelineLabel}
                turnsData={turnsData}
                totalCosts={totalCosts}
                totalPromptTokens={totalPromptTokens}
                totalCompletionTokens={totalCompletionTokens}
                totalTtsChars={totalTtsChars}
                totalSttSec={totalSttSec}
                hasStt={hasStt}
                hasTts={hasTts}
            />

            {/* CARD 6: Tools & RAG Execution */}
            <ToolsExecutionChartCard
                cardNumber={cardNum.tools}
                turnsData={turnsData}
                totalToolCalls={totalToolCalls}
                fullWidth
            />
        </div>
    );
}
