"use client";

import { ArrowDown, ArrowUp, ArrowUpDown, MessagesSquare } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { PageFilterSelect } from "@/components/layout/PageFilterSelect";
import { PageSearchInput } from "@/components/layout/PageSearchInput";
import { TablePagination } from "@/components/layout/TablePagination";
import { Card, CardContent } from "@/components/ui/card";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
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
import { usePagination } from "@/hooks/usePagination";
import { useAuth } from "@/lib/auth";
import { ALL_FILTER, matchesFilter, toFilterOptions } from "@/lib/searchFilter";
import { cn } from "@/lib/utils";

interface ConversationSummary {
    id: number;
    number_id: number;
    number_name: string | null;
    agent_name: string | null;
    contact: string;
    message_count: number;
    last_message: string | null;
    last_role: string | null;
    updated_at: string | null;
}

interface ConversationDetail extends ConversationSummary {
    messages: { role: string; content: string }[];
}

function fmtContact(chatId: string) {
    const digits = chatId.replace(/@.*$/, "").replace(/\D/g, "");
    return digits ? `+${digits}` : chatId;
}

function fmtTime(iso: string | null) {
    if (!iso) return "";
    const d = new Date(iso);
    return d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export default function WhatsAppConversationsPage() {
    const { user, loading: authLoading, getAccessToken } = useAuth();
    const hasFetched = useRef(false);

    const [rows, setRows] = useState<ConversationSummary[]>([]);
    const [loading, setLoading] = useState(true);
    const [detail, setDetail] = useState<ConversationDetail | null>(null);
    const [detailLoading, setDetailLoading] = useState(false);
    const [searchQuery, setSearchQuery] = useState("");
    const [refreshing, setRefreshing] = useState(false);

    const authFetch = useCallback(
        async (path: string) => {
            const token = await getAccessToken();
            return fetch(`/api/v1${path}`, { headers: { Authorization: `Bearer ${token}` } });
        },
        [getAccessToken]
    );

    const load = useCallback(async () => {
        try {
            const res = await authFetch("/whatsapp/conversations");
            if (res.ok) setRows(await res.json());
        } catch {
            /* non-critical */
        } finally {
            setLoading(false);
        }
    }, [authFetch]);

    const handleRefresh = () => {
        setRefreshing(true);
        load().finally(() => setRefreshing(false));
    };

    const [agentFilter, setAgentFilter] = useState(ALL_FILTER);
    const [numberFilter, setNumberFilter] = useState(ALL_FILTER);
    const filteredRows = rows.filter((r) => {
        if (!matchesFilter(r.agent_name, agentFilter) || !matchesFilter(r.number_name, numberFilter)) return false;
        if (!searchQuery) return true;
        const q = searchQuery.toLowerCase().trim();
        return (
            (r.contact || "").toLowerCase().includes(q) ||
            (r.agent_name || "").toLowerCase().includes(q) ||
            (r.number_name || "").toLowerCase().includes(q) ||
            (r.last_message || "").toLowerCase().includes(q)
        );
    });

    // Header sorting (client-side, current list only; null = server order).
    type WaConvoSortKey = 'contact' | 'agent_name' | 'message_count' | 'updated_at';
    const [sortKey, setSortKey] = useState<WaConvoSortKey | null>(null);
    const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
    const toggleSort = (key: WaConvoSortKey) => {
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
    const SortIcon = ({ column }: { column: WaConvoSortKey }) => {
        if (sortKey !== column) return <ArrowUpDown className="h-3.5 w-3.5 text-muted-foreground/60" />;
        return sortDir === 'asc'
            ? <ArrowUp className="h-3.5 w-3.5 text-foreground" />
            : <ArrowDown className="h-3.5 w-3.5 text-foreground" />;
    };
    const sortedRows = useMemo(() => {
        if (!sortKey) return filteredRows;
        const dir = sortDir === 'asc' ? 1 : -1;
        return [...filteredRows].sort((a, b) => {
            switch (sortKey) {
                case 'contact':
                    return (a.contact ?? '').localeCompare(b.contact ?? '') * dir;
                case 'agent_name':
                    return (a.agent_name ?? '').localeCompare(b.agent_name ?? '') * dir;
                case 'message_count':
                    return ((a.message_count ?? 0) - (b.message_count ?? 0)) * dir;
                case 'updated_at':
                    return ((a.updated_at ? new Date(a.updated_at).getTime() : -1) - (b.updated_at ? new Date(b.updated_at).getTime() : -1)) * dir;
            }
        });
    }, [filteredRows, sortKey, sortDir]);
    const rowPagination = usePagination(sortedRows);

    useEffect(() => {
        if (authLoading || !user || hasFetched.current) return;
        hasFetched.current = true;
        load();
    }, [authLoading, user, load]);

    const openDetail = async (id: number) => {
        setDetailLoading(true);
        setDetail(null);
        try {
            const res = await authFetch(`/whatsapp/conversations/${id}`);
            if (res.ok) setDetail(await res.json());
        } catch {
            /* ignore */
        } finally {
            setDetailLoading(false);
        }
    };

    return (
        <div className="px-4 lg:px-6 pt-2 pb-6 space-y-4">
            <PageHeader
                title="WhatsApp Conversations"
                subtitle="Every conversation your WhatsApp agents have had"
                onRefresh={handleRefresh}
                isRefreshing={refreshing || loading}
                toolbar={
                    <>
                        <PageSearchInput placeholder="Search conversations..." value={searchQuery} onChange={setSearchQuery} />
                        <PageFilterSelect allLabel="All agents" value={agentFilter} options={toFilterOptions(rows, (r) => r.agent_name, (name) => name)} onChange={setAgentFilter} />
                        <PageFilterSelect allLabel="All numbers" value={numberFilter} options={toFilterOptions(rows, (r) => r.number_name, (name) => name)} onChange={setNumberFilter} />
                    </>
                }
            />

            {loading ? (
                <Card className="border border-border">
                    <CardContent className="p-12 text-center text-muted-foreground text-sm">
                        Loading conversations...
                    </CardContent>
                </Card>
            ) : sortedRows.length === 0 ? (
                <Card>
                    <CardContent className="flex flex-col items-center justify-center gap-3 py-16 text-center">
                        <div className="flex h-12 w-12 items-center justify-center rounded-full" style={{ background: "color-mix(in oklch, var(--cta) 14%, transparent)", color: "var(--cta)" }}>
                            <MessagesSquare className="h-6 w-6" />
                        </div>
                        <div>
                            <p className="font-medium">No conversations found</p>
                            <p className="text-sm text-muted-foreground">{searchQuery ? "No conversations match your search query." : "When someone messages a connected number with an attached agent, it'll show up here."}</p>
                        </div>
                    </CardContent>
                </Card>
            ) : (
                <Card className="overflow-hidden border border-border/80 shadow-xs">
                    <div className="overflow-x-auto">
                        <Table>
                            <TableHeader className="bg-muted/40">
                                <TableRow>
                                    <TableHead className="font-semibold text-xs">
                                        <button onClick={() => toggleSort('agent_name')} className="inline-flex items-center gap-1 hover:text-foreground cursor-pointer" aria-label="Sort by agent name">
                                            Agent Name <SortIcon column="agent_name" />
                                        </button>
                                    </TableHead>
                                    <TableHead className="font-semibold text-xs">
                                        <button onClick={() => toggleSort('contact')} className="inline-flex items-center gap-1 hover:text-foreground cursor-pointer" aria-label="Sort by contact">
                                            Contact <SortIcon column="contact" />
                                        </button>
                                    </TableHead>
                                    <TableHead className="font-semibold text-xs">Line / Number</TableHead>
                                    <TableHead className="font-semibold text-xs">Last Message</TableHead>
                                    <TableHead className="font-semibold text-xs text-center">
                                        <button onClick={() => toggleSort('message_count')} className="inline-flex items-center gap-1 hover:text-foreground cursor-pointer" aria-label="Sort by message count">
                                            Message Count <SortIcon column="message_count" />
                                        </button>
                                    </TableHead>
                                    <TableHead className="font-semibold text-xs text-right">
                                        <button onClick={() => toggleSort('updated_at')} className="inline-flex items-center gap-1 hover:text-foreground cursor-pointer ml-auto" aria-label="Sort by last active">
                                            Last Active <SortIcon column="updated_at" />
                                        </button>
                                    </TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {rowPagination.pageItems.map((c) => (
                                    <TableRow
                                        key={c.id}
                                        onClick={() => openDetail(c.id)}
                                        className="hover:bg-muted/40 transition-colors cursor-pointer"
                                    >
                                        <TableCell className="text-xs">
                                            {c.agent_name ? (
                                                <span className="font-medium text-foreground">{c.agent_name}</span>
                                            ) : (
                                                <span className="text-foreground">—</span>
                                            )}
                                        </TableCell>
                                        <TableCell className="font-medium text-xs">
                                            <span className="font-semibold text-foreground truncate">{fmtContact(c.contact)}</span>
                                        </TableCell>
                                        <TableCell className="text-xs text-foreground">
                                            {c.number_name || "—"}
                                        </TableCell>
                                        <TableCell className="text-xs text-foreground max-w-[300px]">
                                            <p className="truncate">{c.last_message || "—"}</p>
                                        </TableCell>
                                        <TableCell className="text-center text-xs">
                                            <span className="inline-flex items-center justify-center px-2 py-0.5 text-xs font-semibold bg-muted rounded-full">
                                                {c.message_count} msg
                                            </span>
                                        </TableCell>
                                        <TableCell className="text-right text-xs text-foreground font-mono">
                                            {fmtTime(c.updated_at) || "—"}
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                        <TablePagination {...rowPagination} />
                    </div>
                </Card>
            )}

            <Dialog open={!!detail || detailLoading} onOpenChange={(o) => { if (!o) setDetail(null); }}>
                <DialogContent className="max-h-[85vh] max-w-lg overflow-hidden p-0">
                    <DialogHeader className="border-b border-border p-4">
                        <DialogTitle>{detail ? fmtContact(detail.contact) : "Conversation"}</DialogTitle>
                        <DialogDescription>
                            {detail?.number_name ? `on ${detail.number_name}` : ""}
                            {detail?.agent_name ? ` · ${detail.agent_name}` : ""}
                        </DialogDescription>
                    </DialogHeader>
                    <div className="max-h-[65vh] space-y-2 overflow-y-auto p-4">
                        {detailLoading ? (
                            <div className="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-10 w-2/3" />)}</div>
                        ) : (
                            (detail?.messages ?? []).map((m, i) => (
                                <div key={i} className={cn("flex", m.role === "assistant" ? "justify-start" : "justify-end")}>
                                    <div
                                        className={cn("max-w-[80%] rounded-2xl px-3 py-2 text-sm", m.role === "assistant" ? "bg-muted" : "text-white")}
                                        style={m.role === "assistant" ? undefined : { background: "var(--cta)" }}
                                    >
                                        {m.content}
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </DialogContent>
            </Dialog>
        </div>
    );
}
