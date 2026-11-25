"use client";

import { Pencil, Plus, Trash2, Volume2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
    Dialog,
    DialogContent,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { type Breadcrumb, PageHeader } from "@/context/HeaderContext";
import { detailFromError } from "@/lib/apiError";
import { useAuth } from "@/lib/auth";

interface Voice {
    id: number;
    name: string;
    provider: string;
    voice_id: string;
    language: string;
    gender: string | null;
    accent: string | null;
    preview_audio_url: string | null;
    is_active: boolean;
}

const EMPTY_FORM = {
    name: "",
    provider: "",
    voice_id: "",
    language: "en",
    gender: "",
    accent: "",
    preview_audio_url: "",
    is_active: true,
};

export default function AdminVoicesPage() {
    const { user, loading: authLoading, getAccessToken } = useAuth();
    const hasFetched = useRef(false);
    const [voices, setVoices] = useState<Voice[]>([]);
    const [loading, setLoading] = useState(true);
    const [dialogOpen, setDialogOpen] = useState(false);
    const [editing, setEditing] = useState<Voice | null>(null);
    const [form, setForm] = useState(EMPTY_FORM);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const fetchVoices = async () => {
        setLoading(true);
        try {
            const token = await getAccessToken();
            const res = await fetch("/api/v1/admin/voices?active_only=false", {
                headers: { Authorization: `Bearer ${token}` },
            });
            if (!res.ok) {
                const body = await res.json().catch(() => ({}));
                const detail = (body as { detail?: string })?.detail ?? `Request failed (${res.status})`;
                if (res.status === 401 && detail.toLowerCase().includes("token")) {
                    window.location.href = "/auth/login";
                    return;
                }
                throw new Error(detail);
            }
            setVoices(await res.json());
        } catch (e: unknown) {
            setError(e instanceof Error ? e.message : "Unknown error");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (authLoading || !user || hasFetched.current) return;
        hasFetched.current = true;
        fetchVoices();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [authLoading, user]);

    const openCreate = () => {
        setEditing(null);
        setForm(EMPTY_FORM);
        setError(null);
        setDialogOpen(true);
    };

    const openEdit = (v: Voice) => {
        setEditing(v);
        setForm({
            name: v.name,
            provider: v.provider,
            voice_id: v.voice_id,
            language: v.language,
            gender: (v.gender ?? "").toLowerCase(),
            accent: v.accent ?? "",
            preview_audio_url: v.preview_audio_url ?? "",
            is_active: v.is_active,
        });
        setError(null);
        setDialogOpen(true);
    };

    const save = async () => {
        setSaving(true);
        setError(null);
        try {
            const token = await getAccessToken();
            const url = editing
                ? `/api/v1/admin/voices/${editing.id}`
                : "/api/v1/admin/voices";
            const method = editing ? "PATCH" : "POST";
            const body = { ...form, gender: form.gender || null, accent: form.accent || null, preview_audio_url: form.preview_audio_url || null };
            const res = await fetch(url, {
                method,
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
                body: JSON.stringify(body),
            });
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                const detail = detailFromError(err, "Failed to save voice");
                if (res.status === 401 && detail.toLowerCase().includes("token")) {
                    window.location.href = "/auth/login";
                    return;
                }
                throw new Error(detail);
            }
            setDialogOpen(false);
            hasFetched.current = false;
            fetchVoices();
        } catch (e: unknown) {
            setError(e instanceof Error ? e.message : "Unknown error");
        } finally {
            setSaving(false);
        }
    };

    const deleteVoice = async (id: number) => {
        if (!confirm("Delete this voice?")) return;
        try {
            const token = await getAccessToken();
            const res = await fetch(`/api/v1/admin/voices/${id}`, {
                method: "DELETE",
                headers: { Authorization: `Bearer ${token}` },
            });
            if (!res.ok && res.status === 401) {
                const body = await res.json().catch(() => ({}));
                const detail = (body as { detail?: string })?.detail ?? "";
                if (detail.toLowerCase().includes("token")) {
                    window.location.href = "/auth/login";
                    return;
                }
            }
        } finally {
            hasFetched.current = false;
            fetchVoices();
        }
    };

    const breadcrumbs = useMemo<Breadcrumb[]>(
        () => [
            { label: "Admin", href: "/admin" },
            { label: "Voice Catalog" },
        ],
        [],
    );

    return (
        <div className="space-y-6">
            <PageHeader
                title="Voice Catalog"
                subtitle="Voices added here are available for orgs to assign to their users."
                breadcrumbs={breadcrumbs}
            />
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-xl font-semibold">Voice Catalog</h2>
                    <p className="text-sm text-muted-foreground">
                        Voices added here are available for orgs to assign to their users.
                    </p>
                </div>
                <Button onClick={openCreate} size="sm">
                    <Plus className="h-4 w-4 mr-1" /> Add Voice
                </Button>
            </div>

            {loading && <p className="text-muted-foreground text-sm">Loading…</p>}
            {!loading && voices.length === 0 && (
                <p className="text-muted-foreground text-sm">No voices yet. Add one to get started.</p>
            )}

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {voices.map((v) => (
                    <Card key={v.id} className={v.is_active ? "" : "opacity-50"}>
                        <CardHeader className="pb-2">
                            <div className="flex items-start justify-between gap-2">
                                <div>
                                    <CardTitle className="text-sm font-semibold">{v.name}</CardTitle>
                                    <p className="text-xs text-muted-foreground mt-0.5">
                                        {v.provider} · {v.voice_id}
                                    </p>
                                </div>
                                <Badge variant={v.is_active ? "default" : "secondary"} className="text-xs shrink-0">
                                    {v.is_active ? "active" : "inactive"}
                                </Badge>
                            </div>
                        </CardHeader>
                        <CardContent className="pt-0">
                            <div className="flex flex-wrap gap-1 mb-3">
                                {v.language && <Badge variant="outline" className="text-xs">{v.language}</Badge>}
                                {v.gender && <Badge variant="outline" className="text-xs">{v.gender}</Badge>}
                                {v.accent && <Badge variant="outline" className="text-xs">{v.accent}</Badge>}
                            </div>
                            <div className="flex gap-2">
                                {v.preview_audio_url && (
                                    <Button
                                        variant="outline" size="sm" className="h-7 text-xs"
                                        onClick={() => new Audio(v.preview_audio_url!).play()}
                                    >
                                        <Volume2 className="h-3 w-3 mr-1" /> Preview
                                    </Button>
                                )}
                                <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => openEdit(v)}>
                                    <Pencil className="h-3 w-3 mr-1" /> Edit
                                </Button>
                                <Button variant="outline" size="sm" className="h-7 text-xs text-destructive hover:text-destructive" onClick={() => deleteVoice(v.id)}>
                                    <Trash2 className="h-3 w-3" />
                                </Button>
                            </div>
                        </CardContent>
                    </Card>
                ))}
            </div>

            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                <DialogContent className="max-w-md">
                    <DialogHeader>
                        <DialogTitle>{editing ? "Edit Voice" : "Add Voice"}</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4 py-2">
                        {[
                            { label: "Display Name", key: "name", placeholder: "e.g. Aria" },
                            { label: "Provider", key: "provider", placeholder: "e.g. elevenlabs" },
                            { label: "Voice ID", key: "voice_id", placeholder: "Provider-specific ID" },
                            { label: "Language (ISO)", key: "language", placeholder: "en" },
                            { label: "Gender (optional)", key: "gender", placeholder: "" },
                            { label: "Accent (optional)", key: "accent", placeholder: "e.g. British" },
                            { label: "Preview Audio URL (optional)", key: "preview_audio_url", placeholder: "https://… or MinIO path" },
                        ].map(({ label, key, placeholder }) => (
                            <div key={key} className="space-y-1">
                                <Label className="text-xs">{label}</Label>
                                {key === "gender" ? (
                                    <Select
                                        value={form.gender || "none"}
                                        onValueChange={(v) => setForm((f) => ({ ...f, gender: v === "none" ? "" : v }))}
                                    >
                                        <SelectTrigger className="w-full">
                                            <SelectValue placeholder="Not set" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="none">Not set</SelectItem>
                                            <SelectItem value="female">Female</SelectItem>
                                            <SelectItem value="male">Male</SelectItem>
                                            <SelectItem value="neutral">Neutral</SelectItem>
                                        </SelectContent>
                                    </Select>
                                ) : (
                                    <Input
                                        placeholder={placeholder}
                                        value={(form as Record<string, string | boolean>)[key] as string}
                                        onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
                                    />
                                )}
                            </div>
                        ))}
                        <div className="flex items-center gap-2">
                            <Switch
                                checked={form.is_active}
                                onCheckedChange={(v) => setForm((f) => ({ ...f, is_active: v }))}
                            />
                            <Label className="text-xs">Active</Label>
                        </div>
                        {error && <p className="text-xs text-destructive">{error}</p>}
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
                        <Button onClick={save} disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
