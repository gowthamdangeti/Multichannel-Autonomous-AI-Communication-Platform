"use client";

import { ArrowDown, ArrowUp, ArrowUpDown, ExternalLink, Eye, Pencil, Plus, RotateCcw, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
    deleteToolApiV1ToolsToolUuidDelete,
    listToolsApiV1ToolsGet,
    unarchiveToolApiV1ToolsToolUuidUnarchivePost,
} from "@/client/sdk.gen";
import type { ToolResponse } from "@/client/types.gen";
import { PageFilterSelect } from "@/components/layout/PageFilterSelect";
import { PageSearchInput } from "@/components/layout/PageSearchInput";
import { RowAction, RowActionSeparator, RowActionsMenu } from "@/components/layout/RowActionsMenu";
import { TableCellLink } from "@/components/layout/TableCellLink";
import {
    getCategoryConfig,
    getToolIcon,
    getToolTypeLabel,
    renderToolIcon,
    type ToolCategory,
} from "@/components/tools/config";
import { ToolDetailsDrawer } from "@/components/tools/ToolDetailsDrawer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
    Card,
    CardContent,
} from "@/components/ui/card";
import { Pagination, PaginationContent, PaginationEllipsis, PaginationItem, PaginationLink, PaginationNext, PaginationPrevious } from "@/components/ui/pagination";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/context/HeaderContext";
import { useAuth } from "@/lib/auth";
import { ALL_FILTER, matchesFilter, toFilterOptions } from "@/lib/searchFilter";

export default function ToolsPage() {
    const { user, getAccessToken, redirectToLogin, loading } = useAuth();

    const [tools, setTools] = useState<ToolResponse[]>([]);
    const [selectedTool, setSelectedTool] = useState<ToolResponse | null>(null);
    const [isCreateOpen, setIsCreateOpen] = useState(false);
    const [selectedTab, setSelectedTab] = useState<"general" | "config" | "post_execution">("general");
    const [isLoading, setIsLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState("");
    const [error, setError] = useState<string | null>(null);

    // Pagination state
    const [currentPage, setCurrentPage] = useState(1);

    useEffect(() => {
        setCurrentPage(1);
    }, [searchQuery]);

    // Redirect if not authenticated
    useEffect(() => {
        if (!loading && !user) {
            redirectToLogin();
        }
    }, [loading, user, redirectToLogin]);

    const fetchTools = useCallback(async () => {
        if (loading || !user) return;

        try {
            setIsLoading(true);
            setError(null);
            const accessToken = await getAccessToken();

            const response = await listToolsApiV1ToolsGet({
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                },
                query: {
                    status: "active,archived",
                },
            });

            if (response.data) {
                setTools(response.data);
            }
        } catch (err) {
            setError("Failed to fetch tools");
            console.error("Error fetching tools:", err);
        } finally {
            setIsLoading(false);
        }
    }, [loading, user, getAccessToken]);

    useEffect(() => {
        fetchTools();
    }, [fetchTools]);

    const handleDeleteTool = async (toolUuid: string, e: React.MouseEvent) => {
        e.stopPropagation();
        if (!confirm("Are you sure you want to archive this tool?")) return;

        try {
            setError(null);
            const accessToken = await getAccessToken();

            await deleteToolApiV1ToolsToolUuidDelete({
                path: {
                    tool_uuid: toolUuid,
                },
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                },
            });

            fetchTools();
        } catch (err) {
            setError("Failed to archive tool");
            console.error("Error archiving tool:", err);
        }
    };

    const handleUnarchiveTool = async (toolUuid: string, e: React.MouseEvent) => {
        e.stopPropagation();

        try {
            setError(null);
            const accessToken = await getAccessToken();

            await unarchiveToolApiV1ToolsToolUuidUnarchivePost({
                path: {
                    tool_uuid: toolUuid,
                },
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                },
            });

            fetchTools();
        } catch (err) {
            setError("Failed to unarchive tool");
            console.error("Error unarchiving tool:", err);
        }
    };

    const [typeFilter, setTypeFilter] = useState(ALL_FILTER);
    const [statusFilter, setStatusFilter] = useState(ALL_FILTER);
    const filteredTools = tools.filter(
        (tool) =>
            matchesFilter(tool.category, typeFilter) &&
            matchesFilter(tool.status, statusFilter) &&
            (tool.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                tool.description?.toLowerCase().includes(searchQuery.toLowerCase()) ||
                String(tool.id).includes(searchQuery) ||
                tool.tool_uuid.toLowerCase().includes(searchQuery.toLowerCase()))
    );

    // Header sorting (client-side, current list only).
    // Default is newest-first to preserve the previous fixed ordering.
    type ToolSortKey = 'id' | 'name' | 'category' | 'created_at' | 'status';
    const [sortKey, setSortKey] = useState<ToolSortKey | null>('created_at');
    const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
    const toggleSort = (key: ToolSortKey) => {
        if (sortKey !== key) {
            setSortKey(key);
            setSortDir('asc');
        } else if (sortDir === 'asc') {
            setSortDir('desc');
        } else {
            setSortKey('created_at');
            setSortDir('desc');
        }
        setCurrentPage(1);
    };
    const SortIcon = ({ column }: { column: ToolSortKey }) => {
        if (sortKey !== column) return <ArrowUpDown className="h-3.5 w-3.5 text-muted-foreground/60" />;
        return sortDir === 'asc'
            ? <ArrowUp className="h-3.5 w-3.5 text-foreground" />
            : <ArrowDown className="h-3.5 w-3.5 text-foreground" />;
    };
    const sortedTools = useMemo(() => {
        if (!sortKey) return filteredTools;
        const dir = sortDir === 'asc' ? 1 : -1;
        return [...filteredTools].sort((a, b) => {
            switch (sortKey) {
                case 'id':
                    return (a.id - b.id) * dir;
                case 'name':
                    return (a.name ?? '').localeCompare(b.name ?? '') * dir;
                case 'category':
                    return (a.category ?? '').localeCompare(b.category ?? '') * dir;
                case 'created_at':
                    return ((a.created_at ? new Date(a.created_at).getTime() : 0) - (b.created_at ? new Date(b.created_at).getTime() : 0)) * dir;
                case 'status':
                    return (a.status ?? '').localeCompare(b.status ?? '') * dir;
            }
        });
    }, [filteredTools, sortKey, sortDir]);

    const ITEMS_PER_PAGE = 8;
    const totalCount = sortedTools.length;
    const totalPages = Math.ceil(totalCount / ITEMS_PER_PAGE);
    const activePage = Math.min(currentPage, Math.max(1, totalPages));
    const paginatedTools = sortedTools.slice(
        (activePage - 1) * ITEMS_PER_PAGE,
        activePage * ITEMS_PER_PAGE
    );

    const getCategoryBadge = (category: string) => {
        const Icon = getToolIcon(category);
        switch (category) {
            case "http_api":
                return (
                    <Badge variant="info" className="gap-1 px-2.5 py-0.5 font-medium whitespace-nowrap">
                        <Icon className="w-3 h-3 shrink-0" />
                        HTTP API
                    </Badge>
                );
            case "end_call":
                return (
                    <Badge variant="rose" className="gap-1 px-2.5 py-0.5 font-medium whitespace-nowrap">
                        <Icon className="w-3 h-3 shrink-0" />
                        End Call
                    </Badge>
                );
            case "transfer_call":
                return (
                    <Badge variant="emerald" className="gap-1 px-2.5 py-0.5 font-medium whitespace-nowrap">
                        <Icon className="w-3 h-3 shrink-0" />
                        Transfer Call
                    </Badge>
                );
            case "calculator":
                return (
                    <Badge variant="purple" className="gap-1 px-2.5 py-0.5 font-medium whitespace-nowrap">
                        <Icon className="w-3 h-3 shrink-0" />
                        Calculator
                    </Badge>
                );
            case "mcp":
                return (
                    <Badge variant="violet" className="gap-1 px-2.5 py-0.5 font-medium whitespace-nowrap">
                        <Icon className="w-3 h-3 shrink-0" />
                        MCP
                    </Badge>
                );
            case "website_scraper":
                return (
                    <Badge variant="primary" className="gap-1 px-2.5 py-0.5 font-medium whitespace-nowrap border-primary/20 bg-primary/10 hover:bg-primary/15 hover:border-primary/30">
                        <Icon className="w-3 h-3 shrink-0" />
                        Web Scraper
                    </Badge>
                );
            case "native":
                return (
                    <Badge variant="cyan" className="gap-1 px-2.5 py-0.5 font-medium whitespace-nowrap">
                        <Icon className="w-3 h-3 shrink-0" />
                        Native
                    </Badge>
                );
            case "integration":
                return (
                    <Badge variant="indigo" className="gap-1 px-2.5 py-0.5 font-medium whitespace-nowrap">
                        <Icon className="w-3 h-3 shrink-0" />
                        Integration
                    </Badge>
                );
            default: {
                const config = getCategoryConfig(category as ToolCategory);
                const label = config?.label || category.split("_").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
                return (
                    <Badge variant="outline" className="gap-1 px-2.5 py-0.5 font-medium whitespace-nowrap">
                        <Icon className="w-3 h-3 shrink-0" />
                        {label}
                    </Badge>
                );
            }
        }
    };

    const getStatusBadge = (status: string) => {
        switch (status) {
            case "active":
                return <Badge variant="success">Active</Badge>;
            case "draft":
                return <Badge variant="warning">Draft</Badge>;
            case "archived":
                return <Badge variant="destructive">Archived</Badge>;
            default:
                return <Badge variant="outline">{status}</Badge>;
        }
    };

    const getToolMethod = (tool: ToolResponse) => {
        if (tool.category === "http_api") {
            const def = tool.definition as Record<string, unknown>;
            return (def?.config as Record<string, unknown>)?.method as string || "—";
        }
        return "—";
    };

    const formatDate = (dateString?: string | null): string => {
        if (!dateString) return "—";
        const date = new Date(dateString);
        if (isNaN(date.getTime())) return "—";
        return date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
    };

    const getMethodBadge = (method: string) => {
        const m = method.toUpperCase();
        switch (m) {
            case "GET":
                return <Badge variant="success" className="font-mono text-[10px] font-bold">GET</Badge>;
            case "POST":
                return <Badge variant="warning" className="font-mono text-[10px] font-bold">POST</Badge>;
            case "PUT":
                return <Badge variant="info" className="font-mono text-[10px] font-bold">PUT</Badge>;
            case "DELETE":
                return <Badge variant="destructive" className="font-mono text-[10px] font-bold">DELETE</Badge>;
            case "PATCH":
                return <Badge variant="purple" className="font-mono text-[10px] font-bold">PATCH</Badge>;
            case "—":
            case "-":
                return <span className="text-muted-foreground font-normal text-xs">—</span>;
            default:
                return <Badge variant="outline" className="font-mono text-[10px] font-bold">{m}</Badge>;
        }
    };

    if (loading || !user) {
        return (
            <div className="px-4 lg:px-6 pt-2 pb-6">
                <div className="space-y-4">
                    <Skeleton className="h-12 w-64" />
                    <Skeleton className="h-64 w-full" />
                </div>
            </div>
        );
    }

    return (
        <div className="px-4 lg:px-6 pt-2 pb-6">
            <PageHeader
                title="Tools"
                subtitle={
                    <span>
                        Manage reusable tools that can be used across your workflows.{" "}
                        <a href="https://docs.convozent.ai/voice-agent/tools/introduction" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 underline">
                            Learn more <ExternalLink className="h-3 w-3" />
                        </a>
                    </span>
                }
                onRefresh={() => void fetchTools()}
                isRefreshing={isLoading}
                primaryAction={<Button onClick={() => { setSelectedTool(null); setIsCreateOpen(true); setSelectedTab("general"); }}>
                        <Plus className="w-4 h-4 mr-2" />
                        Create Tool
                    </Button>}
                toolbar={
                    <>
                        <PageSearchInput placeholder="Search tools..." value={searchQuery} onChange={setSearchQuery} />
                        <PageFilterSelect allLabel="All types" value={typeFilter} options={toFilterOptions(tools, (tool) => tool.category, getToolTypeLabel)} onChange={setTypeFilter} />
                        <PageFilterSelect allLabel="All statuses" value={statusFilter} options={toFilterOptions(tools, (tool) => tool.status)} onChange={setStatusFilter} />
                    </>
                }
            />

            {error && (
                <div className="mb-4 p-4 bg-destructive/10 border border-destructive/20 rounded-lg text-destructive">
                    {error}
                </div>
            )}

            <div className="mt-4">

                <Card className="overflow-hidden">
                    <CardContent className="p-0 overflow-hidden rounded-[inherit]">
                        {isLoading ? (
                            <div className="p-4 space-y-4">
                                {[1, 2, 3].map((i) => (
                                    <div
                                        key={i}
                                        className="flex items-center justify-between p-4 border rounded-lg"
                                    >
                                        <div className="space-y-2">
                                            <Skeleton className="h-4 w-32" />
                                            <Skeleton className="h-3 w-48" />
                                        </div>
                                        <Skeleton className="h-8 w-20" />
                                    </div>
                                ))}
                            </div>
                        ) : filteredTools.length === 0 ? (
                            <div className="text-center py-12">
                                {renderToolIcon("http_api", "w-12 h-12 text-muted-foreground mx-auto mb-4")}
                                <p className="text-muted-foreground mb-4">
                                    {searchQuery
                                        ? "No tools match your search"
                                        : "No tools found"}
                                </p>
                                {!searchQuery && (
                                    <Button
                                        onClick={() => {
                                            setSelectedTool(null);
                                            setIsCreateOpen(true);
                                            setSelectedTab("general");
                                        }}
                                        size="sm"
                                        className="h-8"
                                    >
                                        Create Your First Tool
                                    </Button>
                                )}
                            </div>
                        ) : (
                            <div className="relative w-full overflow-auto rounded-t-[inherit]">
                                <table className="w-full caption-bottom text-sm">
                                    <thead className="[&_tr]:border-b border-border">
                                        <tr className="border-b border-border transition-colors hover:bg-muted/50 data-[state=selected]:bg-muted">
                                            <th className="h-10 px-4 text-left align-middle font-medium text-muted-foreground">
                                                <button onClick={() => toggleSort('id')} className="inline-flex items-center gap-1 hover:text-foreground cursor-pointer" aria-label="Sort by ID">
                                                    ID <SortIcon column="id" />
                                                </button>
                                            </th>
                                            <th className="h-10 px-4 text-left align-middle font-medium text-muted-foreground">
                                                <button onClick={() => toggleSort('name')} className="inline-flex items-center gap-1 hover:text-foreground cursor-pointer" aria-label="Sort by tool name">
                                                    Tool Name <SortIcon column="name" />
                                                </button>
                                            </th>
                                            <th className="h-10 px-4 text-left align-middle font-medium text-muted-foreground w-36">
                                                <button onClick={() => toggleSort('category')} className="inline-flex items-center gap-1 hover:text-foreground cursor-pointer" aria-label="Sort by category">
                                                    Category <SortIcon column="category" />
                                                </button>
                                            </th>
                                            <th className="h-10 px-4 text-left align-middle font-medium text-muted-foreground w-24">
                                                Method
                                            </th>
                                            <th className="h-10 px-4 text-left align-middle font-medium text-muted-foreground w-44">
                                                <button onClick={() => toggleSort('created_at')} className="inline-flex items-center gap-1 hover:text-foreground cursor-pointer" aria-label="Sort by created date">
                                                    Created Date <SortIcon column="created_at" />
                                                </button>
                                            </th>
                                            <th className="h-10 px-4 text-left align-middle font-medium text-muted-foreground w-32">
                                                <button onClick={() => toggleSort('status')} className="inline-flex items-center gap-1 hover:text-foreground cursor-pointer" aria-label="Sort by status">
                                                    Status <SortIcon column="status" />
                                                </button>
                                            </th>
                                            <th className="h-10 px-4 align-middle font-medium text-muted-foreground w-20 text-right">
                                                Actions
                                            </th>
                                        </tr>
                                    </thead>
                                    <tbody className="[&_tr:last-child]:border-0">
                                        {paginatedTools.map((tool) => (
                                            <tr
                                                key={tool.tool_uuid}
                                                className="border-b border-border transition-colors hover:bg-muted/50 data-[state=selected]:bg-muted cursor-pointer"
                                                onClick={() => {
                                                    setSelectedTool(tool);
                                                    setIsCreateOpen(false);
                                                    setSelectedTab("general");
                                                }}
                                            >
                                                <td className="p-4 align-middle text-muted-foreground font-mono text-xs">
                                                    #{tool.id}
                                                </td>
                                                <td className="p-4 align-middle font-medium">
                                                    <div className="flex flex-col gap-0.5">
                                                        <TableCellLink
                                                            onClick={() => {
                                                                setSelectedTool(tool);
                                                                setIsCreateOpen(false);
                                                                setSelectedTab("general");
                                                            }}
                                                            className="w-fit"
                                                        >
                                                            {tool.name}
                                                        </TableCellLink>
                                                        {tool.description && (
                                                            <span className="text-xs font-normal text-muted-foreground max-w-sm truncate" title={tool.description}>
                                                                {tool.description}
                                                            </span>
                                                        )}
                                                    </div>
                                                </td>
                                                <td className="p-4 align-middle whitespace-nowrap">
                                                    {getCategoryBadge(tool.category)}
                                                </td>
                                                <td className="p-4 align-middle">
                                                    {getMethodBadge(getToolMethod(tool))}
                                                </td>
                                                <td className="p-4 align-middle text-foreground font-medium whitespace-nowrap text-sm">
                                                    {formatDate(tool.created_at)}
                                                </td>
                                                <td className="p-4 align-middle">
                                                    {getStatusBadge(tool.status)}
                                                </td>
                                                <td className="p-4 align-middle text-right" onClick={(e) => e.stopPropagation()}>
                                                    <RowActionsMenu label={`Actions for ${tool.name}`}>
                                                        <RowAction
                                                            icon={<Eye className="size-4" />}
                                                            onClick={() => {
                                                                setSelectedTool(tool);
                                                                setIsCreateOpen(false);
                                                                setSelectedTab("general");
                                                            }}
                                                        >
                                                            View details
                                                        </RowAction>
                                                        <RowAction
                                                            icon={<Pencil className="size-4" />}
                                                            onClick={() => {
                                                                setSelectedTool(tool);
                                                                setIsCreateOpen(false);
                                                                setSelectedTab("config");
                                                            }}
                                                        >
                                                            Edit
                                                        </RowAction>
                                                        <RowActionSeparator />
                                                        {tool.status === "active" ? (
                                                            <RowAction icon={<Trash2 />} onClick={(e) =>
                                                                handleDeleteTool(tool.tool_uuid, e)
                                                            } destructive>Delete</RowAction>
                                                        ) : (
                                                            <RowAction icon={<RotateCcw />} onClick={(e) =>
                                                                handleUnarchiveTool(tool.tool_uuid, e)
                                                            }>Restore</RowAction>
                                                        )}
                                                    </RowActionsMenu>
</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
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
                    </CardContent>
                </Card>
            </div>

            {/* Tool detail & create — off-canvas drawer */}
            <ToolDetailsDrawer
                tool={selectedTool}
                isOpen={selectedTool !== null || isCreateOpen}
                isCreate={isCreateOpen}
                initialTab={selectedTab}
                onOpenChange={(open) => {
                    if (!open) {
                        setSelectedTool(null);
                        setIsCreateOpen(false);
                    }
                }}
                onToolCreated={(newTool) => {
                    setTools((prev) => [newTool, ...prev]);
                    setSelectedTool(newTool);
                    setIsCreateOpen(false);
                }}
                onToolSaved={(saved) => {
                    setTools((prev) => prev.map((t) => (t.tool_uuid === saved.tool_uuid ? saved : t)));
                    setSelectedTool(saved);
                }}
            />
        </div>
    );
}
