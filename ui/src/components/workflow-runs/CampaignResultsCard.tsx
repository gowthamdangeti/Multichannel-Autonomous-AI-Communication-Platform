"use client";

import { AgentMetricTile } from "@/components/agent-view/AgentMetricTile";
import { fmtDuration } from "@/components/charts/DashboardCharts";
import { Card } from "@/components/ui/card";

const numberFormat = new Intl.NumberFormat("en-US");

interface CampaignResultsCardProps {
    totalCalls: number;
    completedCalls: number;
    averageDurationSeconds: number;
    talkTimeSeconds: number;
    dialedCount: number;
    queuedCount: number;
    connectRatePercent: string;
    loading: boolean;
    agentLoading: boolean;
    error: string | null;
}

/**
 * Executive telemetry for campaign execution totals, matching the
 * visual structure and design of the Agent View Executive Telemetry card.
 */
export function CampaignResultsCard({
    totalCalls,
    completedCalls,
    averageDurationSeconds,
    talkTimeSeconds,
    dialedCount,
    queuedCount,
    connectRatePercent,
    loading,
    agentLoading,
    error,
}: CampaignResultsCardProps) {
    const dialPercent = queuedCount > 0 ? Math.round((dialedCount / queuedCount) * 100) : 0;
    const completionPercent = totalCalls > 0 ? `${Math.round((completedCalls / totalCalls) * 100)}%` : "—";

    const tiles = [
        {
            label: "Calls completed",
            value: `${numberFormat.format(completedCalls)} of ${numberFormat.format(totalCalls)}`,
            detail: totalCalls > 0 ? `${completionPercent} finished` : undefined,
            loading,
        },
        {
            label: "Average duration",
            value: fmtDuration(averageDurationSeconds),
            detail: "Per completed call",
            loading,
        },
        {
            label: "Talk time",
            value: fmtDuration(talkTimeSeconds),
            detail: "Total call time",
            loading,
        },
        {
            label: "Completion rate",
            value: completionPercent,
            detail: totalCalls > 0 ? `${numberFormat.format(completedCalls)} reached end` : undefined,
            loading,
        },
        {
            label: "Connect rate",
            value: connectRatePercent,
            detail: "Calls answered",
            loading: agentLoading,
        },
        {
            label: "Dial progress",
            value: `${dialPercent}%`,
            detail: queuedCount > 0 ? `${numberFormat.format(dialedCount)} of ${numberFormat.format(queuedCount)} dialed` : "No queue",
            loading,
        },
    ];

    return (
        <Card className="p-5">
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                    <h3 className="text-lg font-semibold tracking-tight text-foreground">Results</h3>
                    <p className="text-xs text-muted-foreground">All runs in this campaign</p>
                </div>
                {dialPercent > 0 && (
                    <span className="shrink-0 rounded-full border border-border/60 bg-muted/30 px-2.5 py-0.5 text-xs font-medium tabular-nums text-foreground">
                        {dialPercent}% dialed
                    </span>
                )}
            </div>

            {error ? (
                <p className="mt-3 text-xs text-destructive">{error}</p>
            ) : (
                <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
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

