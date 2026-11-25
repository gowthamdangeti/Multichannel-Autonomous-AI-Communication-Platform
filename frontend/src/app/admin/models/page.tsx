"use client";

import { Pencil, Plus, Star, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import {
    deleteModelConfigPresetApiV1AdminModelConfigurationsConfigIdDelete,
    listModelConfigPresetsApiV1AdminModelConfigurationsGet,
} from "@/client/sdk.gen";
import type { ModelConfigPresetResponse } from "@/client/types.gen";
import { PageFilterSelect } from "@/components/layout/PageFilterSelect";
import { PageSearchInput } from "@/components/layout/PageSearchInput";
import { RowAction, RowActionSeparator, RowActionsMenu } from "@/components/layout/RowActionsMenu";
import { SortableTableHead } from "@/components/layout/SortableTableHead";
import { TableCellLink } from "@/components/layout/TableCellLink";
import { TablePagination } from "@/components/layout/TablePagination";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getLanguageNameAndCountry } from "@/constants/languages";
import { PageHeader } from "@/context/HeaderContext";
import { usePagination } from "@/hooks/usePagination";
import { useTableSort } from "@/hooks/useTableSort";
import { detailFromError } from "@/lib/apiError";
import { useAuth } from "@/lib/auth";
import { ACTIVE_FILTER_OPTIONS, ALL_FILTER, filterBySearch,matchesFilter, toActiveValue, toFilterOptions } from "@/lib/searchFilter";
import { resolveVoiceGender } from "@/lib/voiceMetadata";

function getModeString(config: Record<string, unknown> | null): string {
    if (!config) return "—";
    if (config.mode === "byok") {
        const byok = config.byok as Record<string, unknown>;
        return byok?.mode === "realtime" ? "Speech to Speech" : "Bring Your Own Key";
    }
    if (config.mode === "convozent") return "Legacy Managed";
    if (config.mode === "realtime") return "Speech to Speech";
    return String(config.mode || "—");
}

function asRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : null;
}

interface PresetVoiceInfo {
    /** Segment whose `voice` names the speaker (TTS for pipelines, realtime for S2S). */
    voiceSegment: Record<string, unknown> | null;
    /** Segments to read `language` from, most specific first. */
    languageSegments: (Record<string, unknown> | null)[];
}

// Configurations are stored in two shapes:
//   v2 byok: { mode: "byok", byok: { mode: "pipeline", pipeline: { llm, tts, stt } } }
//            { mode: "byok", byok: { mode: "realtime", realtime: { realtime, llm } } }
//   legacy:  { mode: "realtime"|"convozent", realtime: {...}, tts: {...}, stt: {...} }
function getPresetVoiceInfo(config: Record<string, unknown> | null): PresetVoiceInfo {
    const empty: PresetVoiceInfo = { voiceSegment: null, languageSegments: [] };
    if (!config) return empty;

    const pipelineSegments = (container: Record<string, unknown>): PresetVoiceInfo => {
        const tts = asRecord(container.tts);
        const stt = asRecord(container.stt);
        return { voiceSegment: tts, languageSegments: [tts, stt] };
    };

    if (config.mode === "byok") {
        const byok = asRecord(config.byok);
        if (!byok) return empty;

        const pipeline = asRecord(byok.pipeline);
        if (pipeline) return pipelineSegments(pipeline);

        const realtime = asRecord(byok.realtime);
        if (realtime) {
            // v2 nests the realtime model config one level deeper; v1 kept it flat.
            const segment = asRecord(realtime.realtime) ?? realtime;
            return { voiceSegment: segment, languageSegments: [segment, asRecord(realtime.llm)] };
        }
        // Legacy flat byok container.
        return pipelineSegments(byok);
    }

    const realtime = asRecord(config.realtime);
    if (config.is_realtime || realtime) {
        return { voiceSegment: realtime, languageSegments: [realtime] };
    }
    return pipelineSegments(config);
}

function getPresetLanguage(config: Record<string, unknown> | null): string {
    const rawLang = getPresetVoiceInfo(config).languageSegments
        .map((segment) => segment?.language)
        .find((value): value is string => typeof value === "string" && value.length > 0);
    if (!rawLang) return "—";
    const info = getLanguageNameAndCountry(rawLang);
    return info.countryCode ? `${info.name} (${info.countryCode})` : info.name;
}

function getPresetGender(config: Record<string, unknown> | null): string {
    const segment = getPresetVoiceInfo(config).voiceSegment;
    const voice = segment?.voice;
    // Prefer the gender saved with the config (needed for custom voice IDs).
    const saved = typeof segment?.gender === "string" && segment.gender ? segment.gender : null;
    if (!saved && (typeof voice !== "string" || !voice)) return "—";
    const provider = typeof segment?.provider === "string" ? segment.provider : null;
    const resolved = saved || resolveVoiceGender(voice as string, null, provider);
    if (!resolved) return "—";
    return resolved.charAt(0).toUpperCase() + resolved.slice(1).toLowerCase();
}

type PresetConfig = Record<string, unknown> | null;

/** Value each sortable column sorts by. */
const PRESET_SORT_ACCESSORS = {
    id: (p: ModelConfigPresetResponse) => p.id,
    name: (p: ModelConfigPresetResponse) => p.name,
    mode: (p: ModelConfigPresetResponse) => getModeString(p.config as PresetConfig),
    language: (p: ModelConfigPresetResponse) => getPresetLanguage(p.config as PresetConfig),
    gender: (p: ModelConfigPresetResponse) => getPresetGender(p.config as PresetConfig),
    is_default: (p: ModelConfigPresetResponse) => p.is_default,
    is_active: (p: ModelConfigPresetResponse) => p.is_active,
};
type PresetSortKey = keyof typeof PRESET_SORT_ACCESSORS;

export default function AdminModelsPage() {
    const router = useRouter();
    const { user, loading: authLoading, getAccessToken } = useAuth();
    const hasFetched = useRef(false);

    const authHeaders = useCallback(async (): Promise<Record<string, string>> => {
        const token = await getAccessToken();
        return token ? { Authorization: `Bearer ${token}` } : {};
    }, [getAccessToken]);

    const [presets, setPresets] = useState<ModelConfigPresetResponse[]>([]);
    const [searchQuery, setSearchQuery] = useState("");
    const [statusFilter, setStatusFilter] = useState(ALL_FILTER);
    const [typeFilter, setTypeFilter] = useState(ALL_FILTER);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const fetchPresets = useCallback(async () => {
        const res = await listModelConfigPresetsApiV1AdminModelConfigurationsGet({
            headers: await authHeaders(),
        });
        if (res.error) {
            setError(detailFromError(res.error, "Failed to load configurations"));
            return;
        }
        setPresets(res.data ?? []);
    }, [authHeaders]);

    useEffect(() => {
        if (authLoading || !user || hasFetched.current) return;
        hasFetched.current = true;
        (async () => {
            setLoading(true);
            await fetchPresets();
            setLoading(false);
        })();
    }, [authLoading, user, fetchPresets]);

    const openCreate = () => {
        router.push("/admin/models/new");
    };

    const openEdit = (preset: ModelConfigPresetResponse) => {
        router.push(`/admin/models/${preset.id}`);
    };

    const removePreset = async (preset: ModelConfigPresetResponse) => {
        if (!confirm(`Delete configuration "${preset.name}"?`)) return;
        const res = await deleteModelConfigPresetApiV1AdminModelConfigurationsConfigIdDelete({
            path: { config_id: preset.id },
            headers: await authHeaders(),
        });
        if (res.error) {
            const err = detailFromError(res.error, "Failed to delete configuration");
            setError(err);
            toast.error(err);
            return;
        }
        toast.success(`Configuration "${preset.name}" deleted successfully`);
        await fetchPresets();
    };

    const filteredPresets = filterBySearch(presets, searchQuery, (p) => p.name).filter(
        (p) => matchesFilter(toActiveValue(p.is_active), statusFilter) && matchesFilter(getModeString(p.config), typeFilter),
    );
    // Header sorting (client-side; unsorted = server order).
    const { sortedItems: visiblePresets, sortKey, sortDir, toggleSort } = useTableSort<ModelConfigPresetResponse, PresetSortKey>(
        filteredPresets,
        PRESET_SORT_ACCESSORS,
    );
    const sortProps = { sortKey, sortDir, onSort: toggleSort };
    const presetPagination = usePagination(visiblePresets);

    if (loading) {
        return (
            <div className="w-full px-4 lg:px-6 pt-0 pb-4 space-y-2">
                <Skeleton className="h-10 w-80" />
                <Skeleton className="h-40 w-full" />
            </div>
        );
    }

    return (
        <div className="space-y-4 flex flex-col h-full pt-0 pb-6">
            <PageHeader
                title="Model Configurations"
                subtitle="Create named configurations (e.g. &quot;English Sarvam India&quot;). Organizations pick one by name when creating an agent — they never see providers or keys."
                onRefresh={() => void fetchPresets()}
                isRefreshing={loading}
                primaryAction={<Button onClick={openCreate}>
                        <Plus className="h-4 w-4 mr-1" /> New Configuration
                    </Button>}
                toolbar={
                    <>
                        <PageSearchInput placeholder="Search configurations..." value={searchQuery} onChange={setSearchQuery} />
                        <PageFilterSelect allLabel="All statuses" value={statusFilter} options={ACTIVE_FILTER_OPTIONS} onChange={setStatusFilter} />
                        <PageFilterSelect allLabel="All types" value={typeFilter} options={toFilterOptions(presets, (p) => getModeString(p.config), (mode) => mode)} onChange={setTypeFilter} />
                    </>
                }
            />

            {error && (
                <div className="mb-2 rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive shrink-0">
                    {error}
                </div>
            )}

            {presets.length === 0 ? (
                <p className="text-sm text-muted-foreground mt-1">No configurations yet. Create one to get started.</p>
            ) : (
                <Card className="mt-1 w-full">
                    <CardContent className="p-0 overflow-hidden">
                        <Table>
                            <TableHeader className="bg-muted/50">
                                <TableRow>
                                    <SortableTableHead column="id" label="ID" {...sortProps} />
                                    <SortableTableHead column="name" label="Name" {...sortProps} />
                                    <SortableTableHead column="mode" label="Mode" {...sortProps} />
                                    <SortableTableHead column="language" label="Language" {...sortProps} />
                                    <SortableTableHead column="gender" label="Gender" {...sortProps} />
                                    <SortableTableHead column="is_default" label="Default" {...sortProps} />
                                    <SortableTableHead column="is_active" label="Status" {...sortProps} />
                                    <TableHead className="font-semibold text-muted-foreground w-[100px] text-right">Actions</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {presetPagination.pageItems.map((p) => (
                                    <TableRow key={p.id} className="hover:bg-accent/50 transition-colors">
                                        <TableCell className="text-muted-foreground font-mono text-xs">
                                            #{p.id}
                                        </TableCell>
                                        <TableCell>
                                            <TableCellLink href={`/admin/models/${p.id}`}>{p.name}</TableCellLink>
                                        </TableCell>
                                        <TableCell className="text-foreground text-xs whitespace-nowrap font-medium">
                                            {getModeString(p.config as Record<string, unknown> | null)}
                                        </TableCell>
                                        <TableCell className="text-foreground text-xs whitespace-nowrap font-medium">
                                            {getPresetLanguage(p.config as Record<string, unknown> | null)}
                                        </TableCell>
                                        <TableCell className="text-foreground text-xs whitespace-nowrap font-medium">
                                            {getPresetGender(p.config as Record<string, unknown> | null)}
                                        </TableCell>
                                        <TableCell>
                                            {p.is_default ? (
                                                <Badge
                                                    variant="purple"
                                                    className="gap-1 font-medium"
                                                >
                                                    <Star className="h-3 w-3 fill-current text-purple-600 dark:text-purple-300" /> Default
                                                </Badge>
                                            ) : (
                                                <span className="text-muted-foreground text-xs">—</span>
                                            )}
                                        </TableCell>
                                        <TableCell>
                                            {p.is_active ? (
                                                <Badge variant="success" className="font-medium">Active</Badge>
                                            ) : (
                                                <Badge variant="secondary" className="font-medium">Inactive</Badge>
                                            )}
                                        </TableCell>
                                        <TableCell className="text-right">
                                            <RowActionsMenu label={`Actions for ${p.name}`}>
                                                <RowAction icon={<Pencil />} onClick={() => openEdit(p)}>Edit</RowAction>
                                                <RowActionSeparator />
                                                <RowAction icon={<Trash2 />} onClick={() => removePreset(p)} destructive>Delete</RowAction>
                                            </RowActionsMenu>
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                        <TablePagination {...presetPagination} />
                    </CardContent>
                </Card>
            )}
        </div>
    );
}
