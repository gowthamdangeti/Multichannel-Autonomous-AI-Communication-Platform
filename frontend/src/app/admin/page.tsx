"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import {
    CallVolumeChart,
    fmtDelta,
    StatCard,
    TopAgentsBarChart,
} from "@/components/charts/DashboardCharts";
import { PageHeader } from "@/context/HeaderContext";
import { getBackendApiUrl } from "@/lib/apiClient";
import { useAuth } from "@/lib/auth";
import type { LocalUser } from "@/lib/auth/types";

interface PlatformStats {
    total_orgs: number;
    total_users: number;
    total_workflows: number;
    total_active_voices: number;
    current_signups: number;
    prev_signups: number;
    current_agents: number;
    prev_agents: number;
    daily_signups: Array<{ date: string; calls: number }>;
    daily_agents: Array<{ date: string; calls: number }>;
    top_orgs_by_agents: Array<{ name: string; calls: number }>;
}

const NAV_SECTIONS = [
    {
        title: "Enterprise Leads",
        description: "Book a Strategy Call submissions stored in-house, with status tracking.",
        href: "/admin/leads",
    },
    {
        title: "Organizations",
        description: "View all orgs, assign model/provider config and allowed voices.",
        href: "/admin/orgs",
    },
    {
        title: "Models & Keys",
        description: "Configure global LLM, STT, TTS providers, API keys, and the voice catalog.",
        href: "/admin/models",
    },
    {
        title: "Provider Languages",
        description: "Live language lists fetched from provider APIs, daily refresh, and changes awaiting review.",
        href: "/admin/languages",
    },
    {
        title: "Billing Plans",
        description: "Manage subscription plans, pricing, and payment gateways.",
        href: "/admin/billing",
    },
    {
        title: "Container Monitor",
        description: "Live CPU, memory, and health status for all deployment instances.",
        href: "/admin/monitor",
    },
];

export default function AdminPage() {
    const { user, loading: authLoading, getAccessToken } = useAuth();
    const isSuperAdmin = (user as LocalUser & { is_superuser?: boolean })?.is_superuser;
    const hasFetched = useRef(false);

    const [stats, setStats] = useState<PlatformStats | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (authLoading || !user || !isSuperAdmin || hasFetched.current) return;
        hasFetched.current = true;

        (async () => {
            try {
                const token = await getAccessToken();
                const baseUrl = getBackendApiUrl();
                const res = await fetch(`${baseUrl}/api/v1/admin/stats`, {
                    headers: { Authorization: `Bearer ${token}`, "ngrok-skip-browser-warning": "true" },
                });
                if (res.ok) setStats(await res.json());
            } catch {
                // silent
            } finally {
                setLoading(false);
            }
        })();
    }, [authLoading, user, isSuperAdmin, getAccessToken]);

    const signupDelta = stats ? fmtDelta(stats.current_signups, stats.prev_signups) : null;
    const agentDelta = stats ? fmtDelta(stats.current_agents, stats.prev_agents) : null;

    return (
        <div className="space-y-4 pt-0">
            <PageHeader
                title="Admin Panel"
                subtitle="Platform-wide configuration — visible only to super-admins."
            />

            {/* KPI Cards */}
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <StatCard
                    label="Total Orgs"
                    value={loading ? "—" : (stats?.total_orgs ?? 0)}
                    loading={loading}
                    sub="on platform"
                />
                <StatCard
                    label="Total Users"
                    value={loading ? "—" : (stats?.total_users ?? 0)}
                    loading={loading}
                    sub="registered"
                />
                <StatCard
                    label="New Signups (7d)"
                    value={loading ? "—" : (stats?.current_signups ?? 0)}
                    delta={signupDelta}
                    sub="vs prior 7 days"
                    loading={loading}
                />
                <StatCard
                    label="New Agents (7d)"
                    value={loading ? "—" : (stats?.current_agents ?? 0)}
                    delta={agentDelta}
                    sub="vs prior 7 days"
                    loading={loading}
                />
            </div>

            {/* Trend charts side by side */}
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <CallVolumeChart
                    data={stats?.daily_signups ?? []}
                    loading={loading}
                    title="New Signups — last 7 days"
                />
                <CallVolumeChart
                    data={stats?.daily_agents ?? []}
                    loading={loading}
                    title="Agents Created — last 7 days"
                />
            </div>

            {/* Bottom row: top orgs + quick nav */}
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <TopAgentsBarChart
                    data={stats?.top_orgs_by_agents ?? []}
                    title="Top Organizations by Agent Count"
                    loading={loading}
                />

                <div className="space-y-3">
                    {NAV_SECTIONS.map((s) => (
                        <Link key={s.href} href={s.href}>
                            <div className="rounded-xl border border-border/50 bg-card p-4 hover:border-primary/40 transition-colors cursor-pointer">
                                <p className="font-medium text-sm">{s.title}</p>
                                <p className="mt-0.5 text-xs text-muted-foreground">{s.description}</p>
                            </div>
                        </Link>
                    ))}
                </div>
            </div>
        </div>
    );
}
