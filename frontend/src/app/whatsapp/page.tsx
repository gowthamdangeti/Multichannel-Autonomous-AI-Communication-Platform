"use client";

import { CheckCircle2, Loader2, MessageCircle, Plus, RefreshCw, Trash2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { PageFilterSelect } from "@/components/layout/PageFilterSelect";
import { PageSearchInput } from "@/components/layout/PageSearchInput";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/context/HeaderContext";
import { useAuth } from "@/lib/auth";
import { ALL_FILTER, filterBySearch,matchesFilter, toFilterOptions } from "@/lib/searchFilter";

interface WhatsAppNumber {
    id: number;
    name: string;
    phone_number: string | null;
    status: string;
    openwa_session_name: string;
    assigned_agent_id: number | null;
    created_at?: string;
}

interface WhatsAppAgentOption {
    id: number;
    name: string;
}

const STATUS_META: Record<string, { label: string; variant: "success" | "warning" | "info" | "secondary" | "destructive" }> = {
    connected: { label: "Connected", variant: "success" },
    qr: { label: "Scan QR", variant: "warning" },
    connecting: { label: "Connecting", variant: "info" },
    created: { label: "Not connected", variant: "secondary" },
    disconnected: { label: "Disconnected", variant: "secondary" },
    error: { label: "Error", variant: "destructive" },
};

function StatusBadge({ status }: { status: string }) {
    const meta = STATUS_META[status] ?? { label: status, variant: "secondary" };
    return <Badge variant={meta.variant}>{meta.label}</Badge>;
}

export default function WhatsAppNumbersPage() {
    const { user, loading: authLoading, getAccessToken } = useAuth();
    const hasFetched = useRef(false);

    const [numbers, setNumbers] = useState<WhatsAppNumber[]>([]);
    const [searchQuery, setSearchQuery] = useState("");
    const [statusFilter, setStatusFilter] = useState(ALL_FILTER);
    const [agents, setAgents] = useState<WhatsAppAgentOption[]>([]);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState<string | null>(null);

    // Connect dialog
    const [connectOpen, setConnectOpen] = useState(false);
    const [newName, setNewName] = useState("");
    const [creating, setCreating] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // QR dialog
    const [qrNumber, setQrNumber] = useState<WhatsAppNumber | null>(null);
    const [qr, setQr] = useState<string | null>(null);
    const [qrStatus, setQrStatus] = useState<string>("connecting");

    // Delete confirmation
    const [deleteTarget, setDeleteTarget] = useState<WhatsAppNumber | null>(null);
    const [deleting, setDeleting] = useState(false);

    const authFetch = useCallback(
        async (path: string, opts: RequestInit = {}) => {
            const token = await getAccessToken();
            return fetch(`/api/v1${path}`, {
                ...opts,
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                    ...(opts.headers ?? {}),
                },
            });
        },
        [getAccessToken]
    );

    const loadNumbers = useCallback(async () => {
        setLoadError(null);
        for (let attempt = 0; attempt < 3; attempt++) {
            try {
                const res = await authFetch("/whatsapp/numbers");
                if (res.ok) {
                    setNumbers(await res.json());
                    setLoading(false);
                    return;
                }
                setLoadError(`Could not load WhatsApp numbers (HTTP ${res.status}).`);
            } catch {
                setLoadError("Could not reach the Autonomous AI OS API.");
            }
            if (attempt < 2) await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
        }
        setLoading(false);
    }, [authFetch]);

    const loadAgents = useCallback(async () => {
        try {
            const res = await authFetch("/whatsapp/agents");
            if (res.ok) setAgents(await res.json());
        } catch {
            /* non-critical */
        }
    }, [authFetch]);

    useEffect(() => {
        if (authLoading || !user || hasFetched.current) return;
        hasFetched.current = true;
        loadNumbers();
        loadAgents();
    }, [authLoading, user, loadNumbers, loadAgents]);

    const assignAgent = async (numberId: number, agentId: number | null) => {
        setNumbers((list) => list.map((n) => (n.id === numberId ? { ...n, assigned_agent_id: agentId } : n)));
        await authFetch(`/whatsapp/numbers/${numberId}/agent`, {
            method: "PATCH",
            body: JSON.stringify({ agent_id: agentId }),
        });
    };

    // Poll the QR endpoint (which also carries status) while the dialog is open.
    // One call per tick at 3s — OpenWA rate-limits, so keep it light.
    useEffect(() => {
        if (!qrNumber) return;
        setQrStatus(qrNumber.status || "connecting");
        let active = true;
        const tick = async () => {
            if (!active) return;
            try {
                // /qr → the image; /numbers/{id} → authoritative status + phone
                // (reads OpenWA's session state, which is where "ready"/connected
                // shows up — the QR endpoint never reports it).
                const [qrRes, numRes] = await Promise.all([
                    authFetch(`/whatsapp/numbers/${qrNumber.id}/qr`),
                    authFetch(`/whatsapp/numbers/${qrNumber.id}`),
                ]);
                if (!active) return;
                if (qrRes.ok) {
                    const data = await qrRes.json();
                    if (data.qr) setQr(data.qr); // keep last QR; only replace with a fresh one
                }
                if (numRes.ok) {
                    const updated: WhatsAppNumber = await numRes.json();
                    setQrStatus(updated.status);
                    setNumbers((list) => list.map((n) => (n.id === updated.id ? updated : n)));
                    if (updated.status === "connected") active = false;
                }
            } catch {
                // keep polling
            }
        };
        tick();
        const id = setInterval(tick, 3000);
        return () => {
            active = false;
            clearInterval(id);
        };
    }, [qrNumber, authFetch]);

    const handleCreate = async () => {
        if (!newName.trim()) return;
        setCreating(true);
        setError(null);
        try {
            const res = await authFetch("/whatsapp/numbers", {
                method: "POST",
                body: JSON.stringify({ name: newName.trim() }),
            });
            if (!res.ok) {
                const body = await res.json().catch(() => ({}));
                setError(typeof body.detail === "string" ? body.detail : "Failed to connect. Is the WhatsApp gateway running?");
                return;
            }
            const created: WhatsAppNumber = await res.json();
            setNumbers((list) => [created, ...list]);
            setConnectOpen(false);
            setNewName("");
            setQr(null);
            setQrNumber(created); // open QR dialog to scan
        } catch {
            setError("Failed to connect. Is the WhatsApp gateway running?");
        } finally {
            setCreating(false);
        }
    };

    const confirmDelete = async () => {
        if (!deleteTarget) return;
        const target = deleteTarget;
        setDeleting(true);
        try {
            await authFetch(`/whatsapp/numbers/${target.id}`, { method: "DELETE" });
            setNumbers((list) => list.filter((x) => x.id !== target.id));
        } catch {
            /* leave the row in place if the delete failed */
        } finally {
            setDeleting(false);
            setDeleteTarget(null);
        }
    };

    return (
        <div className="space-y-4 px-4 lg:px-6 pt-2 pb-6">
            <PageHeader
                title="WhatsApp Numbers"
                subtitle="Connect WhatsApp numbers and assign agents to them"
                onRefresh={() => void loadNumbers()}
                isRefreshing={loading}
                toolbar={
                    <>
                        <PageSearchInput placeholder="Search numbers..." value={searchQuery} onChange={setSearchQuery} />
                        <PageFilterSelect
                            allLabel="All statuses"
                            value={statusFilter}
                            options={toFilterOptions(numbers, (n) => n.status, (status) => STATUS_META[status]?.label ?? status)}
                            onChange={setStatusFilter}
                        />
                    </>
                }
                primaryAction={<Button onClick={() => { setError(null); setConnectOpen(true); }}>
                        <Plus className="mr-2 h-4 w-4" /> Connect a number
                    </Button>}
            />

            {loading ? (
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {[0, 1, 2].map((i) => <Skeleton key={i} className="h-32 w-full" />)}
                </div>
            ) : numbers.length === 0 ? (
                <Card>
                    <CardContent className="flex flex-col items-center justify-center gap-3 py-16 text-center">
                        <div className="flex h-12 w-12 items-center justify-center rounded-full" style={{ background: "color-mix(in oklch, var(--cta) 14%, transparent)", color: "var(--cta)" }}>
                            <MessageCircle className="h-6 w-6" />
                        </div>
                        {loadError ? (
                            <>
                                <div>
                                    <p className="font-medium">Couldn&apos;t load your numbers</p>
                                    <p className="text-sm text-muted-foreground">{loadError}</p>
                                </div>
                                <Button variant="outline" onClick={() => { setLoading(true); loadNumbers(); }}>
                                    <RefreshCw className="mr-2 h-4 w-4" /> Retry
                                </Button>
                            </>
                        ) : (
                            <>
                                <div>
                                    <p className="font-medium">No WhatsApp numbers yet</p>
                                    <p className="text-sm text-muted-foreground">Connect a number to start building WhatsApp agents.</p>
                                </div>
                                <Button onClick={() => setConnectOpen(true)}><Plus className="mr-2 h-4 w-4" /> Connect a number</Button>
                            </>
                        )}
                    </CardContent>
                </Card>
            ) : (
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {filterBySearch(numbers, searchQuery, (n) => `${n.name} ${n.phone_number ?? ""}`).filter((n) => matchesFilter(n.status, statusFilter)).map((n) => (
                        <Card
                            key={n.id}
                            className="wa-card-interactive group relative h-full cursor-pointer overflow-hidden transition-all duration-150 hover:translate-y-0.5 hover:border-cta/40 hover:shadow-sm"
                        >
                            <span className="absolute inset-x-0 top-0 h-0.5 scale-x-0 bg-cta transition-transform duration-300 group-hover:scale-x-100" />
                            <CardContent className="flex h-full flex-col gap-3 p-5">
                                <div className="flex items-start justify-between gap-2">
                                    <div className="flex min-w-0 items-center gap-2.5">
                                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-cta/10 text-cta">
                                            <MessageCircle className="h-4 w-4" />
                                        </span>
                                        <div className="min-w-0">
                                            <p className="truncate font-medium leading-tight">{n.name}</p>
                                            <p className="truncate text-sm text-muted-foreground">
                                                {n.phone_number ? `+${n.phone_number.replace(/\D/g, "")}` : "Not linked yet"}
                                            </p>
                                        </div>
                                    </div>
                                    <StatusBadge status={n.status} />
                                </div>
                                <div className="space-y-1">
                                    <p className="text-xs text-muted-foreground">Agent</p>
                                    <Select
                                        value={n.assigned_agent_id != null ? String(n.assigned_agent_id) : "none"}
                                        onValueChange={(v) => assignAgent(n.id, v === "none" ? null : Number(v))}
                                    >
                                        <SelectTrigger className="h-8 text-xs">
                                            <SelectValue placeholder="No agent" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="none">No agent</SelectItem>
                                            {agents.map((a) => (
                                                <SelectItem key={a.id} value={String(a.id)}>{a.name}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="mt-auto flex gap-2 pt-1">
                                    {n.status !== "connected" && (
                                        <Button variant="outline" size="sm" onClick={() => { setQr(null); setQrNumber(n); }}>
                                            <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Connect
                                        </Button>
                                    )}
                                    <Button variant="outline" size="sm" className="text-destructive" onClick={() => setDeleteTarget(n)}>
                                        <Trash2 className="h-3.5 w-3.5" />
                                    </Button>
                                </div>
                            </CardContent>
                        </Card>
                    ))}
                </div>
            )}

            {/* Connect dialog — name the number */}
            <Dialog open={connectOpen} onOpenChange={setConnectOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Connect a WhatsApp number</DialogTitle>
                        <DialogDescription>Give it a label, then scan the QR with the WhatsApp phone you want to connect.</DialogDescription>
                    </DialogHeader>
                    <div className="space-y-2">
                        <Label htmlFor="wa-name">Label</Label>
                        <Input id="wa-name" placeholder="e.g. Support Line" value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handleCreate()} />
                        {error && <p className="text-sm text-destructive">{error}</p>}
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setConnectOpen(false)}>Cancel</Button>
                        <Button onClick={handleCreate} disabled={creating || !newName.trim()}>
                            {creating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Create
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* QR dialog — scan to link */}
            <Dialog open={!!qrNumber} onOpenChange={(o) => { if (!o) { setQrNumber(null); setQr(null); loadNumbers(); } }}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>{qrNumber?.name}</DialogTitle>
                        <DialogDescription>
                            Open WhatsApp → Linked devices → Link a device, then scan this code.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="flex flex-col items-center justify-center gap-4 py-4">
                        {qrStatus === "connected" ? (() => {
                            const phone = numbers.find((n) => n.id === qrNumber?.id)?.phone_number;
                            return (
                                <div className="flex flex-col items-center gap-2 text-emerald-600">
                                    <CheckCircle2 className="h-12 w-12" />
                                    <p className="font-medium">Connected{phone ? ` — +${phone.replace(/\D/g, "")}` : ""}</p>
                                </div>
                            );
                        })() : qr ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={qr} alt="WhatsApp QR code" className="h-64 w-64 rounded-md border border-border" />
                        ) : (
                            <div className="flex h-64 w-64 flex-col items-center justify-center gap-2 rounded-md border border-dashed border-border text-muted-foreground">
                                <Loader2 className="h-6 w-6 animate-spin" />
                                <p className="text-sm">Waiting for QR…</p>
                            </div>
                        )}
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => { setQrNumber(null); setQr(null); loadNumbers(); }}>Done</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Delete confirmation */}
            <AlertDialog open={!!deleteTarget} onOpenChange={(o) => { if (!o && !deleting) setDeleteTarget(null); }}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Delete “{deleteTarget?.name}”?</AlertDialogTitle>
                        <AlertDialogDescription>
                            This disconnects the WhatsApp number and permanently deletes its WhatsApp session{deleteTarget?.phone_number ? ` (+${deleteTarget.phone_number.replace(/\D/g, "")})` : ""}. You&apos;ll need to scan a new QR code to reconnect. This can&apos;t be undone.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={(e) => { e.preventDefault(); confirmDelete(); }}
                            disabled={deleting}
                            className="bg-destructive text-white hover:bg-destructive/90"
                        >
                            {deleting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Delete
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
}
