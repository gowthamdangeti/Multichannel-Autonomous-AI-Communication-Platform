"use client";

import { Coins } from "lucide-react";
import { useState } from "react";

import type { ChatAgentAnalyticsResponse } from "@/client/types.gen";
import {
  formatAverage,
  formatPercent,
  formatTokenCount,
} from "@/components/agent-view/agentAnalyticsFormat";
import { AgentDailyTokensChart } from "@/components/agent-view/AgentDailyTokensChart";
import { AgentMetricTile } from "@/components/agent-view/AgentMetricTile";
import { RangeTabs } from "@/components/charts/RangeTabs";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { rangeTitle } from "@/lib/dateRange";
import { cn } from "@/lib/utils";

import { ALL_MODELS, chatTokenUsageFigures, modelOptions } from "./chatTokenUsage";
import { ChatHeaviestList, ChatModelList } from "./ChatUsageLists";

interface ChatAgentTokenUsageCardProps {
  analytics: ChatAgentAnalyticsResponse | null;
  /** The selected range (what the tabs highlight). */
  days: number;
  /** The range `analytics` was loaded for; the tiles are labelled with it. Defaults to `days`. */
  dataDays?: number;
  loading: boolean;
  /** A new range is loading: the numbers on screen stay, dimmed, so nothing reflows. */
  refreshing?: boolean;
  onDaysChange: (days: number) => void;
}

/** The chat agent's Token Usage Breakdown — same card the voice agent dashboard shows. */
export function ChatAgentTokenUsageCard({
  analytics,
  days,
  dataDays = days,
  loading,
  refreshing = false,
  onDaysChange,
}: ChatAgentTokenUsageCardProps) {
  const [modelValue, setModelValue] = useState(ALL_MODELS);
  const usage = analytics?.usage;

  const models = modelOptions(analytics);
  // The selected stack can vanish when the range changes; show all rather than blank out.
  const activeModel = models.some((model) => model.name === modelValue) ? modelValue : ALL_MODELS;
  const { total, prompt, completion, conversations, replies, daily } = chatTokenUsageFigures(analytics, activeModel);
  // Only the all-models view can say how many replies reported usage; the
  // per-model rows are built from replies that did.
  const reportedNote =
    activeModel === ALL_MODELS ? `${usage?.replies_with_usage ?? 0} / ${replies} replies reported usage` : null;

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="flex items-center gap-2 text-lg font-semibold tracking-tight text-foreground">
          <Coins className="size-5 text-muted-foreground" />
          Token Usage Breakdown
        </h3>
        <div className="flex flex-wrap items-center gap-2">
          <RangeTabs days={days} onChange={onDaysChange} />
          {models.length > 0 && (
            <Select value={activeModel} onValueChange={setModelValue}>
              <SelectTrigger aria-label="Model stack" className="h-9 w-[200px]">
                <SelectValue placeholder="All stacks" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_MODELS}>All stacks</SelectItem>
                {models.map((model) => (
                  <SelectItem key={model.name} value={model.name}>
                    {model.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      </div>

      <div className={cn("transition-opacity duration-200", refreshing && "opacity-60")} aria-busy={refreshing}>
        <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
          <AgentMetricTile label="Total Tokens" value={formatTokenCount(total)} detail={rangeTitle(dataDays)} loading={loading} />
          <AgentMetricTile label="Prompt" value={formatTokenCount(prompt)} detail={formatPercent(prompt, total)} loading={loading} />
          <AgentMetricTile
            label="Completion"
            value={formatTokenCount(completion)}
            detail={formatPercent(completion, total)}
            loading={loading}
          />
          <AgentMetricTile
            label="Avg / Conversation"
            value={formatAverage(total, conversations)}
            detail={`${conversations} conversations`}
            loading={loading}
          />
          <AgentMetricTile
            label="Avg / Reply"
            value={formatAverage(total, replies)}
            detail={`${replies} replies`}
            loading={loading}
          />
        </div>

        {reportedNote && <p className="mt-2 text-xs text-muted-foreground">{reportedNote}</p>}

        <div className="mt-4">
          <AgentDailyTokensChart daily={daily} loading={loading} />
        </div>

        <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-2">
          <ChatModelList models={analytics?.by_model ?? []} />
          <ChatHeaviestList conversations={analytics?.heaviest ?? []} />
        </div>
      </div>
    </Card>
  );
}
