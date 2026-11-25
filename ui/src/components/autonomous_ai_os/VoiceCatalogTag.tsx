"use client";

/**
 * VoiceCatalogTag — shown beside each voice when the current user is a super-admin.
 *
 * Renders:
 *   ☑  [display name input]
 *
 * When the checkbox is checked + a display name is entered, the voice is saved
 * to the platform voice_catalog so org users can pick it by its friendly name.
 * Unchecking removes it from the catalog.
 *
 * This component is self-contained: it manages its own save state and reads
 * /api/v1/admin/voices to check if the voice is already catalogued.
 */

import { Check, Loader2, Pencil, Plus, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Input } from "@/components/ui/input";
import { useAuth } from "@/lib/auth";
import type { LocalUser } from "@/lib/auth/types";
import { cn } from "@/lib/utils";

interface Props {
    /** Provider string (e.g. "elevenlabs", "google_realtime") */
    provider: string;
    /** The provider-native voice ID */
    voiceId: string;
    /** Default display name to pre-fill (usually the voice's own name) */
    defaultDisplayName?: string;
    /**
     * Optional existing catalog entry. When provided the component skips its
     * own fetch and uses this entry as the source of truth.
     */
    entry?: CatalogEntry | null;
    /** Called whenever a save succeeds so the parent can refresh its list. */
    onChange?: () => void;
    className?: string;
}

interface CatalogEntry {
    id: number;
    name: string;
    provider: string;
    voice_id: string;
    is_active: boolean;
}

export function VoiceCatalogTag({
    provider,
    voiceId,
    defaultDisplayName = "",
    entry,
    onChange,
    className,
}: Props) {
    const { user, getAccessToken } = useAuth();
    const isSuperAdmin = (user as LocalUser & { is_superuser?: boolean })?.is_superuser;

    const initialEntry = entry ?? null;
    const [checked, setChecked] = useState(initialEntry ? initialEntry.is_active : false);
    const [displayName, setDisplayName] = useState(initialEntry ? initialEntry.name : defaultDisplayName);
    const [catalogId, setCatalogId] = useState<number | null>(initialEntry ? initialEntry.id : null);
    const [saving, setSaving] = useState(false);
    const [isEditing, setIsEditing] = useState(false);
    const fetchedRef = useRef(false);
    const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Keep in sync when the parent passes a refreshed entry.
    useEffect(() => {
        if (entry === undefined) return;
        setChecked(entry ? entry.is_active : false);
        setDisplayName(entry ? entry.name : defaultDisplayName);
        setCatalogId(entry ? entry.id : null);
    }, [entry, defaultDisplayName]);

    const buildHdrs = async () => {
        const t = await getAccessToken();
        return { Authorization: `Bearer ${t}`, "Content-Type": "application/json" };
    };

    // On mount, check if this voice is already in the catalog (only when the
    // parent does not already supply the entry).
    useEffect(() => {
        if (!isSuperAdmin || entry !== undefined || fetchedRef.current) return;
        fetchedRef.current = true;
        (async () => {
            try {
                const h = await buildHdrs();
                const res = await fetch("/api/v1/admin/voices?active_only=false", { headers: h });
                if (!res.ok) return;
                const voices: CatalogEntry[] = await res.json();
                const match = voices.find(
                    (v) => v.provider === provider && v.voice_id === voiceId
                );
                if (match) {
                    setChecked(match.is_active);
                    setDisplayName(match.name);
                    setCatalogId(match.id);
                }
            } catch { /* silent */ }
        })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isSuperAdmin, provider, voiceId, entry]);

    const extractError = async (res: Response): Promise<string> => {
        try {
            const payload = await res.json();
            return payload.detail || payload.message || JSON.stringify(payload);
        } catch {
            return res.statusText || `HTTP ${res.status}`;
        }
    };

    const save = async (isChecked: boolean, name: string) => {
        if (!isChecked && !catalogId) return; // nothing to do
        setSaving(true);
        try {
            const h = await buildHdrs();
            if (!isChecked && catalogId) {
                // Deactivate (soft delete — keep in DB but mark inactive)
                const res = await fetch(`/api/v1/admin/voices/${catalogId}`, {
                    method: "PATCH", headers: h,
                    body: JSON.stringify({ is_active: false }),
                });
                if (!res.ok) throw new Error(await extractError(res));
                setCatalogId(null);
                setChecked(false);
                setIsEditing(false);
            } else if (isChecked) {
                if (catalogId) {
                    // Update existing
                    const res = await fetch(`/api/v1/admin/voices/${catalogId}`, {
                        method: "PATCH", headers: h,
                        body: JSON.stringify({ name: name || voiceId, is_active: true }),
                    });
                    if (!res.ok) throw new Error(await extractError(res));
                } else {
                    // Create new
                    const res = await fetch("/api/v1/admin/voices", {
                        method: "POST", headers: h,
                        body: JSON.stringify({
                            name: name || voiceId,
                            provider,
                            voice_id: voiceId,
                            language: "en",
                            is_active: true,
                        }),
                    });
                    if (!res.ok) throw new Error(await extractError(res));
                    const created: CatalogEntry = await res.json();
                    setCatalogId(created.id);
                }
            }
            onChange?.();
        } catch (err) {
            const message = err instanceof Error ? err.message : "Failed to update voice catalog";
            console.error("Voice catalog save failed:", err);
            toast.error(message);
            // Revert the state so it reflects the server state.
            setChecked((prev) => !prev);
        } finally {
            setSaving(false);
        }
    };

    const handleCheck = (val: boolean) => {
        setChecked(val);
        save(val, displayName);
    };

    const handleNameChange = (val: string) => {
        setDisplayName(val);
        if (!checked) return;
        // Debounce the save
        if (saveTimer.current) clearTimeout(saveTimer.current);
        saveTimer.current = setTimeout(() => save(true, val), 800);
    };

    if (!isSuperAdmin) return null;

    if (!checked) {
        return (
            <button
                type="button"
                onClick={(e) => {
                    e.stopPropagation();
                    handleCheck(true);
                }}
                disabled={saving}
                className={cn(
                    "mt-1.5 inline-flex items-center gap-1 text-[10px] font-medium text-muted-foreground/80 hover:text-primary transition-colors py-0.5 px-2 rounded-full border border-dashed border-border/80 hover:border-primary/50 bg-background/40",
                    saving && "opacity-50 cursor-not-allowed",
                    className
                )}
                title="Add this voice to the organization voice catalog"
            >
                {saving ? (
                    <Loader2 className="h-2.5 w-2.5 animate-spin" />
                ) : (
                    <Plus className="h-2.5 w-2.5" />
                )}
                <span>Add to Catalog</span>
            </button>
        );
    }

    return (
        <div
            className={cn(
                "mt-1.5 inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] text-emerald-400 font-medium",
                className
            )}
            onClick={(e) => e.stopPropagation()}
        >
            <Check className="h-2.5 w-2.5 stroke-[2.5]" />
            <span>In Catalog</span>

            {isEditing ? (
                <div className="flex items-center gap-1 ml-0.5" onClick={(e) => e.stopPropagation()}>
                    <Input
                        placeholder="Display name…"
                        value={displayName}
                        onChange={(e) => handleNameChange(e.target.value)}
                        disabled={saving}
                        className="h-4 text-[10px] px-1 py-0 bg-background/90 w-24 border-border rounded"
                        autoFocus
                        onKeyDown={(e) => {
                            if (e.key === "Enter") setIsEditing(false);
                        }}
                    />
                    <button
                        type="button"
                        onClick={() => setIsEditing(false)}
                        className="hover:text-foreground text-muted-foreground p-0.5"
                        title="Done editing"
                    >
                        <Check className="h-2.5 w-2.5" />
                    </button>
                </div>
            ) : (
                <div className="flex items-center gap-1 text-muted-foreground">
                    {displayName && displayName !== voiceId && (
                        <span className="text-foreground/90 font-normal">({displayName})</span>
                    )}
                    <button
                        type="button"
                        onClick={(e) => {
                            e.stopPropagation();
                            setIsEditing(true);
                        }}
                        className="hover:text-foreground p-0.5 rounded transition-colors"
                        title="Edit display name"
                    >
                        <Pencil className="h-2 w-2" />
                    </button>
                    <button
                        type="button"
                        onClick={(e) => {
                            e.stopPropagation();
                            handleCheck(false);
                        }}
                        disabled={saving}
                        className="hover:text-rose-400 p-0.5 rounded transition-colors ml-0.5"
                        title="Remove from catalog"
                    >
                        <X className="h-2.5 w-2.5" />
                    </button>
                </div>
            )}
        </div>
    );
}
