'use client';

import {
    Archive,
    ArrowDown,
    ArrowUp,
    ArrowUpDown,
    Brain,
    Check,
    Folder as FolderIcon,
    FolderInput,
    Inbox,
    Pencil,
    RotateCcw,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState, useTransition } from 'react';
import { toast } from 'sonner';

import {
    getModelConfigurationOptionsApiV1OrganizationsModelConfigurationOptionsGet,
    moveWorkflowToFolderApiV1WorkflowWorkflowIdFolderPut,
    updateWorkflowStatusApiV1WorkflowWorkflowIdStatusPut,
} from '@/client/sdk.gen';
import type { FolderResponse, ModelConfigurationOption } from '@/client/types.gen';
import { RowAction, RowActionSeparator, RowActionsMenu,RowActionSub } from "@/components/layout/RowActionsMenu";
import { TableNameLink } from "@/components/layout/TableNameLink";
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
    Pagination,
    PaginationContent,
    PaginationEllipsis,
    PaginationItem,
    PaginationLink,
    PaginationNext,
    PaginationPrevious,
} from '@/components/ui/pagination';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
interface Workflow {
    id: number;
    name: string;
    status: string;
    created_at: string;
    total_runs?: number | null;
    folder_id?: number | null;
    platform_model_configuration_id?: number | null;
    workflow_configurations?: Record<string, unknown> | null;
}

interface WorkflowTableProps {
    workflows: Workflow[];
    showArchived: boolean;
    /**
     * When provided, each row gets a "Move to folder" action listing these
     * folders. Omit it (e.g. for the archived list) to hide the control.
     */
    folders?: FolderResponse[];
    /** The folder this table is rendered under; null means "Uncategorized". */
    currentFolderId?: number | null;
    /** Called after a successful move so the parent can patch its local
     *  list (router.refresh() alone won't update parent useState). */
    onMoved?: (workflowId: number, folderId: number | null) => void;
    /** Called after a successful archive/restore for the same reason. */
    onStatusChanged?: (workflowId: number, newStatus: string) => void;
}

export function WorkflowTable({
    workflows,
    showArchived,
    folders,
    currentFolderId = null,
    onMoved,
    onStatusChanged,
}: WorkflowTableProps) {
    const router = useRouter();
    const [isPending, startTransition] = useTransition();
    const [loadingWorkflowId, setLoadingWorkflowId] = useState<number | null>(null);
    const [movingWorkflowId, setMovingWorkflowId] = useState<number | null>(null);
    const [presetOptions, setPresetOptions] = useState<ModelConfigurationOption[]>([]);

    useEffect(() => {
        let isMounted = true;
        (async () => {
            try {
                const res = await getModelConfigurationOptionsApiV1OrganizationsModelConfigurationOptionsGet();
                if (isMounted && res.data) {
                    setPresetOptions(res.data);
                }
            } catch {
                // non-fatal
            }
        })();
        return () => {
            isMounted = false;
        };
    }, []);

    const handleViewAgent = (id: number) => {
        router.push(`/voice/agents/${id}/view`);
    };

    // Pagination state
    const [currentPage, setCurrentPage] = useState(1);

    // Header sorting state (client-side, current list only; null = parent order).
    type AgentSortKey = 'id' | 'name' | 'model_config' | 'created_at' | 'total_runs';
    const [sortKey, setSortKey] = useState<AgentSortKey | null>(null);
    const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

    const toggleSort = (key: AgentSortKey) => {
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

    const SortIcon = ({ column }: { column: AgentSortKey }) => {
        if (sortKey !== column) return <ArrowUpDown className="h-3.5 w-3.5 text-muted-foreground/60" />;
        return sortDir === 'asc'
            ? <ArrowUp className="h-3.5 w-3.5 text-foreground" />
            : <ArrowDown className="h-3.5 w-3.5 text-foreground" />;
    };

    const sortedWorkflows = useMemo(() => {
        if (!sortKey) return workflows;
        const getWorkflowModelName = (w: Workflow): string => {
            const wfConfigs = (w.workflow_configurations || {}) as Record<string, unknown>;
            const presetId = w.platform_model_configuration_id ?? wfConfigs.platform_model_configuration_id ?? (presetOptions.length > 0 ? presetOptions[0].id : null);
            if (presetId) {
                const preset = presetOptions.find((p) => p.id === Number(presetId));
                if (preset) return preset.name;
            }
            return '';
        };

        const dir = sortDir === 'asc' ? 1 : -1;
        return [...workflows].sort((a, b) => {
            switch (sortKey) {
                case 'id':
                    return (a.id - b.id) * dir;
                case 'name':
                    return (a.name ?? '').localeCompare(b.name ?? '') * dir;
                case 'model_config':
                    return getWorkflowModelName(a).localeCompare(getWorkflowModelName(b)) * dir;
                case 'created_at':
                    return (new Date(a.created_at).getTime() - new Date(b.created_at).getTime()) * dir;
                case 'total_runs':
                    return ((a.total_runs ?? 0) - (b.total_runs ?? 0)) * dir;
            }
        });
    }, [workflows, sortKey, sortDir, presetOptions]);

    useEffect(() => {
        setCurrentPage(1);
    }, [workflows.length]);

    const ITEMS_PER_PAGE = 8;
    const totalCount = sortedWorkflows.length;
    const totalPages = Math.ceil(totalCount / ITEMS_PER_PAGE);
    const activePage = Math.min(currentPage, Math.max(1, totalPages));

    const paginatedWorkflows = sortedWorkflows.slice(
        (activePage - 1) * ITEMS_PER_PAGE,
        activePage * ITEMS_PER_PAGE
    );

    const handleEdit = (id: number) => {
        router.push(`/voice/agents/${id}`);
    };

    const handleArchiveToggle = async (id: number, currentStatus: string) => {
        const newStatus = currentStatus === 'active' ? 'archived' : 'active';
        const action = currentStatus === 'active' ? 'Archive' : 'Restore';

        setLoadingWorkflowId(id);

        try {
            const response = await updateWorkflowStatusApiV1WorkflowWorkflowIdStatusPut({
                path: {
                    workflow_id: id,
                },
                body: {
                    status: newStatus,
                },
            });

            if (response.data) {
                toast.success(`Workflow ${action.toLowerCase()}d successfully`);
                onStatusChanged?.(id, newStatus);
                startTransition(() => {
                    router.refresh();
                });
            }
        } catch (error) {
            console.error(`Error ${action.toLowerCase()}ing workflow:`, error);
            toast.error(`Failed to ${action.toLowerCase()} workflow`);
        } finally {
            setLoadingWorkflowId(null);
        }
    };

    const handleMove = async (id: number, folderId: number | null) => {
        setMovingWorkflowId(id);
        try {
            const response = await moveWorkflowToFolderApiV1WorkflowWorkflowIdFolderPut({
                path: { workflow_id: id },
                body: { folder_id: folderId },
            });
            if (response.error) {
                throw new Error('Failed to move agent');
            }
            toast.success(
                folderId === null ? 'Moved to Uncategorized' : 'Agent moved',
            );
            onMoved?.(id, folderId);
            startTransition(() => {
                router.refresh();
            });
        } catch (error) {
            console.error('Error moving workflow:', error);
            toast.error('Failed to move agent');
        } finally {
            setMovingWorkflowId(null);
        }
    };

    return (
        <>
            {/* Desktop View: Table */}
            <div className="hidden md:block">
            <Card className="nb-card overflow-hidden border border-border">
                <CardContent className="p-0">
                        <Table>
                            <TableHeader className="nb-table-header">
                                <TableRow>
                                    <TableHead className="font-semibold">
                                        <button
                                            onClick={() => toggleSort('id')}
                                            className="inline-flex items-center gap-1 hover:text-foreground cursor-pointer"
                                            aria-label="Sort by ID"
                                        >
                                            ID <SortIcon column="id" />
                                        </button>
                                    </TableHead>
                                    <TableHead className="font-semibold">
                                        <button
                                            onClick={() => toggleSort('name')}
                                            className="inline-flex items-center gap-1 hover:text-foreground cursor-pointer"
                                            aria-label="Sort by agent name"
                                        >
                                            Agent Name <SortIcon column="name" />
                                        </button>
                                    </TableHead>
                                    <TableHead className="font-semibold">
                                        <button
                                            onClick={() => toggleSort('model_config')}
                                            className="inline-flex items-center gap-1 hover:text-foreground cursor-pointer"
                                            aria-label="Sort by model config"
                                        >
                                            Model Config <SortIcon column="model_config" />
                                        </button>
                                    </TableHead>
                                    <TableHead className="font-semibold">
                                        <button
                                            onClick={() => toggleSort('created_at')}
                                            className="inline-flex items-center gap-1 hover:text-foreground cursor-pointer"
                                            aria-label="Sort by created date"
                                        >
                                            Created At <SortIcon column="created_at" />
                                        </button>
                                    </TableHead>
                                    <TableHead className="font-semibold text-center">
                                        <button
                                            onClick={() => toggleSort('total_runs')}
                                            className="inline-flex items-center gap-1 hover:text-foreground cursor-pointer"
                                            aria-label="Sort by total runs"
                                        >
                                            Total Runs <SortIcon column="total_runs" />
                                        </button>
                                    </TableHead>
                                    <TableHead className="font-semibold text-right">Actions</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {paginatedWorkflows.map((workflow) => (
                                    <TableRow
                                        key={workflow.id}
                                        onClick={() => handleViewAgent(workflow.id)}
                                        className={`hover:bg-accent/50 transition-colors cursor-pointer ${showArchived ? 'opacity-60' : ''}`}
                                    >
                                        <TableCell className="text-muted-foreground font-mono">
                                            #{workflow.id}
                                        </TableCell>
                                        <TableCell className="font-medium">
                                            <TableNameLink href={`/voice/agents/${workflow.id}/view`}>{workflow.name}</TableNameLink>
                                        </TableCell>
                                        <TableCell>
                                            {(() => {
                                                const wfConfigs = (workflow.workflow_configurations || {}) as Record<string, unknown>;
                                                const presetId = workflow.platform_model_configuration_id ?? wfConfigs.platform_model_configuration_id ?? (presetOptions.length > 0 ? presetOptions[0].id : null);
                                                if (presetId) {
                                                    const preset = presetOptions.find((p) => p.id === Number(presetId));
                                                    if (preset) {
                                                        return (
                                                            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-primary bg-primary/10 border border-primary/20 px-2 py-0.5 rounded-md">
                                                                <Brain className="h-3.5 w-3.5" /> {preset.name}
                                                            </span>
                                                        );
                                                    }
                                                }
                                                return <span className="text-muted-foreground text-xs">—</span>;
                                            })()}
                                        </TableCell>
                                        <TableCell>
                                            {new Date(workflow.created_at).toLocaleDateString('en-US', {
                                                year: 'numeric',
                                                month: 'short',
                                                day: 'numeric',
                                            })}
                                        </TableCell>
                                        <TableCell className="text-center">
                                            <span className="inline-flex items-center justify-center min-w-[2rem] px-2 py-1 text-sm font-semibold bg-muted rounded-full">
                                                {workflow.total_runs || 0}
                                            </span>
                                        </TableCell>
                                        <TableCell className="text-right">
                                            <RowActionsMenu label={`Actions for ${workflow.name}`} busy={movingWorkflowId === workflow.id || loadingWorkflowId === workflow.id} disabled={isPending}>
                                                <RowAction icon={<Pencil />} onClick={() => handleEdit(workflow.id)}>Edit</RowAction>
                                                {folders && (
                                                    <RowActionSub icon={<FolderInput />} label="Move to folder">
                                                        <RowAction icon={<Inbox />} disabled={currentFolderId === null} selected={currentFolderId === null} onClick={() => handleMove(workflow.id, null)}>Uncategorized</RowAction>
                                                        {folders.map((folder) => (
                                                            <RowAction key={folder.id} icon={<FolderIcon />} disabled={folder.id === currentFolderId} selected={folder.id === currentFolderId} onClick={() => handleMove(workflow.id, folder.id)}>{folder.name}</RowAction>
                                                        ))}
                                                    </RowActionSub>
                                                )}
                                                <RowActionSeparator />
                                                <RowAction icon={showArchived ? <RotateCcw /> : <Archive />} onClick={() => handleArchiveToggle(workflow.id, workflow.status)}>{showArchived ? 'Restore' : 'Archive'}</RowAction>
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

            {/* Mobile View: Premium Cards Stack */}
            <div className="flex flex-col gap-3 md:hidden">
                {paginatedWorkflows.map((workflow) => (
                    <Card
                        key={workflow.id}
                        onClick={() => handleViewAgent(workflow.id)}
                        className={`relative overflow-hidden transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md border border-border/60 hover:border-primary/20 cursor-pointer ${
                            showArchived ? 'opacity-70 bg-muted/20' : 'bg-card'
                        }`}
                    >
                        <CardContent className="p-4 flex flex-col gap-3">
                            {/* Card Header: ID & Status */}
                            <div className="flex items-center justify-between">
                                <span className="text-[10px] font-mono font-semibold tracking-wider text-muted-foreground bg-muted px-2 py-0.5 rounded">
                                    ID: #{workflow.id}
                                </span>
                                <span className={`text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded ${
                                    showArchived ? 'bg-muted text-muted-foreground' : 'bg-green-500/10 text-green-600 dark:text-green-400'
                                }`}>
                                    {showArchived ? 'Archived' : 'Active'}
                                </span>
                            </div>

                            {/* Card Title (Agent Name) */}
                            <div>
                                <h4 className="font-semibold text-base text-foreground leading-snug tracking-tight">
                                    {workflow.name}
                                </h4>
                            </div>

                            {/* Model Config Badge */}
                            {(() => {
                                const wfConfigs = (workflow.workflow_configurations || {}) as Record<string, unknown>;
                                const presetId = workflow.platform_model_configuration_id ?? wfConfigs.platform_model_configuration_id ?? (presetOptions.length > 0 ? presetOptions[0].id : null);
                                const preset = (presetId ? presetOptions.find((p) => p.id === Number(presetId)) : null) || (presetOptions.length > 0 ? presetOptions[0] : null);
                                if (preset) {
                                    return (
                                        <div className="flex items-center gap-1.5 -mt-1">
                                            <span className="inline-flex items-center gap-1 text-[11px] font-medium text-primary bg-primary/10 border border-primary/20 px-1.5 py-0.5 rounded">
                                                <Brain className="h-3 w-3" /> {preset.name}
                                            </span>
                                        </div>
                                    );
                                }
                                return null;
                            })()}

                            {/* Card Metadata Row: Created Date and Total Runs */}
                            <div className="flex items-center gap-4 text-xs text-foreground border-y border-border/40 py-2.5 my-0.5">
                                <div className="flex items-center gap-1.5">
                                    <span className="font-medium text-foreground/70">Created:</span>
                                    <span>
                                        {new Date(workflow.created_at).toLocaleDateString('en-US', {
                                            month: 'short',
                                            day: 'numeric',
                                            year: 'numeric',
                                        })}
                                    </span>
                                </div>
                                <div className="w-px h-3 bg-border/60" />
                                <div className="flex items-center gap-1.5">
                                    <span className="font-medium text-foreground/70">Runs:</span>
                                    <span className="inline-flex items-center justify-center px-2 py-0.5 font-semibold bg-primary/10 text-primary rounded-full text-[11px]">
                                        {workflow.total_runs || 0}
                                    </span>
                                </div>
                            </div>

                            {/* Card Actions Footer */}
                            <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        handleEdit(workflow.id);
                                    }}
                                    className="flex-1 flex items-center justify-center gap-2 h-9 text-xs"
                                >
                                    <Pencil size={14} />
                                    Edit
                                </Button>

                                {folders && (
                                    <DropdownMenu>
                                        <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                disabled={movingWorkflowId === workflow.id || isPending}
                                                className="flex-1 flex items-center justify-center gap-2 h-9 text-xs"
                                            >
                                                {movingWorkflowId === workflow.id ? (
                                                    <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
                                                ) : (
                                                    <FolderInput size={14} />
                                                )}
                                                Move
                                            </Button>
                                        </DropdownMenuTrigger>
                                        <DropdownMenuContent align="end" className="w-52">
                                            <DropdownMenuLabel>Move to folder</DropdownMenuLabel>
                                            <DropdownMenuSeparator />
                                            <DropdownMenuItem
                                                disabled={currentFolderId === null}
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    handleMove(workflow.id, null);
                                                }}
                                            >
                                                <Inbox size={14} className="mr-2" />
                                                Uncategorized
                                                {currentFolderId === null && (
                                                    <Check size={14} className="ml-auto" />
                                                )}
                                            </DropdownMenuItem>
                                            {folders.map((folder) => (
                                                <DropdownMenuItem
                                                    key={folder.id}
                                                    disabled={folder.id === currentFolderId}
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        handleMove(workflow.id, folder.id);
                                                    }}
                                                >
                                                    <FolderIcon size={14} className="mr-2" />
                                                    <span className="truncate">{folder.name}</span>
                                                    {folder.id === currentFolderId && (
                                                        <Check size={14} className="ml-auto shrink-0" />
                                                    )}
                                                </DropdownMenuItem>
                                            ))}
                                        </DropdownMenuContent>
                                    </DropdownMenu>
                                )}

                                <Button
                                    variant={showArchived ? "default" : "outline"}
                                    size="sm"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        handleArchiveToggle(workflow.id, workflow.status);
                                    }}
                                    disabled={loadingWorkflowId === workflow.id || isPending}
                                    className="flex-1 flex items-center justify-center gap-2 h-9 text-xs"
                                >
                                    {loadingWorkflowId === workflow.id ? (
                                        <>
                                            <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
                                            {showArchived ? 'Restoring...' : 'Archiving...'}
                                        </>
                                    ) : (
                                        <>
                                            {showArchived ? (
                                                <>
                                                    <RotateCcw size={14} />
                                                    Restore
                                                </>
                                            ) : (
                                                <>
                                                    <Archive size={14} />
                                                    Archive
                                                </>
                                            )}
                                        </>
                                    )}
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
    );
}
