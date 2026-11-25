"use client";

import { AlertTriangle, CheckCircle2, ExternalLink, KeyRound, Loader2, RefreshCw, RotateCcw, XCircle } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { type Breadcrumb, PageHeader } from "@/context/HeaderContext";
import { detailFromError } from "@/lib/apiError";
import { useAuth } from "@/lib/auth";

interface CatalogEntry {
    id: number;
    provider: string;
    capability: string;
    model: string;
    language_count: number;
    codes: string[];
    pending_count: number | null;
    pending_codes: string[] | null;
    pending_reason: string | null;
    fetched_at: string | null;
}

interface ProviderStatus {
    id: string; // "provider:capability"
    provider: string;
    capability: string;
    docs_url: string;
    has_credentials: boolean;
    status: string | null;
    message: string | null;
    last_attempt_at: string | null;
    last_success_at: string | null;
    unknown_codes: string[];
    entries: CatalogEntry[];
}

const PROVIDER_NAMES: Record<string, string> = {
    google: "Google Cloud TTS",
    azure_speech: "Azure Speech",
    elevenlabs: "ElevenLabs",
    deepgram: "Deepgram Aura",
    cartesia: "Cartesia",
    soniox: "Soniox",
    speechmatics: "Speechmatics",
};

/** "soniox:stt" -> "Soniox (speech-to-text)" */
function nameFor(id: string): string {
    const [provider, capability] = id.split(":");
    const name = PROVIDER_NAMES[provider] ?? provider;
    if (!capability) return name;
    return `${name} (${capability === "stt" ? "speech-to-text" : "text-to-speech"})`;
}

const STATUS_STYLES: Record<string, { label: string; className: string }> = {
    updated: { label: "Updated", className: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" },
    unchanged: { label: "Up to date", className: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" },
    pending_review: { label: "Needs review", className: "bg-amber-500/15 text-amber-700 dark:text-amber-300" },
    skipped: { label: "Skipped", className: "bg-muted text-muted-foreground" },
    error: { label: "Failed", className: "bg-red-500/15 text-red-700 dark:text-red-300" },
};

function formatTime(value: string | null): string {
    if (!value) return "never";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

export default function AdminLanguagesPage() {
    const { user, loading: authLoading, getAccessToken } = useAuth();
    const isSuperAdmin = (user as { is_superuser?: boolean } | null)?.is_superuser;
    const hasFetched = useRef(false);

    const [providers, setProviders] = useState<ProviderStatus[]>([]);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState<string | null>(null); // provider id, "all", or "entry-<id>"

    const request = useCallback(
        async (path: string, init?: RequestInit) => {
            const token = await getAccessToken();
            const res = await fetch(`/api/v1/admin/${path}`, {
                ...init,
                headers: { Authorization: `Bearer ${token}`, ...(init?.headers ?? {}) },
            });
            if (!res.ok) {
                const body = await res.json().catch(() => ({}));
                throw new Error(detailFromError(body, `Request failed (${res.status})`));
            }
            return res.status === 204 ? null : res.json();
        },
        [getAccessToken],
    );

    const load = useCallback(async () => {
        try {
            setProviders(await request("language-sync"));
        } catch (err) {
            toast.error(detailFromError(err, "Could not load language sync status"));
        } finally {
            setLoading(false);
        }
    }, [request]);

    useEffect(() => {
        if (authLoading || !user || !isSuperAdmin || hasFetched.current) return;
        hasFetched.current = true;
        void load();
    }, [authLoading, user, isSuperAdmin, load]);

    const runSync = async (id?: string) => {
        setBusy(id ?? "all");
        try {
            const query = id ? `?provider=${encodeURIComponent(id)}` : "";
            const data = await request(`language-sync/run${query}`, { method: "POST" });
            const results: Array<{ provider: string; capability: string; status: string; message: string }> = data.results;
            const failed = results.filter((r) => r.status === "error");
            if (failed.length) toast.error(failed.map((r) => `${nameFor(`${r.provider}:${r.capability}`)}: ${r.message}`).join("\n"));
            else toast.success(id ? `${nameFor(id)} refreshed` : "All providers refreshed");
            await load();
        } catch (err) {
            toast.error(detailFromError(err, "Refresh failed"));
        } finally {
            setBusy(null);
        }
    };

    const resolveEntry = async (entry: CatalogEntry, action: "approve" | "reject") => {
        setBusy(`entry-${entry.id}`);
        try {
            await request(`language-sync/entries/${entry.id}/${action}`, { method: "POST" });
            toast.success(action === "approve" ? "New list applied" : "Change rejected; current list kept");
            await load();
        } catch (err) {
            toast.error(detailFromError(err, "Could not update the list"));
        } finally {
            setBusy(null);
        }
    };

    const resetProvider = async (id: string) => {
        if (!window.confirm(`Forget the live list for ${nameFor(id)} and use the built-in list?`)) return;
        setBusy(id);
        try {
            await request(`language-sync/${encodeURIComponent(id)}`, { method: "DELETE" });
            toast.success("Using the built-in list again");
            await load();
        } catch (err) {
            toast.error(detailFromError(err, "Reset failed"));
        } finally {
            setBusy(null);
        }
    };

    const breadcrumbs = useMemo<Breadcrumb[]>(
        () => [
            { label: "Admin", href: "/admin" },
            { label: "Provider Languages" },
        ],
        [],
    );

    return (
        <div className="mx-auto max-w-5xl space-y-6 p-4 sm:p-6">
            <PageHeader
                title="Provider Languages"
                subtitle="Providers with a language-listing API are refreshed daily (03:17 UTC). If a provider can't be reached, the last good list or the built-in list keeps being used. A refresh that removes more than 30% of languages waits here for your approval."
                breadcrumbs={breadcrumbs}
            />
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                    <h1 className="text-2xl font-semibold">Provider languages</h1>
                    <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
                        Providers with a language-listing API are refreshed daily (03:17 UTC). If a provider can&apos;t be
                        reached, the last good list or the built-in list keeps being used. A refresh that removes more
                        than 30% of languages waits here for your approval.
                    </p>
                </div>
                <Button onClick={() => runSync()} disabled={busy !== null || loading}>
                    {busy === "all" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                    Refresh all
                </Button>
            </div>

            {loading ? (
                <div className="flex items-center gap-2 py-12 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" /> Loading…
                </div>
            ) : (
                <div className="grid gap-4">
                    {providers.map((p) => {
                        const style = p.status ? STATUS_STYLES[p.status] : null;
                        const isLive = p.entries.length > 0;
                        return (
                            <Card key={p.id}>
                                <CardHeader className="pb-3">
                                    <div className="flex flex-wrap items-start justify-between gap-3">
                                        <div className="min-w-0">
                                            <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                                                {PROVIDER_NAMES[p.provider] ?? p.provider}
                                                <Badge variant="outline">
                                                    {p.capability === "stt" ? "Speech-to-text" : "Text-to-speech"}
                                                </Badge>
                                                <Badge className={isLive ? "bg-sky-500/15 text-sky-700 dark:text-sky-300" : "bg-muted text-muted-foreground"}>
                                                    {isLive ? "Live list" : "Built-in list"}
                                                </Badge>
                                                {style && <Badge className={style.className}>{style.label}</Badge>}
                                            </CardTitle>
                                            <CardDescription className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1">
                                                <span>Last refresh: {formatTime(p.last_attempt_at)}</span>
                                                <span>Last success: {formatTime(p.last_success_at)}</span>
                                                <span className="inline-flex items-center gap-1">
                                                    <KeyRound className="h-3 w-3" />
                                                    {p.has_credentials ? "Key available" : "No platform key"}
                                                </span>
                                                <a href={p.docs_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 underline">
                                                    API docs <ExternalLink className="h-3 w-3" />
                                                </a>
                                            </CardDescription>
                                        </div>
                                        <div className="flex gap-2">
                                            <Button size="sm" variant="outline" onClick={() => runSync(p.id)} disabled={busy !== null}>
                                                {busy === p.id ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-1 h-4 w-4" />}
                                                Refresh
                                            </Button>
                                            {isLive && (
                                                <Button size="sm" variant="ghost" onClick={() => resetProvider(p.id)} disabled={busy !== null}>
                                                    <RotateCcw className="mr-1 h-4 w-4" /> Use built-in
                                                </Button>
                                            )}
                                        </div>
                                    </div>
                                </CardHeader>
                                <CardContent className="space-y-3 text-sm">
                                    {p.message && (
                                        <p className={p.status === "error" ? "text-red-600 dark:text-red-400" : "text-muted-foreground"}>
                                            {p.message}
                                        </p>
                                    )}
                                    {isLive ? (
                                        <div className="divide-y rounded-md border">
                                            {p.entries.map((e) => (
                                                <div key={e.id} className="space-y-2 p-3">
                                                    <div className="flex flex-wrap items-center justify-between gap-2">
                                                        <span className="font-mono text-xs">{e.model || "all models"}</span>
                                                        <span className="text-muted-foreground">
                                                            {e.language_count} languages · fetched {formatTime(e.fetched_at)}
                                                        </span>
                                                    </div>
                                                    {e.pending_codes && (
                                                        <div className="space-y-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-3">
                                                            <p className="flex items-start gap-2 text-amber-800 dark:text-amber-200">
                                                                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                                                                {e.pending_reason}
                                                            </p>
                                                            <p className="break-words font-mono text-xs text-muted-foreground">
                                                                New list: {e.pending_codes.join(", ") || "(empty)"}
                                                            </p>
                                                            <div className="flex gap-2">
                                                                <Button size="sm" onClick={() => resolveEntry(e, "approve")} disabled={busy !== null}>
                                                                    <CheckCircle2 className="mr-1 h-4 w-4" /> Apply new list
                                                                </Button>
                                                                <Button size="sm" variant="outline" onClick={() => resolveEntry(e, "reject")} disabled={busy !== null}>
                                                                    <XCircle className="mr-1 h-4 w-4" /> Keep current
                                                                </Button>
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>
                                            ))}
                                        </div>
                                    ) : (
                                        <p className="text-muted-foreground">
                                            {p.has_credentials
                                                ? "Not refreshed yet. The built-in list is in use."
                                                : `Add a ${PROVIDER_NAMES[p.provider] ?? p.provider} key to the global model configuration (or set LANGUAGE_SYNC_${p.provider.toUpperCase()}_API_KEY) to enable live refresh.`}
                                        </p>
                                    )}
                                    {p.unknown_codes.length > 0 && (
                                        <p className="text-xs text-muted-foreground">
                                            Codes without a display name yet: {p.unknown_codes.join(", ")}
                                        </p>
                                    )}
                                </CardContent>
                            </Card>
                        );
                    })}
                    <p className="text-xs text-muted-foreground">
                        Other providers (Azure and Google speech-to-text, OpenAI, Sarvam, Rime, MiniMax, Smallest, Gladia,
                        AssemblyAI, realtime models…) don&apos;t publish a usable language list, so their built-in lists are used.
                    </p>
                </div>
            )}
        </div>
    );
}
