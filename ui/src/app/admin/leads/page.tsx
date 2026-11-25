"use client";

import { Eye, Inbox } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { PageFilterSelect } from "@/components/layout/PageFilterSelect";
import { PageSearchInput } from "@/components/layout/PageSearchInput";
import { RowAction, RowActionsMenu } from "@/components/layout/RowActionsMenu";
import { SortableTableHead } from "@/components/layout/SortableTableHead";
import { TableCellLink } from "@/components/layout/TableCellLink";
import { TablePagination } from "@/components/layout/TablePagination";
import { LeadDetailsDrawer } from "@/components/leads/LeadDetailsDrawer";
import { getLeadStatusBadgeVariant, LEAD_STATUSES, type LeadItem } from "@/components/leads/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { PageHeader } from "@/context/HeaderContext";
import { getBackendApiUrl } from "@/lib/apiClient";
import { useAuth } from "@/lib/auth";
import { formatDateTime } from "@/lib/formatDateTime";
import { DEFAULT_PAGE_SIZE, getPageCount } from "@/lib/pagination";

type LeadSortKey = "id" | "name" | "phone" | "company" | "job_title" | "country" | "created_at" | "status";

/** Fixed status list, so the filter keeps every option even on a sparse page. */
const STATUS_OPTIONS = LEAD_STATUSES.map((status) => ({
    value: status,
    label: status.charAt(0).toUpperCase() + status.slice(1),
}));

export default function AdminLeadsPage() {
    const { user, loading: authLoading, getAccessToken } = useAuth();
    const isSuperAdmin = (user as { is_superuser?: boolean } | null)?.is_superuser;
    const hasFetched = useRef(false);

    const [items, setItems] = useState<LeadItem[]>([]);
    const [currentPage, setCurrentPage] = useState(1);
    const [totalCount, setTotalCount] = useState(0);
    const [loading, setLoading] = useState(true);
    const [status, setStatus] = useState<string>("all");
    const [search, setSearch] = useState("");
    const [searchInput, setSearchInput] = useState("");
    const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);

    const [selectedLead, setSelectedLead] = useState<LeadItem | null>(null);

    const [sortKey, setSortKey] = useState<LeadSortKey>("created_at");
    const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

    const fetchLeads = useCallback(async (s: string, q: string, page = 1) => {
        setLoading(true);
        try {
            const token = await getAccessToken();
            const baseUrl = getBackendApiUrl();
            const params = new URLSearchParams({ page: String(page), limit: String(DEFAULT_PAGE_SIZE) });
            if (s !== "all") params.set("status", s);
            if (q.trim()) params.set("search", q.trim());
            const res = await fetch(`${baseUrl}/api/v1/admin/leads?${params.toString()}`, {
                headers: { Authorization: `Bearer ${token}`, "ngrok-skip-browser-warning": "true" },
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            setItems(data.items ?? []);
            setTotalCount(data.total ?? 0);
            setCurrentPage(page);
        } catch {
            toast.error("Failed to load leads");
        } finally {
            setLoading(false);
        }
    }, [getAccessToken]);

    useEffect(() => {
        if (authLoading || !user || !isSuperAdmin || hasFetched.current) return;
        hasFetched.current = true;
        void fetchLeads(status, search);
    }, [authLoading, user, isSuperAdmin, fetchLeads, status, search]);

    const onSearchChange = (val: string) => {
        setSearchInput(val);
        clearTimeout(searchTimeoutRef.current ?? undefined);
        searchTimeoutRef.current = setTimeout(() => {
            setSearch(val);
            void fetchLeads(status, val);
        }, 350);
    };

    const onStatusChange = (val: string) => {
        setStatus(val);
        void fetchLeads(val, searchInput);
    };

    const setLeadStatus = async (id: number, next: string) => {
        try {
            const token = await getAccessToken();
            const baseUrl = getBackendApiUrl();
            const res = await fetch(`${baseUrl}/api/v1/admin/leads/${id}`, {
                method: "PATCH",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                    "ngrok-skip-browser-warning": "true",
                },
                body: JSON.stringify({ status: next }),
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            setItems((prev) => prev.map((l) => (l.id === id ? { ...l, status: next } : l)));
            setSelectedLead((prev) => (prev && prev.id === id ? { ...prev, status: next } : prev));
            toast.success("Lead status updated");
        } catch {
            toast.error("Failed to update status");
        }
    };

    const toggleSort = (key: LeadSortKey) => {
        if (sortKey === key) {
            setSortDir((prev) => (prev === "asc" ? "desc" : "asc"));
        } else {
            setSortKey(key);
            setSortDir(key === "created_at" || key === "id" ? "desc" : "asc");
        }
    };

    const sortProps = { sortKey, sortDir, onSort: toggleSort };

    const sortedItems = [...items].sort((a, b) => {
        const dir = sortDir === "asc" ? 1 : -1;
        switch (sortKey) {
            case "id":
                return (a.id - b.id) * dir;
            case "name":
                return a.name.localeCompare(b.name) * dir;
            case "phone":
                return (a.phone ?? "").localeCompare(b.phone ?? "") * dir;
            case "company":
                return a.company.localeCompare(b.company) * dir;
            case "job_title":
                return (a.job_title ?? "").localeCompare(b.job_title ?? "") * dir;
            case "country":
                return (a.country ?? "").localeCompare(b.country ?? "") * dir;
            case "status":
                return a.status.localeCompare(b.status) * dir;
            case "created_at": {
                const timeA = a.created_at ? new Date(a.created_at).getTime() : 0;
                const timeB = b.created_at ? new Date(b.created_at).getTime() : 0;
                return (timeA - timeB) * dir;
            }
            default:
                return 0;
        }
    });

    const hasFilters = Boolean(search) || status !== "all";

    return (
        <div className="space-y-4 pt-0">
            <PageHeader
                title="Enterprise Leads"
                subtitle="Book a Strategy Call submissions — stored in-house (Postgres) for data residency."
                onRefresh={() => void fetchLeads(status, searchInput, currentPage)}
                isRefreshing={loading}
                toolbar={
                    <>
                        <PageSearchInput placeholder="Search name, company, email..." value={searchInput} onChange={onSearchChange} />
                        <PageFilterSelect allLabel="All statuses" value={status} options={STATUS_OPTIONS} onChange={onStatusChange} />
                    </>
                }
            />

            <Card className="overflow-hidden">
                <CardContent className="p-0 overflow-hidden">
                    <Table>
                        <TableHeader className="bg-muted/50">
                            <TableRow className="hover:bg-transparent">
                                <SortableTableHead column="id" label="ID" {...sortProps} />
                                <SortableTableHead column="name" label="Name" {...sortProps} />
                                <SortableTableHead column="phone" label="Phone" {...sortProps} />
                                <SortableTableHead column="company" label="Company" {...sortProps} />
                                <SortableTableHead column="job_title" label="Role" {...sortProps} />
                                <SortableTableHead column="country" label="Country" {...sortProps} />
                                <SortableTableHead column="created_at" label="Created" {...sortProps} />
                                <SortableTableHead column="status" label="Status" {...sortProps} />
                                <TableHead className="font-semibold text-muted-foreground w-[100px] text-right">Actions</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {loading && items.length === 0 ? (
                                Array.from({ length: 4 }).map((_, idx) => (
                                    <TableRow key={`skeleton-${idx}`}>
                                        <TableCell><Skeleton className="h-4 w-10" /></TableCell>
                                        <TableCell><Skeleton className="h-4 w-32" /></TableCell>
                                        <TableCell><Skeleton className="h-4 w-28" /></TableCell>
                                        <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                                        <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                                        <TableCell><Skeleton className="h-4 w-16" /></TableCell>
                                        <TableCell><Skeleton className="h-4 w-36" /></TableCell>
                                        <TableCell><Skeleton className="h-5 w-20" /></TableCell>
                                        <TableCell className="text-right"><Skeleton className="ml-auto h-7 w-14" /></TableCell>
                                    </TableRow>
                                ))
                            ) : sortedItems.length === 0 ? (
                                <TableRow>
                                    <TableCell colSpan={9} className="py-16 text-center">
                                        <div className="flex flex-col items-center justify-center space-y-2 text-muted-foreground">
                                            <Inbox className="h-10 w-10 stroke-[1.5] text-muted-foreground/60" />
                                            <p className="text-sm font-medium text-foreground">No enterprise leads found</p>
                                            <p className="max-w-sm text-xs text-muted-foreground">
                                                {hasFilters
                                                    ? "No leads matched your search or status filter. Try clearing filters to see all submissions."
                                                    : "New submissions from the Book a Strategy Call form will be displayed here."}
                                            </p>
                                            {hasFilters && (
                                                <Button
                                                    variant="outline"
                                                    size="sm"
                                                    className="mt-2 text-xs"
                                                    onClick={() => {
                                                        setStatus("all");
                                                        setSearchInput("");
                                                        setSearch("");
                                                        void fetchLeads("all", "");
                                                    }}
                                                >
                                                    Clear Filters
                                                </Button>
                                            )}
                                        </div>
                                    </TableCell>
                                </TableRow>
                            ) : (
                                sortedItems.map((lead) => (
                                    <TableRow key={lead.id} className="hover:bg-accent/50 transition-colors">
                                        <TableCell className="font-mono text-xs text-muted-foreground">
                                            {lead.id}
                                        </TableCell>
                                        <TableCell>
                                            {/* Only the name (and the Actions menu) opens the drawer. */}
                                            <TableCellLink onClick={() => setSelectedLead(lead)} title={lead.name} className="max-w-[200px]">
                                                {lead.name}
                                            </TableCellLink>
                                        </TableCell>
                                        <TableCell className="whitespace-nowrap font-mono text-xs font-medium text-foreground">
                                            {lead.phone || "—"}
                                        </TableCell>
                                        <TableCell className="text-xs font-medium text-foreground">
                                            <span className="block max-w-[200px] truncate" title={lead.company}>
                                                {lead.company || "—"}
                                            </span>
                                        </TableCell>
                                        <TableCell className="text-xs font-medium text-foreground">
                                            <span className="block max-w-[160px] truncate" title={lead.job_title}>
                                                {lead.job_title || "—"}
                                            </span>
                                        </TableCell>
                                        <TableCell className="whitespace-nowrap text-xs font-medium text-foreground">
                                            {lead.country || "—"}
                                        </TableCell>
                                        <TableCell className="whitespace-nowrap text-xs font-medium text-foreground">
                                            {formatDateTime(lead.created_at)}
                                        </TableCell>
                                        <TableCell>
                                            <Badge variant={getLeadStatusBadgeVariant(lead.status)} className="text-xs capitalize">
                                                {lead.status}
                                            </Badge>
                                        </TableCell>
                                        <TableCell className="text-right">
                                            <RowActionsMenu label={`Actions for ${lead.name}`}>
                                                <RowAction icon={<Eye />} onClick={() => setSelectedLead(lead)}>View</RowAction>
                                            </RowActionsMenu>
                                        </TableCell>
                                    </TableRow>
                                ))
                            )}
                        </TableBody>
                    </Table>
                    <TablePagination
                        page={currentPage}
                        totalPages={getPageCount(totalCount, DEFAULT_PAGE_SIZE)}
                        totalCount={totalCount}
                        setPage={(page) => void fetchLeads(status, searchInput, page)}
                    />
                </CardContent>
            </Card>

            {/* Lead detail — off-canvas drawer, same pattern as the Org and Tool drawers. */}
            <LeadDetailsDrawer
                lead={selectedLead}
                onOpenChange={(open) => { if (!open) setSelectedLead(null); }}
                onStatusChange={(id, next) => void setLeadStatus(id, next)}
            />
        </div>
    );
}
