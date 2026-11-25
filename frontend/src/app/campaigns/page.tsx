"use client";

import { Eye } from "lucide-react";
import { ArrowDown, ArrowUp, ArrowUpDown, Plus, Trash2 } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';

import { client } from '@/client/client.gen';
import { getCampaignsApiV1CampaignGet } from '@/client/sdk.gen';
import type { CampaignResponse, CampaignsResponse } from '@/client/types.gen';
import { CreateCampaignDrawer } from "@/components/campaigns/CreateCampaignDrawer";
import { toneForState } from "@/components/campaigns/detail/CampaignDetailParts";
import { PageFilterSelect } from "@/components/layout/PageFilterSelect";
import { PageSearchInput } from "@/components/layout/PageSearchInput";
import { RowAction, RowActionSeparator, RowActionsMenu } from "@/components/layout/RowActionsMenu";
import { TableNameLink } from "@/components/layout/TableNameLink";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
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
} from '@/components/ui/table';
import { PageHeader } from "@/context/HeaderContext";
import { detailFromError } from '@/lib/apiError';
import { useAuth } from '@/lib/auth';
import { ALL_FILTER, matchesFilter, toFilterOptions } from "@/lib/searchFilter";

export default function CampaignsPage() {
    const { user, getAccessToken, redirectToLogin, loading } = useAuth();
    const router = useRouter();
    const searchParams = useSearchParams();

    const [campaignsData, setCampaignsData] = useState<CampaignsResponse | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState("");
    const [refreshing, setRefreshing] = useState(false);
    const [deleteTarget, setDeleteTarget] = useState<CampaignsResponse['campaigns'][number] | null>(null);
    const [isDeleting, setIsDeleting] = useState(false);
    const [isCreateDrawerOpen, setIsCreateDrawerOpen] = useState(false);
    const hasFetched = useRef(false);

    // Automatically open drawer if redirected with ?create=true
    useEffect(() => {
        if (searchParams.get("create") === "true") {
            setIsCreateDrawerOpen(true);
        }
    }, [searchParams]);

    // Pagination state
    const [currentPage, setCurrentPage] = useState(1);

    // Redirect if not authenticated
    useEffect(() => {
        if (!loading && !user) {
            redirectToLogin();
        }
    }, [loading, user, redirectToLogin]);

    const fetchCampaigns = useCallback(async () => {
        setIsLoading(true);
        try {
            const accessToken = await getAccessToken();
            const response = await getCampaignsApiV1CampaignGet({
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                }
            });

            if (response.data) {
                setCampaignsData(response.data);
            }
        } catch (error) {
            console.error('Failed to fetch campaigns:', error);
        } finally {
            setIsLoading(false);
        }
    }, [getAccessToken]);

    const handleRefresh = async () => {
        setRefreshing(true);
        try {
            const accessToken = await getAccessToken();
            const response = await getCampaignsApiV1CampaignGet({
                headers: { 'Authorization': `Bearer ${accessToken}` }
            });
            if (response.data) setCampaignsData(response.data);
        } catch (error) {
            console.error('Failed to refresh campaigns:', error);
        } finally {
            setRefreshing(false);
        }
    };

    // Fetch campaigns once when user is ready
    useEffect(() => {
        if (loading || !user || hasFetched.current) {
            return;
        }
        hasFetched.current = true;
        fetchCampaigns();
    }, [loading, user, fetchCampaigns]);

    const handleRowClick = (campaignId: number) => {
        router.push(`/campaigns/${campaignId}`);
    };

    const handleCreateCampaign = () => {
        setIsCreateDrawerOpen(true);
    };

    const handleDrawerOpenChange = (open: boolean) => {
        setIsCreateDrawerOpen(open);
        if (!open && searchParams.get("create") === "true") {
            router.replace("/campaigns", { scroll: false });
        }
    };

    const handleCampaignCreated = (newCampaign: CampaignResponse) => {
        setIsCreateDrawerOpen(false);
        fetchCampaigns();
        router.push(`/campaigns/${newCampaign.id}`);
    };
    const handleDeleteCampaign = async () => {
        if (!deleteTarget) return;

        setIsDeleting(true);
        try {
            const accessToken = await getAccessToken();
            const response = await client.delete({
                url: '/api/v1/campaign/{campaign_id}',
                path: { campaign_id: deleteTarget.id },
                headers: { Authorization: `Bearer ${accessToken}` },
            });
            if (response.error) throw new Error(detailFromError(response.error));

            setCampaignsData((current) => current
                ? { campaigns: current.campaigns.filter((campaign) => campaign.id !== deleteTarget.id) }
                : current,
            );
            setDeleteTarget(null);
            toast.success('Campaign deleted and scheduled calls cancelled');
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Failed to delete campaign');
        } finally {
            setIsDeleting(false);
        }
    };


    const [stateFilter, setStateFilter] = useState(ALL_FILTER);
    const [agentFilter, setAgentFilter] = useState(ALL_FILTER);
    const allCampaigns = campaignsData?.campaigns ?? [];
    const filteredCampaigns = allCampaigns.filter((c) => {
        if (!matchesFilter(c.state, stateFilter) || !matchesFilter(c.workflow_name, agentFilter)) return false;
        if (!searchQuery) return true;
        const q = searchQuery.toLowerCase().trim();
        return (
            c.name.toLowerCase().includes(q) ||
            (c.workflow_name || '').toLowerCase().includes(q) ||
            c.state.toLowerCase().includes(q) ||
            c.id.toString().includes(q)
        );
    });
    // Header sorting (client-side, current list only; null = server order).
    type CampaignSortKey = 'id' | 'name' | 'workflow_name' | 'state' | 'created_at';
    const [sortKey, setSortKey] = useState<CampaignSortKey | null>(null);
    const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
    const toggleSort = (key: CampaignSortKey) => {
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
    const SortIcon = ({ column }: { column: CampaignSortKey }) => {
        if (sortKey !== column) return <ArrowUpDown className="h-3.5 w-3.5 text-muted-foreground/60" />;
        return sortDir === 'asc'
            ? <ArrowUp className="h-3.5 w-3.5 text-foreground" />
            : <ArrowDown className="h-3.5 w-3.5 text-foreground" />;
    };
    const sortedCampaigns = useMemo(() => {
        if (!sortKey) return filteredCampaigns;
        const dir = sortDir === 'asc' ? 1 : -1;
        return [...filteredCampaigns].sort((a, b) => {
            switch (sortKey) {
                case 'id':
                    return (a.id - b.id) * dir;
                case 'name':
                    return (a.name ?? '').localeCompare(b.name ?? '') * dir;
                case 'workflow_name':
                    return (a.workflow_name ?? '').localeCompare(b.workflow_name ?? '') * dir;
                case 'state':
                    return (a.state ?? '').localeCompare(b.state ?? '') * dir;
                case 'created_at':
                    return (new Date(a.created_at).getTime() - new Date(b.created_at).getTime()) * dir;
            }
        });
    }, [filteredCampaigns, sortKey, sortDir]);

    const ITEMS_PER_PAGE = 8;
    const totalCount = sortedCampaigns.length;
    const totalPages = Math.ceil(totalCount / ITEMS_PER_PAGE);
    const activePage = Math.min(currentPage, Math.max(1, totalPages));
    const paginatedCampaigns = sortedCampaigns.slice(
        (activePage - 1) * ITEMS_PER_PAGE,
        activePage * ITEMS_PER_PAGE
    );

    // Same state colours as the campaign detail page.
    const getStateBadgeVariant = toneForState;

    return (
        <div className="px-4 lg:px-6 pt-2 pb-6 space-y-4">
            <PageHeader
                title="Campaigns"
                subtitle="View and manage your voice agent campaigns."
                onRefresh={handleRefresh}
                isRefreshing={refreshing || isLoading}
                primaryAction={<Button onClick={handleCreateCampaign}>
                        <Plus className="h-4 w-4 mr-2" />
                        Create Campaign
                    </Button>}
                toolbar={
                    <>
                        <PageSearchInput placeholder="Search campaigns..." value={searchQuery} onChange={setSearchQuery} />
                        <PageFilterSelect allLabel="All states" value={stateFilter} options={toFilterOptions(allCampaigns, (c) => c.state)} onChange={setStateFilter} />
                        <PageFilterSelect allLabel="All workflows" value={agentFilter} options={toFilterOptions(allCampaigns, (c) => c.workflow_name, (name) => name)} onChange={setAgentFilter} />
                    </>
                }
            />

            {isLoading ? (
                <Card className="nb-card border border-border">
                    <CardContent className="p-6">
                        <div className="animate-pulse space-y-3">
                            {[...Array(5)].map((_, i) => (
                                <div key={i} className="h-12 bg-muted rounded"></div>
                            ))}
                        </div>
                    </CardContent>
                </Card>
            ) : paginatedCampaigns.length > 0 ? (
                <>
                    {/* Desktop View: Table identical to Voice Agents (WorkflowTable) */}
                    <div className="hidden md:block">
                        <Card className="nb-card overflow-hidden border border-border">
                            <CardContent className="p-0">
                                <Table>
                                    <TableHeader className="nb-table-header">
                                        <TableRow>
                                            <TableHead className="font-semibold">
                                                <button onClick={() => toggleSort('id')} className="inline-flex items-center gap-1 hover:text-foreground cursor-pointer" aria-label="Sort by ID">
                                                    ID <SortIcon column="id" />
                                                </button>
                                            </TableHead>
                                            <TableHead className="font-semibold">
                                                <button onClick={() => toggleSort('name')} className="inline-flex items-center gap-1 hover:text-foreground cursor-pointer" aria-label="Sort by name">
                                                    Name <SortIcon column="name" />
                                                </button>
                                            </TableHead>
                                            <TableHead className="font-semibold">
                                                <button onClick={() => toggleSort('workflow_name')} className="inline-flex items-center gap-1 hover:text-foreground cursor-pointer" aria-label="Sort by workflow">
                                                    Workflow <SortIcon column="workflow_name" />
                                                </button>
                                            </TableHead>
                                            <TableHead className="font-semibold">
                                                <button onClick={() => toggleSort('state')} className="inline-flex items-center gap-1 hover:text-foreground cursor-pointer" aria-label="Sort by state">
                                                    State <SortIcon column="state" />
                                                </button>
                                            </TableHead>
                                            <TableHead className="font-semibold text-center">Progress</TableHead>
                                            <TableHead className="font-semibold">
                                                <button onClick={() => toggleSort('created_at')} className="inline-flex items-center gap-1 hover:text-foreground cursor-pointer" aria-label="Sort by created date">
                                                    Created At <SortIcon column="created_at" />
                                                </button>
                                            </TableHead>
                                            <TableHead className="font-semibold text-right">Actions</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {paginatedCampaigns.map((campaign) => (
                                            <TableRow
                                                key={campaign.id}
                                                className="hover:bg-accent/50 transition-colors cursor-pointer"
                                                onClick={() => handleRowClick(campaign.id)}
                                            >
                                                <TableCell className="text-muted-foreground font-mono">
                                                    #{campaign.id}
                                                </TableCell>
                                                <TableCell className="font-medium">
                                                    <TableNameLink href={`/campaigns/${campaign.id}`}>{campaign.name}</TableNameLink>
                                                </TableCell>
                                                <TableCell>
                                                    {campaign.workflow_name || '-'}
                                                </TableCell>
                                                <TableCell>
                                                    <Badge variant={getStateBadgeVariant(campaign.state)}>
                                                        {campaign.state}
                                                    </Badge>
                                                </TableCell>
                                                <TableCell className="text-center">
                                                    <span className="inline-flex items-center justify-center min-w-[2rem] px-2 py-1 text-sm font-semibold bg-muted rounded-full">
                                                        {campaign.executed_count} / {campaign.total_queued_count}
                                                    </span>
                                                </TableCell>
                                                <TableCell>
                                                    {new Date(campaign.created_at).toLocaleDateString('en-US', {
                                                        year: 'numeric',
                                                        month: 'short',
                                                        day: 'numeric',
                                                    })}
                                                </TableCell>
                                                <TableCell className="text-right">
                                                    <RowActionsMenu label={`Actions for ${campaign.name}`}>
                                                        <RowAction icon={<Eye />} onClick={(e) => {
                                                                e.stopPropagation();
                                                                handleRowClick(campaign.id);
                                                            }}>View</RowAction>
                                                        <RowActionSeparator />
                                                        <RowAction icon={<Trash2 />} onClick={(e) => {
                                                                e.stopPropagation();
                                                                setDeleteTarget(campaign);
                                                            }} destructive>Delete</RowAction>
                                                    </RowActionsMenu>
</TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>

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

                    {/* Mobile View: Premium Cards Stack identical to WorkflowTable */}
                    <div className="flex flex-col gap-3 md:hidden">
                        {paginatedCampaigns.map((campaign) => (
                            <Card
                                key={campaign.id}
                                className="relative overflow-hidden transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md border border-border/60 hover:border-primary/20 bg-card cursor-pointer"
                                onClick={() => handleRowClick(campaign.id)}
                            >
                                <CardContent className="p-4 flex flex-col gap-3">
                                    <div className="flex items-center justify-between">
                                        <span className="text-[10px] font-mono font-semibold tracking-wider text-muted-foreground bg-muted px-2 py-0.5 rounded">
                                            ID: #{campaign.id}
                                        </span>
                                        <Badge variant={getStateBadgeVariant(campaign.state)}>
                                            {campaign.state}
                                        </Badge>
                                    </div>

                                    <div>
                                        <h4 className="font-semibold text-base text-foreground leading-snug tracking-tight">
                                            {campaign.name}
                                        </h4>
                                        <p className="text-xs text-muted-foreground mt-0.5">
                                            Workflow: {campaign.workflow_name || '-'}
                                        </p>
                                    </div>

                                    <div className="flex items-center gap-4 text-xs text-foreground border-y border-border/40 py-2.5 my-0.5">
                                        <div className="flex items-center gap-1.5">
                                            <span className="font-medium text-foreground/70">Created:</span>
                                            <span>
                                                {new Date(campaign.created_at).toLocaleDateString('en-US', {
                                                    month: 'short',
                                                    day: 'numeric',
                                                    year: 'numeric',
                                                })}
                                            </span>
                                        </div>
                                        <div className="w-px h-3 bg-border/60" />
                                        <div className="flex items-center gap-1.5">
                                            <span className="font-medium text-foreground/70">Progress:</span>
                                            <span className="inline-flex items-center justify-center px-2 py-0.5 font-semibold bg-primary/10 text-primary rounded-full text-[11px]">
                                                {campaign.executed_count} / {campaign.total_queued_count}
                                            </span>
                                        </div>
                                    </div>

                                    <div className="flex items-center justify-end gap-2 pt-1">
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                handleRowClick(campaign.id);
                                            }}
                                            className="flex-1 flex items-center justify-center gap-2 h-9 text-xs"
                                        >
                                            View Campaign
                                        </Button>
                                        <Button
                                            variant="destructive"
                                            size="sm"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                setDeleteTarget(campaign);
                                            }}
                                        >
                                            <Trash2 className="h-4 w-4 mr-2" />
                                            Delete
                                        </Button>
                                    </div>
                                </CardContent>
                            </Card>
                        ))}

                        {totalPages > 1 && (
                            <Card className="overflow-hidden border border-border mt-3">
                                <div className="flex flex-col sm:flex-row items-center justify-between gap-3 p-4 px-6 border-t border-border bg-muted/10">
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
                            </Card>
                        )}
                    </div>
                </>
            ) : (
                <Card className="nb-card border border-border">
                    <CardContent className="p-8 text-center text-muted-foreground">
                        <p className="mb-4">No campaigns found</p>
                        <Button onClick={handleCreateCampaign} variant="outline">
                            <Plus className="h-4 w-4 mr-2" />
                            Create your first campaign
                        </Button>
                    </CardContent>
                </Card>
            )}
            <AlertDialog
                open={!!deleteTarget}
                onOpenChange={(open) => !open && !isDeleting && setDeleteTarget(null)}
            >
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Delete “{deleteTarget?.name}”?</AlertDialogTitle>
                        <AlertDialogDescription>
                            This permanently deletes the campaign and cancels all of its queued and scheduled calls. Calls already in progress are not interrupted.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                            disabled={isDeleting}
                            onClick={(event) => {
                                event.preventDefault();
                                void handleDeleteCampaign();
                            }}
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        >
                            Delete campaign
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            {/* Campaign creation off-canvas drawer */}
            <CreateCampaignDrawer
                open={isCreateDrawerOpen}
                onOpenChange={handleDrawerOpenChange}
                onCampaignCreated={handleCampaignCreated}
            />
        </div>
    );
}
