"use client";

import {
    ArrowLeft,
    ArrowUpRight,
    Calendar,
    MessageSquare,
    MessagesSquare,
    Pencil,
    RefreshCw,
    Search,
    TrendingUp,
} from "lucide-react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { RowAction, RowActionsMenu } from "@/components/layout/RowActionsMenu";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
    Pagination,
    PaginationContent,
    PaginationItem,
    PaginationLink,
    PaginationNext,
    PaginationPrevious,
} from "@/components/ui/pagination";
import { Skeleton } from "@/components/ui/skeleton";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { type Breadcrumb, PageHeader } from "@/context/HeaderContext";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";

interface WhatsAppAgent {
    id: number;
    name: string;
    description: string | null;
    character: string | null;
    system_prompt: string;
    greeting: string | null;
    active_contacts: string[];
    deactive_contacts: string[];
    is_active: boolean;
    created_at?: string | null;
    total_runs?: number | null;
}

interface ConversationSummary {
    id: number;
    number_id: number;
    number_name: string | null;
    agent_id?: number | null;
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

export default function WhatsAppAgentViewPage() {
    const params = useParams();
    const router = useRouter();
    const searchParams = useSearchParams();
    const { isAuthenticated, getAccessToken } = useAuth();
    const hasFetched = useRef(false);

    const agentId = params?.agentId ? Number(params.agentId) : null;

    const [agentDetail, setAgentDetail] = useState<WhatsAppAgent | null>(null);
    const [conversations, setConversations] = useState<ConversationSummary[]>([]);
    const [isLoading, setIsLoading] = useState<boolean>(true);
    const [error, setError] = useState<string | null>(null);

    const [searchQuery, setSearchQuery] = useState<string>("");
    const [currentPage, setCurrentPage] = useState<number>(() => {
        const pageParam = searchParams.get("page");
        return pageParam ? parseInt(pageParam, 10) : 1;
    });

    // Conversation detail modal state
    const [detail, setDetail] = useState<ConversationDetail | null>(null);
    const [detailLoading, setDetailLoading] = useState(false);

    const authFetch = useCallback(
        async (path: string) => {
            const token = await getAccessToken();
            return fetch(`/api/v1${path}`, {
                headers: { Authorization: `Bearer ${token}` },
            });
        },
        [getAccessToken]
    );

    const loadData = useCallback(async () => {
        if (!agentId || !isAuthenticated) return;
        setIsLoading(true);
        setError(null);

        try {
            const [agentRes, convsRes] = await Promise.all([
                authFetch(`/whatsapp/agents/${agentId}`).catch(() => null),
                authFetch("/whatsapp/conversations").catch(() => null),
            ]);

            if (agentRes && agentRes.ok) {
                const data = await agentRes.json();
                setAgentDetail(data);
            }

            if (convsRes && convsRes.ok) {
                const allConvs: ConversationSummary[] = await convsRes.json();
                // Filter conversations for this agent if agent_name is available or show all matching
                setConversations(allConvs);
            }
        } catch (err) {
            console.error("Failed to load WhatsApp agent view data:", err);
            setError("Failed to load WhatsApp agent details. Please try again.");
        } finally {
            setIsLoading(false);
        }
    }, [agentId, isAuthenticated, authFetch]);

    useEffect(() => {
        if (isAuthenticated && agentId && !hasFetched.current) {
            hasFetched.current = true;
            loadData();
        }
    }, [isAuthenticated, agentId, loadData]);

    const openDetail = async (id: number) => {
        setDetailLoading(true);
        setDetail(null);
        try {
            const res = await authFetch(`/whatsapp/conversations/${id}`);
            if (res.ok) setDetail(await res.json());
        } catch (err) {
            console.error("Failed to load conversation details:", err);
        } finally {
            setDetailLoading(false);
        }
    };

    // Filter conversations for this agent
    const agentConvs = conversations.filter((c) => {
        if (c.agent_id != null && agentId != null) {
            return c.agent_id === agentId;
        }
        if (!agentDetail) return true;
        if (c.agent_name) {
            return c.agent_name.toLowerCase() === agentDetail.name.toLowerCase();
        }
        return false;
    });

    const filteredConvs = agentConvs.filter((c) => {
        if (!searchQuery) return true;
        const q = searchQuery.toLowerCase().trim();
        return (
            (c.contact || "").toLowerCase().includes(q) ||
            (c.number_name || "").toLowerCase().includes(q) ||
            (c.last_message || "").toLowerCase().includes(q)
        );
    });

    const ITEMS_PER_PAGE = 10;
    const totalCount = filteredConvs.length;
    const totalPages = Math.ceil(totalCount / ITEMS_PER_PAGE) || 1;
    const paginatedConvs = filteredConvs.slice(
        (currentPage - 1) * ITEMS_PER_PAGE,
        currentPage * ITEMS_PER_PAGE
    );

    const totalMessages = agentConvs.reduce((acc, c) => acc + (c.message_count || 0), 0);
    const avgMessagesPerChat = totalCount > 0 ? Math.round(totalMessages / totalCount) : 0;

    const handlePageChange = (newPage: number) => {
        if (newPage < 1 || newPage > totalPages) return;
        setCurrentPage(newPage);
        router.push(`/whatsapp/agents/${agentId}/view?page=${newPage}`);
    };

    const breadcrumbs = useMemo<Breadcrumb[]>(
        () => [
            { label: "WhatsApp agents", href: "/whatsapp/agents" },
            { label: agentDetail?.name || `Agent #${agentId}` },
        ],
        [agentDetail?.name, agentId],
    );

    return (
        <div className="px-4 lg:px-6 pt-2 pb-8 space-y-6">
            <PageHeader
                breadcrumbs={breadcrumbs}
                title={
                    <div className="flex items-center gap-3">
                        <Link
                            href="/whatsapp/agents"
                            className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                            title="Back to WhatsApp Agents"
                        >
                            <ArrowLeft className="h-5 w-5" />
                        </Link>
                        <div className="flex items-center gap-2.5">
                            <h1 className="text-xl font-bold tracking-tight">
                                {agentDetail?.name || `Agent #${agentId}`}
                            </h1>
                            <span className="text-xs font-mono bg-muted text-muted-foreground px-2 py-0.5 rounded font-medium">
                                #{agentId}
                            </span>
                            <Badge variant="secondary" className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-none font-semibold text-xs ml-1">
                                {agentDetail?.is_active !== false ? "Active" : "Inactive"}
                            </Badge>
                        </div>
                    </div>
                }
                subtitle="Agent analytics, configuration overview, and conversation history."
                actions={
                    <div className="flex items-center gap-2">
                        {agentId && (
                            <Button
                                size="sm"
                                variant="outline"
                                onClick={() => router.push("/whatsapp/agents")}
                                className="h-8 text-xs flex items-center gap-1.5"
                            >
                                <Pencil className="h-3.5 w-3.5" />
                                Customize Agent
                            </Button>
                        )}
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={loadData}
                            disabled={isLoading}
                            className="h-8 w-8 p-0"
                            aria-label="Refresh agent"
                            title="Refresh"
                        >
                            <RefreshCw className={cn("h-3.5 w-3.5", isLoading && "animate-spin")} />
                        </Button>
                    </div>
                }
            />

            {error ? (
                <div className="p-4 rounded-md bg-destructive/10 text-destructive text-sm text-center">
                    {error}
                </div>
            ) : (
                <>
                    {/* Analytics Overview Cards Grid */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                        <Card className="bg-card border-border/80 shadow-xs">
                            <CardContent className="p-5 flex flex-col justify-between">
                                <span className="text-xs font-medium text-muted-foreground flex items-center justify-between">
                                    Total Conversations
                                    <MessagesSquare className="h-4 w-4 text-primary" />
                                </span>
                                <div className="mt-3 text-2xl font-bold text-foreground">
                                    {totalCount}
                                </div>
                            </CardContent>
                        </Card>

                        <Card className="bg-card border-border/80 shadow-xs">
                            <CardContent className="p-5 flex flex-col justify-between">
                                <span className="text-xs font-medium text-muted-foreground flex items-center justify-between">
                                    Total Messages
                                    <MessageSquare className="h-4 w-4 text-blue-500" />
                                </span>
                                <div className="mt-3 text-2xl font-bold text-foreground">
                                    {totalMessages}
                                </div>
                            </CardContent>
                        </Card>

                        <Card className="bg-card border-border/80 shadow-xs">
                            <CardContent className="p-5 flex flex-col justify-between">
                                <span className="text-xs font-medium text-muted-foreground flex items-center justify-between">
                                    Avg Messages / Chat
                                    <TrendingUp className="h-4 w-4 text-amber-500" />
                                </span>
                                <div className="mt-3 text-2xl font-bold text-foreground">
                                    {avgMessagesPerChat}
                                </div>
                            </CardContent>
                        </Card>

                        <Card className="bg-card border-border/80 shadow-xs">
                            <CardContent className="p-5 flex flex-col justify-between">
                                <span className="text-xs font-medium text-muted-foreground flex items-center justify-between">
                                    Agent Created
                                    <Calendar className="h-4 w-4 text-emerald-500" />
                                </span>
                                <div className="mt-3 text-sm font-semibold text-foreground">
                                    {agentDetail?.created_at
                                        ? new Date(agentDetail.created_at).toLocaleDateString("en-US", {
                                              month: "short",
                                              day: "numeric",
                                              year: "numeric",
                                          })
                                        : "—"}
                                </div>
                            </CardContent>
                        </Card>
                    </div>

                    {/* Conversations Table Section */}
                    <div className="space-y-4 pt-2">
                        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
                            <div>
                                <h2 className="text-base font-bold text-foreground">
                                    Conversations Table
                                </h2>
                                <p className="text-xs text-muted-foreground mt-0.5">
                                    All WhatsApp conversation sessions for this agent.
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
                            </div>
                        </div>

                        {isLoading ? (
                            <Card className="border border-border/80">
                                <CardContent className="p-12 text-center text-muted-foreground text-sm">
                                    Loading conversations history...
                                </CardContent>
                            </Card>
                        ) : paginatedConvs.length === 0 ? (
                            <Card className="border border-dashed">
                                <CardContent className="p-12 text-center text-muted-foreground">
                                    No WhatsApp conversations found for this agent yet.
                                </CardContent>
                            </Card>
                        ) : (
                            <Card className="border border-border/80 overflow-hidden shadow-xs">
                                <div className="overflow-x-auto">
                                    <Table>
                                        <TableHeader className="bg-muted/40">
                                            <TableRow>
                                                <TableHead className="font-semibold text-xs">Agent Name</TableHead>
                                                <TableHead className="font-semibold text-xs">Contact</TableHead>
                                                <TableHead className="font-semibold text-xs">Line / Number</TableHead>
                                                <TableHead className="font-semibold text-xs">Last Message</TableHead>
                                                <TableHead className="font-semibold text-xs text-center">Message Count</TableHead>
                                                <TableHead className="font-semibold text-xs text-right">Actions</TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {paginatedConvs.map((c) => (
                                                <TableRow
                                                    key={c.id}
                                                    className="hover:bg-muted/40 transition-colors cursor-pointer"
                                                    onClick={() => openDetail(c.id)}
                                                >
                                                    <TableCell className="text-xs font-medium">
                                                        {c.agent_name || agentDetail?.name || "—"}
                                                    </TableCell>
                                                    <TableCell className="font-medium text-xs">
                                                        <span className="font-semibold text-foreground truncate">
                                                            {fmtContact(c.contact)}
                                                        </span>
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
                                                    <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                                                        <RowActionsMenu label={`Actions for conversation ${c.id}`}>
                                                            <RowAction icon={<ArrowUpRight />} onClick={() => openDetail(c.id)}>View chat</RowAction>
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
                                                        className={currentPage <= 1 ? "pointer-events-none opacity-50" : "cursor-pointer"}
                                                    />
                                                </PaginationItem>
                                                {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
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
                                                ))}
                                                <PaginationItem>
                                                    <PaginationNext
                                                        onClick={(e) => {
                                                            e.preventDefault();
                                                            handlePageChange(currentPage + 1);
                                                        }}
                                                        className={currentPage >= totalPages ? "pointer-events-none opacity-50" : "cursor-pointer"}
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

            {/* Conversation message detail modal */}
            <Dialog open={!!detail || detailLoading} onOpenChange={(o) => { if (!o) setDetail(null); }}>
                <DialogContent className="max-h-[85vh] max-w-lg overflow-hidden p-0">
                    <DialogHeader className="border-b border-border p-4">
                        <DialogTitle>{detail ? fmtContact(detail.contact) : "Conversation Details"}</DialogTitle>
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
