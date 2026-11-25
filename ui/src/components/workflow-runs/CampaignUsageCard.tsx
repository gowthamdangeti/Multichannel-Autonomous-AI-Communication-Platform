"use client";

import type { AgentAnalyticsSummary } from "@/client/types.gen";
import { formatPercent, formatTokenCount } from "@/components/agent-view/agentAnalyticsFormat";
import { AgentMetricTile } from "@/components/agent-view/AgentMetricTile";
import { Card } from "@/components/ui/card";

const numberFormat = new Intl.NumberFormat("en-US");

interface CampaignUsageCardProps {
    summary?: AgentAnalyticsSummary;
    loading: boolean;
    error?: string | null;
}

/**
 * Usage telemetry: Tokens used, Prompt, Completion, and Tool calls,
 * styled consistently with the Executive Telemetry cards.
 */
export function CampaignUsageCard({ summary, loading, error }: CampaignUsageCardProps) {
    const totalTokens = summary?.total_tokens ?? 0;
    const promptTokens = summary?.prompt_tokens ?? 0;
    const completionTokens = summary?.completion_tokens ?? 0;
    const toolCalls = summary?.tool_calls ?? 0;
    const sessionsWithUsage = summary?.sessions_with_usage ?? 0;

    const tiles = [
        {
            label: "Tokens used",
            value: formatTokenCount(totalTokens),
            detail: totalTokens > 0
                ? `${formatTokenCount(promptTokens)} in · ${formatTokenCount(completionTokens)} out`
                : undefined,
            loading,
        },
        {
            label: "Prompt tokens",
            value: formatTokenCount(promptTokens),
            detail: totalTokens > 0 ? formatPercent(promptTokens, totalTokens) : undefined,
            loading,
        },
        {
            label: "Completion tokens",
            value: formatTokenCount(completionTokens),
            detail: totalTokens > 0 ? formatPercent(completionTokens, totalTokens) : undefined,
            loading,
        },
        {
            label: "Tool calls",
            value: numberFormat.format(toolCalls),
            detail: toolCalls > 0 ? "Workflow tool executions" : undefined,
            loading,
        },
    ];

    return (
        <Card className="p-5">
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                    <h3 className="text-lg font-semibold tracking-tight text-foreground">Usage</h3>
                    <p className="text-xs text-muted-foreground">
                        Tokens used, Tool calls — cost-related usage for this campaign
                    </p>
                </div>
                {sessionsWithUsage > 0 && !loading && (
                    <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                        {numberFormat.format(sessionsWithUsage)} runs tracked
                    </span>
                )}
            </div>

            {error && !summary ? (
                <p className="mt-3 text-xs text-destructive">{error}</p>
            ) : (
                <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                    {tiles.map((tile) => (
                        <AgentMetricTile
                            key={tile.label}
                            label={tile.label}
                            value={tile.value}
                            detail={tile.detail}
                            loading={tile.loading}
                        />
                    ))}
                </div>
            )}
        </Card>
    );
}

