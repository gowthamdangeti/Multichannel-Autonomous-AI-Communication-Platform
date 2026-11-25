"use client";

import { ChevronRight, ExternalLink, Save, Search, Wallet } from "lucide-react";
import Link from "next/link";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { PageFilterSelect } from "@/components/layout/PageFilterSelect";
import { PageSearchInput } from "@/components/layout/PageSearchInput";
import { SortableTableHead } from "@/components/layout/SortableTableHead";
import { TableCellLink } from "@/components/layout/TableCellLink";
import { TablePagination } from "@/components/layout/TablePagination";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetBody, SheetContent, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { UnderlineTabs } from "@/components/ui/underline-tabs";
import { PageHeader } from "@/context/HeaderContext";
import { usePagination } from "@/hooks/usePagination";
import { useTableSort } from "@/hooks/useTableSort";
import { getBackendApiUrl } from "@/lib/apiClient";
import { useAuth } from "@/lib/auth";
import { formatDateTime } from "@/lib/formatDateTime";
import { ALL_FILTER, filterBySearch, matchesFilter, toFilterOptions } from "@/lib/searchFilter";

interface OrgPlatformConfig {
    organization_id: number;
    llm_config: Record<string, string>;
    stt_config: Record<string, string>;
    tts_config: Record<string, string>;
    allowed_voice_ids: number[];
    channels_enabled: string[];
}

interface OrgSubscription {
    organization_id: number;
    plan_name: string;
    status: string;
    included_minutes: number;
    included_messages: number;
    price_per_extra_minute: string;
    price_per_extra_message: string;
}

interface BillingPlan {
    id: number;
    name: string;
    currency: string;
    price_per_month: number;
    included_minutes: number;
    is_active: boolean;
    stripe_price_id: string | null;
    razorpay_plan_id: string | null;
}

interface OrgWallet {
    organization_id: number;
    balance: number;
    currency: string;
    gateway: string;
    exhaustion_policy: string;
    billing_plan_id: number | null;
    plan_expires_at: string | null;
}

interface OrgItem {
    id: number;
    provider_id: string;
    email?: string | null;
    first_name?: string | null;
    last_name?: string | null;
    name?: string | null;
    country?: string | null;
    phone_number?: string | null;
    created_at?: string | null;
    platform_config: OrgPlatformConfig | null;
    subscription: OrgSubscription | null;
}

/** Org id shown in the table: long provider ids are shortened, the full id is in the tooltip. */
const shortOrgId = (providerId: string) =>
    providerId.length > 8 ? `${providerId.slice(0, 5)}***${providerId.slice(-3)}` : providerId;

/** Value each sortable column sorts by. */
const ORG_SORT_ACCESSORS = {
    id: (o: OrgItem) => o.id,
    org: (o: OrgItem) => o.provider_id,
    owner: (o: OrgItem) => o.email,
    country: (o: OrgItem) => o.country,
    created_at: (o: OrgItem) => (o.created_at ? new Date(o.created_at).getTime() : null),
    plan: (o: OrgItem) =>
        o.subscription ? `${o.subscription.plan_name ?? ""} ${o.subscription.status ?? ""}`.trim() : "",
};
type OrgSortKey = keyof typeof ORG_SORT_ACCESSORS;

const normalizeCfg = (c: OrgPlatformConfig | null | undefined, orgId: number): OrgPlatformConfig => ({
    organization_id: c?.organization_id ?? orgId,
    llm_config: c?.llm_config ?? {},
    stt_config: c?.stt_config ?? {},
    tts_config: c?.tts_config ?? {},
    allowed_voice_ids: c?.allowed_voice_ids ?? [],
    channels_enabled: c?.channels_enabled ?? ["voice", "widget", "chat"],
});

const normalizeSub = (s: OrgSubscription | null | undefined, orgId: number): OrgSubscription => ({
    organization_id: s?.organization_id ?? orgId,
    plan_name: s?.plan_name ?? "starter",
    status: s?.status ?? "trialing",
    included_minutes: s?.included_minutes ?? 100,
    included_messages: s?.included_messages ?? 1000,
    price_per_extra_minute: s?.price_per_extra_minute ?? "0.0500",
    price_per_extra_message: s?.price_per_extra_message ?? "0.0010",
});

/** Backend error bodies carry { detail?: string } — extracted via narrowing, never an unchecked cast. */
const detailOf = (body: unknown): string | undefined => {
    if (body && typeof body === "object" && "detail" in body) {
        const detail = body.detail;
        return typeof detail === "string" ? detail : undefined;
    }
    return undefined;
};

const stableStringify = (obj: unknown): string => {
    if (obj === null || obj === undefined) return "";
    if (typeof obj !== "object") return JSON.stringify(obj);
    if (Array.isArray(obj)) return JSON.stringify(obj.map(stableStringify));
    const sortedKeys = Object.keys(obj as Record<string, unknown>).sort();
    const sortedObj: Record<string, unknown> = {};
    for (const key of sortedKeys) {
        sortedObj[key] = (obj as Record<string, unknown>)[key];
    }
    return JSON.stringify(sortedObj);
};

const isCfgDirty = (current: OrgPlatformConfig, saved: OrgPlatformConfig) => {
    if (stableStringify(current.llm_config || {}) !== stableStringify(saved.llm_config || {})) return true;
    if (stableStringify(current.stt_config || {}) !== stableStringify(saved.stt_config || {})) return true;
    if (stableStringify(current.tts_config || {}) !== stableStringify(saved.tts_config || {})) return true;
    if (JSON.stringify(current.allowed_voice_ids || []) !== JSON.stringify(saved.allowed_voice_ids || [])) return true;
    if (JSON.stringify(current.channels_enabled || []) !== JSON.stringify(saved.channels_enabled || [])) return true;
    return false;
};

const isSubDirty = (current: OrgSubscription, saved: OrgSubscription) => {
    const keys: (keyof OrgSubscription)[] = [
        "plan_name",
        "status",
        "included_minutes",
        "included_messages",
        "price_per_extra_minute",
        "price_per_extra_message",
    ];
    for (const k of keys) {
        if (String(current[k] ?? "") !== String(saved[k] ?? "")) {
            return true;
        }
    }
    return false;
};

function JsonEditor({
    label,
    value,
    onChange,
    onErrorChange,
}: {
    label: string;
    value: Record<string, string>;
    onChange: (v: Record<string, string>) => void;
    onErrorChange?: (hasErr: boolean) => void;
}) {
    const serializedValue = JSON.stringify(value || {}, null, 2);
    const [text, setText] = useState(serializedValue);
    const [err, setErr] = useState(false);
    const lastValueRef = useRef(serializedValue);
    const onErrorChangeRef = useRef(onErrorChange);
    onErrorChangeRef.current = onErrorChange;

    useEffect(() => {
        if (lastValueRef.current !== serializedValue) {
            lastValueRef.current = serializedValue;
            setText(serializedValue);
            setErr(false);
            onErrorChangeRef.current?.(false);
        }
    }, [serializedValue]);

    return (
        <div className="space-y-1">
            <Label className="text-xs">{label}</Label>
            <textarea
                className={`w-full rounded-md border ${err ? "border-destructive" : "border-input"} bg-card px-3 py-2 text-xs font-mono resize-y min-h-[80px]`}
                value={text}
                onChange={(e) => {
                    const newText = e.target.value;
                    setText(newText);
                    try {
                        const parsed = JSON.parse(newText);
                        setErr(false);
                        onErrorChangeRef.current?.(false);
                        lastValueRef.current = JSON.stringify(parsed, null, 2);
                        onChange(parsed);
                    } catch {
                        setErr(true);
                        onErrorChangeRef.current?.(true);
                    }
                }}
            />
        </div>
    );
}

function OrgOnboarding({ orgId }: { orgId: number }) {
    const { getAccessToken } = useAuth();
    const [data, setData] = useState<Record<string, unknown> | null>(null);
    const [loaded, setLoaded] = useState(false);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const token = await getAccessToken();
                const baseUrl = getBackendApiUrl();
                const res = await fetch(`${baseUrl}/api/v1/admin/orgs/${orgId}/onboarding`, {
                    headers: { Authorization: `Bearer ${token}`, "ngrok-skip-browser-warning": "true" },
                });
                if (res.ok && !cancelled) {
                    const body = await res.json();
                    setData((body.profile ?? null) as Record<string, unknown> | null);
                }
            } catch {
                // best-effort: leave empty
            } finally {
                if (!cancelled) setLoaded(true);
            }
        })();
        return () => { cancelled = true; };
    }, [orgId, getAccessToken]);

    if (!loaded) return <p className="text-xs text-muted-foreground">Loading onboarding…</p>;
    if (!data) return <p className="text-xs text-muted-foreground">No Welcome-popup answers for this org yet.</p>;

    const rows: Array<[string, unknown]> = [
        ["Persona", data.persona],
        ["On-prem need", data.onprem_need],
        ["Migrating from", data.migrating_from],
        ["Other provider", data.migrating_other_provider],
        ["Switch reason", data.switch_reason],
        ["Heard via", data.how_heard],
        ["Volume", data.volume],
        ["Country", data.country],
        ["Origin", data.origin],
    ];
    return (
        <div className="grid grid-cols-2 gap-2 text-xs">
            {rows.map(([label, value]) => (
                <div key={label}>
                    <span className="text-muted-foreground block text-[11px] font-medium">{label}</span>
                    <span className="font-medium text-foreground">{String(value ?? "—")}</span>
                </div>
            ))}
        </div>
    );
}

type OrgDetailTab = "overview" | "platform" | "billing";

/** Surface of every card in the org drawer: white on the drawer's grey. */
const DRAWER_CARD = "rounded-lg border border-border bg-card p-4 shadow-xs";

/** A titled white card inside a drawer tab. */
function DetailSection({ title, description, action, children }: {
    title: string;
    description?: string;
    action?: ReactNode;
    children: ReactNode;
}) {
    return (
        <section className={`${DRAWER_CARD} space-y-4`}>
            <div className="flex items-start justify-between gap-3">
                <div>
                    <h4 className="text-sm font-semibold text-foreground">{title}</h4>
                    {description && <p className="text-xs text-muted-foreground">{description}</p>}
                </div>
                {action}
            </div>
            {children}
        </section>
    );
}

/** Label above a read-only value. */
function DetailField({ label, children, mono = false }: { label: string; children: ReactNode; mono?: boolean }) {
    return (
        <div className="min-w-0">
            <span className="block text-[11px] font-medium text-muted-foreground">{label}</span>
            <span className={`block truncate text-xs font-medium text-foreground ${mono ? "font-mono" : ""}`}>{children}</span>
        </div>
    );
}

/** Full org detail in tabs: overview, platform config and wallet/billing. */
function OrgDetail({ org, onSaved, plans }: { org: OrgItem; onSaved: () => void; plans: BillingPlan[] }) {
    const { getAccessToken } = useAuth();
    const [cfg, setCfg] = useState<OrgPlatformConfig>(() => normalizeCfg(org.platform_config, org.id));
    const [savedCfg, setSavedCfg] = useState<OrgPlatformConfig>(() => normalizeCfg(org.platform_config, org.id));
    const [sub, setSub] = useState<OrgSubscription>(() => normalizeSub(org.subscription, org.id));
    const [savedSub, setSavedSub] = useState<OrgSubscription>(() => normalizeSub(org.subscription, org.id));
    const [jsonErrors, setJsonErrors] = useState<Record<string, boolean>>({});

    const [wallet, setWallet] = useState<OrgWallet | null>(null);
    const [walletLoading, setWalletLoading] = useState(false);
    const [walletPlanId, setWalletPlanId] = useState<string>("0"); // 0 = none
    const [savedWalletPlanId, setSavedWalletPlanId] = useState<string>("0");
    const [exhaustionPolicy, setExhaustionPolicy] = useState<string>("pause");
    const [savedExhaustionPolicy, setSavedExhaustionPolicy] = useState<string>("pause");
    const [saving, setSaving] = useState(false);
    const [walletSaving, setWalletSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [walletError, setWalletError] = useState<string | null>(null);
    const [activeTab, setActiveTab] = useState<OrgDetailTab>("overview");

    useEffect(() => {
        const nextCfg = normalizeCfg(org.platform_config, org.id);
        const nextSub = normalizeSub(org.subscription, org.id);
        setCfg(nextCfg);
        setSavedCfg(nextCfg);
        setSub(nextSub);
        setSavedSub(nextSub);
    }, [org]);

    // Fetch wallet when the drawer opens (source of truth for billing)
    useEffect(() => {
        const fetchWallet = async () => {
            setWalletLoading(true);
            try {
                const token = await getAccessToken();
                const baseUrl = getBackendApiUrl();
                const res = await fetch(`${baseUrl}/api/v1/admin/billing/orgs/${org.id}/wallet`, {
                    headers: { Authorization: `Bearer ${token}`, "ngrok-skip-browser-warning": "true" },
                });
                if (res.ok) {
                    const w: OrgWallet = await res.json();
                    setWallet(w);
                    const planStr = w.billing_plan_id ? String(w.billing_plan_id) : "0";
                    const policyStr = w.exhaustion_policy ?? "pause";
                    setWalletPlanId(planStr);
                    setSavedWalletPlanId(planStr);
                    setExhaustionPolicy(policyStr);
                    setSavedExhaustionPolicy(policyStr);
                } else if (res.status === 404) {
                    setWallet(null);
                    setWalletPlanId("0");
                    setSavedWalletPlanId("0");
                    setExhaustionPolicy("pause");
                    setSavedExhaustionPolicy("pause");
                }
            } catch {
                // keep wallet null
            } finally {
                setWalletLoading(false);
            }
        };
        fetchWallet();
    }, [org.id, getAccessToken]);

    /** PUT one admin org resource; redirects to login on an expired token. */
    const putOrgResource = async (path: "config" | "subscription", body: unknown) => {
        const token = await getAccessToken();
        const res = await fetch(`${getBackendApiUrl()}/api/v1/admin/orgs/${org.id}/${path}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, "ngrok-skip-browser-warning": "true" },
            body: JSON.stringify(body),
        });
        if (res.ok) return;
        const detail = detailOf(await res.json().catch(() => ({})));
        if (res.status === 401 && detail?.toLowerCase().includes("token")) {
            window.location.href = "/auth/login";
        }
        throw new Error(detail ?? "Save failed");
    };

    const save = async () => {
        setSaving(true); setError(null);
        try {
            await putOrgResource("config", cfg);
            toast.success("Platform config saved");
            setSavedCfg(cfg);
            onSaved();
        } catch (e: unknown) {
            setError(e instanceof Error ? e.message : "Save failed");
        } finally {
            setSaving(false);
        }
    };

    const saveWallet = async () => {
        setWalletSaving(true); setWalletError(null);
        try {
            const token = await getAccessToken();
            const baseUrl = getBackendApiUrl();
            const planId = walletPlanId === "0" ? null : Number(walletPlanId);
            const selectedPlan = plans.find((p) => p.id === planId);
            const body: Record<string, unknown> = {
                billing_plan_id: planId,
                exhaustion_policy: exhaustionPolicy,
            };
            // Auto-sync currency/gateway from selected plan to avoid INR/USD mismatch
            if (selectedPlan) {
                body.currency = selectedPlan.currency;
                body.gateway = selectedPlan.currency === "INR" ? "razorpay" : "stripe";
            } else if (planId === null) {
                // clearing plan keeps existing currency/gateway
            }
            const h = { "Content-Type": "application/json", Authorization: `Bearer ${token}`, "ngrok-skip-browser-warning": "true" };
            const res = await fetch(`${baseUrl}/api/v1/admin/billing/orgs/${org.id}/wallet`, {
                method: "PUT",
                headers: h,
                body: JSON.stringify(body),
            });
            if (!res.ok) {
                const isJson = res.headers.get("content-type")?.includes("application/json");
                const b = isJson ? await res.json().catch(() => ({})) : {};
                throw new Error(detailOf(b) ?? "Wallet save failed");
            }
            // also sync legacy org_subscription for backward compat display
            if (selectedPlan) {
                await fetch(`${baseUrl}/api/v1/admin/orgs/${org.id}/subscription`, {
                    method: "PUT",
                    headers: h,
                    body: JSON.stringify({ plan_name: selectedPlan.name, status: "active", included_minutes: selectedPlan.included_minutes }),
                });
            } else if (planId === null) {
                await fetch(`${baseUrl}/api/v1/admin/orgs/${org.id}/subscription`, {
                    method: "PUT",
                    headers: h,
                    body: JSON.stringify({ plan_name: "no plan", status: "inactive", included_minutes: 0 }),
                });
            }
            if (planId === null) {
                toast.success(wallet?.billing_plan_id ? "Billing plan removed" : "Wallet saved without a billing plan");
            } else if (wallet?.billing_plan_id && wallet.billing_plan_id !== planId) {
                toast.success("Billing plan changed");
            } else {
                toast.success("Billing plan assigned");
            }
            onSaved();
            // refresh wallet
            const wr = await fetch(`${baseUrl}/api/v1/admin/billing/orgs/${org.id}/wallet`, { headers: { Authorization: `Bearer ${token}`, "ngrok-skip-browser-warning": "true" } });
            if (wr.ok) {
                const w: OrgWallet = await wr.json();
                setWallet(w);
                const planStr = w.billing_plan_id ? String(w.billing_plan_id) : "0";
                const policyStr = w.exhaustion_policy ?? "pause";
                setWalletPlanId(planStr);
                setSavedWalletPlanId(planStr);
                setExhaustionPolicy(policyStr);
                setSavedExhaustionPolicy(policyStr);
            } else {
                setSavedWalletPlanId(walletPlanId);
                setSavedExhaustionPolicy(exhaustionPolicy);
            }
        } catch (e: unknown) {
            setWalletError(e instanceof Error ? e.message : "Wallet save failed");
        } finally {
            setWalletSaving(false);
        }
    };

    const saveBilling = async () => {
        if (isWalletDirty) await saveWallet();
        if (!isLegacySubDirty) return;
        setWalletSaving(true); setWalletError(null);
        try {
            await putOrgResource("subscription", sub);
            toast.success("Legacy subscription saved");
            setSavedSub(sub);
            onSaved();
        } catch (e: unknown) {
            setWalletError(e instanceof Error ? e.message : "Save failed");
        } finally {
            setWalletSaving(false);
        }
    };

    const hasJsonError = Object.values(jsonErrors).some(Boolean);
    const isPlatformConfigDirty = isCfgDirty(cfg, savedCfg);
    const isLegacySubDirty = isSubDirty(sub, savedSub);
    const isWalletDirty = !walletLoading && (
        wallet !== null
            ? (walletPlanId !== savedWalletPlanId || exhaustionPolicy !== savedExhaustionPolicy)
            : (walletPlanId !== "0" || exhaustionPolicy !== savedExhaustionPolicy)
    );

    const ownerFullName = `${org.first_name || ""} ${org.last_name || ""}`.trim() || org.name;

    const planOptionLabel = (p: BillingPlan) =>
        `${p.name} · ${p.currency} ${p.price_per_month}/mo · ${p.included_minutes} min${p.is_active ? "" : " (inactive)"}`;

    const billingFields = (
        <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
                <Label className="text-xs">Billing Plan</Label>
                <Select value={walletPlanId} onValueChange={setWalletPlanId}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="No plan" /></SelectTrigger>
                    <SelectContent>
                        <SelectItem value="0">— No plan —</SelectItem>
                        {plans.map((p) => (
                            <SelectItem key={p.id} value={String(p.id)}>{planOptionLabel(p)}</SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </div>
            <div className="space-y-1">
                <Label className="text-xs">Exhaustion Policy</Label>
                <Select value={exhaustionPolicy} onValueChange={setExhaustionPolicy}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                        <SelectItem value="pause">pause — block calls at $0</SelectItem>
                        <SelectItem value="auto_bill">auto_bill — allow overage</SelectItem>
                    </SelectContent>
                </Select>
            </div>
        </div>
    );

    return (
        <Tabs
            value={activeTab}
            onValueChange={(value) => setActiveTab(value as OrgDetailTab)}
            className="flex min-h-0 flex-1 flex-col gap-0"
        >
            {/* Tab bar stays fixed under the drawer title. */}
            <div className="shrink-0 border-b border-border px-4 pb-3">
                <UnderlineTabs
                    value={activeTab}
                    onValueChange={(v) => setActiveTab(v as OrgDetailTab)}
                    items={[
                        { value: "overview", label: "Overview" },
                        { value: "platform", label: "Platform", dirty: isPlatformConfigDirty },
                        { value: "billing", label: "Billing", dirty: isWalletDirty || isLegacySubDirty },
                    ]}
                />
            </div>

            <SheetBody className="px-4 py-4">
                {/* Tabs stay mounted (hidden when inactive) so unsaved edits survive switching. */}
                <TabsContent value="overview" forceMount className="mt-0 space-y-4 data-[state=inactive]:hidden">
                    <DetailSection title="Organization" description="Created at signup; read-only.">
                        <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                            <DetailField label="Org ID" mono>{org.provider_id}</DetailField>
                            <DetailField label="Created">{formatDateTime(org.created_at)}</DetailField>
                            <DetailField label="Owner name">{ownerFullName || "—"}</DetailField>
                            <DetailField label="Email" mono>{org.email || "—"}</DetailField>
                            <DetailField label="Country">{org.country || "—"}</DetailField>
                            <DetailField label="Phone" mono>{org.phone_number || "—"}</DetailField>
                        </div>
                    </DetailSection>
                    <DetailSection title="Onboarding answers" description="From the Welcome popup, per org user.">
                        <OrgOnboarding orgId={org.id} />
                    </DetailSection>
                </TabsContent>

                <TabsContent value="platform" forceMount className="mt-0 space-y-4 data-[state=inactive]:hidden">
                    <DetailSection title="Model services" description="Provider settings applied to this org, as JSON.">
                        <div className="grid gap-4">
                            <JsonEditor
                                label="LLM Config"
                                value={cfg.llm_config}
                                onChange={(v) => setCfg((c) => ({ ...c, llm_config: v }))}
                                onErrorChange={(e) => setJsonErrors((prev) => ({ ...prev, llm: e }))}
                            />
                            <JsonEditor
                                label="STT Config"
                                value={cfg.stt_config}
                                onChange={(v) => setCfg((c) => ({ ...c, stt_config: v }))}
                                onErrorChange={(e) => setJsonErrors((prev) => ({ ...prev, stt: e }))}
                            />
                            <JsonEditor
                                label="TTS Config"
                                value={cfg.tts_config}
                                onChange={(v) => setCfg((c) => ({ ...c, tts_config: v }))}
                                onErrorChange={(e) => setJsonErrors((prev) => ({ ...prev, tts: e }))}
                            />
                        </div>
                    </DetailSection>

                    <DetailSection title="Access" description="Voices and channels this org can use.">
                        <div className="space-y-3">
                            <div className="space-y-1">
                                <Label className="text-xs">Allowed Voice IDs (comma-separated)</Label>
                                <Input
                                    className="text-xs"
                                    value={cfg.allowed_voice_ids.join(", ")}
                                    onChange={(e) => setCfg((c) => ({
                                        ...c,
                                        allowed_voice_ids: e.target.value.split(",").map((v) => parseInt(v.trim())).filter(Boolean),
                                    }))}
                                />
                            </div>
                            <div className="space-y-1">
                                <Label className="text-xs">Channels Enabled (comma-separated)</Label>
                                <Input
                                    className="text-xs"
                                    value={cfg.channels_enabled.join(", ")}
                                    onChange={(e) => setCfg((c) => ({
                                        ...c,
                                        channels_enabled: e.target.value.split(",").map((v) => v.trim()).filter(Boolean),
                                    }))}
                                />
                            </div>
                        </div>
                    </DetailSection>

                </TabsContent>

                <TabsContent value="billing" forceMount className="mt-0 space-y-4 data-[state=inactive]:hidden">
                    <DetailSection
                        title="Wallet & billing plan"
                        description="Source of truth for this org's billing."
                        action={
                            <Link href="/admin/billing" className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
                                Manage plans <ExternalLink className="h-3 w-3" />
                            </Link>
                        }
                    >
                        {walletLoading ? (
                            <p className="text-xs text-muted-foreground">Loading wallet…</p>
                        ) : wallet ? (
                            <div className="space-y-4">
                                <div className="flex items-center gap-3 border-b border-border/60 pb-4">
                                    <Wallet className="h-4 w-4 shrink-0 text-muted-foreground" />
                                    <div className="min-w-0">
                                        <p className="font-mono text-sm font-semibold">
                                            {new Intl.NumberFormat("en", { style: "currency", currency: wallet.currency }).format(wallet.balance)}
                                            <span className="ml-1.5 text-xs font-normal text-muted-foreground">{wallet.currency} · {wallet.gateway}</span>
                                        </p>
                                        {wallet.plan_expires_at && (
                                            <p className="text-[11px] text-muted-foreground">Renews {new Date(wallet.plan_expires_at).toLocaleDateString()}</p>
                                        )}
                                    </div>
                                </div>
                                {billingFields}
                                <Link href="/admin/billing" className="inline-block text-xs text-muted-foreground hover:text-foreground">
                                    Transaction history on the Billing page
                                </Link>
                            </div>
                        ) : (
                            <div className="space-y-3">
                                <p className="text-xs text-muted-foreground">No wallet yet — select a plan to create one.</p>
                                {billingFields}
                            </div>
                        )}
                    </DetailSection>
                    {/* Legacy org_subscriptions — saved with Billing; the wallet above is the source of truth. */}
                    <DetailSection
                        title="Legacy subscription fields"
                        description="Deprecated — the wallet above is the source of truth."
                    >
                        <div className="grid gap-3 sm:grid-cols-2">
                            {(["plan_name", "status", "included_minutes", "included_messages", "price_per_extra_minute", "price_per_extra_message"] as (keyof OrgSubscription)[]).map((k) => (
                                <div key={k} className="space-y-1">
                                    <Label className="text-xs capitalize">{k.replace(/_/g, " ")}</Label>
                                    <Input
                                        className="text-xs"
                                        value={String(sub[k] ?? "")}
                                        onChange={(e) => setSub((current) => ({ ...current, [k]: e.target.value }))}
                                    />
                                </div>
                            ))}
                        </div>
                    </DetailSection>
                </TabsContent>
            </SheetBody>

            {/* Fixed footer: the save action for the open tab. */}
            {activeTab === "platform" && (
                <SheetFooter className="justify-between">
                    <p className="min-w-0 truncate text-xs text-destructive">{error}</p>
                    <Button size="sm" onClick={save} disabled={saving || !isPlatformConfigDirty || hasJsonError}>
                        <Save className="h-3 w-3 mr-1" />{saving ? "Saving…" : "Save Platform Config"}
                    </Button>
                </SheetFooter>
            )}
            {activeTab === "billing" && !walletLoading && (
                <SheetFooter className="justify-between">
                    <p className="min-w-0 truncate text-xs text-destructive">{walletError}</p>
                    <Button size="sm" onClick={saveBilling} disabled={walletSaving || !(isWalletDirty || isLegacySubDirty)}>
                        <Save className="h-3 w-3 mr-1" />{walletSaving ? "Saving…" : wallet ? "Save Billing" : "Create Wallet"}
                    </Button>
                </SheetFooter>
            )}
        </Tabs>
    );
}

export default function AdminOrgsPage() {
    const { user, loading: authLoading, getAccessToken } = useAuth();
    const hasFetched = useRef(false);
    const [orgs, setOrgs] = useState<OrgItem[]>([]);
    const [plans, setPlans] = useState<BillingPlan[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [selectedOrg, setSelectedOrg] = useState<OrgItem | null>(null);
    const [searchQuery, setSearchQuery] = useState("");
    const [statusFilter, setStatusFilter] = useState(ALL_FILTER);
    const [countryFilter, setCountryFilter] = useState(ALL_FILTER);
    const visibleOrgs = useMemo(() => {
        const searched = filterBySearch(
            orgs,
            searchQuery,
            (o) => `${o.name || ""} ${o.email || ""} ${o.provider_id}`,
        );
        return searched.filter(
            (o) => matchesFilter(o.subscription?.status, statusFilter) && matchesFilter(o.country, countryFilter),
        );
    }, [orgs, searchQuery, statusFilter, countryFilter]);

    const { sortedItems: sortedOrgs, sortKey, sortDir, toggleSort } = useTableSort<OrgItem, OrgSortKey>(
        visibleOrgs,
        ORG_SORT_ACCESSORS,
        { sortKey: "id", sortDir: "asc" },
    );
    const orgPagination = usePagination(sortedOrgs);
    const sortProps = { sortKey, sortDir, onSort: toggleSort };

    const fetchOrgs = async () => {
        setLoading(true);
        setError(null);
        try {
            const token = await getAccessToken();
            const baseUrl = getBackendApiUrl();
            const headers = {
                Authorization: `Bearer ${token}`,
                "ngrok-skip-browser-warning": "true",
            };
            const [orgRes, planRes] = await Promise.all([
                fetch(`${baseUrl}/api/v1/admin/orgs`, { headers }),
                fetch(`${baseUrl}/api/v1/admin/billing/plans`, { headers }),
            ]);
            if (orgRes.ok) {
                const data = await orgRes.json();
                setOrgs(Array.isArray(data) ? data : []);
            } else {
                const isJson = orgRes.headers.get("content-type")?.includes("application/json");
                const body = isJson ? await orgRes.json().catch(() => ({})) : {};
                const detail = detailOf(body) ?? `Request failed (${orgRes.status})`;
                if (orgRes.status === 401 && String(detail).toLowerCase().includes("token")) {
                    window.location.href = "/auth/login";
                    return;
                }
                setError(detail);
            }
            if (planRes.ok) setPlans(await planRes.json());
        } catch (e: unknown) {
            setError(e instanceof Error ? e.message : "Failed to fetch organizations");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (authLoading || !user || hasFetched.current) return;
        hasFetched.current = true;
        fetchOrgs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [authLoading, user]);

    // Keep the open drawer in sync after a refresh (plan/status changes).
    useEffect(() => {
        setSelectedOrg((prev) => (prev ? orgs.find((o) => o.id === prev.id) ?? null : prev));
    }, [orgs]);

    return (
        <div className="space-y-4 pt-0 pb-6">
            <PageHeader
                title="Organizations"
                subtitle="Assign model configs, voices, channels, and subscription plans to each org."
                toolbar={
                    <>
                        <PageSearchInput placeholder="Search organizations..." value={searchQuery} onChange={setSearchQuery} />
                        <PageFilterSelect allLabel="All statuses" value={statusFilter} options={toFilterOptions(orgs, (o) => o.subscription?.status)} onChange={setStatusFilter} />
                        <PageFilterSelect allLabel="All countries" value={countryFilter} options={toFilterOptions(orgs, (o) => o.country)} onChange={setCountryFilter} />
                    </>
                }
            />
            {loading && <p className="text-muted-foreground text-sm">Loading…</p>}
            {!loading && orgs.length === 0 && (
                <p className="text-muted-foreground text-sm">No organizations yet.</p>
            )}
            {!loading && orgs.length > 0 && visibleOrgs.length === 0 && (
                <div className="text-center py-12 px-4">
                    <Search className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
                    <p className="text-sm text-muted-foreground">No organizations match your filters.</p>
                </div>
            )}
            {error && <p className="text-sm text-destructive">{error}</p>}
            {!loading && visibleOrgs.length > 0 && (
                <Card className="overflow-hidden">
                    <CardContent className="p-0 overflow-hidden">
                        <Table>
                            <TableHeader className="bg-muted/50">
                                <TableRow className="hover:bg-transparent">
                                    <SortableTableHead column="id" label="ID" {...sortProps} />
                                    <SortableTableHead column="org" label="Org" {...sortProps} />
                                    <SortableTableHead column="owner" label="Owner" {...sortProps} />
                                    <SortableTableHead column="country" label="Country" {...sortProps} />
                                    <SortableTableHead column="created_at" label="Created" {...sortProps} />
                                    <SortableTableHead column="plan" label="Plan" {...sortProps} />
                                    <TableHead className="font-semibold text-muted-foreground text-right">Details</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {orgPagination.pageItems.map((org) => (
                                    <TableRow key={org.id}>
                                        <TableCell className="font-mono text-muted-foreground">{org.id}</TableCell>
                                        <TableCell>
                                            {/* Only the org (and the Details button) opens its drawer. */}
                                            <TableCellLink
                                                onClick={() => setSelectedOrg(org)}
                                                title={org.provider_id}
                                                className="font-mono max-w-[160px]"
                                            >
                                                {shortOrgId(org.provider_id)}
                                            </TableCellLink>
                                        </TableCell>
                                        <TableCell>
                                            {/* Owner shows the email only; the name stays in the drawer. */}
                                            {org.email ? (
                                                <div className="font-medium text-foreground font-mono truncate max-w-[240px]" title={org.email}>{org.email}</div>
                                            ) : (
                                                <span className="text-muted-foreground">—</span>
                                            )}
                                        </TableCell>
                                        <TableCell className="text-muted-foreground">{org.country || "—"}</TableCell>
                                        <TableCell className="whitespace-nowrap text-xs font-medium text-foreground">
                                            {formatDateTime(org.created_at)}
                                        </TableCell>
                                        <TableCell>
                                            <Badge variant={org.subscription?.status === "active" ? "default" : "secondary"} className="text-xs">
                                                {org.subscription?.plan_name ?? "no plan"} · {org.subscription?.status ?? "—"}
                                            </Badge>
                                        </TableCell>
                                        <TableCell className="text-right">
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                className="h-8 w-8"
                                                aria-label={`Open org ${org.id} details`}
                                                onClick={() => setSelectedOrg(org)}
                                            >
                                                <ChevronRight className="h-4 w-4" />
                                            </Button>
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                        <TablePagination {...orgPagination} />
                    </CardContent>
                </Card>
            )}

            {/* Org detail — off-canvas drawer */}
            <Sheet open={selectedOrg !== null} onOpenChange={(open) => { if (!open) setSelectedOrg(null); }}>
                <SheetContent side="right">
                    <SheetHeader>
                        {selectedOrg && (
                            <SheetTitle className="text-base">
                                Org #{selectedOrg.id} — {`${selectedOrg.first_name || ""} ${selectedOrg.last_name || ""}`.trim() || selectedOrg.name || "Organization"}
                            </SheetTitle>
                        )}
                    </SheetHeader>
                    {selectedOrg && (
                        <OrgDetail key={selectedOrg.id} org={selectedOrg} plans={plans} onSaved={() => { hasFetched.current = false; fetchOrgs(); }} />
                    )}
                </SheetContent>
            </Sheet>
        </div>
    );
}
