"use client";

import {
    ArrowDown,
    ArrowLeft,
    ArrowUp,
    ArrowUpDown,
    ArrowUpRight,
    Calendar,
    CheckSquare,
    Filter,
    Hash,
    Pencil,
    Phone,
    Radio,
    RefreshCw,
    Search,
    Tag,
    X,
} from "lucide-react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import React, { useCallback, useEffect, useMemo, useState } from "react";

import {
    getUsageHistoryApiV1OrganizationsUsageRunsGet,
    getWorkflowApiV1WorkflowFetchWorkflowIdGet,
} from "@/client/sdk.gen";
import type { WorkflowResponse, WorkflowRunUsageResponse } from "@/client/types.gen";
import { AgentAnalyticsTab } from "@/components/agent-view/AgentAnalyticsTab";
import { AgentDashboardTab } from "@/components/agent-view/AgentDashboardTab";
import { AGENT_TAB_LABELS, AgentHeaderCard, type AgentTab } from "@/components/agent-view/AgentHeaderCard";
import { AgentNodesTable } from "@/components/agent-view/AgentNodesTable";
import { useAgentAnalytics } from "@/components/agent-view/hooks/useAgentAnalytics";
import { CallTypeCell } from "@/components/CallTypeCell";
import { AgentSelectFilter } from "@/components/filters/AgentSelectFilter";
import { DateRangeFilter } from "@/components/filters/DateRangeFilter";
import { FilterTemplatesMenu } from "@/components/filters/FilterTemplatesMenu";
import { MultiSelectFilter } from "@/components/filters/MultiSelectFilter";
import { NumberFilter } from "@/components/filters/NumberFilter";
import { NumberRangeFilter } from "@/components/filters/NumberRangeFilter";
import { RadioFilter } from "@/components/filters/RadioFilter";
import { TagInputFilter } from "@/components/filters/TagInputFilter";
import { TextFilter } from "@/components/filters/TextFilter";
import { RowAction, RowActionsMenu } from "@/components/layout/RowActionsMenu";
import { TableNameLink } from "@/components/layout/TableNameLink";
import { MediaPreviewDialog } from "@/components/MediaPreviewDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { DispositionBadge } from "@/components/workflow-runs/RunBadges";
import { RunMediaAction } from "@/components/workflow-runs/RunRowActions";
import { PageHeader } from "@/context/HeaderContext";
import { useAuth } from "@/lib/auth";
import { displayConversationTitle } from "@/lib/conversationDisplay";
import { DEFAULT_RANGE_DAYS } from "@/lib/dateRange";
import { workflowFilterAttributes } from "@/lib/filterAttributes";
import { formatDateRange, formatNumberRange, getDefaultValue, validateFilter } from "@/lib/filters";
import { withReturnTo } from "@/lib/returnTo";
import { cn } from "@/lib/utils";
import {
    ActiveFilter,
    DateRangeValue,
    FilterTemplate,
    FilterValue,
    MultiSelectValue,
    NumberRangeValue,
    NumberValue,
    RadioValue,
    TextValue,
} from "@/types/filters";

import { PhoneCallDialog } from "../components/PhoneCallDialog";

export default function ViewAgentPage() {
    const params = useParams();
    const router = useRouter();
    const searchParams = useSearchParams();
    const { isAuthenticated, user } = useAuth();

    const workflowId = params?.workflowId ? Number(params.workflowId) : null;

    const [isPhoneCallDialogOpen, setIsPhoneCallDialogOpen] = useState<boolean>(false);
    const [agentDetail, setAgentDetail] = useState<WorkflowResponse | null>(null);
    const [runs, setRuns] = useState<WorkflowRunUsageResponse[]>([]);
    const [totalCount, setTotalCount] = useState<number | null>(null);
    const [totalPages, setTotalPages] = useState<number>(1);
    const [currentPage, setCurrentPage] = useState<number>(() => {
        const pageParam = searchParams.get("page");
        return pageParam ? parseInt(pageParam, 10) : 1;
    });

    const [searchQuery, setSearchQuery] = useState<string>("");

    // Filter Popover & Attribute Filter State
    const [activeFilters, setActiveFilters] = useState<ActiveFilter[]>([]);
    const [appliedFilters, setAppliedFilters] = useState<ActiveFilter[]>([]);
    const [isExecutingFilters, setIsExecutingFilters] = useState<boolean>(false);
    const [popoverOpen, setPopoverOpen] = useState<boolean>(false);
    const [editingAttributeId, setEditingAttributeId] = useState<string | null>(null);

    // Which filter template is currently applied (null = custom/manual).
    // Shown in the Templates trigger so the selection is visible after click.
    const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);

    const addFilter = useCallback((attributeId: string) => {
        const attribute = workflowFilterAttributes.find((attr) => attr.id === attributeId);
        if (!attribute) return;

        const defaultValue = getDefaultValue(attribute.type);
        const newFilter: ActiveFilter = {
            attribute,
            value: defaultValue,
            isValid: validateFilter({ attribute, value: defaultValue, isValid: false }) === null,
        };

        setActiveFilters((prev) => [...prev, newFilter]);
    }, []);

    const updateFilter = useCallback((index: number, value: FilterValue) => {
        setActiveFilters((prev) => {
            const newFilters = [...prev];
            newFilters[index].value = value;
            newFilters[index].isValid = validateFilter(newFilters[index]) === null;
            return newFilters;
        });
    }, []);

    const handleApplyFilters = useCallback(() => {
        setIsExecutingFilters(true);
        setAppliedFilters([...activeFilters]);
        setSelectedTemplateId(null); // manual edit → no longer a template
        setPopoverOpen(false);
        setTimeout(() => {
            setIsExecutingFilters(false);
        }, 200);
    }, [activeFilters]);

    const handleClearFilters = useCallback(() => {
        setActiveFilters([]);
        setAppliedFilters([]);
        setSelectedTemplateId(null);
        setPopoverOpen(false);
        setEditingAttributeId(null);
    }, []);

    const handleRemoveFilterAndApply = useCallback((attributeId: string) => {
        setActiveFilters((prev) => prev.filter((f) => f.attribute.id !== attributeId));
        setAppliedFilters((prev) => prev.filter((f) => f.attribute.id !== attributeId));
        setSelectedTemplateId(null);
    }, []);

    const handlePopoverOpenChange = useCallback((open: boolean) => {
        setPopoverOpen(open);
        if (open) {
            setActiveFilters(appliedFilters);
        } else {
            setEditingAttributeId(null);
        }
    }, [appliedFilters]);

    const applyTemplate = useCallback((template: FilterTemplate) => {
        const newFilters: ActiveFilter[] = template.filters
            .map((filterConfig) => {
                const attribute = workflowFilterAttributes.find(
                    (attr) => attr.id === filterConfig.attributeId
                );
                if (!attribute) return null;
                return {
                    attribute,
                    value: filterConfig.value,
                    isValid: true,
                };
            })
            .filter((f): f is ActiveFilter => f !== null);

        setActiveFilters(newFilters);
        setAppliedFilters(newFilters);
        setSelectedTemplateId(template.id);
        setCurrentPage(1);
    }, []);

    const getFilterIcon = (type: ActiveFilter["attribute"]["type"]) => {
        switch (type) {
            case "dateRange":
                return <Calendar className="h-4 w-4" />;
            case "multiSelect":
                return <CheckSquare className="h-4 w-4" />;
            case "number":
            case "numberRange":
                return <Hash className="h-4 w-4" />;
            case "radio":
                return <Radio className="h-4 w-4" />;
            case "tags":
                return <Tag className="h-4 w-4" />;
            case "text":
                return <Hash className="h-4 w-4" />;
        }
    };

    const getFilterSummary = (filter: ActiveFilter): string => {
        switch (filter.attribute.type) {
            case "dateRange":
                return formatDateRange(filter.value as DateRangeValue);
            case "multiSelect": {
                const value = filter.value as MultiSelectValue;
                if (!value.codes || value.codes.length === 0) return "Any";
                if (value.codes.length <= 2) return value.codes.join(", ");
                return `${value.codes.slice(0, 2).join(", ")} +${value.codes.length - 2}`;
            }
            case "number": {
                const value = filter.value as NumberValue;
                return value.value !== null ? value.value.toString() : "Any";
            }
            case "numberRange":
                return formatNumberRange(filter.value as NumberRangeValue, filter.attribute.config.unit);
            case "radio": {
                const value = filter.value as RadioValue;
                const option = filter.attribute.config.radioOptions?.find((opt) => opt.value === value.status);
                return option?.label || value.status;
            }
            case "tags": {
                const value = filter.value as MultiSelectValue;
                if (!value.codes || value.codes.length === 0) return "Any";
                if (value.codes.length <= 2) return value.codes.join(", ");
                return `${value.codes.slice(0, 2).join(", ")} +${value.codes.length - 2}`;
            }
            case "text": {
                const value = filter.value as TextValue;
                return value.value || "Any";
            }
        }
    };

    const renderFilterInput = (filter: ActiveFilter, index: number) => {
        const error = filter.isValid ? undefined : validateFilter(filter) || undefined;

        switch (filter.attribute.type) {
            case "dateRange":
                return (
                    <DateRangeFilter
                        value={filter.value as DateRangeValue}
                        onChange={(value) => updateFilter(index, value)}
                        error={error}
                        presets={filter.attribute.config.datePresets}
                    />
                );
            case "multiSelect":
                if (filter.attribute.id === "workflowId") {
                    return (
                        <AgentSelectFilter
                            value={filter.value as MultiSelectValue}
                            onChange={(value) => updateFilter(index, value)}
                            error={error}
                        />
                    );
                }
                return (
                    <MultiSelectFilter
                        options={filter.attribute.config.options || []}
                        value={filter.value as MultiSelectValue}
                        onChange={(value) => updateFilter(index, value)}
                        error={error}
                        showSelectAll={filter.attribute.config.showSelectAll}
                        searchable={filter.attribute.config.searchable}
                    />
                );
            case "number":
                return (
                    <NumberFilter
                        value={filter.value as NumberValue}
                        onChange={(value) => updateFilter(index, value)}
                        error={error}
                        placeholder={filter.attribute.config.placeholder}
                        min={filter.attribute.config.min}
                        max={filter.attribute.config.max}
                        step={filter.attribute.config.step}
                    />
                );
            case "numberRange":
                return (
                    <NumberRangeFilter
                        value={filter.value as NumberRangeValue}
                        onChange={(value) => updateFilter(index, value)}
                        error={error}
                        unit={filter.attribute.config.unit}
                        min={filter.attribute.config.min}
                        max={filter.attribute.config.max}
                        step={filter.attribute.config.step}
                        presets={filter.attribute.config.numberPresets}
                    />
                );
            case "radio":
                return (
                    <RadioFilter
                        value={filter.value as RadioValue}
                        onChange={(value) => updateFilter(index, value)}
                        error={error}
                        options={filter.attribute.config.radioOptions || []}
                    />
                );
            case "tags":
                return (
                    <TagInputFilter
                        value={filter.value as MultiSelectValue}
                        onChange={(value) => updateFilter(index, value)}
                        error={error}
                    />
                );
            case "text":
                return (
                    <TextFilter
                        value={filter.value as TextValue}
                        onChange={(value) => updateFilter(index, value)}
                        error={error}
                        placeholder={filter.attribute.config.placeholder}
                        maxLength={filter.attribute.config.maxLength}
                    />
                );
        }
    };

    const [isLoading, setIsLoading] = useState<boolean>(true);
    const [activeTab, setActiveTab] = useState<AgentTab>(() => {
        const tab = searchParams.get("tab");
        if (tab && tab in AGENT_TAB_LABELS) return tab as AgentTab;
        return searchParams.get("page") ? "conversations" : "dashboard";
    });
    const [analyticsDays, setAnalyticsDays] = useState(DEFAULT_RANGE_DAYS);
    const {
        analytics,
        isLoading: isAnalyticsLoading,
        error: analyticsError,
        reload: reloadAnalytics,
    } = useAgentAnalytics(workflowId ?? 0, analyticsDays);
    const [error, setError] = useState<string | null>(null);

    const mediaPreview = MediaPreviewDialog();

    const loadData = useCallback(async (page: number, options?: { silent?: boolean }) => {
        if (!workflowId || !isAuthenticated) return;
        const silent = options?.silent ?? false;
        if (!silent) {
            setIsLoading(true);
            setError(null);
        }

        try {
            const filterPayload = JSON.stringify([
                {
                    attribute: "workflowId",
                    type: "multiSelect",
                    value: { codes: [workflowId.toString()] },
                },
            ]);

            const [workflowRes, usageRes] = await Promise.all([
                getWorkflowApiV1WorkflowFetchWorkflowIdGet({
                    path: { workflow_id: workflowId },
                }).catch(() => null),

                getUsageHistoryApiV1OrganizationsUsageRunsGet({
                    query: {
                        page: page,
                        limit: 10,
                        filters: filterPayload,
                    },
                }).catch(() => null),
            ]);

            if (!silent && (!workflowRes?.data || !usageRes?.data)) {
                setError("Failed to load agent details. Please try again.");
            }

            if (workflowRes?.data) {
                setAgentDetail(workflowRes.data);
            }

            if (usageRes?.data) {
                setRuns(usageRes.data.runs || []);
                setTotalCount(usageRes.data.total_count || 0);
                setTotalPages(usageRes.data.total_pages || 1);
            }
        } catch (err) {
            console.error("Failed to load agent view data:", err);
            if (!silent) {
                setError("Failed to load agent details. Please try again.");
            }
        } finally {
            if (!silent) {
                setIsLoading(false);
            }
        }
    }, [workflowId, isAuthenticated]);

    useEffect(() => {
        if (isAuthenticated && workflowId) {
            loadData(currentPage);
        }
    }, [isAuthenticated, workflowId, currentPage, loadData]);

    // Live refresh: backend flushes usage_info every 15s mid-call, so a
    // silent refetch keeps Duration + Tokens ticking for in-progress calls
    // without flashing the table. Poll failures are swallowed by loadData.
    useEffect(() => {
        if (!isAuthenticated || !workflowId) return;
        const intervalId = window.setInterval(() => {
            void loadData(currentPage, { silent: true });
        }, 15_000);
        return () => window.clearInterval(intervalId);
    }, [isAuthenticated, workflowId, currentPage, loadData]);

    const handlePageChange = (newPage: number) => {
        if (newPage < 1 || newPage > totalPages) return;
        setCurrentPage(newPage);
        router.push(
            `/voice/agents/${workflowId}/view?tab=conversations&page=${newPage}`
        );
    };

    const conversationHref = (runId: number) =>
        withReturnTo(`/usage/runs/${runId}`, `/voice/agents/${workflowId}/view?tab=conversations&page=${currentPage}`);

    const formatDuration = (seconds: number) => {
        const minutes = Math.floor(seconds / 60);
        const remainingSeconds = seconds % 60;
        if (minutes === 0) return `${remainingSeconds}s`;
        if (remainingSeconds === 0) return `${minutes}m`;
        return `${minutes}m ${remainingSeconds}s`;
    };

    const formatDateTime = (dateString: string) => {
        const date = new Date(dateString);
        return date.toLocaleString("en-US", {
            month: "short",
            day: "numeric",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
            hour12: true,
        });
    };


    const filteredRuns = runs.filter((run) => {
        if (searchQuery) {
            const q = searchQuery.toLowerCase().trim();
            const matchesSearch =
                String(run.id).includes(q) ||
                (run.disposition || "").toLowerCase().includes(q) ||
                (run.mode || "").toLowerCase().includes(q) ||
                (run.call_type || "").toLowerCase().includes(q);
            if (!matchesSearch) return false;
        }

        for (const filter of appliedFilters) {
            if (!filter.isValid) continue;
            const attrType = filter.attribute.type;
            const val = filter.value;

            if (attrType === "text") {
                const textVal = (val as { value: string }).value;
                if (textVal) {
                    const q = textVal.toLowerCase();
                    const matches =
                        String(run.id).includes(q) ||
                        (run.disposition || "").toLowerCase().includes(q) ||
                        (run.mode || "").toLowerCase().includes(q) ||
                        (run.call_type || "").toLowerCase().includes(q);
                    if (!matches) return false;
                }
            } else if (attrType === "dateRange") {
                const range = val as { from: Date | null; to: Date | null };
                if ((range.from || range.to) && run.created_at) {
                    const created = new Date(run.created_at).getTime();
                    if (range.from && created < new Date(range.from).getTime()) return false;
                    if (range.to && created > new Date(range.to).getTime()) return false;
                }
            } else if (attrType === "numberRange") {
                const numRange = val as { min: number | null; max: number | null };
                if (numRange.min !== null || numRange.max !== null) {
                    // tokenUsage templates must compare against token usage,
                    // not call duration (previous code used duration for both).
                    const metric =
                        filter.attribute.id === "tokenUsage"
                            ? (run as any).autonomous_ai_os_token_usage || (run as any).convozent_token_usage || 0
                            : run.call_duration_seconds || 0;
                    if (numRange.min !== null && metric < numRange.min) return false;
                    if (numRange.max !== null && metric > numRange.max) return false;
                }
            } else if (attrType === "multiSelect") {
                const codes = (val as { codes: string[] }).codes;
                if (codes && codes.length > 0) {
                    const disp = (run.disposition || "").toLowerCase();
                    const matches = codes.some((code) => disp.includes(code.toLowerCase()));
                    if (!matches) return false;
                }
            } else if (attrType === "radio" || attrType === "tags" || attrType === "number") {
                // Run payload has no completion-status/tags field client-side;
                // the org-level conversations page filters these server-side.
                // Skip here so templates containing them never blank the table.
                continue;
            }
        }
        return true;
    });

    // Header sorting (client-side, current page rows only).
    type AgentConvoSortKey = 'id' | 'created_at' | 'call_duration_seconds' | 'disposition';
    const [convoSortKey, setConvoSortKey] = useState<AgentConvoSortKey | null>(null);
    const [convoSortDir, setConvoSortDir] = useState<'asc' | 'desc'>('asc');
    const toggleConvoSort = (key: AgentConvoSortKey) => {
        if (convoSortKey !== key) {
            setConvoSortKey(key);
            setConvoSortDir('asc');
        } else if (convoSortDir === 'asc') {
            setConvoSortDir('desc');
        } else {
            setConvoSortKey(null);
            setConvoSortDir('asc');
        }
    };
    const ConvoSortIcon = ({ column }: { column: AgentConvoSortKey }) => {
        if (convoSortKey !== column) return <ArrowUpDown className="h-3.5 w-3.5 text-muted-foreground/60" />;
        return convoSortDir === 'asc'
            ? <ArrowUp className="h-3.5 w-3.5 text-foreground" />
            : <ArrowDown className="h-3.5 w-3.5 text-foreground" />;
    };
    const sortedRuns = useMemo(() => {
        if (!convoSortKey) return filteredRuns;
        const dir = convoSortDir === 'asc' ? 1 : -1;
        return [...filteredRuns].sort((a, b) => {
            switch (convoSortKey) {
                case 'id':
                    return (a.id - b.id) * dir;
                case 'created_at':
                    return (new Date(a.created_at).getTime() - new Date(b.created_at).getTime()) * dir;
                case 'call_duration_seconds':
                    return ((a.call_duration_seconds ?? 0) - (b.call_duration_seconds ?? 0)) * dir;
                case 'disposition':
                    return (a.disposition ?? '').localeCompare(b.disposition ?? '') * dir;
            }
        });
    }, [filteredRuns, convoSortKey, convoSortDir]);

    // Voice agents → this agent → the section of it you are looking at.
    const breadcrumbs = useMemo(
        () => [
            { label: "Voice agents", href: "/voice/agents" },
            ...(agentDetail?.name ? [{ label: agentDetail.name, href: activeTab !== "dashboard" ? `/voice/agents/${workflowId}/view` : undefined }] : []),
            { label: AGENT_TAB_LABELS[activeTab] },
        ],
        [agentDetail?.name, activeTab, workflowId],
    );

    return (
        <div data-detail-page className="min-h-[calc(100%+1rem)] shrink-0 space-y-4 px-4 pt-6 pb-8 lg:px-6">
            <PageHeader
                title={agentDetail?.name ?? ""}
                breadcrumbs={breadcrumbs}
                actions={
                    <div className="flex items-center gap-2">
                        <Button asChild variant="outline" size="sm" className="h-8 gap-1.5 text-xs">
                            <Link href={`/voice/agents/${workflowId}`}>
                                <Pencil className="h-3.5 w-3.5" />
                                Customize Agent
                            </Link>
                        </Button>
                        {workflowId && user && (
                            <Button
                                variant="outline"
                                size="sm"
                                className="h-8 gap-1.5 text-xs"
                                onClick={() => setIsPhoneCallDialogOpen(true)}
                            >
                                <Phone className="h-3.5 w-3.5" />
                                Phone Call
                            </Button>
                        )}
                        <Button
                            variant="outline"
                            size="sm"
                            className="h-8 w-8 p-0"
                            onClick={() => {
                                void loadData(currentPage);
                                void reloadAnalytics();
                            }}
                            disabled={isLoading || isAnalyticsLoading}
                            aria-label="Refresh agent"
                            title="Refresh"
                        >
                            <RefreshCw className={cn("h-3.5 w-3.5", (isLoading || isAnalyticsLoading) && "animate-spin")} />
                        </Button>
                    </div>
                }
            />

            <AgentHeaderCard
                name={agentDetail?.name}
                createdAt={agentDetail?.created_at}
                sessions={totalCount}
                stack={analytics?.by_model[0]?.name || (agentDetail?.workflow_configurations as { preset_name?: string } | undefined)?.preset_name || null}
                workflowId={workflowId ?? 0}
                activeTab={activeTab}
                isRefreshing={isLoading || isAnalyticsLoading}
                onTabChange={setActiveTab}
                onRefresh={() => {
                    void loadData(currentPage);
                    void reloadAnalytics();
                }}
                onPhoneCall={workflowId && user ? () => setIsPhoneCallDialogOpen(true) : undefined}
            />

            {error ? (
                <div className="p-4 rounded-md bg-destructive/10 text-destructive text-sm text-center">
                    {error}
                </div>
            ) : (
                <>
                    {activeTab !== "conversations" && analyticsError && !analytics ? (
                        <Card className="flex flex-col items-start gap-3 p-6">
                            <p className="text-sm text-muted-foreground">{analyticsError}</p>
                            <Button variant="outline" size="sm" onClick={() => void reloadAnalytics()}>
                                Try again
                            </Button>
                        </Card>
                    ) : (
                        <>
                            {activeTab === "dashboard" && (
                                <AgentDashboardTab
                                    analytics={analytics}
                                    workflowId={workflowId ?? 0}
                                    days={analyticsDays}
                                    loading={isAnalyticsLoading}
                                    onDaysChange={setAnalyticsDays}
                                />
                            )}

                            {activeTab === "analytics" && (
                                <AgentAnalyticsTab
                                    analytics={analytics}
                                    days={analyticsDays}
                                    loading={isAnalyticsLoading}
                                    onDaysChange={setAnalyticsDays}
                                />
                            )}

                            {activeTab === "nodes" && (
                                <AgentNodesTable
                                    nodes={analytics?.by_node ?? []}
                                    days={analyticsDays}
                                    loading={isAnalyticsLoading && !analytics}
                                />
                            )}
                        </>
                    )}

                    {/* Conversations Table Section */}
                    <div className={cn("space-y-4", activeTab !== "conversations" && "hidden")}>
                        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
                            <div>
                                <h2 className="text-base font-bold text-foreground">
                                    Conversations Table
                                </h2>
                                <p className="text-xs text-muted-foreground mt-0.5">
                                    All call runs and WebRTC sessions for this voice agent.
                                </p>
                            </div>
                            <div className="flex flex-wrap items-center gap-2 sm:gap-3">
                                {/* Search box */}
                                <div className="relative w-40 sm:w-56">
                                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                                    <Input
                                        placeholder="Search conversations..."
                                        value={searchQuery}
                                        onChange={(e) => setSearchQuery(e.target.value)}
                                        className="pl-9 h-9 text-xs w-full bg-background"
                                    />
                                </div>

                                {/* Templates — shared menu with icons */}
                                <FilterTemplatesMenu selectedTemplateId={selectedTemplateId} onSelect={applyTemplate} />

                                {/* Select attribute to filter by Popover */}
                                <Popover open={popoverOpen} onOpenChange={handlePopoverOpenChange}>
                                    <PopoverTrigger asChild>
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            className="h-9 text-xs flex items-center gap-1.5"
                                        >
                                            <Filter className="h-4 w-4" />
                                            <span>Select attribute to filter by</span>
                                            {appliedFilters.length > 0 && (
                                                <Badge variant="secondary" className="ml-1.5 h-5 px-1.5 text-[10px] font-semibold bg-primary/10 text-primary border-none">
                                                    {appliedFilters.length}
                                                </Badge>
                                            )}
                                        </Button>
                                    </PopoverTrigger>
                                    <PopoverContent className="w-80 p-4" align="end">
                                        {editingAttributeId === null ? (
                                            /* Main View: List of available attributes */
                                            <div className="space-y-3">
                                                <div className="flex items-center justify-between border-b pb-2 mb-1">
                                                    <span className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                                                        <Filter className="h-3.5 w-3.5" />
                                                        Filter Attributes
                                                    </span>
                                                </div>
                                                <div className="space-y-1">
                                                    {workflowFilterAttributes.map((attr) => {
                                                        const activeFilter = activeFilters.find((f) => f.attribute.id === attr.id);
                                                        return (
                                                            <div key={attr.id} className="flex items-center justify-between group hover:bg-muted/50 rounded-md px-2 py-1.5 transition-colors">
                                                                <button
                                                                    onClick={() => {
                                                                        if (!activeFilter) {
                                                                            addFilter(attr.id);
                                                                        }
                                                                        setEditingAttributeId(attr.id);
                                                                    }}
                                                                    className="flex items-center justify-between flex-1 text-left text-xs"
                                                                >
                                                                    <div className="flex items-center gap-2">
                                                                        <span className="text-muted-foreground group-hover:text-foreground">
                                                                            {getFilterIcon(attr.type)}
                                                                        </span>
                                                                        <span className="font-medium text-foreground">{attr.label}</span>
                                                                    </div>
                                                                    {activeFilter && (
                                                                        <span className="text-[11px] text-muted-foreground max-w-[120px] truncate mr-2 font-semibold">
                                                                            {getFilterSummary(activeFilter)}
                                                                        </span>
                                                                    )}
                                                                </button>
                                                                {activeFilter && (
                                                                    <Button
                                                                        variant="ghost"
                                                                        size="icon"
                                                                        className="h-6 w-6 text-muted-foreground hover:text-red-500"
                                                                        onClick={(e) => {
                                                                            e.stopPropagation();
                                                                            handleRemoveFilterAndApply(attr.id);
                                                                        }}
                                                                    >
                                                                        <X className="h-3.5 w-3.5" />
                                                                    </Button>
                                                                )}
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                                {activeFilters.length > 0 && (
                                                    <div className="border-t pt-2 mt-2 flex justify-between gap-2">
                                                        <Button
                                                            variant="ghost"
                                                            size="sm"
                                                            className="h-8 text-xs flex-1 text-muted-foreground hover:text-foreground"
                                                            onClick={handleClearFilters}
                                                        >
                                                            Clear All
                                                        </Button>
                                                    </div>
                                                )}
                                            </div>
                                        ) : (
                                            /* Edit View: Filter input rendering */
                                            (() => {
                                                const attr = workflowFilterAttributes.find((a) => a.id === editingAttributeId);
                                                const filterIndex = activeFilters.findIndex((f) => f.attribute.id === editingAttributeId);
                                                if (!attr || filterIndex === -1) return null;
                                                const filter = activeFilters[filterIndex];
                                                return (
                                                    <div className="space-y-4">
                                                        <div className="flex items-center justify-between border-b pb-2 mb-2">
                                                            <Button
                                                                variant="ghost"
                                                                size="icon"
                                                                className="h-6 w-6"
                                                                onClick={() => setEditingAttributeId(null)}
                                                            >
                                                                <ArrowLeft className="h-4 w-4" />
                                                            </Button>
                                                            <span className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                                                                {getFilterIcon(attr.type)}
                                                                {attr.label}
                                                            </span>
                                                            <Button
                                                                variant="ghost"
                                                                size="icon"
                                                                className="h-6 w-6 text-muted-foreground hover:text-red-500"
                                                                onClick={() => {
                                                                    handleRemoveFilterAndApply(attr.id);
                                                                    setEditingAttributeId(null);
                                                                }}
                                                            >
                                                                <X className="h-4 w-4" />
                                                            </Button>
                                                        </div>
                                                        <div className="space-y-3">
                                                            {renderFilterInput(filter, filterIndex)}
                                                        </div>
                                                        <div className="flex justify-between gap-2 pt-2 border-t mt-2">
                                                            <Button
                                                                variant="outline"
                                                                size="sm"
                                                                className="h-8 text-xs flex-1"
                                                                onClick={() => setEditingAttributeId(null)}
                                                            >
                                                                Back
                                                            </Button>
                                                            <Button
                                                                size="sm"
                                                                className="h-8 text-xs flex-1"
                                                                onClick={handleApplyFilters}
                                                                disabled={!filter.isValid || isExecutingFilters}
                                                            >
                                                                Apply
                                                            </Button>
                                                        </div>
                                                    </div>
                                                );
                                            })()
                                        )}
                                    </PopoverContent>
                                </Popover>
                            </div>
                        </div>

                        {isLoading ? (
                            <Card className="border border-border/80">
                                <CardContent className="p-12 text-center text-muted-foreground text-sm">
                                    Loading conversations history...
                                </CardContent>
                            </Card>
                        ) : sortedRuns.length === 0 ? (
                            <Card className="border border-dashed">
                                <CardContent className="p-12 text-center text-muted-foreground">
                                    {appliedFilters.length > 0 ? "No conversations match your applied filters." : "No conversations found for this agent yet."}
                                </CardContent>
                            </Card>
                        ) : (
                            <Card className="border border-border/80 overflow-hidden shadow-xs">
                                <div className="overflow-x-auto">
                                    <Table>
                                        <TableHeader className="bg-muted/40">
                                            <TableRow>
                                                <TableHead className="w-[90px] font-semibold text-xs">
                                                    <button onClick={() => toggleConvoSort('id')} className="inline-flex items-center gap-1 hover:text-foreground cursor-pointer" aria-label="Sort by run ID">
                                                        Run ID <ConvoSortIcon column="id" />
                                                    </button>
                                                </TableHead>
                                                <TableHead className="font-semibold text-xs">Conversation</TableHead>
                                                <TableHead className="font-semibold text-xs">
                                                    <button onClick={() => toggleConvoSort('created_at')} className="inline-flex items-center gap-1 hover:text-foreground cursor-pointer" aria-label="Sort by date">
                                                        Date & Time <ConvoSortIcon column="created_at" />
                                                    </button>
                                                </TableHead>
                                                <TableHead className="font-semibold text-xs">Channel / Type</TableHead>
                                                <TableHead className="font-semibold text-xs">
                                                    <button onClick={() => toggleConvoSort('call_duration_seconds')} className="inline-flex items-center gap-1 hover:text-foreground cursor-pointer" aria-label="Sort by duration">
                                                        Duration <ConvoSortIcon column="call_duration_seconds" />
                                                    </button>
                                                </TableHead>
                                                <TableHead className="font-semibold text-xs">Tokens</TableHead>
                                                <TableHead className="font-semibold text-xs">
                                                    <button onClick={() => toggleConvoSort('disposition')} className="inline-flex items-center gap-1 hover:text-foreground cursor-pointer" aria-label="Sort by disposition">
                                                        Disposition <ConvoSortIcon column="disposition" />
                                                    </button>
                                                </TableHead>
                                                <TableHead className="font-semibold text-xs text-right">Actions</TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {sortedRuns.map((run) => (
                                                <TableRow
                                                    key={run.id}
                                                    className="hover:bg-muted/40 transition-colors cursor-pointer"
                                                    onClick={() => router.push(conversationHref(run.id))}
                                                >
                                                    <TableCell className="font-mono text-xs font-semibold text-muted-foreground">
                                                        #{run.id}
                                                    </TableCell>
                                                    <TableCell className="text-xs font-medium max-w-64 truncate" title={displayConversationTitle(run)}>
                                                        <TableNameLink href={conversationHref(run.id)}>{displayConversationTitle(run)}</TableNameLink>
                                                    </TableCell>
                                                    <TableCell className="text-xs font-medium">
                                                        {formatDateTime(run.created_at)}
                                                    </TableCell>
                                                    <TableCell>
                                                        <CallTypeCell callType={run.call_type || run.mode || "voice"} />
                                                    </TableCell>
                                                    <TableCell className="text-xs font-medium">
                                                        {formatDuration(run.call_duration_seconds || 0)}
                                                    </TableCell>
                                                    <TableCell className="text-xs font-medium text-right">
                                                        {((run as any).autonomous_ai_os_token_usage ?? (run as any).convozent_token_usage) != null
                                                            ? Number((run as any).autonomous_ai_os_token_usage ?? (run as any).convozent_token_usage).toLocaleString()
                                                            : '—'}
                                                    </TableCell>
                                                    <TableCell>
                                                        <DispositionBadge disposition={run.disposition} />
                                                    </TableCell>
                                                    <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                                                        <RowActionsMenu label={`Actions for run ${run.id}`}>
                                                            <RowAction icon={<ArrowUpRight />} href={conversationHref(run.id)}>View run</RowAction>
                                                            <RunMediaAction
                                                                recordingUrl={run.recording_url || run.recording_public_url}
                                                                videoUrl={(run as { video_recording_url?: string | null; video_recording_public_url?: string | null }).video_recording_url || (run as { video_recording_url?: string | null; video_recording_public_url?: string | null }).video_recording_public_url}
                                                                transcriptUrl={run.transcript_url || run.transcript_public_url}
                                                                runId={run.id}
                                                                onOpenPreview={mediaPreview.openPreview}
                                                            />
                                                            </RowActionsMenu>
</TableCell>
                                                </TableRow>
                                            ))}
                                        </TableBody>
                                    </Table>
                                </div>

                                {totalPages > 1 && (
                                    <div className="flex flex-col sm:flex-row items-center justify-between gap-3 p-4 px-6 border-t border-border bg-muted/10">
                                        <p className="text-sm text-muted-foreground">
                                            Page {currentPage} of {totalPages} ({totalCount} total items)
                                        </p>
                                        <Pagination className="mx-0 w-auto justify-end">
                                            <PaginationContent>
                                                <PaginationItem>
                                                    <PaginationPrevious
                                                        onClick={(e) => {
                                                            e.preventDefault();
                                                            handlePageChange(currentPage - 1);
                                                        }}
                                                        className={currentPage <= 1 ? 'pointer-events-none opacity-50' : 'cursor-pointer'}
                                                    />
                                                </PaginationItem>
                                                {(() => {
                                                    const pages: (number | 'ellipsis')[] = [];
                                                    if (totalPages <= 7) {
                                                        for (let i = 1; i <= totalPages; i++) pages.push(i);
                                                    } else {
                                                        pages.push(1);
                                                        if (currentPage > 3) pages.push('ellipsis');
                                                        for (let i = Math.max(2, currentPage - 1); i <= Math.min(totalPages - 1, currentPage + 1); i++) {
                                                            pages.push(i);
                                                        }
                                                        if (currentPage < totalPages - 2) pages.push('ellipsis');
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
                                                                    isActive={p === currentPage}
                                                                    onClick={(e) => {
                                                                        e.preventDefault();
                                                                        handlePageChange(p);
                                                                    }}
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
                                                        onClick={(e) => {
                                                            e.preventDefault();
                                                            handlePageChange(currentPage + 1);
                                                        }}
                                                        className={currentPage >= totalPages ? 'pointer-events-none opacity-50' : 'cursor-pointer'}
                                                    />
                                                </PaginationItem>
                                            </PaginationContent>
                                        </Pagination>
                                    </div>
                                )}
                            </Card>
                        )}
                    </div>
                </>
            )}

            {/* Audio & Transcript Media Preview Dialog */}
            {mediaPreview.dialog}

            {/* Phone Call Dialog */}
            {workflowId && user && (
                <PhoneCallDialog
                    open={isPhoneCallDialogOpen}
                    onOpenChange={setIsPhoneCallDialogOpen}
                    workflowId={workflowId}
                    user={user}
                />
            )}
        </div>
    );
}
