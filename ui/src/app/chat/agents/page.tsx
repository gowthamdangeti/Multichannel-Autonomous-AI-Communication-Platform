"use client";

import { Bot, Check, Copy, Plus } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { ChatAgentTable } from "@/components/chat-agent/ChatAgentTable";
import { type ChatAgent } from "@/components/chat-agent/editor/chatAgentDraft";
import { ChatAgentEditorDrawer } from "@/components/chat-agent/editor/ChatAgentEditorDrawer";
import { DetailSection } from "@/components/chat-agent/editor/ChatAgentEditorSection";
import { EmbedCodeBlock } from "@/components/chat-agent/EmbedCodeBlock";
import { useModelPresets } from "@/components/chat-agent/hooks/useModelPresets";
import { PageFilterSelect } from "@/components/layout/PageFilterSelect";
import { PageSearchInput } from "@/components/layout/PageSearchInput";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
    Sheet,
    SheetBody,
    SheetContent,
    SheetDescription,
    SheetFooter,
    SheetHeader,
    SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/context/HeaderContext";
import { useAuth } from "@/lib/auth";
import { ACTIVE_FILTER_OPTIONS, ALL_FILTER, filterBySearch, matchesFilter, toActiveValue } from "@/lib/searchFilter";

export default function ChatAgentsPage() {
    const { user, loading: authLoading, getAccessToken } = useAuth();
    const hasFetched = useRef(false);

    const [agents, setAgents] = useState<ChatAgent[]>([]);
    const [searchQuery, setSearchQuery] = useState("");
    const [statusFilter, setStatusFilter] = useState(ALL_FILTER);
    const [loading, setLoading] = useState(true);

    // The editor drawer is shared with an agent's own page; null `editing` means "new agent".
    const [editorOpen, setEditorOpen] = useState(false);
    const [editing, setEditing] = useState<ChatAgent | null>(null);

    const { presets } = useModelPresets();
    const [embedAgent, setEmbedAgent] = useState<ChatAgent | null>(null);
    const [copied, setCopied] = useState(false);

    const authFetch = useCallback(
        async (path: string, opts: RequestInit = {}) => {
            const token = await getAccessToken();
            return fetch(`/api/v1${path}`, {
                ...opts,
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                    ...(opts.headers ?? {}),
                },
            });
        },
        [getAccessToken]
    );

    const loadAgents = useCallback(async () => {
        try {
            const res = await authFetch("/chat/agents");
            if (res.ok) setAgents(await res.json());
        } catch {
            /* non-critical */
        } finally {
            setLoading(false);
        }
    }, [authFetch]);

    useEffect(() => {
        if (authLoading || !user || hasFetched.current) return;
        hasFetched.current = true;
        loadAgents();
    }, [authLoading, user, loadAgents]);

    const openNew = () => {
        setEditing(null);
        setEditorOpen(true);
    };
    const openEdit = (a: ChatAgent) => {
        setEditing(a);
        setEditorOpen(true);
    };
    const handleSaved = (saved: ChatAgent, created: boolean) =>
        setAgents((list) => (created ? [saved, ...list] : list.map((a) => (a.id === saved.id ? saved : a))));

    const remove = async (a: ChatAgent) => {
        setAgents((list) => list.filter((x) => x.id !== a.id));
        await authFetch(`/chat/agents/${a.id}`, { method: "DELETE" });
    };

    const copyEmbed = (text: string) => {
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    return (
        <div className="space-y-4 px-4 lg:px-6 pt-2 pb-6">
            <PageHeader
                title="Chat Agents"
                subtitle="Create chat agents and embed them on your website"
                onRefresh={() => void loadAgents()}
                isRefreshing={loading}
                primaryAction={<Button onClick={openNew}>
                        <Plus className="mr-2 h-4 w-4" /> New agent
                    </Button>}
                toolbar={
                    <>
                        <PageSearchInput placeholder="Search agents..." value={searchQuery} onChange={setSearchQuery} />
                        <PageFilterSelect allLabel="All statuses" value={statusFilter} options={ACTIVE_FILTER_OPTIONS} onChange={setStatusFilter} />
                    </>
                }
            />

            {loading ? (
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {[0, 1, 2].map((i) => <Skeleton key={i} className="h-36 w-full" />)}
                </div>
            ) : agents.length === 0 ? (
                <Card>
                    <CardContent className="flex flex-col items-center justify-center gap-3 py-16 text-center">
                        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-cta/10 text-cta">
                            <Bot className="h-6 w-6" />
                        </div>
                        <div>
                            <p className="font-medium">No chat agents yet</p>
                            <p className="text-sm text-muted-foreground">Create an agent, then embed it on your site with a script tag.</p>
                        </div>
                        <Button onClick={openNew}><Plus className="mr-2 h-4 w-4" /> New agent</Button>
                    </CardContent>
                </Card>
            ) : (
                <ChatAgentTable
                    agents={filterBySearch(agents, searchQuery, (a) => a.name).filter((a) => matchesFilter(toActiveValue(a.is_active), statusFilter))}
                    presets={presets}
                    onEmbed={(a) => { setCopied(false); setEmbedAgent(a); }}
                    onEdit={(a) => openEdit(a)}
                    onDelete={(a) => void remove(a)}
                />
            )}

            <ChatAgentEditorDrawer
                open={editorOpen}
                agent={editing}
                onOpenChange={setEditorOpen}
                onSaved={handleSaved}
            />

            {/* Embed off-canvas drawer */}
            <Sheet open={!!embedAgent} onOpenChange={(o) => { if (!o) setEmbedAgent(null); }}>
                <SheetContent side="right">
                    <SheetHeader>
                        <SheetTitle className="text-base truncate">
                            Embed &ldquo;{embedAgent?.name}&rdquo;
                        </SheetTitle>
                        <SheetDescription className="sr-only">
                            Paste this snippet into your website HTML
                        </SheetDescription>
                    </SheetHeader>

                    <SheetBody className="px-4 py-4 space-y-4">
                        <DetailSection
                            title="Website Embed Snippet"
                            description={`Paste this snippet into your website's HTML, just before </body>. A chat bubble appears in the ${embedAgent?.appearance?.position === "bottom-left" ? "bottom-left" : "bottom-right"} corner.`}
                            action={
                                <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => embedAgent && copyEmbed(embedAgent.embed_script ?? "")}
                                    className="h-8 gap-1.5 text-xs font-medium cursor-pointer"
                                >
                                    {copied ? <Check className="h-3.5 w-3.5 text-status-success" /> : <Copy className="h-3.5 w-3.5" />}
                                    {copied ? "Copied!" : "Copy code"}
                                </Button>
                            }
                        >
                            {embedAgent?.embed_script ? (
                                <EmbedCodeBlock code={embedAgent.embed_script} />
                            ) : (
                                <p className="text-xs text-muted-foreground">No embed script generated.</p>
                            )}
                        </DetailSection>

                        <DetailSection
                            title="Origin Restriction"
                            description={
                                embedAgent?.allowed_domains?.length
                                    ? `Restricted to: ${embedAgent.allowed_domains.join(", ")}`
                                    : "Embeddable on any domain. Add allowed domains in the agent's settings to restrict it."
                            }
                        >
                            <p className="text-xs text-muted-foreground">
                                {embedAgent?.allowed_domains?.length
                                    ? "Only websites listed above are authorized to initialize this chat agent."
                                    : "No origin restrictions are set. Any website can embed this chat widget."}
                            </p>
                        </DetailSection>
                    </SheetBody>

                    <SheetFooter className="justify-end border-t border-border px-4 py-3 bg-card/95">
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => setEmbedAgent(null)}
                            className="h-8 text-xs font-medium cursor-pointer"
                        >
                            Close
                        </Button>
                    </SheetFooter>
                </SheetContent>
            </Sheet>
        </div>
    );
}
