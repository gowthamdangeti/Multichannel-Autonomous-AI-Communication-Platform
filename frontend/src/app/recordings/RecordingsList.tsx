"use client";

import { ArrowDown, ArrowUp, ArrowUpDown, AudioLines, ExternalLink, Pause, Pencil, Play, Trash2, Upload } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import {
    deleteRecordingApiV1WorkflowRecordingsRecordingIdDelete,
    listRecordingsApiV1WorkflowRecordingsGet,
    updateRecordingApiV1WorkflowRecordingsIdPatch,
} from "@/client/sdk.gen";
import type { RecordingResponseSchema } from "@/client/types.gen";
import { PageSearchInput } from "@/components/layout/PageSearchInput";
import { RowAction, RowActionSeparator, RowActionsMenu } from "@/components/layout/RowActionsMenu";
import { TableCellLink } from "@/components/layout/TableCellLink";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Pagination, PaginationContent, PaginationEllipsis, PaginationItem, PaginationLink, PaginationNext, PaginationPrevious } from "@/components/ui/pagination";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { LANGUAGE_DISPLAY_NAMES } from "@/constants/languages";
import { PageHeader } from "@/context/HeaderContext";
import { useAudioPlayback } from "@/hooks/useAudioPlayback";
import logger from "@/lib/logger";

import { RecordingDetailsDrawer } from "./RecordingDetailsDrawer";

export default function RecordingsList({
    refreshKey,
    onUploadClick,
}: {
    refreshKey?: number;
    onUploadClick?: () => void;
}) {
    const [recordings, setRecordings] = useState<RecordingResponseSchema[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState("");
    const [error, setError] = useState<string | null>(null);

    // Edit Dialog state
    const [editingRecording, setEditingRecording] = useState<RecordingResponseSchema | null>(null);
    const [editValue, setEditValue] = useState("");
    const [editError, setEditError] = useState<string | null>(null);
    const [isSaving, setIsSaving] = useState(false);

    // Filter states
    const [selectedLanguage, setSelectedLanguage] = useState("all");
    const [selectedFileType, setSelectedFileType] = useState("all");

    // Drawer state
    const [drawerRecording, setDrawerRecording] = useState<RecordingResponseSchema | null>(null);
    const [drawerIsPlaying, setDrawerIsPlaying] = useState(false);
    const [initialPlay, setInitialPlay] = useState(false);
    const [toggleDrawerAudioTrigger, setToggleDrawerAudioTrigger] = useState(0);

    const { playingId, stop: stopPlayback } = useAudioPlayback();

    // Pagination state
    const [currentPage, setCurrentPage] = useState(1);

    useEffect(() => {
        setCurrentPage(1);
    }, [searchQuery, selectedLanguage, selectedFileType]);

    const fetchRecordings = useCallback(async () => {
        try {
            setIsLoading(true);
            setError(null);

            const response = await listRecordingsApiV1WorkflowRecordingsGet({
                query: {},
            });

            if (response.error || !response.data) {
                throw new Error("Failed to fetch recordings");
            }

            setRecordings(response.data.recordings);
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to fetch recordings");
            logger.error("Error fetching recordings:", err);
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchRecordings();
    }, [fetchRecordings, refreshKey]);

    const handleDelete = async (recordingId: string) => {
        if (!confirm("Are you sure you want to delete this recording?")) return;

        try {
            const response = await deleteRecordingApiV1WorkflowRecordingsRecordingIdDelete({
                path: { recording_id: recordingId },
            });

            if (response.error) {
                throw new Error("Failed to delete recording");
            }

            toast.success("Recording deleted");
            fetchRecordings();
        } catch (err) {
            toast.error(err instanceof Error ? err.message : "Failed to delete recording");
            logger.error("Error deleting recording:", err);
        }
    };


    const startEditing = (rec: RecordingResponseSchema) => {
        setEditingRecording(rec);
        setEditValue(rec.recording_id);
        setEditError(null);
    };

    const cancelEditing = () => {
        setEditingRecording(null);
        setEditValue("");
        setEditError(null);
    };

    const saveRecordingId = async (rec: RecordingResponseSchema) => {
        const newId = editValue.trim();
        if (!newId) {
            setEditError("ID cannot be empty");
            return;
        }
        if (!/^[a-zA-Z0-9_-]+$/.test(newId)) {
            setEditError("Only letters, numbers, hyphens, and underscores");
            return;
        }
        if (newId === rec.recording_id) {
            cancelEditing();
            return;
        }

        setEditError(null);
        setIsSaving(true);
        try {
            const response = await updateRecordingApiV1WorkflowRecordingsIdPatch({
                path: { id: rec.id },
                body: { recording_id: newId },
            });

            if (response.error) {
                const errData = response.error as { detail?: string };
                throw new Error(errData?.detail || "Failed to update recording ID");
            }

            toast.success(`Recording ID updated to "${newId}". All workflow references have been updated.`);
            cancelEditing();
            fetchRecordings();
        } catch (err) {
            setEditError(err instanceof Error ? err.message : "Failed to update recording ID");
        } finally {
            setIsSaving(false);
        }
    };

    const formatFileSize = (bytes?: number): string => {
        if (!bytes) return "—";
        if (bytes < 1024) return bytes + " B";
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
        return (bytes / (1024 * 1024)).toFixed(1) + " MB";
    };


    const handleRowClick = (rec: RecordingResponseSchema, e: React.MouseEvent) => {
        const target = e.target as HTMLElement;
        if (target.closest("button") || target.closest("input") || target.closest("[data-no-row-click]")) return;
        stopPlayback();
        setInitialPlay(false);
        setDrawerRecording(rec);
    };

    const uniqueLanguages = Array.from(
        new Set(
            recordings
                .map((rec) => (rec.metadata?.language as string) || "")
                .filter(Boolean)
        )
    );

    const uniqueFileTypes = Array.from(
        new Set(
            recordings
                .map((rec) => {
                    const filename = (rec.metadata?.original_filename as string) || "";
                    const lastDot = filename.lastIndexOf(".");
                    return lastDot !== -1 ? filename.substring(lastDot + 1).toUpperCase() : "";
                })
                .filter(Boolean)
        )
    );

    const filteredRecordings = recordings.filter((rec) => {
        // 1. Search Query
        if (searchQuery) {
            const q = searchQuery.toLowerCase();
            const filename = (rec.metadata?.original_filename as string) || "";
            const recordingName = filename.replace(/\.[^.]+$/, "");
            const matchesSearch =
                filename.toLowerCase().includes(q) ||
                recordingName.toLowerCase().includes(q) ||
                rec.recording_id.toLowerCase().includes(q) ||
                String(rec.id).includes(q);
            if (!matchesSearch) return false;
        }

        // 2. Language Filter
        if (selectedLanguage !== "all") {
            const lang = (rec.metadata?.language as string) || "";
            if (lang !== selectedLanguage) return false;
        }

        // 3. File Type Filter
        if (selectedFileType !== "all") {
            const filename = (rec.metadata?.original_filename as string) || "";
            const lastDot = filename.lastIndexOf(".");
            const fileType = lastDot !== -1 ? filename.substring(lastDot + 1).toUpperCase() : "";
            if (fileType !== selectedFileType) return false;
        }

        return true;
    });

    // Header sorting (client-side, current list only; null = server order).
    type RecordingSortKey = 'id' | 'name' | 'recording_id' | 'language' | 'file_size';
    const [sortKey, setSortKey] = useState<RecordingSortKey | null>(null);
    const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
    const toggleSort = (key: RecordingSortKey) => {
        if (sortKey !== key) {
            setSortKey(key);
            setSortDir('asc');
        } else if (sortDir === 'asc') {
            setSortDir('desc');
        } else {
            setSortKey(null);
            setSortDir('asc');
        }
        setCurrentPage(1);
    };
    const SortIcon = ({ column }: { column: RecordingSortKey }) => {
        if (sortKey !== column) return <ArrowUpDown className="h-3.5 w-3.5 text-muted-foreground/60" />;
        return sortDir === 'asc'
            ? <ArrowUp className="h-3.5 w-3.5 text-foreground" />
            : <ArrowDown className="h-3.5 w-3.5 text-foreground" />;
    };
    const recordingDisplayName = (rec: RecordingResponseSchema) => {
        const filename = (rec.metadata?.original_filename as string) || "";
        const lastDot = filename.lastIndexOf(".");
        return lastDot !== -1 ? filename.substring(0, lastDot) : filename;
    };
    const sortedRecordings = useMemo(() => {
        if (!sortKey) return filteredRecordings;
        const dir = sortDir === 'asc' ? 1 : -1;
        return [...filteredRecordings].sort((a, b) => {
            switch (sortKey) {
                case 'id':
                    return (a.id - b.id) * dir;
                case 'name':
                    return recordingDisplayName(a).localeCompare(recordingDisplayName(b)) * dir;
                case 'recording_id':
                    return (a.recording_id ?? '').localeCompare(b.recording_id ?? '') * dir;
                case 'language':
                    return (((a.metadata?.language as string) ?? '').localeCompare((b.metadata?.language as string) ?? '')) * dir;
                case 'file_size':
                    return (((a.metadata?.file_size_bytes as number) ?? 0) - ((b.metadata?.file_size_bytes as number) ?? 0)) * dir;
            }
        });
    }, [filteredRecordings, sortKey, sortDir]);

    const ITEMS_PER_PAGE = 8;
    const totalCount = sortedRecordings.length;
    const totalPages = Math.ceil(totalCount / ITEMS_PER_PAGE);
    const activePage = Math.min(currentPage, Math.max(1, totalPages));
    const paginatedRecordings = sortedRecordings.slice(
        (activePage - 1) * ITEMS_PER_PAGE,
        activePage * ITEMS_PER_PAGE
    );

    if (isLoading && recordings.length === 0) {
        return (
            <div className="space-y-4">
                {[1, 2, 3].map((i) => (
                    <div key={i} className="flex items-center justify-between p-4 border rounded-lg">
                        <div className="space-y-2 flex-1">
                            <Skeleton className="h-4 w-48" />
                            <Skeleton className="h-3 w-64" />
                        </div>
                        <Skeleton className="h-8 w-24" />
                    </div>
                ))}
            </div>
        );
    }

    if (error) {
        return (
            <div className="p-4 bg-destructive/10 border border-destructive/20 rounded-lg text-destructive">
                {error}
            </div>
        );
    }

    return (
        <div className="space-y-4">
            <PageHeader
                title="Recordings"
                subtitle={
                    <span>
                        Manage audio recordings for your organization.{" "}
                        <a href="https://docs.convozent.ai/voice-agent/pre-recorded-audio" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 underline">
                            Learn more <ExternalLink className="h-3 w-3" />
                        </a>
                    </span>
                }
                onRefresh={() => { stopPlayback(); void fetchRecordings(); }}
                isRefreshing={isLoading}
                primaryAction={onUploadClick && (
                    <Button onClick={onUploadClick}>
                        <Upload className="w-4 h-4 mr-2" />
                        Upload Recording
                    </Button>
                )}
                toolbar={<>
                        <PageSearchInput placeholder="Search recordings..." value={searchQuery} onChange={setSearchQuery} />
                        {/* Language filter */}
                        <Select value={selectedLanguage} onValueChange={setSelectedLanguage}>
                            <SelectTrigger className="w-[140px] shrink-0">
                                <SelectValue placeholder="Language" />
                            </SelectTrigger>
                            <SelectContent className="max-h-[220px]">
                                <SelectItem value="all">All Languages</SelectItem>
                                {uniqueLanguages.map((langCode) => {
                                    const name = LANGUAGE_DISPLAY_NAMES[langCode as keyof typeof LANGUAGE_DISPLAY_NAMES] || langCode;
                                    return (
                                        <SelectItem key={langCode} value={langCode}>
                                            {name}
                                        </SelectItem>
                                    );
                                })}
                            </SelectContent>
                        </Select>

                        {/* File Type filter */}
                        <Select value={selectedFileType} onValueChange={setSelectedFileType}>
                            <SelectTrigger className="w-[140px] shrink-0">
                                <SelectValue placeholder="File Type" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">All Types</SelectItem>
                                {uniqueFileTypes.map((type) => (
                                    <SelectItem key={type} value={type}>
                                        {type}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </>}
            />

            <div className="mt-4">

            {/* Recordings List */}
            <Card className="overflow-hidden">
                <CardContent className="p-0">
                    {filteredRecordings.length === 0 ? (
                        <div className="text-center py-12">
                            <AudioLines className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
                            <p className="text-muted-foreground">
                                {searchQuery || selectedLanguage !== "all" || selectedFileType !== "all"
                                    ? "No recordings match your filters"
                                    : "No recordings yet"}
                            </p>
                        </div>
                    ) : (
                        <>
                            <div className="relative w-full overflow-auto">
                            <table className="w-full caption-bottom text-sm">
                                <thead className="[&_tr]:border-b border-border">
                                    <tr className="border-b border-border transition-colors hover:bg-muted/50 data-[state=selected]:bg-muted">
                                        <th className="h-10 px-4 text-left align-middle font-medium text-muted-foreground">
                                            <button onClick={() => toggleSort('id')} className="inline-flex items-center gap-1 hover:text-foreground cursor-pointer" aria-label="Sort by ID">
                                                ID <SortIcon column="id" />
                                            </button>
                                        </th>
                                        <th className="h-10 px-4 text-left align-middle font-medium text-muted-foreground">
                                            <button onClick={() => toggleSort('name')} className="inline-flex items-center gap-1 hover:text-foreground cursor-pointer" aria-label="Sort by recording name">
                                                Recording Name <SortIcon column="name" />
                                            </button>
                                        </th>
                                        <th className="h-10 px-4 text-left align-middle font-medium text-muted-foreground">
                                            <button onClick={() => toggleSort('recording_id')} className="inline-flex items-center gap-1 hover:text-foreground cursor-pointer" aria-label="Sort by recording ID">
                                                Recording ID <SortIcon column="recording_id" />
                                            </button>
                                        </th>
                                        <th className="h-10 px-4 text-left align-middle font-medium text-muted-foreground">
                                            <button onClick={() => toggleSort('language')} className="inline-flex items-center gap-1 hover:text-foreground cursor-pointer" aria-label="Sort by language">
                                                Language <SortIcon column="language" />
                                            </button>
                                        </th>
                                        <th className="h-10 px-4 text-left align-middle font-medium text-muted-foreground">
                                            File Type
                                        </th>
                                        <th className="h-10 px-4 text-left align-middle font-medium text-muted-foreground">
                                            <button onClick={() => toggleSort('file_size')} className="inline-flex items-center gap-1 hover:text-foreground cursor-pointer" aria-label="Sort by file size">
                                                File Size <SortIcon column="file_size" />
                                            </button>
                                        </th>
                                        <th className="h-10 px-4 align-middle font-medium text-muted-foreground text-right">
                                            Actions
                                        </th>
                                    </tr>
                                </thead>
                                <tbody className="[&_tr:last-child]:border-0">
                                    {paginatedRecordings.map((rec) => {
                                        const originalFilename = (rec.metadata?.original_filename as string) || "—";
                                        const lastDotIndex = originalFilename.lastIndexOf(".");
                                        const recordingName = lastDotIndex !== -1 ? originalFilename.substring(0, lastDotIndex) : originalFilename;
                                        const fileType = lastDotIndex !== -1 ? originalFilename.substring(lastDotIndex + 1).toUpperCase() : "—";
                                        const fileSize = formatFileSize(rec.metadata?.file_size_bytes as number);
                                        const languageCode = (rec.metadata?.language as string) || "";
                                        const language = LANGUAGE_DISPLAY_NAMES[languageCode as keyof typeof LANGUAGE_DISPLAY_NAMES] || languageCode || "—";

                                        return (
                                            <tr
                                                key={rec.recording_id}
                                                className="border-b border-border transition-colors hover:bg-muted/50 data-[state=selected]:bg-muted cursor-pointer"
                                                onClick={(e) => handleRowClick(rec, e)}
                                            >
                                                <td className="p-4 align-middle text-muted-foreground font-mono text-xs">
                                                    #{rec.id}
                                                </td>
                                                <td className="p-4 align-middle font-medium max-w-xs truncate">
                                                    <div className="flex items-center gap-3">
                                                        <AudioLines className="w-4 h-4 text-primary shrink-0" />
                                                        <TableCellLink
                                                            title={recordingName}
                                                            onClick={() => {
                                                                stopPlayback();
                                                                setInitialPlay(false);
                                                                setDrawerRecording(rec);
                                                            }}
                                                        >
                                                            {recordingName}
                                                        </TableCellLink>
                                                    </div>
                                                </td>
                                                <td className="p-4 align-middle">
                                                    <code className="text-sm font-mono bg-muted px-1.5 py-0.5 rounded truncate max-w-[200px]">
                                                        {rec.recording_id}
                                                    </code>
                                                </td>
                                                <td className="p-4 align-middle text-foreground whitespace-nowrap text-xs">
                                                    {language}
                                                </td>
                                                <td className="p-4 align-middle text-foreground whitespace-nowrap text-xs font-mono">
                                                    {fileType}
                                                </td>
                                                <td className="p-4 align-middle text-foreground whitespace-nowrap text-xs font-mono">
                                                    {fileSize}
                                                </td>
                                                <td className="p-4 align-middle text-right">
                                                    <RowActionsMenu label={`Actions for ${rec.transcript || rec.recording_id}`}>
                                                        <RowAction icon={(playingId === rec.recording_id || (drawerRecording?.recording_id === rec.recording_id && drawerIsPlaying)) ? <Pause /> : <Play />} onClick={() => {
                                                                if (drawerRecording?.recording_id === rec.recording_id) {
                                                                    setToggleDrawerAudioTrigger((prev) => prev + 1);
                                                                } else {
                                                                    stopPlayback();
                                                                    setInitialPlay(true);
                                                                    setDrawerRecording(rec);
                                                                }
                                                            }}>{(playingId === rec.recording_id || (drawerRecording?.recording_id === rec.recording_id && drawerIsPlaying)) ? 'Pause' : 'Play'}</RowAction>
                                                        <RowAction icon={<Pencil />} onClick={() => startEditing(rec)}>Edit</RowAction>
                                                        <RowActionSeparator />
                                                        <RowAction icon={<Trash2 />} onClick={() => handleDelete(rec.recording_id)} destructive>Delete</RowAction>
                                                    </RowActionsMenu>
</td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                        {totalPages > 1 && (
                            <div className="flex items-center justify-between p-4 px-6 border-t border-border bg-muted/10">
                                <p className="text-sm text-muted-foreground">
                                    Page {activePage} of {totalPages} ({totalCount} total items)
                                </p>
                                <Pagination className="mx-0 w-auto justify-end">
                                    <PaginationContent>
                                        <PaginationItem>
                                            <PaginationPrevious
                                                onClick={() => setCurrentPage(activePage - 1)}
                                                className={activePage <= 1 ? 'pointer-events-none opacity-50' : 'cursor-pointer'}
                                            />
                                        </PaginationItem>
                                        {(() => {
                                            const pages: (number | 'ellipsis')[] = [];
                                            if (totalPages <= 7) {
                                                for (let i = 1; i <= totalPages; i++) pages.push(i);
                                            } else {
                                                pages.push(1);
                                                if (activePage > 3) pages.push('ellipsis');
                                                for (let i = Math.max(2, activePage - 1); i <= Math.min(totalPages - 1, activePage + 1); i++) {
                                                    pages.push(i);
                                                }
                                                if (activePage < totalPages - 2) pages.push('ellipsis');
                                                pages.push(totalPages);
                                            }
                                            return pages.map((p, idx) =>
                                                p === 'ellipsis' ? (
                                                    <PaginationItem key={`e-${idx}`}>
                                                        <PaginationEllipsis />
                                                    </PaginationItem>
                                                ) : (
                                                    <PaginationItem key={p}>
                                                        <PaginationLink
                                                            isActive={p === activePage}
                                                            onClick={() => setCurrentPage(p)}
                                                            className="cursor-pointer"
                                                        >
                                                            {p}
                                                        </PaginationLink>
                                                    </PaginationItem>
                                                )
                                            );
                                        })()}
                                        <PaginationItem>
                                            <PaginationNext
                                                onClick={() => setCurrentPage(activePage + 1)}
                                                className={activePage >= totalPages ? 'pointer-events-none opacity-50' : 'cursor-pointer'}
                                            />
                                        </PaginationItem>
                                    </PaginationContent>
                                </Pagination>
                            </div>
                        )}
                        </>
                    )}
                </CardContent>
            </Card>
            </div>

            {/* Recording Details Drawer */}
            <RecordingDetailsDrawer
                recording={drawerRecording}
                onOpenChange={(open) => {
                    if (!open) {
                        setDrawerRecording(null);
                        setInitialPlay(false);
                    }
                }}
                initialPlay={initialPlay}
                onPlayingStateChange={setDrawerIsPlaying}
                toggleAudioTrigger={toggleDrawerAudioTrigger}
            />

            {/* Edit Recording ID Dialog */}
            <Dialog open={editingRecording !== null} onOpenChange={(open) => { if (!open) cancelEditing(); }}>
                <DialogContent className="max-w-[360px] p-0 flex flex-col gap-0 border-0 shadow-lg sm:rounded-xl [&>button]:bg-muted/60 [&>button]:hover:bg-muted [&>button]:rounded-md [&>button]:h-7 [&>button]:w-7 [&>button]:flex [&>button]:items-center [&>button]:justify-center [&>button]:top-3.5 [&>button]:right-4 [&>button]:text-muted-foreground [&>button]:hover:text-foreground [&>button]:transition-colors [&>button>svg]:stroke-[2.5]">
                    <div className="flex flex-col gap-0.5 py-3.5 px-5 shrink-0 border-b">
                        <DialogTitle className="text-sm font-semibold text-foreground leading-tight">Edit Recording ID</DialogTitle>
                        <p className="text-xs text-muted-foreground truncate">Update the unique identifier for this audio recording</p>
                    </div>

                    <div className="p-5 flex flex-col gap-4">
                        <div className="space-y-1.5">
                            <label className="text-xs font-medium text-foreground">Recording ID</label>
                            <Input
                                value={editValue}
                                onChange={(e) => { setEditValue(e.target.value); setEditError(null); }}
                                onKeyDown={(e) => {
                                    if (e.key === "Enter" && editingRecording) saveRecordingId(editingRecording);
                                    if (e.key === "Escape") cancelEditing();
                                }}
                                className={`h-9 text-sm font-mono bg-background w-full ${editError ? "border-destructive focus-visible:ring-destructive" : ""}`}
                                maxLength={64}
                                autoFocus
                                disabled={isSaving}
                            />
                            {editError && (
                                <p className="text-[11px] text-destructive mt-1 font-medium">{editError}</p>
                            )}
                        </div>

                        {/* Metadata information below the recording ID section */}
                        {editingRecording && (
                            <div className="border rounded-lg bg-muted/20 p-3 space-y-2 mt-2">
                                <h4 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Recording Metadata</h4>
                                <div className="grid grid-cols-2 gap-2 text-xs">
                                    <div className="space-y-0.5">
                                        <span className="text-muted-foreground block">Original Filename:</span>
                                        <span className="font-medium text-foreground truncate block" title={(editingRecording.metadata?.original_filename as string) || "—"}>
                                            {(editingRecording.metadata?.original_filename as string) || "—"}
                                        </span>
                                    </div>
                                    <div className="space-y-0.5">
                                        <span className="text-muted-foreground block">Language:</span>
                                        <span className="font-medium text-foreground block">
                                            {(() => {
                                                const langCode = (editingRecording.metadata?.language as string) || "";
                                                return LANGUAGE_DISPLAY_NAMES[langCode as keyof typeof LANGUAGE_DISPLAY_NAMES] || langCode || "—";
                                            })()}
                                        </span>
                                    </div>
                                    <div className="space-y-0.5">
                                        <span className="text-muted-foreground block">File Type:</span>
                                        <span className="font-medium text-foreground block">
                                            {(() => {
                                                const filename = (editingRecording.metadata?.original_filename as string) || "";
                                                const dotIdx = filename.lastIndexOf(".");
                                                return dotIdx !== -1 ? filename.substring(dotIdx + 1).toUpperCase() : "—";
                                            })()}
                                        </span>
                                    </div>
                                    <div className="space-y-0.5">
                                        <span className="text-muted-foreground block">File Size:</span>
                                        <span className="font-medium text-foreground block">
                                            {formatFileSize(editingRecording.metadata?.file_size_bytes as number)}
                                        </span>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>

                    <div className="flex items-center justify-end gap-2 border-t p-3 bg-muted/20 shrink-0">
                        <Button
                            variant="outline"
                            size="sm"
                            className="h-8 text-xs font-medium"
                            onClick={cancelEditing}
                            disabled={isSaving}
                        >
                            Cancel
                        </Button>
                        <Button
                            size="sm"
                            className="h-8 text-xs font-medium px-4"
                            onClick={() => editingRecording && saveRecordingId(editingRecording)}
                            disabled={isSaving}
                        >
                            {isSaving ? "Saving..." : "Save"}
                        </Button>
                    </div>
                </DialogContent>
            </Dialog>
        </div>
    );
}
