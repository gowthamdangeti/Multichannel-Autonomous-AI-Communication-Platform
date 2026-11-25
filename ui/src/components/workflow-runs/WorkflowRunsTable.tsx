"use client";

import { ArrowDown, ArrowUp, ArrowUpDown, ExternalLink, RefreshCw, Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { type ReactNode, useState } from "react";

import { WorkflowRunResponseSchema } from "@/client/types.gen";
import { CallTypeCell } from "@/components/CallTypeCell";
import { FilterBuilder } from "@/components/filters/FilterBuilder";
import { RowAction, RowActionsMenu } from "@/components/layout/RowActionsMenu";
import { TableNameLink } from "@/components/layout/TableNameLink";
import { MediaPreviewDialog } from "@/components/MediaPreviewDialog";
import { ReportViewerDialog } from "@/components/ReportViewerDialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
    Pagination,
    PaginationContent,
    PaginationEllipsis,
    PaginationItem,
    PaginationLink,
    PaginationNext,
    PaginationPrevious,
} from "@/components/ui/pagination";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { DispositionBadge, RunStatusBadge } from "@/components/workflow-runs/RunBadges";
import { RunColumnsMenu } from "@/components/workflow-runs/RunColumnsMenu";
import { RunMediaAction, RunReportAction } from "@/components/workflow-runs/RunRowActions";
import { type RunColumnOption, useRunColumns } from "@/components/workflow-runs/useRunColumns";
import { displayConversationTitle } from "@/lib/conversationDisplay";
import { formatKeyLabel } from "@/lib/formatLabel";
import { getPageNumbers } from "@/lib/pagination";
import { ActiveFilter, FilterAttribute } from "@/types/filters";

type ContextSource = "initial_context" | "gathered_context";

interface ContextColumn {
    source: ContextSource;
    key: string;
}

const PHONE_NUMBER_KEYS = ["phone_number", "called_number", "customer_phone_number", "caller_number"];

function formatContextValue(value: unknown): string {
    if (value === null || value === undefined) return "-";
    if (typeof value === "object") return JSON.stringify(value);
    return String(value);
}

function getPhoneNumber(run: WorkflowRunResponseSchema): string | null {
    for (const context of [run.initial_context, run.gathered_context]) {
        for (const key of PHONE_NUMBER_KEYS) {
            const value = context?.[key];
            if (typeof value === "string" && value) return value;
        }
    }
    return null;
}

function getContextColumns(runs: WorkflowRunResponseSchema[]): ContextColumn[] {
    return (["initial_context", "gathered_context"] as const).flatMap((source) => {
        const keys = new Set<string>();
        runs.forEach((run) => {
            Object.keys(run[source] ?? {}).forEach((key) => keys.add(key));
        });
        return [...keys]
            .sort((left, right) => left.localeCompare(right))
            .map((key) => ({ source, key }));
    });
}

/** Voice conversations table order; the first seven are shown by default. */
const VOICE_COLUMN_ORDER = ["id", "conversation", "callType", "phone", "disposition", "date", "duration", "tokens", "status"];
const VOICE_DEFAULT_COLUMNS = ["id", "conversation", "callType", "phone", "disposition", "date", "duration"];
/** Original order, every column shown, for the pages that keep the classic table. */
const CLASSIC_COLUMN_ORDER = ["id", "conversation", "status", "date", "phone", "callType", "duration", "disposition"];

interface RunColumn extends RunColumnOption {
    head: ReactNode;
    cell: (run: WorkflowRunResponseSchema) => ReactNode;
    headClassName?: string;
    cellClassName?: string;
    cellTitle?: (run: WorkflowRunResponseSchema) => string | undefined;
}

export interface WorkflowRunsTableProps {
    // Data
    runs: WorkflowRunResponseSchema[];
    loading: boolean;
    error: string | null;

    // Pagination
    currentPage: number;
    totalPages: number;
    totalCount: number;
    onPageChange: (page: number) => void;

    // Filters
    availableAttributes: FilterAttribute[];
    activeFilters: ActiveFilter[];
    onFiltersChange: (filters: ActiveFilter[]) => void;
    onApplyFilters: (filters?: ActiveFilter[]) => void;
    onClearFilters: () => void;
    isExecutingFilters: boolean;
    hasAppliedFilters?: boolean;

    // Sorting
    sortBy?: string | null;
    sortOrder?: 'asc' | 'desc';
    onSort?: (field: string) => void;

    // Navigation & Actions
    workflowId: number;

    // Reload
    onReload?: () => void;

    // Optional customization
    title?: string;
    subtitle?: string;
    showFilters?: boolean;
    emptyMessage?: string;
    showTitle?: boolean;
    /**
     * Put the filters (Templates + Filter) and reload in the list's own header
     * row, on the page background, with the table as the only card — the agent
     * view's Conversations layout. Default: the full filter card above the list.
     */
    filtersInHeader?: boolean;
    /**
     * "voiceConversations": the Voice conversations columns by default, with a
     * Customize Columns menu (status and call variables can be added) and search.
     * "classic" (default): every column in the original order.
     */
    columnPreset?: "classic" | "voiceConversations";
    /** Remembers the viewer's column choice in this browser (voiceConversations preset). */
    columnsStorageKey?: string;
    /** Where a run opens; lets a list add `?returnTo=` so Back comes back to it. */
    runHref?: (runId: number) => string;
}

export function WorkflowRunsTable({
    runs,
    loading,
    error,
    currentPage,
    totalPages,
    totalCount,
    onPageChange,
    availableAttributes,
    activeFilters,
    onFiltersChange,
    onApplyFilters,
    onClearFilters,
    isExecutingFilters,
    hasAppliedFilters = false,
    sortBy,
    sortOrder = 'desc',
    onSort,
    workflowId,
    onReload,
    title = "Workflow Run History",
    subtitle,
    showFilters = true,
    emptyMessage = "No workflow runs found",
    showTitle = true,
    filtersInHeader = false,
    columnPreset = "classic",
    columnsStorageKey,
    runHref = (runId: number) => `/usage/runs/${runId}`,
}: WorkflowRunsTableProps) {
    const router = useRouter();
    const [selectedRowId, setSelectedRowId] = useState<number | null>(null);
    const isVoicePreset = columnPreset === "voiceConversations";
    const columnState = useRunColumns(isVoicePreset ? columnsStorageKey : undefined, VOICE_DEFAULT_COLUMNS);
    const [searchQuery, setSearchQuery] = useState("");
    const contextColumns = getContextColumns(runs);

    // Media preview dialog
    const mediaPreview = MediaPreviewDialog();

    // Report viewer dialog
    const reportViewer = ReportViewerDialog();

    const formatDate = (dateString: string) => new Date(dateString).toLocaleString();

    const handleRowClick = (runId: number) => {
        router.push(runHref(runId));
    };

    const handleViewRun = (runId: number) => {
        router.push(runHref(runId));
    };

    const sortHead = (label: string, field: string) => {
        if (!onSort) return label;
        const active = sortBy === field;
        return (
            <button type="button" className="inline-flex items-center gap-1 hover:text-foreground cursor-pointer" onClick={() => onSort(field)}>
                {label}
                {active ? (
                    sortOrder === 'asc' ? <ArrowUp className="h-4 w-4" /> : <ArrowDown className="h-4 w-4" />
                ) : (
                    <ArrowUpDown className="h-4 w-4 text-muted-foreground" />
                )}
            </button>
        );
    };

    const baseColumns: Record<string, RunColumn> = {
        id: { id: "id", label: isVoicePreset ? "Run ID" : "ID", required: true, head: sortHead(isVoicePreset ? "Run ID" : "ID", "id"), cell: (run) => `#${run.id}`, cellClassName: "font-mono text-sm" },
        conversation: {
            id: "conversation", label: "Conversation", required: true, head: "Conversation",
            // A real link (underline on hover, opens in a new tab), like the other run tables.
            cell: (run) => <TableNameLink href={runHref(run.id)}>{displayConversationTitle(run)}</TableNameLink>,
            cellClassName: "max-w-64 truncate text-sm", cellTitle: (run) => displayConversationTitle(run),
        },
        callType: { id: "callType", label: "Call Type", head: sortHead("Call Type", "callType"), cell: (run) => <CallTypeCell mode={run.mode} callType={run.call_type} /> },
        phone: {
            id: "phone", label: "Phone Number", head: "Phone Number", cellClassName: "text-sm whitespace-nowrap",
            cell: (run) => getPhoneNumber(run) ?? <span className="text-muted-foreground">-</span>,
        },
        disposition: {
            id: "disposition", label: "Disposition", head: sortHead("Disposition", "disposition"),
            cell: (run) => <DispositionBadge disposition={run.gathered_context?.mapped_call_disposition as string | undefined} />,
        },
        date: { id: "date", label: isVoicePreset ? "Date" : "Created At", head: sortHead(isVoicePreset ? "Date" : "Created At", "date"), cell: (run) => formatDate(run.created_at), cellClassName: "text-sm" },
        duration: {
            id: "duration", label: "Duration", head: sortHead("Duration", "duration"), cellClassName: "text-sm",
            cell: (run) => (typeof run.cost_info?.call_duration_seconds === 'number' ? `${run.cost_info.call_duration_seconds.toFixed(1)}s` : "-"),
        },
        tokens: {
            id: "tokens", label: "Token Usage", head: sortHead("Token Usage", "tokens"), cellClassName: "text-sm tabular-nums whitespace-nowrap",
            cell: (run) => (typeof run.cost_info?.convozent_token_usage === 'number' ? run.cost_info.convozent_token_usage.toLocaleString() : "-"),
            cellTitle: (run) => (typeof run.cost_info?.convozent_token_usage === 'number' ? run.cost_info.convozent_token_usage.toLocaleString() : undefined),
        },
        status: { id: "status", label: "Status", head: sortHead("Status", "status"), cell: (run) => <RunStatusBadge completed={Boolean(run.is_completed)} /> },
    };
    const variableColumns: RunColumn[] = contextColumns.map(({ source, key }) => {
        // Column named by the variable alone, as a label: "full_name" -> "Full Name".
        const label = formatKeyLabel(key);
        return {
            id: `ctx:${source}:${key}`, label, head: label, headClassName: "whitespace-nowrap", cellClassName: "max-w-64 truncate text-sm",
            cell: (run) => formatContextValue(run[source]?.[key]),
            cellTitle: (run) => formatContextValue(run[source]?.[key]),
        };
    });
    const allColumns: RunColumn[] = [
        ...(isVoicePreset ? VOICE_COLUMN_ORDER : CLASSIC_COLUMN_ORDER).map((id) => baseColumns[id]),
        ...variableColumns,
    ];
    const shownColumns = isVoicePreset
        ? allColumns.filter((column) => column.required || columnState.isVisible(column.id))
        : allColumns;

    // Search the loaded page, like Voice conversations: run ID, conversation, phone, disposition.
    const query = searchQuery.trim().toLowerCase();
    const shownRuns = query
        ? runs.filter((run) =>
            [String(run.id), displayConversationTitle(run), getPhoneNumber(run) ?? "", String(run.gathered_context?.mapped_call_disposition ?? "")]
                .some((value) => value.toLowerCase().includes(query)))
        : runs;

    const headerRow = (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
                <h3 className="text-sm font-semibold text-foreground">{title || "Runs"}</h3>
                <p className="text-xs text-muted-foreground">
                    {loading ? "Loading runs" : subtitle || `Showing ${runs.length} of ${totalCount} total runs`}
                </p>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2">
                {isVoicePreset && (
                    <div className="relative w-56">
                        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                        <Input
                            placeholder="Search runs..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="h-9 w-full pl-10 text-xs"
                        />
                    </div>
                )}
                {showFilters && (
                    <FilterBuilder
                        variant="toolbar"
                        availableAttributes={availableAttributes}
                        activeFilters={activeFilters}
                        onFiltersChange={onFiltersChange}
                        onApplyFilters={onApplyFilters}
                        onClearFilters={onClearFilters}
                        isExecuting={isExecutingFilters}
                        hasAppliedFilters={hasAppliedFilters}
                    />
                )}
                {isVoicePreset && (
                    <RunColumnsMenu
                        options={allColumns}
                        isVisible={columnState.isVisible}
                        onToggle={columnState.toggle}
                        onReset={columnState.reset}
                    />
                )}
                {onReload && (
                    <Button variant="outline" size="icon" className="h-9 w-9" onClick={onReload} disabled={loading} title="Reload">
                        <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
                    </Button>
                )}
            </div>
        </div>
    );

    const effectiveTotalPages = Math.max(1, totalPages);
    const displayCount = totalCount > 0 ? totalCount : runs.length;

    return (
        <div className={filtersInHeader ? "space-y-4" : "space-y-6"}>
            {/* Header row with the filters (header mode) — always shown, so filters stay reachable */}
            {filtersInHeader && headerRow}

            {/* Title and Filters */}
            {showFilters && !filtersInHeader && (
                <div className="mb-6">
                    {showTitle && <h1 className="text-2xl font-bold mb-4">{title}</h1>}
                    <FilterBuilder
                        availableAttributes={availableAttributes}
                        activeFilters={activeFilters}
                        onFiltersChange={onFiltersChange}
                        onApplyFilters={onApplyFilters}
                        onClearFilters={onClearFilters}
                        isExecuting={isExecutingFilters}
                        hasAppliedFilters={hasAppliedFilters}
                    />
                </div>
            )}

            {/* Loading State */}
            {loading ? (
                <div className="flex justify-center">
                    <div className="animate-pulse">Loading workflow runs...</div>
                </div>
            ) : error ? (
                <div className="bg-destructive/10 border border-destructive/30 text-destructive px-4 py-3 rounded">
                    {error}
                </div>
            ) : runs.length === 0 ? (
                <div className="text-center py-8">
                    <p className="text-muted-foreground">{emptyMessage}</p>
                </div>
            ) : (
                <Card className={filtersInHeader ? "border-0 bg-transparent p-0 shadow-none backdrop-blur-none" : undefined}>
                    {!filtersInHeader && (
                    <CardHeader>
                        <div className="flex items-center justify-between">
                            <div>
                                <CardTitle>Runs</CardTitle>
                                <CardDescription>
                                    {subtitle || `Showing ${runs.length} of ${totalCount} total runs`}
                                </CardDescription>
                            </div>
                            {onReload && (
                                <Button
                                    variant="outline"
                                    size="icon"
                                    onClick={onReload}
                                    disabled={loading}
                                    title="Reload"
                                >
                                    <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
                                </Button>
                            )}
                        </div>
                    </CardHeader>
                    )}
                    <CardContent className={filtersInHeader ? "p-0" : undefined}>
                        <div className={filtersInHeader ? "overflow-hidden rounded-[var(--radius-card)] border-[length:var(--surface-border-width)] border-border bg-card shadow-surface" : undefined}>
                            <div className="overflow-x-auto">
                                <Table className="min-w-max">
                                    <TableHeader>
                                        <TableRow className="bg-muted/50">
                                            {shownColumns.map((column) => (
                                                <TableHead key={column.id} className={`font-semibold ${column.headClassName ?? ""}`}>
                                                    {column.head}
                                                </TableHead>
                                            ))}
                                            <TableHead className="font-semibold text-right">Actions</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {shownRuns.length === 0 && (
                                            <TableRow>
                                                <TableCell colSpan={shownColumns.length + 1} className="py-8 text-center text-sm text-muted-foreground">
                                                    No runs match your search
                                                </TableCell>
                                            </TableRow>
                                        )}
                                        {shownRuns.map((run) => (
                                            <TableRow
                                                key={run.id}
                                                className={`cursor-pointer hover:bg-muted/50 ${selectedRowId === run.id ? "bg-primary/20 ring-1 ring-primary/50" : ""}`}
                                                onClick={() => handleRowClick(run.id)}
                                            >
                                                {shownColumns.map((column) => (
                                                    <TableCell key={column.id} className={column.cellClassName} title={column.cellTitle?.(run)}>
                                                        {column.cell(run)}
                                                    </TableCell>
                                                ))}
                                                <TableCell className="text-right">
                                                    <RowActionsMenu label={`Actions for run ${run.id}`}>
                                                        <RowAction icon={<ExternalLink />} onClick={() => handleViewRun(run.id)}>View run</RowAction>
                                                        <RunMediaAction
                                                            recordingUrl={run.recording_url}
                                                            fallbackRecordingUrl={run.user_recording_url ?? run.bot_recording_url}
                                                            transcriptUrl={run.transcript_url}
                                                            runId={run.id}
                                                            onOpenPreview={mediaPreview.openPreview}
                                                            onSelect={setSelectedRowId}
                                                        />
                                                        <RunReportAction
                                                            workflowId={workflowId}
                                                            runId={run.id}
                                                            agentName={
                                                                (run.initial_context?.agent_name as string) ||
                                                                (run.initial_context?.name as string) ||
                                                                (run.gathered_context?.agent_name as string) ||
                                                                run.name
                                                            }
                                                            hasReport={!!run.report_s3_key}
                                                            reportS3Key={run.report_s3_key ?? null}
                                                            reportVariables={
                                                                (run.gathered_context as
                                                                    | { report_variables?: Record<string, unknown> }
                                                                    | null
                                                                    | undefined)?.report_variables ?? null
                                                            }
                                                            reportStatus={(run.report_generation_status as "pending" | "processing" | "completed" | "failed" | null) ?? null}
                                                            onOpenPreview={reportViewer.openPreview}
                                                            onSelect={setSelectedRowId}
                                                        />
                                                    </RowActionsMenu>
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </div>

                            {/* Pagination */}
                            {(totalPages >= 1 || runs.length > 0) && (
                                <div className={filtersInHeader
                                    ? "flex flex-col sm:flex-row items-center justify-between gap-3 border-t border-border bg-muted/10 p-4 px-6"
                                    : "flex flex-col sm:flex-row items-center justify-between gap-3 p-4 px-6 -mx-6 -mb-6 mt-6 border-t border-border bg-muted/10"}>
                                    <p className="text-sm text-muted-foreground">
                                        Page {currentPage} of {effectiveTotalPages} ({displayCount} total {displayCount === 1 ? 'item' : 'items'})
                                    </p>
                                    <Pagination className="mx-0 w-auto justify-end">
                                        <PaginationContent>
                                            <PaginationItem>
                                                <PaginationPrevious
                                                    onClick={() => onPageChange(currentPage - 1)}
                                                    className={currentPage <= 1 ? 'pointer-events-none opacity-50' : 'cursor-pointer'}
                                                />
                                            </PaginationItem>
                                            {getPageNumbers(currentPage, effectiveTotalPages).map((p, idx) =>
                                                p === 'ellipsis' ? (
                                                    <PaginationItem key={`e-${idx}`}>
                                                        <PaginationEllipsis />
                                                    </PaginationItem>
                                                ) : (
                                                    <PaginationItem key={p}>
                                                        <PaginationLink
                                                            isActive={p === currentPage}
                                                            onClick={() => onPageChange(p)}
                                                            className="cursor-pointer"
                                                        >
                                                            {p}
                                                        </PaginationLink>
                                                    </PaginationItem>
                                                )
                                            )}
                                            <PaginationItem>
                                                <PaginationNext
                                                    onClick={() => onPageChange(currentPage + 1)}
                                                    className={currentPage >= effectiveTotalPages ? 'pointer-events-none opacity-50' : 'cursor-pointer'}
                                                />
                                            </PaginationItem>
                                        </PaginationContent>
                                    </Pagination>
                                </div>
                            )}
                        </div>
                    </CardContent>
                </Card>
            )}

            {/* Media Preview Dialog */}
            {mediaPreview.dialog}

            {/* Report Viewer Dialog */}
            {reportViewer.dialog}
        </div>
    );
}
