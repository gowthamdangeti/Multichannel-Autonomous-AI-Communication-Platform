"use client";

import type { AgentAnalyticsSummary } from "@/client/types.gen";
import { formatResponseTime } from "@/components/agent-view/agentAnalyticsFormat";
import { AgentMetricTile } from "@/components/agent-view/AgentMetricTile";
import { Card } from "@/components/ui/card";

const numberFormat = new Intl.NumberFormat("en-US");

interface CampaignQualityCardProps {
    summary?: AgentAnalyticsSummary;
    loading: boolean;
    error?: string | null;
}

/**
 * Conversation Quality telemetry: Avg turns per call, Avg response time,
 * and Resolution score, styled consistently with the Executive Telemetry cards.
 */
export function CampaignQualityCard({ summary, loading, error }: CampaignQualityCardProps) {
    const turns = summary?.turns ?? 0;
    const sessions = summary?.sessions ?? 0;
    const avgTurns = turns && sessions ? (turns / sessions).toFixed(1) : turns > 0 ? String(turns) : "—";
    const score = summary?.avg_resolution_score;
    const resolutionScore = score === null || score === undefined ? "—" : `${score}%`;

    const tiles = [
        {
            label: "Avg turns per call",
            value: avgTurns,
            detail: turns > 0 ? `${numberFormat.format(turns)} total turns across calls` : undefined,
            loading,
        },
        {
            label: "Avg response time",
            value: formatResponseTime(summary?.avg_response_ms),
            detail: summary?.avg_response_ms !== null && summary?.avg_response_ms !== undefined ? "Latency per turn" : undefined,
            loading,
        },
        {
            label: "Resolution score",
            value: resolutionScore,
            detail: score !== null && score !== undefined ? "Call objective resolved" : undefined,
            loading,
        },
    ];

    return (
        <Card className="p-5">
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                    <h3 className="text-lg font-semibold tracking-tight text-foreground">Conversation quality</h3>
                    <p className="text-xs text-muted-foreground">
                        Avg turns per call, Avg response time, Resolution score
                    </p>
                </div>
                {sessions > 0 && !loading && (
                    <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                        {numberFormat.format(sessions)} calls analyzed
                    </span>
                )}
            </div>

            {error && !summary ? (
                <p className="mt-3 text-xs text-destructive">{error}</p>
            ) : (
                <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
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

