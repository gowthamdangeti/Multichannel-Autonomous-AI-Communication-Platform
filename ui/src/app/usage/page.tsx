"use client";

import { ArrowDown, ArrowLeft, ArrowUp, ArrowUpDown, Calendar, CheckSquare, Download, ExternalLink, Filter, Hash, Radio, Search, Tag, X } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';

import { downloadUsageRunsReportApiV1OrganizationsUsageRunsReportGet, getDailyUsageBreakdownApiV1OrganizationsUsageDailyBreakdownGet, getUsageHistoryApiV1OrganizationsUsageRunsGet } from '@/client/sdk.gen';
import type { DailyUsageBreakdownResponse, UsageHistoryResponse, WorkflowRunUsageResponse } from '@/client/types.gen';
import { CallTypeCell } from '@/components/CallTypeCell';
import { DailyUsageTable } from '@/components/DailyUsageTable';
import { AgentSelectFilter } from '@/components/filters/AgentSelectFilter';
import { DateRangeFilter } from '@/components/filters/DateRangeFilter';
import { FilterTemplatesMenu } from "@/components/filters/FilterTemplatesMenu";
import { MultiSelectFilter } from '@/components/filters/MultiSelectFilter';
import { NumberFilter } from '@/components/filters/NumberFilter';
import { NumberRangeFilter } from '@/components/filters/NumberRangeFilter';
import { RadioFilter } from '@/components/filters/RadioFilter';
import { TagInputFilter } from '@/components/filters/TagInputFilter';
import { TextFilter } from '@/components/filters/TextFilter';
import { RowAction, RowActionsMenu } from "@/components/layout/RowActionsMenu";
import { TableNameLink } from "@/components/layout/TableNameLink";
import { MediaPreviewDialog } from '@/components/MediaPreviewDialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Pagination, PaginationContent, PaginationEllipsis, PaginationItem, PaginationLink, PaginationNext, PaginationPrevious } from '@/components/ui/pagination';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { DispositionBadge } from "@/components/workflow-runs/RunBadges";
import { RunMediaAction } from "@/components/workflow-runs/RunRowActions";
import { PageHeader } from '@/context/HeaderContext';
import { useUserConfig } from '@/context/UserConfigContext';
import { useAuth } from '@/lib/auth';
import { displayConversationTitle } from '@/lib/conversationDisplay';
import { usageFilterAttributes } from '@/lib/filterAttributes';
import { decodeFiltersFromURL, encodeFiltersToURL, formatDateRange, formatNumberRange, getDefaultValue, validateFilter } from '@/lib/filters';
import { withReturnTo } from '@/lib/returnTo';
import { ActiveFilter, DateRangeValue, FilterTemplate, FilterValue, MultiSelectValue, NumberRangeValue, NumberValue, RadioValue, TextValue } from '@/types/filters';

// Get local timezone
const getLocalTimezone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

export default function UsagePage() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const { organizationPricing } = useUserConfig();
    const auth = useAuth();

    // Usage history state
    const [usageHistory, setUsageHistory] = useState<UsageHistoryResponse | null>(null);
    const [isLoadingHistory, setIsLoadingHistory] = useState(false);
    const [currentPage, setCurrentPage] = useState(() => {
        const pageParam = searchParams.get('page');
        return pageParam ? parseInt(pageParam, 10) : 1;
    });
    const [isExecutingFilters, setIsExecutingFilters] = useState(false);

    // Daily usage breakdown state (only for paid orgs)
    const [dailyUsage, setDailyUsage] = useState<DailyUsageBreakdownResponse | null>(null);
    const [isLoadingDaily, setIsLoadingDaily] = useState(false);

    // Initialize filters from URL. `activeFilters` tracks the in-progress
    // edits in the FilterBuilder; `appliedFilters` is what's actually been
    // committed via Apply (and what drives fetching + the download button).
    const [activeFilters, setActiveFilters] = useState<ActiveFilter[]>(() => {
        return decodeFiltersFromURL(searchParams, usageFilterAttributes);
    });
    const [appliedFilters, setAppliedFilters] = useState<ActiveFilter[]>(() => {
        return decodeFiltersFromURL(searchParams, usageFilterAttributes);
    });

    // Media preview dialog
    const mediaPreview = MediaPreviewDialog();

    const [isDownloadingReport, setIsDownloadingReport] = useState(false);

    // Client-side search and inline filter selection state
    const [searchQuery, setSearchQuery] = useState("");
    const [popoverOpen, setPopoverOpen] = useState(false);
    const [editingAttributeId, setEditingAttributeId] = useState<string | null>(null);

    // Which filter template is currently applied (null = custom/manual).
    // Shown in the Templates trigger so the selection is visible after click.
    const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);

    const addFilter = useCallback((attributeId: string) => {
        const attribute = usageFilterAttributes.find(attr => attr.id === attributeId);
        if (!attribute) return;

        const defaultValue = getDefaultValue(attribute.type);
        const newFilter: ActiveFilter = {
            attribute,
            value: defaultValue,
            isValid: validateFilter({ attribute, value: defaultValue, isValid: false }) === null,
        };

        setActiveFilters(prev => [...prev, newFilter]);
    }, []);

    const updateFilter = useCallback((index: number, value: FilterValue) => {
        setActiveFilters(prev => {
            const newFilters = [...prev];
            newFilters[index].value = value;
            newFilters[index].isValid = validateFilter(newFilters[index]) === null;
            return newFilters;
        });
    }, []);


    // Update URL with query parameters
    const updateUrlParams = useCallback((params: { page?: number; filters?: ActiveFilter[] }) => {
        const newParams = new URLSearchParams();

        if (params.page !== undefined) {
            newParams.set('page', params.page.toString());
        }

        // Add filters to URL if present
        if (params.filters && params.filters.length > 0) {
            const filterString = encodeFiltersToURL(params.filters);
            if (filterString) {
                const filterParams = new URLSearchParams(filterString);
                filterParams.forEach((value, key) => newParams.set(key, value));
            }
        }

        router.push(`/usage?${newParams.toString()}`);
    }, [router]);

    // Fetch usage history
    const fetchUsageHistory = useCallback(async (page: number, filters?: ActiveFilter[], options?: { silent?: boolean }) => {
        if (!auth.isAuthenticated) return;
        if (!options?.silent) setIsLoadingHistory(true);
        try {
            const response = await getUsageHistoryApiV1OrganizationsUsageRunsGet({
                query: {
                    page,
                    limit: 8,
                    ...buildUsageQueryParams(filters),
                },
            });

            if (response.data) {
                setUsageHistory(response.data);
            }
        } catch (error) {
            console.error('Failed to fetch usage history:', error);
        } finally {
            setIsLoadingHistory(false);
        }
    }, [auth.isAuthenticated]);

    // Fetch daily usage breakdown
    const fetchDailyUsage = useCallback(async () => {
        if (!auth.isAuthenticated || !organizationPricing?.price_per_second_usd) return;

        setIsLoadingDaily(true);
        try {
            const response = await getDailyUsageBreakdownApiV1OrganizationsUsageDailyBreakdownGet({
                query: { days: 7 },
            });

            if (response.data) {
                setDailyUsage(response.data);
            }
        } catch (error) {
            console.error('Failed to fetch daily usage:', error);
        } finally {
            setIsLoadingDaily(false);
        }
    }, [auth.isAuthenticated, organizationPricing]);

    // Initial load - fetch when auth becomes available
    useEffect(() => {
        if (auth.isAuthenticated) {
            fetchUsageHistory(currentPage, appliedFilters);
        }
    }, [auth.isAuthenticated, currentPage, appliedFilters, fetchUsageHistory]);

    // Poll for new runs every 10s so transcript/recording appears after ARQ finishes
    useEffect(() => {
        if (!auth.isAuthenticated) return;
        const interval = setInterval(() => {
            fetchUsageHistory(currentPage, appliedFilters, { silent: true });
        }, 10_000);
        return () => clearInterval(interval);
    }, [auth.isAuthenticated, currentPage, appliedFilters, fetchUsageHistory]);

    // Fetch daily usage when organizationPricing becomes available
    useEffect(() => {
        if (auth.isAuthenticated && organizationPricing?.price_per_second_usd) {
            fetchDailyUsage();
        }
    }, [auth.isAuthenticated, organizationPricing, fetchDailyUsage]);

    const applyTemplate = useCallback((template: FilterTemplate) => {
        const newFilters: ActiveFilter[] = template.filters.map(filterConfig => {
            const attribute = usageFilterAttributes.find(attr => attr.id === filterConfig.attributeId);
            if (!attribute) {
                console.warn(`Attribute ${filterConfig.attributeId} not found`);
                return null;
            }

            const filter: ActiveFilter = {
                attribute,
                value: filterConfig.value,
                isValid: true,
            };
            return filter;
        }).filter((f): f is ActiveFilter => f !== null);

        setActiveFilters(newFilters);
        setAppliedFilters(newFilters);
        setSelectedTemplateId(template.id);
        setCurrentPage(1);
        updateUrlParams({ page: 1, filters: newFilters });
        fetchUsageHistory(1, newFilters);
    }, [fetchUsageHistory, updateUrlParams]);

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
                const option = filter.attribute.config.radioOptions?.find(opt => opt.value === value.status);
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

    // Translate the FilterBuilder state into the query-param shape the
    // backend expects. Shared between the listing fetch and the CSV export
    // so they stay in lockstep.
    const buildUsageQueryParams = (filters?: ActiveFilter[]) => {
        let filterParam: string | undefined;
        let startDate = '';
        let endDate = '';

        if (filters && filters.length > 0) {
            const dateRangeFilter = filters.find(f => f.attribute.id === 'dateRange');
            if (dateRangeFilter && dateRangeFilter.value) {
                const dateValue = dateRangeFilter.value as DateRangeValue;
                if (dateValue.from) startDate = dateValue.from.toISOString();
                if (dateValue.to) endDate = dateValue.to.toISOString();
            }

            const otherFilters = filters.filter(f => f.attribute.id !== 'dateRange');
            if (otherFilters.length > 0) {
                const filterData = otherFilters.map(filter => ({
                    attribute: filter.attribute.id,
                    type: filter.attribute.type,
                    value: filter.value,
                }));
                filterParam = JSON.stringify(filterData);
            }
        }

        return {
            ...(startDate && { start_date: startDate }),
            ...(endDate && { end_date: endDate }),
            ...(filterParam && { filters: filterParam }),
        };
    };

    // Download a CSV of all runs matching the current filters.
    const handleDownloadReport = async () => {
        if (!auth.isAuthenticated) return;
        setIsDownloadingReport(true);
        try {
            const response = await downloadUsageRunsReportApiV1OrganizationsUsageRunsReportGet({
                query: buildUsageQueryParams(appliedFilters),
                parseAs: 'blob',
            });

            if (response.data) {
                const blob = response.data as Blob;
                const url = window.URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = 'usage_runs_report.csv';
                document.body.appendChild(a);
                a.click();
                a.remove();
                window.URL.revokeObjectURL(url);
            } else {
                toast.error('Failed to download report');
            }
        } catch (error) {
            console.error('Failed to download usage report:', error);
            toast.error('Failed to download report');
        } finally {
            setIsDownloadingReport(false);
        }
    };

    const handleApplyFilters = useCallback(async () => {
        setIsExecutingFilters(true);
        setCurrentPage(1); // Reset to first page when applying filters
        setAppliedFilters(activeFilters);
        setSelectedTemplateId(null); // manual edit → no longer a template
        setPopoverOpen(false);
        updateUrlParams({ page: 1, filters: activeFilters });
        await fetchUsageHistory(1, activeFilters);
        setIsExecutingFilters(false);
    }, [activeFilters, fetchUsageHistory, updateUrlParams]);


    const handleClearFilters = useCallback(async () => {
        setIsExecutingFilters(true);
        setCurrentPage(1);
        setActiveFilters([]);
        setAppliedFilters([]);
        setSelectedTemplateId(null);
        setPopoverOpen(false);
        setEditingAttributeId(null);
        updateUrlParams({ page: 1, filters: [] }); // Clear filters from URL
        await fetchUsageHistory(1, []); // Fetch all runs without filters
        setIsExecutingFilters(false);
    }, [fetchUsageHistory, updateUrlParams]);

    const handlePopoverOpenChange = useCallback((open: boolean) => {
        setPopoverOpen(open);
        if (open) {
            // Rollback activeFilters edits to committed appliedFilters
            setActiveFilters(appliedFilters);
            setEditingAttributeId(null);
        } else {
            setEditingAttributeId(null);
        }
    }, [appliedFilters]);

    const handleRemoveFilterAndApply = useCallback(async (attributeId: string) => {
        const nextFilters = activeFilters.filter(f => f.attribute.id !== attributeId);
        setActiveFilters(nextFilters);
        setAppliedFilters(nextFilters);
        setSelectedTemplateId(null);
        updateUrlParams({ page: 1, filters: nextFilters });
        await fetchUsageHistory(1, nextFilters);
    }, [activeFilters, fetchUsageHistory, updateUrlParams]);

    // Handle page change
    const handlePageChange = (newPage: number) => {
        setCurrentPage(newPage);
        updateUrlParams({ page: newPage, filters: appliedFilters });
        fetchUsageHistory(newPage, appliedFilters);
    };

    // Conversation links carry this list's URL (page + filters), so Back returns here.
    const conversationHref = (runId: number) => {
        const query = searchParams.toString();
        return withReturnTo(`/usage/runs/${runId}`, `/voice/conversations${query ? `?${query}` : ""}`);
    };

    // Handle row click to navigate to workflow run
    const handleRowClick = (run: WorkflowRunUsageResponse) => {
        router.push(conversationHref(run.id));
    };

    // Format datetime for display with timezone support
    const formatDateTime = (dateString: string) => {
        const date = new Date(dateString);
        const effectiveTz = getLocalTimezone();
        return date.toLocaleString('en-US', {
            timeZone: effectiveTz,
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            hour12: true
        });
    };

    // Format duration for display
    const formatDuration = (seconds: number) => {
        const minutes = Math.floor(seconds / 60);
        const remainingSeconds = seconds % 60;
        if (minutes === 0) return `${remainingSeconds}s`;
        if (remainingSeconds === 0) return `${minutes}m`;
        return `${minutes}m ${remainingSeconds}s`;
    };


    const filteredRuns = (usageHistory?.runs || []).filter((run) => {
        if (!searchQuery) return true;
        const q = searchQuery.toLowerCase().trim();
        return (
            (run.workflow_name || '').toLowerCase().includes(q) ||
            run.id.toString().includes(q) ||
            (run.caller_number || '').toLowerCase().includes(q) ||
            (run.called_number || '').toLowerCase().includes(q) ||
            (run.disposition || '').toLowerCase().includes(q)
        );
    });

    // Header sorting (client-side, current page rows only — server has no sort param).
    type ConvoSortKey = 'id' | 'workflow_name' | 'conversation_title' | 'phone_number' | 'disposition' | 'created_at' | 'call_duration_seconds' | 'charge_usd';
    const [sortKey, setSortKey] = useState<ConvoSortKey | null>(null);
    const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
    const toggleSort = (key: ConvoSortKey) => {
        if (sortKey !== key) {
            setSortKey(key);
            setSortDir('asc');
        } else if (sortDir === 'asc') {
            setSortDir('desc');
        } else {
            setSortKey(null);
            setSortDir('asc');
        }
    };
    const SortIcon = ({ column }: { column: ConvoSortKey }) => {        if (sortKey !== column) return <ArrowUpDown className="h-3.5 w-3.5 text-muted-foreground/60" />;
        return sortDir === 'asc'
            ? <ArrowUp className="h-3.5 w-3.5 text-foreground" />
            : <ArrowDown className="h-3.5 w-3.5 text-foreground" />;
    };
    const sortedRuns = useMemo(() => {
        if (!sortKey) return filteredRuns;
        const dir = sortDir === 'asc' ? 1 : -1;
        const displayPhoneNumber = (run: WorkflowRunUsageResponse) =>
            (run.call_type === 'inbound' ? run.caller_number : run.called_number) || '-';
        return [...filteredRuns].sort((a, b) => {
            switch (sortKey) {
                case 'id':
                    return (a.id - b.id) * dir;
                case 'workflow_name':
                    return (a.workflow_name ?? '').localeCompare(b.workflow_name ?? '') * dir;
                case 'conversation_title':
                    return displayConversationTitle(a).localeCompare(displayConversationTitle(b)) * dir;
                case 'phone_number':
                    return displayPhoneNumber(a).localeCompare(displayPhoneNumber(b)) * dir;
                case 'disposition':
                    return (a.disposition ?? '').localeCompare(b.disposition ?? '') * dir;
                case 'created_at':
                    return (new Date(a.created_at).getTime() - new Date(b.created_at).getTime()) * dir;
                case 'call_duration_seconds':
                    return ((a.call_duration_seconds ?? 0) - (b.call_duration_seconds ?? 0)) * dir;
                case 'charge_usd':
                    return ((a.charge_usd ?? -1) - (b.charge_usd ?? -1)) * dir;
            }
        });
    }, [filteredRuns, sortKey, sortDir]);


    return (
        <div className="px-4 lg:px-6 pt-2 pb-6 space-y-4">
            <PageHeader
                title="Voice Conversations"
                subtitle="Every agent run across your organization with usage details."
                onRefresh={() => void fetchUsageHistory(currentPage, appliedFilters)}
                isRefreshing={isLoadingHistory}
                toolbar={
                    <div className="flex w-full flex-wrap items-center gap-2">
                        {/* Search box */}
                        <div className="relative min-w-56 flex-1">
                            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                            <Input
                                placeholder="Search agent runs..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="pl-10 h-9 text-xs w-full"
                            />
                        </div>

                        {/* Templates — shared menu with icons */}
                        <FilterTemplatesMenu selectedTemplateId={selectedTemplateId} onSelect={applyTemplate} />

                        {/* Download button */}
                        <Button
                            variant="outline"
                            size="sm"
                            className="h-9 text-xs font-medium"
                            onClick={handleDownloadReport}
                            disabled={isDownloadingReport}
                        >
                            <Download className="h-4 w-4 mr-2" />
                            {isDownloadingReport ? 'Preparing...' : 'Download'}
                        </Button>

                        {/* Single Multi-Stage Popover Filter */}
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
                            <PopoverContent className="w-80 p-4" align="start">
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
                                            {usageFilterAttributes.map((attr) => {
                                                const activeFilter = activeFilters.find(f => f.attribute.id === attr.id);
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
                                        const attr = usageFilterAttributes.find(a => a.id === editingAttributeId);
                                        const filterIndex = activeFilters.findIndex(f => f.attribute.id === editingAttributeId);
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

                        {/* Timezone Select (Hidden by user request)
                        <div className="relative flex items-center w-[220px]">
                            <Globe className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground z-10 pointer-events-none" />
                            <div className="w-full">
                                <TimezoneSelect
                                    instanceId={timezoneSelectId}
                                    value={selectedTimezone}
                                    onChange={handleTimezoneChange}
                                    isDisabled={savingTimezone || preferencesLoading}
                                    placeholder={preferencesLoading ? "Loading..." : "Select timezone"}
                                    styles={{
                                        control: (base, state) => ({
                                            ...base,
                                            minHeight: '36px',
                                            fontSize: '13px',
                                            paddingLeft: '24px',
                                            backgroundColor: 'var(--card)',
                                            borderColor: state.isFocused ? 'var(--ring)' : 'var(--border)',
                                            borderWidth: 'var(--surface-border-width)',
                                            boxShadow: state.isFocused ? 'var(--input-shadow, 0 0 0 2px color-mix(in srgb, var(--ring) 20%, transparent))' : 'var(--input-shadow, none)',
                                            borderRadius: 'var(--radius-button, 8px)',
                                            '&:hover': {
                                                borderColor: state.isFocused ? 'var(--ring)' : 'var(--border)',
                                            },
                                        }),
                                        menu: (base) => ({
                                            ...base,
                                            zIndex: 9999,
                                            backgroundColor: 'var(--popover)',
                                            border: '1px solid var(--border)',
                                            boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)',
                                        }),
                                        menuList: (base) => ({
                                            ...base,
                                            backgroundColor: 'var(--popover)',
                                            padding: 0,
                                        }),
                                        option: (base, state) => ({
                                            ...base,
                                            backgroundColor: state.isSelected
                                                ? 'var(--accent)'
                                                : state.isFocused
                                                ? 'var(--accent)'
                                                : 'var(--popover)',
                                            color: 'var(--foreground)',
                                            cursor: 'pointer',
                                            '&:active': {
                                                backgroundColor: 'var(--accent)',
                                            },
                                        }),
                                        singleValue: (base) => ({
                                            ...base,
                                            color: 'var(--foreground)',
                                        }),
                                        input: (base) => ({
                                            ...base,
                                            color: 'var(--foreground)',
                                        }),
                                        placeholder: (base) => ({
                                            ...base,
                                            color: 'var(--muted-foreground)',
                                        }),
                                        indicatorSeparator: (base) => ({
                                            ...base,
                                            backgroundColor: 'var(--border)',
                                        }),
                                        dropdownIndicator: (base) => ({
                                            ...base,
                                            color: 'var(--muted-foreground)',
                                            '&:hover': {
                                                color: 'var(--foreground)',
                                            },
                                        }),
                                    }}
                                />
                            </div>
                        </div>
                        */}
                    </div>
                }
            />

                {/* Daily Usage Table - Only for paid organizations */}
                {organizationPricing?.price_per_second_usd && (
                    <div className="mb-6">
                        <DailyUsageTable
                            data={dailyUsage}
                            isLoading={isLoadingDaily}
                        />
                    </div>
                )}

                {/* Usage History */}
                <Card className="border border-border rounded-xl">
                    <CardContent className="p-0">

                        {isLoadingHistory ? (
                            <div className="animate-pulse space-y-3 p-6">
                                {[...Array(5)].map((_, i) => (
                                    <div key={i} className="h-12 bg-muted rounded"></div>
                                ))}
                            </div>
                        ) : usageHistory && sortedRuns.length > 0 ? (
                            <>
                                <div className="w-full overflow-x-auto rounded-xl">
                                    <table className="w-full caption-bottom text-sm border-collapse whitespace-nowrap">
                                        <thead className="border-b border-border">
                                            <tr>
                                                <th className="h-12 px-4 text-left align-middle font-medium text-muted-foreground font-semibold">
                                                    <button onClick={() => toggleSort('id')} className="inline-flex items-center gap-1 hover:text-foreground cursor-pointer" aria-label="Sort by run ID">
                                                        Run ID <SortIcon column="id" />
                                                    </button>
                                                </th>
                                                <th className="h-12 px-4 text-left align-middle font-medium text-muted-foreground font-semibold">
                                                    <button onClick={() => toggleSort('conversation_title')} className="inline-flex items-center gap-1 hover:text-foreground cursor-pointer" aria-label="Sort by conversation">
                                                        Conversation <SortIcon column="conversation_title" />
                                                    </button>
                                                </th>
                                                <th className="h-12 px-4 text-left align-middle font-medium text-muted-foreground font-semibold">Call Type</th>
                                                <th className="h-12 px-4 text-left align-middle font-medium text-muted-foreground font-semibold">
                                                    <button onClick={() => toggleSort('phone_number')} className="inline-flex items-center gap-1 hover:text-foreground cursor-pointer" aria-label="Sort by phone number">
                                                        Phone Number <SortIcon column="phone_number" />
                                                    </button>
                                                </th>
                                                <th className="h-12 px-4 text-left align-middle font-medium text-muted-foreground font-semibold">
                                                    <button onClick={() => toggleSort('disposition')} className="inline-flex items-center gap-1 hover:text-foreground cursor-pointer" aria-label="Sort by disposition">
                                                        Disposition <SortIcon column="disposition" />
                                                    </button>
                                                </th>
                                                <th className="h-12 px-4 text-left align-middle font-medium text-muted-foreground font-semibold">
                                                    <button onClick={() => toggleSort('created_at')} className="inline-flex items-center gap-1 hover:text-foreground cursor-pointer" aria-label="Sort by date">
                                                        Date <SortIcon column="created_at" />
                                                    </button>
                                                </th>
                                                <th className="h-12 px-4 text-right align-middle font-medium text-muted-foreground font-semibold">
                                                    <button onClick={() => toggleSort('call_duration_seconds')} className="inline-flex items-center gap-1 hover:text-foreground cursor-pointer ml-auto" aria-label="Sort by duration">
                                                        Duration <SortIcon column="call_duration_seconds" />
                                                    </button>
                                                </th>
                                                {organizationPricing?.price_per_second_usd && (
                                                    <th className="h-12 px-4 text-right align-middle font-medium text-muted-foreground font-semibold">
                                                        <button onClick={() => toggleSort('charge_usd')} className="inline-flex items-center gap-1 hover:text-foreground cursor-pointer ml-auto" aria-label="Sort by cost">
                                                            Cost (USD) <SortIcon column="charge_usd" />
                                                        </button>
                                                    </th>
                                                )}
                                                <th className="sticky right-0 z-10 bg-card h-12 px-4 align-middle font-medium text-muted-foreground font-semibold text-right">Actions</th>
                                            </tr>
                                        </thead>
                                        <tbody className="[&_tr:last-child]:border-0">
                                            {sortedRuns.map((run) => (
                                                <tr
                                                    key={run.id}
                                                    className="border-b border-border transition-colors hover:bg-muted/50 cursor-pointer"
                                                >
                                                    <td
                                                        className="p-4 align-middle font-mono text-sm cursor-pointer hover:underline"
                                                        onClick={() => handleRowClick(run)}
                                                    >
                                                        #{run.id}
                                                    </td>
                                                    <td className="p-4 align-middle text-sm max-w-48 truncate" title={displayConversationTitle(run)}>
                                                        <TableNameLink href={conversationHref(run.id)}>{displayConversationTitle(run)}</TableNameLink>
                                                    </td>
                                                    <td className="p-4 align-middle">
                                                        <CallTypeCell mode={run.mode} callType={run.call_type} />
                                                    </td>
                                                    <td className="p-4 align-middle text-sm">
                                                        {(run.call_type === 'inbound'
                                                            ? run.caller_number
                                                            : run.called_number) || '-'}
                                                    </td>
                                                    <td className="p-4 align-middle">
                                                        <DispositionBadge disposition={run.disposition} />
                                                    </td>
                                                    <td className="p-4 align-middle">{formatDateTime(run.created_at)}</td>
                                                    <td className="p-4 align-middle text-right">
                                                        {formatDuration(run.call_duration_seconds)}
                                                    </td>
                                                    {organizationPricing?.price_per_second_usd && (
                                                        <td className="p-4 align-middle text-right font-medium">
                                                            {run.charge_usd !== undefined && run.charge_usd !== null
                                                                ? `$${run.charge_usd.toFixed(2)}`
                                                                : '-'
                                                            }
                                                        </td>
                                                    )}
                                                    <td className="sticky right-0 z-10 bg-card p-4 text-right align-middle">
                                                        <RowActionsMenu label={`Actions for run ${run.id}`}>
                                                            <RowAction icon={<ExternalLink />} href={conversationHref(run.id)}>View run</RowAction>
                                                            <RunMediaAction
                                                                recordingUrl={run.recording_url}
                                                                fallbackRecordingUrl={run.user_recording_url ?? run.bot_recording_url}
                                                                transcriptUrl={run.transcript_url}
                                                                videoUrl={
                                                                    // types.gen.ts predates the video artifact fields; narrow at runtime.
                                                                    "video_recording_public_url" in run &&
                                                                    typeof run.video_recording_public_url === "string" &&
                                                                    run.video_recording_public_url.length > 0
                                                                        ? run.video_recording_public_url
                                                                        : null
                                                                }
                                                                runId={run.id}
                                                                onOpenPreview={mediaPreview.openPreview}
                                                            />
                                                        </RowActionsMenu>
</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>

                                {usageHistory.total_pages > 1 && (
                                    <div className="flex flex-col sm:flex-row items-center justify-between gap-3 p-4 px-6 border-t border-border bg-muted/10">
                                        <p className="text-sm text-muted-foreground">
                                            Page {usageHistory.page} of {usageHistory.total_pages} ({usageHistory.total_count} total runs)
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
                                                    const total = usageHistory.total_pages;
                                                    const current = currentPage;
                                                    if (total <= 7) {
                                                        for (let i = 1; i <= total; i++) pages.push(i);
                                                    } else {
                                                        pages.push(1);
                                                        if (current > 3) pages.push('ellipsis');
                                                        for (let i = Math.max(2, current - 1); i <= Math.min(total - 1, current + 1); i++) {
                                                            pages.push(i);
                                                        }
                                                        if (current < total - 2) pages.push('ellipsis');
                                                        pages.push(total);
                                                    }
                                                    return pages.map((p, idx) =>
                                                        p === 'ellipsis' ? (
                                                            <PaginationItem key={`e-${idx}`}>
                                                                <PaginationEllipsis />
                                                            </PaginationItem>
                                                        ) : (
                                                            <PaginationItem key={p}>
                                                                <PaginationLink
                                                                    isActive={p === current}
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
                                                        className={currentPage >= usageHistory.total_pages ? 'pointer-events-none opacity-50' : 'cursor-pointer'}
                                                    />
                                                </PaginationItem>
                                            </PaginationContent>
                                        </Pagination>
                                    </div>
                                )}
                            </>
                        ) : (
                            <p className="text-center py-12 text-muted-foreground">
                                {searchQuery ? "No runs match your search" : "No runs found"}
                            </p>
                        )}
                    </CardContent>
                </Card>

                {/* Media Preview Dialog */}
                {mediaPreview.dialog}
        </div>
    );
}
