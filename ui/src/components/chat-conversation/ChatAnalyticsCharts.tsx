"use client";

import { useMemo } from "react";

import type { ModelPricingRule } from "@/context/OrgConfigContext";
import { resolveLLMPricing } from "@/lib/modelPricing";

import { toReplyChartPoints, toRequestChartPoints } from "./chatAnalyticsSeries";
import { ChatApiHealthCard } from "./ChatApiHealthCard";
import type { ReplyPoint, RequestPoint } from "./chatConversationStats";
import { ChatCostBreakdownCard } from "./ChatCostBreakdownCard";
import { ChatPipelineLatencyCard } from "./ChatPipelineLatencyCard";
import { ChatTokenConsumptionCard } from "./ChatTokenConsumptionCard";
import { ChatToolsExecutionCard } from "./ChatToolsExecutionCard";

export interface ChatAnalyticsChartsProps {
  replies: ReplyPoint[];
  requests: RequestPoint[];
  /** Why the latest reply failed, when it did. */
  errorDetail?: { message: string; model?: string | null } | null;
  promptTokens: number | null;
  completionTokens: number | null;
  avgLatencyMs: number | null;
  modelPricingRules: ModelPricingRule[];
}

/**
 * The voice run page's six analytics sections for a chat conversation. Website
 * chat has no speech stages, so the numbering skips the voice card exactly as
 * the voice page does when a run has no STT or TTS: cost is 4, tools is 5.
 */
export function ChatAnalyticsCharts({
  replies,
  requests,
  errorDetail,
  promptTokens,
  completionTokens,
  avgLatencyMs,
  modelPricingRules,
}: ChatAnalyticsChartsProps) {
  const points = useMemo(() => toReplyChartPoints(replies), [replies]);
  const requestPoints = useMemo(() => toRequestChartPoints(requests), [requests]);

  const cost = useMemo(() => {
    let usd = 0;
    const unpriced = new Set<string>();
    for (const r of replies) {
      if (r.promptTokens === null && r.completionTokens === null) continue;
      const rate = resolveLLMPricing(r.model ?? "", modelPricingRules);
      if (!rate.priced) {
        unpriced.add(r.model ?? "unknown");
        continue;
      }
      usd += ((r.promptTokens ?? 0) / 1_000_000) * rate.inputPer1M;
      usd += ((r.completionTokens ?? 0) / 1_000_000) * rate.outputPer1M;
    }
    return { usd, unpricedModels: unpriced.size };
  }, [replies, modelPricingRules]);

  return (
    <div className="flex flex-col gap-4">
      <ChatApiHealthCard cardNumber={1} points={requestPoints} errorDetail={errorDetail} />

      <ChatTokenConsumptionCard
        cardNumber={2}
        points={points}
        totalPromptTokens={promptTokens}
        totalCompletionTokens={completionTokens}
      />

      <ChatPipelineLatencyCard cardNumber={3} points={points} avgLatencyMs={avgLatencyMs} />

      <ChatCostBreakdownCard
        cardNumber={4}
        promptTokens={promptTokens}
        completionTokens={completionTokens}
        llmCostUsd={cost.usd}
        unpricedModels={cost.unpricedModels}
      />

      <ChatToolsExecutionCard cardNumber={5} />
    </div>
  );
}
