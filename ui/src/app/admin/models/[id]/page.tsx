"use client";

import { Activity, Brain, Layers, Mic, Sliders, Volume2 } from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import {
    createModelConfigPresetApiV1AdminModelConfigurationsPost,
    getModelConfigurationV2DefaultsApiV1OrganizationsModelConfigurationsV2DefaultsGet,
    listModelConfigPresetsApiV1AdminModelConfigurationsGet,
    updateModelConfigPresetApiV1AdminModelConfigurationsConfigIdPatch,
} from "@/client/sdk.gen";
import type {
    ModelConfigPresetResponse,
    OrganizationAiModelConfigurationV2,
} from "@/client/types.gen";
import { AIModelConfigurationV2Editor, type ModelConfigurationDefaultsV2 } from "@/components/AIModelConfigurationV2Editor";
import { VoiceCatalogManager } from "@/components/autonomous_ai_os/VoiceCatalogManager";
import type { ServiceSegment } from "@/components/ServiceConfigurationForm";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { Textarea } from "@/components/ui/textarea";
import { type Breadcrumb, PageHeader } from "@/context/HeaderContext";
import { detailFromError } from "@/lib/apiError";
import { useAuth } from "@/lib/auth";

interface PresetForm {
    name: string;
    description: string;
    is_default: boolean;
    is_active: boolean;
}

const EMPTY_FORM: PresetForm = { name: "", description: "", is_default: false, is_active: true };

function getModelModeFromConfig(config: Record<string, unknown> | null): "sts" | "byok" {
    if (!config) return "sts";
    if (config.mode === "byok") {
        const byok = config.byok as Record<string, unknown> | undefined;
        if (byok?.mode === "realtime") return "sts";
        return "byok";
    }
    if (config.mode === "realtime" || config.is_realtime) return "sts";
    return "byok";
}

export default function AIModelConfigurationPage() {
    const router = useRouter();
    const params = useParams();
    const id = (params?.id as string) || "";

    const { user, loading: authLoading, getAccessToken } = useAuth();
    const hasFetched = useRef(false);

    const [defaults, setDefaults] = useState<ModelConfigurationDefaultsV2 | null>(null);
    const [loading, setLoading] = useState(true);
    const [editing, setEditing] = useState<ModelConfigPresetResponse | null>(null);
    const [form, setForm] = useState<PresetForm>(EMPTY_FORM);
    const [nameError, setNameError] = useState(false);

    const [modelMode, setModelMode] = useState<"sts" | "byok">("sts");

    // Sidebar navigation state. `serviceTab` is the last model section opened
    // (e.g. "byok:tts"); the editor keeps showing it while General is open.
    const [activeTab, setActiveTabState] = useState<string>("general");
    const [serviceTab, setServiceTab] = useState<string | null>(null);
    const setActiveTab = useCallback((tab: string) => {
        setActiveTabState(tab);
        if (tab.includes(":")) setServiceTab(tab);
    }, []);

    const breadcrumbs = useMemo<Breadcrumb[]>(
        () => [
            { label: "Models & Keys", href: "/admin/models" },
            { label: editing ? "Edit Configuration" : "New Configuration" },
        ],
        [editing],
    );

    const authHeaders = useCallback(async (): Promise<Record<string, string>> => {
        const token = await getAccessToken();
        return token ? { Authorization: `Bearer ${token}` } : {};
    }, [getAccessToken]);

    const fetchDefaults = useCallback(async () => {
        const res = await getModelConfigurationV2DefaultsApiV1OrganizationsModelConfigurationsV2DefaultsGet({
            headers: await authHeaders(),
        });
        if (res.error) {
            toast.error(detailFromError(res.error, "Failed to load defaults"));
            return;
        }
        setDefaults(res.data as ModelConfigurationDefaultsV2);
    }, [authHeaders]);

    const fetchPreset = useCallback(async () => {
        if (id === "new") return;
        const res = await listModelConfigPresetsApiV1AdminModelConfigurationsGet({
            headers: await authHeaders(),
        });
        if (res.error) {
            toast.error(detailFromError(res.error, "Failed to load configurations"));
            return;
        }
        const preset = (res.data ?? []).find(p => String(p.id) === id);
        if (preset) {
            setEditing(preset);
            const initialF = {
                name: preset.name,
                description: preset.description ?? "",
                is_default: preset.is_default,
                is_active: preset.is_active,
            };
            const config = preset.config as Record<string, unknown> | null;
            const mode = getModelModeFromConfig(config);
            setForm(initialF);
            setModelMode(mode);
        } else {
            toast.error("Configuration not found");
        }
    }, [id, authHeaders]);

    useEffect(() => {
        if (authLoading || !user || hasFetched.current) return;
        hasFetched.current = true;
        (async () => {
            setLoading(true);
            await Promise.all([fetchDefaults(), fetchPreset()]);
            setLoading(false);
        })();
    }, [authLoading, user, id, fetchDefaults, fetchPreset]);

    const savePreset = async (config: OrganizationAiModelConfigurationV2) => {
        if (!form.name.trim()) {
            setNameError(true);
            toast.error("Please give this configuration a display name.");
            setActiveTab("general");
            return;
        }
        try {
            if (editing) {
                const res = await updateModelConfigPresetApiV1AdminModelConfigurationsConfigIdPatch({
                    path: { config_id: editing.id },
                    body: { ...form, config },
                    headers: await authHeaders(),
                });
                if (res.error) throw new Error(detailFromError(res.error, "Failed to save configuration"));
                if (res.data) setEditing(res.data);
                toast.success("Configuration saved successfully");
                router.push("/admin/models");
            } else {
                const res = await createModelConfigPresetApiV1AdminModelConfigurationsPost({
                    body: { ...form, config },
                    headers: await authHeaders(),
                });
                if (res.error) throw new Error(detailFromError(res.error, "Failed to create configuration"));
                if (res.data) {
                    setEditing(res.data);
                    router.replace(`/admin/models/${res.data.id}`);
                }
                toast.success("Configuration created successfully");
                router.push("/admin/models");
            }
        } catch (err: unknown) {
            if (err instanceof Error) {
                toast.error(err.message);
            }
            throw err;
        }
    };

    if (loading) {
        return (
            <div className="space-y-4">
                <Skeleton className="h-10 w-80" />
                <Skeleton className="h-96 w-full" />
            </div>
        );
    }

    // Service segment of the last model section opened (e.g. "s2s:realtime" -> "realtime")
    const activeServiceSegment = serviceTab ? (serviceTab.split(":")[1] as ServiceSegment) : undefined;
    const isS2S = activeTab.startsWith("s2s");
    const isBYOK = activeTab.startsWith("byok");
    const isGeneral = activeTab === "general";

    const getNextTabInfo = (): { label: string; onNavigate: () => void } | undefined => {
        if (activeTab === "s2s:realtime") {
            return { label: "LLM", onNavigate: () => setActiveTab("s2s:llm") };
        }
        if (activeTab === "s2s:llm") {
            return { label: "Embedding", onNavigate: () => setActiveTab("s2s:embeddings") };
        }
        if (activeTab === "s2s:embeddings") {
            return undefined;
        }
        if (activeTab === "byok:stt") {
            return { label: "LLM", onNavigate: () => setActiveTab("byok:llm") };
        }
        if (activeTab === "byok:llm") {
            return { label: "Voice (TTS)", onNavigate: () => setActiveTab("byok:tts") };
        }
        if (activeTab === "byok:tts") {
            return { label: "Embedding", onNavigate: () => setActiveTab("byok:embeddings") };
        }
        if (activeTab === "byok:embeddings") {
            return undefined;
        }
        return undefined;
    };

    return (
        <div className="flex-1 w-full min-h-0 space-y-3 flex flex-col overflow-hidden px-4 lg:px-6 pt-2 pb-6">
            <PageHeader
                title={editing ? "Edit Configuration" : "New Configuration"}
                breadcrumbs={breadcrumbs}
            />


            <div className="flex flex-1 w-full min-h-0 gap-4 lg:gap-5 items-stretch">
                {/* Side Navigation Bar */}
                <div className="w-64 bg-card border border-border rounded-xl p-4 space-y-3 shrink-0 flex flex-col nb-secondary-sidebar">
                    {/* General Info */}
                    <button
                        type="button"
                        onClick={() => setActiveTab("general")}
                        className={`w-full flex items-center gap-2.5 h-8 px-3 py-1 text-sm transition-all duration-200 text-left cursor-pointer nb-secondary-nav-item ${activeTab === "general"
                            ? "nb-secondary-nav-active"
                            : ""
                            }`}
                    >
                        <Sliders className="h-4 w-4" />
                        <span>General Info</span>
                    </button>

                    {/* Speech to Speech (S2S) Section */}
                    {modelMode === "sts" && (
                        <>
                            <button
                                type="button"
                                onClick={() => setActiveTab("s2s:realtime")}
                                className={`w-full flex items-center gap-2.5 h-8 px-3 py-1 text-sm transition-all duration-200 text-left cursor-pointer nb-secondary-nav-item ${activeTab === "s2s:realtime" || activeTab === "s2s"
                                    ? "nb-secondary-nav-active"
                                    : ""
                                    }`}
                            >
                                <Activity className="h-4 w-4" />
                                <span>Realtime Model</span>
                            </button>
                            <button
                                type="button"
                                onClick={() => setActiveTab("s2s:llm")}
                                className={`w-full flex items-center gap-2.5 h-8 px-3 py-1 text-sm transition-all duration-200 text-left cursor-pointer nb-secondary-nav-item ${activeTab === "s2s:llm"
                                    ? "nb-secondary-nav-active"
                                    : ""
                                    }`}
                            >
                                <Brain className="h-4 w-4" />
                                <span>LLM</span>
                            </button>
                            <button
                                type="button"
                                onClick={() => setActiveTab("s2s:embeddings")}
                                className={`w-full flex items-center gap-2.5 h-8 px-3 py-1 text-sm transition-all duration-200 text-left cursor-pointer nb-secondary-nav-item ${activeTab === "s2s:embeddings"
                                    ? "nb-secondary-nav-active"
                                    : ""
                                    }`}
                            >
                                <Layers className="h-4 w-4" />
                                <span>Embedding</span>
                            </button>
                        </>
                    )}

                    {/* BYOK / API Keys Section */}
                    {modelMode === "byok" && (
                        <>
                            <button
                                type="button"
                                onClick={() => setActiveTab("byok:stt")}
                                className={`w-full flex items-center gap-2.5 h-8 px-3 py-1 text-sm transition-all duration-200 text-left cursor-pointer nb-secondary-nav-item ${activeTab === "byok:stt" || activeTab === "byok"
                                    ? "nb-secondary-nav-active"
                                    : ""
                                    }`}
                            >
                                <Mic className="h-4 w-4" />
                                <span>Speech to Text (STT)</span>
                            </button>
                            <button
                                type="button"
                                onClick={() => setActiveTab("byok:llm")}
                                className={`w-full flex items-center gap-2.5 h-8 px-3 py-1 text-sm transition-all duration-200 text-left cursor-pointer nb-secondary-nav-item ${activeTab === "byok:llm"
                                    ? "nb-secondary-nav-active"
                                    : ""
                                    }`}
                            >
                                <Brain className="h-4 w-4" />
                                <span>LLM</span>
                            </button>
                            <button
                                type="button"
                                onClick={() => setActiveTab("byok:tts")}
                                className={`w-full flex items-center gap-2.5 h-8 px-3 py-1 text-sm transition-all duration-200 text-left cursor-pointer nb-secondary-nav-item ${activeTab === "byok:tts"
                                    ? "nb-secondary-nav-active"
                                    : ""
                                    }`}
                            >
                                <Volume2 className="h-4 w-4" />
                                <span>Voice (TTS)</span>
                            </button>
                            <button
                                type="button"
                                onClick={() => setActiveTab("byok:embeddings")}
                                className={`w-full flex items-center gap-2.5 h-8 px-3 py-1 text-sm transition-all duration-200 text-left cursor-pointer nb-secondary-nav-item ${activeTab === "byok:embeddings"
                                    ? "nb-secondary-nav-active"
                                    : ""
                                    }`}
                            >
                                <Layers className="h-4 w-4" />
                                <span>Embedding</span>
                            </button>
                        </>
                    )}

                    {/* Voice Catalog Section */}
                    {/* <button
                        type="button"
                        onClick={() => setActiveTab("voice-catalog")}
                        className={`w-full flex items-center gap-2.5 h-8 px-3 py-1 text-sm transition-all duration-200 text-left cursor-pointer nb-secondary-nav-item ${activeTab === "voice-catalog"
                                ? "nb-secondary-nav-active"
                                : ""
                            }`}
                    >
                        <Volume2 className="h-4 w-4" />
                        <span>Voice Catalog</span>
                    </button> */}
                </div>

                {/* Right Main Content Panel */}
                <div data-slot="card" className="flex-1 w-full bg-card border border-border rounded-xl p-6 shadow-sm overflow-y-auto flex flex-col">
                    {/* Sections stay mounted and are only hidden, so nothing typed is
                        lost when the user moves between General and the model sections. */}
                    <div className={isGeneral ? "flex-1 flex flex-col min-h-0" : "hidden"}>
                        <div className="space-y-6">
                            <div>
                                <h3 className="text-sm font-bold text-foreground mb-0.5">General Settings</h3>
                                <p className="text-xs text-muted-foreground">Basic display details and default settings for this configuration.</p>
                            </div>

                            <div className="space-y-4">
                                 <div className="space-y-1.5">
                                     <Label className="text-xs font-semibold flex items-center gap-1">
                                         <span>Display name (shown to org users)</span>
                                         <span className="text-red-500 font-bold">*</span>
                                     </Label>
                                     <Input
                                         placeholder="e.g. English Sarvam India"
                                         value={form.name}
                                         onChange={(e) => {
                                             setForm((f) => ({ ...f, name: e.target.value }));
                                             if (e.target.value.trim()) setNameError(false);
                                         }}
                                         className={nameError ? "border-red-500 focus-visible:ring-red-500" : ""}
                                     />
                                     {nameError && (
                                         <p className="text-xs text-red-500 font-medium mt-1">
                                             Display name is required.
                                         </p>
                                     )}
                                 </div>

                                <div className="space-y-1.5">
                                    <Label className="text-xs font-semibold">Description (optional)</Label>
                                    <Textarea
                                        minRows={3}
                                        maxRows={6}
                                        placeholder="e.g. Optimized for Indian English voice workflows"
                                        value={form.description}
                                        onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                                        className="text-xs"
                                    />
                                </div>

                                <div className="space-y-1.5">
                                    <Label className="text-xs font-semibold">Configuration Type</Label>
                                    <Select value={modelMode} onValueChange={(val) => setModelMode(val as "sts" | "byok")}>
                                        <SelectTrigger>
                                            <SelectValue placeholder="Select type" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="sts">Speech to Speech (STS)</SelectItem>
                                            <SelectItem value="byok">Bring Your Own Key (BYOK)</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>

                                <div className="space-y-3 pt-2">
                                    <label className="flex items-center gap-2.5 text-xs font-medium cursor-pointer">
                                        <Checkbox
                                            checked={form.is_default}
                                            onCheckedChange={(c) => setForm((f) => ({ ...f, is_default: Boolean(c) }))}
                                        />
                                        Default (used when an agent has no selection)
                                    </label>
                                    <label className="flex items-center gap-2.5 text-xs font-medium cursor-pointer">
                                        <Checkbox
                                            checked={form.is_active}
                                            onCheckedChange={(c) => setForm((f) => ({ ...f, is_active: Boolean(c) }))}
                                        />
                                        Active (available for organizations to pick)
                                    </label>
                                </div>
                            </div>
                        </div>

                        <div className="pt-4 pb-4 border-t border-border flex items-center justify-between mt-auto shrink-0">
                            <p className="text-xs text-muted-foreground">
                                Proceed to <strong className="text-foreground">{modelMode === "sts" ? "Speech to Speech (S2S)" : "BYOK"}</strong> model settings to complete configuration.
                            </p>
                            <Button
                                size="sm"
                                className="cursor-pointer"
                                onClick={() => {
                                    if (!form.name.trim()) {
                                        setNameError(true);
                                        toast.error("Please give this configuration a display name.");
                                        return;
                                    }
                                    setNameError(false);
                                    setActiveTab(modelMode === "sts" ? "s2s:realtime" : "byok:stt");
                                }}
                            >
                                {modelMode === "sts" ? "Next: Realtime Model →" : "Next: Transcriber (STT) →"}
                            </Button>
                        </div>
                    </div>

                    <div className={isS2S || isBYOK ? "flex-1 flex flex-col min-h-0" : "hidden"}>
                        {defaults ? (
                            <AIModelConfigurationV2Editor
                                defaults={defaults}
                                configuration={editing?.config ?? null}
                                effectiveConfiguration={null}
                                onSave={savePreset}
                                onCancel={() => router.push("/admin/models")}
                                forcedMode={modelMode === "sts" ? "realtime" : "byok"}
                                hideTabList={true}
                                activeServiceSegment={activeServiceSegment}
                                hideServiceTabs={true}
                                nextTab={getNextTabInfo()}
                                enableVoicePreview
                                voicePreviewModelConfigurationId={editing?.id}
                            />
                        ) : (
                            <div className="p-8 text-center text-sm text-muted-foreground">
                                Loading configuration defaults...
                            </div>
                        )}
                    </div>

                    {activeTab === "voice-catalog" && (
                        <div className="flex-1 flex flex-col min-h-0">
                            <VoiceCatalogManager />
                        </div>
                    )}

                </div>
            </div>
        </div>
    );
}
