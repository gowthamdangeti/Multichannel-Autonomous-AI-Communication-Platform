"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/context/HeaderContext";
import { useAuth } from "@/lib/auth";

const REFRESH_INTERVAL_MS = 5000;

interface ContainerInfo {
    id: string;
    name: string;
    service: string;
    status: string;
    health: string;
    cpu_percent: number | null;
    mem_used_mb: number | null;
    mem_limit_mb: number | null;
    started_at: string | null;
    image: string;
}

interface Instance {
    label: string;
    url: string;
    compose_project: string;
    containers: ContainerInfo[];
    error: string | null;
}

interface LogsModal {
    instanceLabel: string;
    containerId: string;
    containerName: string;
    logs: string;
    loading: boolean;
    error: string | null;
}

function statusColor(status: string, health: string) {
    if (health === "healthy" || (status === "running" && health === "none")) return "bg-green-500";
    if (status === "running" && health === "starting") return "bg-yellow-400";
    if (health === "unhealthy") return "bg-red-500";
    if (status === "exited" || status === "dead") return "bg-red-500";
    return "bg-gray-400";
}

function statusLabel(status: string, health: string) {
    if (health !== "none") return health;
    return status;
}

function MemBar({ used, limit }: { used: number | null; limit: number | null }) {
    if (used === null || limit === null || limit === 0) return <span className="text-muted-foreground">—</span>;
    const pct = Math.min((used / limit) * 100, 100);
    const color = pct > 85 ? "bg-red-500" : pct > 60 ? "bg-yellow-400" : "bg-green-500";
    return (
        <div className="flex items-center gap-2 min-w-[120px]">
            <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
                <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
            </div>
            <span className="text-xs tabular-nums text-muted-foreground whitespace-nowrap">
                {used.toFixed(0)} / {limit.toFixed(0)} MB
            </span>
        </div>
    );
}

function Uptime({ startedAt }: { startedAt: string | null }) {
    if (!startedAt) return <span className="text-muted-foreground">—</span>;
    const start = new Date(startedAt);
    const diff = Date.now() - start.getTime();
    const h = Math.floor(diff / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    if (h > 48) return <span>{Math.floor(h / 24)}d {h % 24}h</span>;
    return <span>{h}h {m}m</span>;
}

function LogsDrawer({ modal, onClose, onRefresh }: { modal: LogsModal; onClose: () => void; onRefresh: () => void }) {
    const logsEndRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        logsEndRef.current?.scrollIntoView();
    }, [modal.logs]);

    return (
        <div className="fixed inset-0 z-50 flex">
            <div className="flex-1 bg-background/60 backdrop-blur-sm" onClick={onClose} />
            <div className="w-full max-w-3xl bg-background border-l border-border flex flex-col shadow-2xl">
                <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                    <div>
                        <p className="font-semibold text-sm">{modal.containerName}</p>
                        <p className="text-xs text-muted-foreground">{modal.instanceLabel} · {modal.containerId}</p>
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={onRefresh}
                            className="text-xs px-3 py-1.5 rounded-md border border-border hover:bg-muted transition-colors"
                        >
                            Refresh
                        </button>
                        <button
                            onClick={onClose}
                            className="text-xs px-3 py-1.5 rounded-md border border-border hover:bg-muted transition-colors"
                        >
                            Close
                        </button>
                    </div>
                </div>
                <div className="flex-1 overflow-auto p-4 font-mono text-xs bg-[#0d1117] text-green-400">
                    {modal.loading && <p className="text-muted-foreground">Loading logs...</p>}
                    {modal.error && <p className="text-red-400">{modal.error}</p>}
                    {!modal.loading && !modal.error && (
                        <pre className="whitespace-pre-wrap break-all leading-5">{modal.logs || "No logs."}</pre>
                    )}
                    <div ref={logsEndRef} />
                </div>
            </div>
        </div>
    );
}

function InstanceCard({ instance, onViewLogs }: {
    instance: Instance;
    onViewLogs: (instanceLabel: string, container: ContainerInfo) => void;
}) {
    const running = instance.containers.filter(c => c.status === "running").length;
    return (
        <Card className="overflow-hidden bg-background border border-border rounded-xl">
            <CardContent className="p-0">
                <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-muted/50">
                    <div>
                        <span className="font-semibold text-sm">{instance.label}</span>
                        <span className="ml-2 text-xs text-muted-foreground">{instance.compose_project}</span>
                    </div>
                    <div>
                        {instance.error ? (
                            <span className="text-xs text-red-500 font-medium">Unreachable</span>
                        ) : (
                            <span className="text-xs text-muted-foreground">{running}/{instance.containers.length} running</span>
                        )}
                    </div>
                </div>

            {instance.error && (
                <div className="px-4 py-3 text-sm text-red-500">{instance.error}</div>
            )}

            {!instance.error && instance.containers.length === 0 && (
                <div className="px-4 py-3 text-sm text-muted-foreground">No containers found.</div>
            )}

            {!instance.error && instance.containers.length > 0 && (
                <table className="w-full text-sm">
                    <thead className="bg-muted/50 border-b border-border">
                        <tr>
                            <th className="h-12 px-4 text-left align-middle font-medium text-muted-foreground font-semibold">Service</th>
                            <th className="h-12 px-4 text-left align-middle font-medium text-muted-foreground font-semibold">Status</th>
                            <th className="h-12 px-4 text-left align-middle font-medium text-muted-foreground font-semibold">CPU</th>
                            <th className="h-12 px-4 text-left align-middle font-medium text-muted-foreground font-semibold">Memory</th>
                            <th className="h-12 px-4 text-left align-middle font-medium text-muted-foreground font-semibold">Uptime</th>
                            <th className="h-12 px-4 text-left align-middle font-medium text-muted-foreground font-semibold"></th>
                        </tr>
                    </thead>
                    <tbody className="[&_tr:last-child]:border-0">
                        {instance.containers.map(c => (
                            <tr key={c.id} className="border-b border-border transition-colors hover:bg-muted/50">
                                <td className="h-[52px] px-4 align-middle">
                                    <span className="font-medium">{c.service}</span>
                                    <span className="ml-1.5 text-xs text-muted-foreground">{c.id}</span>
                                </td>
                                <td className="h-[52px] px-4 align-middle">
                                    <div className="flex items-center gap-1.5">
                                        <div className={`w-2 h-2 rounded-full ${statusColor(c.status, c.health)}`} />
                                        <span className="capitalize text-xs">{statusLabel(c.status, c.health)}</span>
                                    </div>
                                </td>
                                <td className="h-[52px] px-4 align-middle tabular-nums text-xs">
                                    {c.cpu_percent !== null ? `${c.cpu_percent.toFixed(1)}%` : "—"}
                                </td>
                                <td className="h-[52px] px-4 align-middle">
                                    <MemBar used={c.mem_used_mb} limit={c.mem_limit_mb} />
                                </td>
                                <td className="h-[52px] px-4 align-middle text-xs text-muted-foreground">
                                    <Uptime startedAt={c.started_at} />
                                </td>
                                <td className="h-[52px] px-4 align-middle">
                                    <button
                                        onClick={() => onViewLogs(instance.label, c)}
                                        className="text-xs px-2.5 py-1 rounded border border-border hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
                                    >
                                        View Logs
                                    </button>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            )}
            </CardContent>
        </Card>
    );
}

export default function MonitorPage() {
    const { user, loading: authLoading, getAccessToken } = useAuth();
    const [instances, setInstances] = useState<Instance[]>([]);
    const [loading, setLoading] = useState(true);
    const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
    const [logsModal, setLogsModal] = useState<LogsModal | null>(null);
    const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

    const [fetchError, setFetchError] = useState<string | null>(null);

    const fetchMonitor = useCallback(async () => {
        if (!user) return;
        try {
            const token = await getAccessToken();
            const res = await fetch("/api/v1/admin/monitor", {
                headers: { Authorization: `Bearer ${token}` },
            });
            if (res.ok) {
                setInstances(await res.json());
                setLastUpdated(new Date());
                setFetchError(null);
            } else {
                const body = await res.text();
                setFetchError(`${res.status} ${res.statusText}: ${body}`);
            }
        } catch (e) {
            setFetchError(String(e));
        } finally {
            setLoading(false);
        }
    }, [user, getAccessToken]);

    useEffect(() => {
        if (authLoading || !user) return;
        fetchMonitor();
        intervalRef.current = setInterval(fetchMonitor, REFRESH_INTERVAL_MS);
        return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
    }, [authLoading, user, fetchMonitor]);

    const fetchLogs = useCallback(async (instanceLabel: string, container: ContainerInfo) => {
        setLogsModal({ instanceLabel, containerId: container.id, containerName: container.service, logs: "", loading: true, error: null });
        try {
            const token = await getAccessToken();
            const res = await fetch(
                `/api/v1/admin/monitor/${encodeURIComponent(instanceLabel)}/${container.id}/logs?tail=300`,
                { headers: { Authorization: `Bearer ${token}` } }
            );
            const data = await res.json();
            setLogsModal(prev => prev ? { ...prev, logs: data.logs ?? "", error: data.error ?? null, loading: false } : null);
        } catch (e) {
            setLogsModal(prev => prev ? { ...prev, error: String(e), loading: false } : null);
        }
    }, [getAccessToken]);

    return (
        <>
            <div className="space-y-6 px-1">
                <PageHeader
                    title="Container Monitor"
                    subtitle="Live container status across all instances · refreshes every 5s"
                onRefresh={() => void fetchMonitor()}
                isRefreshing={loading}
                toolbar={lastUpdated && (
                    <span className="text-xs text-muted-foreground">
                        Updated {lastUpdated.toLocaleTimeString()}
                    </span>
                )}
            />

                {loading && <div className="text-sm text-muted-foreground">Loading...</div>}

                {fetchError && (
                    <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-500">
                        {fetchError}
                    </div>
                )}

                {!loading && !fetchError && instances.length === 0 && (
                    <Card className="overflow-hidden bg-background border border-border rounded-xl">
                        <CardContent className="px-4 py-8 text-center text-sm text-muted-foreground">
                            No instances configured. Set <code className="font-mono text-xs">DOCKER_HOSTS</code> in your backend environment.
                        </CardContent>
                    </Card>
                )}

                {instances.map(instance => (
                    <InstanceCard key={instance.label} instance={instance} onViewLogs={fetchLogs} />
                ))}
            </div>

            {logsModal && (
                <LogsDrawer
                    modal={logsModal}
                    onClose={() => setLogsModal(null)}
                    onRefresh={() => {
                        const container = instances
                            .flatMap(i => i.containers)
                            .find(c => c.id === logsModal.containerId);
                        if (container) fetchLogs(logsModal.instanceLabel, container);
                    }}
                />
            )}
        </>
    );
}
