"use client";

import { Pencil, Plus, Trash2, Volume2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
    Sheet,
    SheetBody,
    SheetContent,
    SheetFooter,
    SheetHeader,
    SheetTitle,
} from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
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

export function VoiceCatalogManager({ readonly = false }: { readonly?: boolean }) {
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
            if (!res.ok) throw new Error("Failed to fetch voices");
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
                throw new Error(detailFromError(err, "Failed to save voice"));
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
        const token = await getAccessToken();
        await fetch(`/api/v1/admin/voices/${id}`, {
            method: "DELETE",
            headers: { Authorization: `Bearer ${token}` },
        });
        hasFetched.current = false;
        fetchVoices();
    };

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-xl font-semibold">Voice Catalog</h2>
                    <p className="text-sm text-muted-foreground">
                        Voices added here are available for orgs to assign to their users.
                    </p>
                </div>
                {!readonly && (
                    <Button onClick={openCreate} size="sm">
                        <Plus className="h-4 w-4 mr-1" /> Add Voice
                    </Button>
                )}
            </div>

            {loading && <p className="text-muted-foreground text-sm">Loading…</p>}
            {!loading && voices.length === 0 && (
                <p className="text-muted-foreground text-sm">No voices yet. Add one to get started.</p>
            )}

            <div className="flex flex-col gap-3.5 w-full">
                {voices.map((v) => (
                    <Card key={v.id} className={`w-full transition-all ${v.is_active ? "" : "opacity-60"}`}>
                        <CardHeader className="pb-3">
                            <div className="flex items-start justify-between gap-3">
                                <div className="space-y-0.5 min-w-0 flex-1">
                                    <CardTitle className="text-base font-bold text-foreground">{v.name}</CardTitle>
                                    <p className="text-xs text-muted-foreground">
                                        {v.provider} · {v.voice_id}
                                    </p>
                                </div>
                                <Badge variant={v.is_active ? "success" : "secondary"} className="text-xs shrink-0 font-medium">
                                    {v.is_active ? "Active" : "Inactive"}
                                </Badge>
                            </div>
                        </CardHeader>
                        <CardContent className="pt-0">
                            <div className="pt-3 border-t border-border/60 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                                {/* Left Corner: Badges */}
                                <div className="flex flex-wrap items-center gap-1.5">
                                    {v.language && <Badge variant="outline" className="text-xs px-2 py-0.5">{v.language}</Badge>}
                                    {v.gender && <Badge variant="outline" className="text-xs px-2 py-0.5">{v.gender}</Badge>}
                                    {v.accent && <Badge variant="outline" className="text-xs px-2 py-0.5">{v.accent}</Badge>}
                                </div>

                                {/* Right Corner: Action Buttons */}
                                <div className="flex items-center gap-2 shrink-0">
                                    {v.preview_audio_url && (
                                        <Button
                                            variant="outline" size="sm" className="h-8 text-xs gap-1.5"
                                            onClick={() => new Audio(v.preview_audio_url!).play()}
                                        >
                                            <Volume2 className="h-3.5 w-3.5" /> Preview
                                        </Button>
                                    )}
                                    {!readonly && (
                                        <>
                                            <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5" onClick={() => openEdit(v)}>
                                                <Pencil className="h-3.5 w-3.5" /> Edit
                                            </Button>
                                            <Button variant="outline" size="icon" className="h-8 w-8 shrink-0 text-destructive hover:text-destructive" onClick={() => deleteVoice(v.id)} title="Delete voice">
                                                <Trash2 className="h-3.5 w-3.5" />
                                            </Button>
                                        </>
                                    )}
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                ))}
            </div>

            <Sheet open={dialogOpen} onOpenChange={setDialogOpen}>
                <SheetContent className="w-full sm:w-[45%] sm:max-w-[45%]">
                    <SheetHeader className="border-b-2 border-black pb-4 mb-2 !gap-0">
                        <SheetTitle>{editing ? "Edit Voice" : "Add Voice"}</SheetTitle>
                        <p className="text-sm text-muted-foreground mt-0.5">
                            {editing ? "Update the configuration for this voice." : "Add a new voice to your catalog."}
                        </p>
                    </SheetHeader>
                    <SheetBody className="space-y-4 px-4 py-2">
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
                                <Label className="text-xs font-bold">{label}</Label>
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
                            <Label className="text-xs font-bold">Active</Label>
                        </div>
                        {error && <p className="text-xs text-destructive">{error}</p>}
                    </SheetBody>
                    <SheetFooter className="mt-auto border-t-2 border-black pt-4 flex flex-row justify-end space-x-2">
                        <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
                        <Button onClick={save} disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
                    </SheetFooter>
                </SheetContent>
            </Sheet>
        </div>
    );
}
