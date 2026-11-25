"use client";

import { useEffect, useState } from "react";

import { AgentBusyDaysCard, AgentBusyHoursCard } from "@/components/agent-view/AgentBusyTimesCards";
import { useAgentAnalytics } from "@/components/agent-view/hooks/useAgentAnalytics";
import { formatStateLabel } from "@/components/campaigns/detail/CampaignDetailParts";
import { CallsDurationComposedChart, PieBreakdownChart } from "@/components/charts/DashboardCharts";
import { PanelChart } from "@/components/detail-panel/DetailPanel";
import { useAuth } from "@/lib/auth";
import { ALL_TIME_DAYS } from "@/lib/dateRange";

import { CampaignQualityCard } from "./CampaignQualityCard";
import { CampaignResultsCard } from "./CampaignResultsCard";
import { CampaignUsageCard } from "./CampaignUsageCard";

const numberFormat = new Intl.NumberFormat("en-US");

interface CampaignRunAnalytics {
    total_calls: number;
    completed_calls: number;
    average_duration_seconds: number;
    state_breakdown: Array<{ state: string; count: number }>;
    daily: Array<{ date: string; calls: number; duration: number }>;
}

interface CampaignAnalyticsProps {
    campaignId: number;
    /** The campaign's agent: outcomes and busy times come from its analytics, narrowed to this campaign. */
    workflowId: number;
    /** Numbers dialed so far and numbers queued, for the dial progress chart. */
    dialedCount: number;
    queuedCount: number;
}

/**
 * Campaign Analytics tab, all about this campaign: execution totals,
 * conversation quality, cost-related usage, dial progress, run status,
 * call outcomes as donuts, calls by day, and when calls happen.
 */
export function CampaignAnalytics({ campaignId, workflowId, dialedCount, queuedCount }: CampaignAnalyticsProps) {
    const { user, loading: authLoading, getAccessToken } = useAuth();
    // Campaign data is all-time; the agent rollup is narrowed to this campaign's runs.
    const agentAnalytics = useAgentAnalytics(workflowId, ALL_TIME_DAYS, campaignId);
    const [analytics, setAnalytics] = useState<CampaignRunAnalytics | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (authLoading || !user) return;

        let active = true;
        const fetchAnalytics = async () => {
            setLoading(true);
            try {
                const accessToken = await getAccessToken();
                const response = await fetch(`/api/v1/campaign/${campaignId}/analytics`, {
                    headers: { Authorization: `Bearer ${accessToken}` },
                });
                if (!response.ok) {
                    throw new Error("Failed to load campaign analytics");
                }
                const payload = (await response.json()) as CampaignRunAnalytics;
                if (active) {
                    setAnalytics(payload);
                    setError(null);
                }
            } catch (fetchError) {
                if (active) {
                    setError(fetchError instanceof Error ? fetchError.message : "Failed to load campaign analytics");
                }
            } finally {
                if (active) setLoading(false);
            }
        };

        fetchAnalytics();
        return () => {
            active = false;
        };
    }, [authLoading, campaignId, getAccessToken, user]);

    const total = analytics?.total_calls ?? 0;
    const talkTime = (analytics?.daily ?? []).reduce((sum, day) => sum + day.duration, 0);
    const completed = analytics?.completed_calls ?? 0;

    const dialed = Math.min(dialedCount, queuedCount);
    const dialProgress = [
        { name: "Dialed", count: dialed },
        { name: "Left to dial", count: Math.max(0, queuedCount - dialed) },
    ];
    const dialPercent = queuedCount > 0 ? Math.round((dialed / queuedCount) * 100) : 0;
    const runStatus = (analytics?.state_breakdown ?? [])
        .map(({ state, count }) => ({ name: formatStateLabel(state), count }))
        .sort((a, b) => b.count - a.count);
    const outcomes = (agentAnalytics.analytics?.outcomes ?? [])
        .map(({ name, count }) => ({ name: formatStateLabel(name), count }))
        .sort((a, b) => b.count - a.count);
    const agentLoading = agentAnalytics.isLoading && !agentAnalytics.analytics;

    // Outcome cards. A call "connects" unless it ended unanswered, busy, in voicemail or failed.
    const outcomeTotal = outcomes.reduce((sum, item) => sum + item.count, 0);
    const unreached = (agentAnalytics.analytics?.outcomes ?? [])
        .filter(({ name }) => /no[_\s-]?answer|busy|voicemail|fail|error/i.test(name))
        .reduce((sum, item) => sum + item.count, 0);
    const percent = (part: number, whole: number) => (whole > 0 ? `${Math.round((part / whole) * 100)}%` : "—");

    return (
        <section className="space-y-4" aria-label="Campaign analytics">
            {/* 1. Results / All runs in this campaign (Executive Telemetry style) */}
            <CampaignResultsCard
                totalCalls={total}
                completedCalls={completed}
                averageDurationSeconds={analytics?.average_duration_seconds ?? 0}
                talkTimeSeconds={talkTime}
                dialedCount={dialed}
                queuedCount={queuedCount}
                connectRatePercent={percent(outcomeTotal - unreached, outcomeTotal)}
                loading={loading}
                agentLoading={agentLoading}
                error={error}
            />

            {/* 2. Conversation Quality & Usage Telemetry Cards */}
            <div className="grid gap-4 lg:grid-cols-2">
                <CampaignQualityCard
                    summary={agentAnalytics.analytics?.summary}
                    loading={agentLoading}
                    error={agentAnalytics.error}
                />
                <CampaignUsageCard
                    summary={agentAnalytics.analytics?.summary}
                    loading={agentLoading}
                    error={agentAnalytics.error}
                />
            </div>

            {/* 3. Shares: how far dialing got, how runs ended, how calls ended */}
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                <PanelChart>
                    <PieBreakdownChart
                        donut
                        data={dialProgress}
                        title="Dial progress"
                        subtitle={`${numberFormat.format(dialed)} of ${numberFormat.format(queuedCount)} numbers · ${dialPercent}% dialed`}
                        unit="numbers"
                    />
                </PanelChart>
                <PanelChart>
                    <PieBreakdownChart
                        donut
                        data={runStatus}
                        loading={loading}
                        title="Run status"
                        subtitle={`${numberFormat.format(total)} runs`}
                        unit="runs"
                    />
                </PanelChart>
                <PanelChart className="md:col-span-2 xl:col-span-1">
                    <PieBreakdownChart
                        donut
                        data={outcomes}
                        loading={agentLoading}
                        title="Call outcomes"
                        subtitle="How each call ended"
                        unit="calls"
                    />
                </PanelChart>
            </div>

            {/* 4. Volume over time */}
            <PanelChart>
                <CallsDurationComposedChart
                    data={analytics?.daily ?? []}
                    loading={loading}
                    title="Calls and talk time by day"
                    subtitle="Bars are calls, the line is talk time in minutes"
                />
            </PanelChart>

            {/* 5. When calls happen */}
            {agentAnalytics.error && !agentAnalytics.analytics ? (
                <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                    {agentAnalytics.error}
                </p>
            ) : (
                <div className="grid gap-4 lg:grid-cols-2">
                    <AgentBusyHoursCard hours={agentAnalytics.analytics?.hourly ?? []} loading={agentLoading} />
                    <AgentBusyDaysCard weekdays={agentAnalytics.analytics?.weekdays ?? []} loading={agentLoading} />
                </div>
            )}
        </section>
    );
}
