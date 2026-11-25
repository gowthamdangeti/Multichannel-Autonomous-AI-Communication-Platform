"use client";

import {
  Archive,
  ArrowLeft,
  ArrowRight,
  Bot,
  Copy,
  Download,
  Inbox,
  Loader2,
  Mail,
  MailOpen,
  Paperclip,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Tag,
  Wand2,
} from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { PageHeader } from "@/context/HeaderContext";
import { useAuth } from "@/lib/auth";
import {
  analyzeEmailMessage,
  draftEmailReply,
  EmailAccount,
  EmailAgent,
  EmailAttachment,
  EmailMessage,
  getAttachmentDownloadUrl,
  getEmailAccounts,
  getEmailAgents,
  getEmailMessage,
  getEmailMessages,
  regenerateEmailReply,
  updateEmailMessage,
} from "@/lib/emailApi";
import { cn } from "@/lib/utils";

const CATEGORY_COLORS: Record<string, string> = {
  action_required: "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20",
  important: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20",
  newsletter: "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20",
  promotional: "bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20",
  spam: "bg-zinc-500/10 text-zinc-600 dark:text-zinc-400 border-zinc-500/20",
  general: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20",
};

const PRIORITY_COLORS: Record<string, string> = {
  urgent: "bg-red-500 text-white",
  high: "bg-orange-500 text-white",
  normal: "bg-zinc-200 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-200",
  low: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
};

function InboxSkeleton() {
  return (
    <div className="flex flex-1 min-h-0 h-full flex-col gap-3 overflow-hidden">
      <Skeleton className="h-10 w-full rounded-lg" />
      <div className="grid flex-1 min-h-0 grid-cols-12 gap-3 overflow-hidden">
        <Skeleton className="col-span-5 h-full rounded-lg" />
        <Skeleton className="col-span-7 h-full rounded-lg" />
      </div>
    </div>
  );
}

function formatMailDate(rawDate?: string | null, full = false): string {
  if (!rawDate) return "—";
  const d = new Date(rawDate);
  if (isNaN(d.getTime())) return "—";
  if (full) {
    return d.toLocaleString([], {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  }
  const now = new Date();
  const isToday =
    d.getDate() === now.getDate() &&
    d.getMonth() === now.getMonth() &&
    d.getFullYear() === now.getFullYear();
  if (isToday) {
    return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }
  return d.toLocaleDateString([], {
    month: "short",
    day: "numeric",
    year: d.getFullYear() !== now.getFullYear() ? "numeric" : undefined,
  });
}

function UnifiedInboxContent() {
  const router = useRouter();
  const { user, loading: authLoading, getAccessToken } = useAuth();
  const searchParams = useSearchParams();
  const initialMessageId = searchParams.get("message_id");
  const initialAgentId = searchParams.get("agent_id");

  // Agents state
  const [agents, setAgents] = useState<EmailAgent[]>([]);
  const [loadingAgents, setLoadingAgents] = useState(true);
  const [selectedAgent, setSelectedAgent] = useState<EmailAgent | null>(null);
  const [agentSearch, setAgentSearch] = useState("");

  // Messages State
  const [messages, setMessages] = useState<EmailMessage[]>([]);
  const [selectedMessage, setSelectedMessage] = useState<EmailMessage | null>(null);
  const [loadingList, setLoadingList] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);

  // Filters
  const [search, setSearch] = useState("");
  const [accounts, setAccounts] = useState<EmailAccount[]>([]);
  const [accountFilter, setAccountFilter] = useState("all");
  const [providerFilter, setProviderFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [priorityFilter, setPriorityFilter] = useState("all");
  const [readFilter, setReadFilter] = useState("all");
  const [archivedFilter, setArchivedFilter] = useState("false");

  // AI draft reply
  const [userGuidance, setUserGuidance] = useState("");
  const [generatingDraft, setGeneratingDraft] = useState(false);
  const [draftReplyText, setDraftReplyText] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [downloadingAttId, setDownloadingAttId] = useState<number | null>(null);

  // Load email agents
  const loadAgents = useCallback(async () => {
    try {
      setLoadingAgents(true);
      const data = await getEmailAgents(getAccessToken);
      const list = Array.isArray(data) ? data : [];
      setAgents(list);

      if (initialAgentId) {
        const found = list.find((a) => a.id === Number(initialAgentId));
        if (found) {
          setSelectedAgent(found);
          if (found.gmail_account_id) {
            setAccountFilter(String(found.gmail_account_id));
          } else if (found.outlook_account_id) {
            setAccountFilter(String(found.outlook_account_id));
          }
        }
      }
    } catch (err) {
      console.error("Failed to load email agents:", err);
      setAgents([]);
    } finally {
      setLoadingAgents(false);
    }
  }, [getAccessToken, initialAgentId]);

  useEffect(() => {
    if (!authLoading && user) {
      loadAgents();
    }
  }, [authLoading, user, loadAgents]);

  const handleSelectAgent = (agent: EmailAgent) => {
    setSelectedAgent(agent);
    if (agent.gmail_account_id) {
      setAccountFilter(String(agent.gmail_account_id));
    } else if (agent.outlook_account_id) {
      setAccountFilter(String(agent.outlook_account_id));
    } else {
      setAccountFilter("all");
    }
  };

  const handleBackToAgents = () => {
    setSelectedAgent(null);
    setAccountFilter("all");
    setSelectedMessage(null);
  };

  const handleSelectMessage = useCallback(
    async (msg: EmailMessage) => {
      setSelectedMessage(msg);
      setDraftReplyText(msg.draft_reply || "");
      setUserGuidance("");

      setLoadingDetail(true);
      try {
        const detail = await getEmailMessage(msg.id, getAccessToken);
        setSelectedMessage(detail);
        if (detail.draft_reply) {
          setDraftReplyText(detail.draft_reply);
        }
        if (!msg.is_read) {
          await updateEmailMessage(msg.id, { is_read: true }, getAccessToken);
          setMessages((prev) =>
            prev.map((m) => (m.id === msg.id ? { ...m, is_read: true } : m))
          );
        }
      } catch {
        // fallback to current selected
      } finally {
        setLoadingDetail(false);
      }
    },
    [getAccessToken]
  );

  // Load accounts for multi-inbox selection
  useEffect(() => {
    if (!authLoading && user) {
      getEmailAccounts(getAccessToken)
        .then((accs) => setAccounts(Array.isArray(accs) ? accs : []))
        .catch(() => {});
    }
  }, [authLoading, user, getAccessToken]);

  // Fetch messages
  const fetchMessages = useCallback(async (silent = false) => {
    if (!silent) setLoadingList(true);
    try {
      const data = await getEmailMessages(getAccessToken, {
        account_id: accountFilter !== "all" ? Number(accountFilter) : undefined,
        provider: providerFilter !== "all" ? providerFilter : undefined,
        category: categoryFilter !== "all" ? categoryFilter : undefined,
        priority: priorityFilter !== "all" ? priorityFilter : undefined,
        is_read: readFilter === "read" ? true : readFilter === "unread" ? false : undefined,
        is_archived: archivedFilter === "true" ? true : archivedFilter === "false" ? false : undefined,
        search: search.trim() || undefined,
        limit: 50,
      });
      const messageList = Array.isArray(data) ? data : [];
      setMessages(messageList);

      if (messageList.length > 0) {
        if (initialMessageId) {
          const matched = messageList.find((m) => m.id === Number(initialMessageId));
          if (matched) {
            handleSelectMessage(matched);
            return;
          }
        }
        if (!selectedMessage) {
          handleSelectMessage(messageList[0]);
        }
      } else {
        setSelectedMessage(null);
      }
    } catch (err: unknown) {
      if (!silent) {
        setMessages([]);
        const msg = err instanceof Error ? err.message : "Failed to load emails";
        toast.error(msg);
      }
    } finally {
      if (!silent) setLoadingList(false);
    }
  }, [
    getAccessToken,
    accountFilter,
    providerFilter,
    categoryFilter,
    priorityFilter,
    readFilter,
    archivedFilter,
    search,
    initialMessageId,
    selectedMessage,
    handleSelectMessage,
  ]);

  useEffect(() => {
    if (!authLoading && user && selectedAgent) {
      fetchMessages();
    }
  }, [authLoading, user, selectedAgent, fetchMessages]);

  // Auto-sync / poll messages every 2 seconds when an agent conversation is open
  useEffect(() => {
    if (authLoading || !user || !selectedAgent) return;
    const interval = setInterval(() => {
      fetchMessages(true);
    }, 2000);
    return () => clearInterval(interval);
  }, [authLoading, user, selectedAgent, fetchMessages]);

  const handleToggleRead = async () => {
    if (!selectedMessage) return;
    const newStatus = !selectedMessage.is_read;
    try {
      await updateEmailMessage(selectedMessage.id, { is_read: newStatus }, getAccessToken);
      setSelectedMessage({ ...selectedMessage, is_read: newStatus });
      setMessages((prev) =>
        prev.map((m) => (m.id === selectedMessage.id ? { ...m, is_read: newStatus } : m))
      );
      toast.success(newStatus ? "Marked as read" : "Marked as unread");
    } catch {
      toast.error("Failed to update read status");
    }
  };

  const handleToggleArchive = async () => {
    if (!selectedMessage) return;
    const newArchived = !selectedMessage.is_archived;
    try {
      await updateEmailMessage(selectedMessage.id, { is_archived: newArchived }, getAccessToken);
      setSelectedMessage({ ...selectedMessage, is_archived: newArchived });
      setMessages((prev) =>
        prev.map((m) => (m.id === selectedMessage.id ? { ...m, is_archived: newArchived } : m))
      );
      toast.success(newArchived ? "Archived message" : "Moved back to inbox");
    } catch {
      toast.error("Failed to update archive status");
    }
  };

  const handleGenerateDraft = async (regenerate = false) => {
    if (!selectedMessage) return;
    setGeneratingDraft(true);
    try {
      const fn = regenerate ? regenerateEmailReply : draftEmailReply;
      const res = await fn(selectedMessage.id, userGuidance, getAccessToken);
      setDraftReplyText(res.draft_reply);
      setSelectedMessage((prev) =>
        prev
          ? {
              ...prev,
              draft_reply: res.draft_reply,
              suggested_action: res.suggested_action || prev.suggested_action,
            }
          : prev
      );
      toast.success(regenerate ? "Regenerated reply draft" : "Generated AI draft reply");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to generate draft";
      toast.error(msg);
    } finally {
      setGeneratingDraft(false);
    }
  };

  const handleReanalyze = async () => {
    if (!selectedMessage) return;
    setAnalyzing(true);
    try {
      await analyzeEmailMessage(selectedMessage.id, getAccessToken);
      toast.success("AI analysis queued in background");
      setTimeout(() => {
        handleSelectMessage(selectedMessage);
      }, 3000);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to re-analyze";
      toast.error(msg);
    } finally {
      setAnalyzing(false);
    }
  };

  const handleCopyDraft = () => {
    if (!draftReplyText) return;
    navigator.clipboard.writeText(draftReplyText);
    toast.success("Draft copied to clipboard!");
  };

  const handleDownloadAttachment = async (att: EmailAttachment) => {
    setDownloadingAttId(att.id);
    try {
      const { download_url } = await getAttachmentDownloadUrl(att.id, getAccessToken);
      window.open(download_url, "_blank");
    } catch {
      toast.error("Failed to generate download URL");
    } finally {
      setDownloadingAttId(null);
    }
  };

  // Filter agents by search query
  const filteredAgents = useMemo(() => {
    if (!agentSearch.trim()) return agents;
    const q = agentSearch.toLowerCase();
    return agents.filter(
      (a) =>
        (a.name || "").toLowerCase().includes(q) ||
        (a.assigned_email || "").toLowerCase().includes(q) ||
        (a.description || "").toLowerCase().includes(q)
    );
  }, [agents, agentSearch]);

  // Actions toolbar for Agents Table view
  const agentHeaderActions = (
    <div className="flex items-center gap-2">
      <div className="relative w-44 sm:w-60">
        <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
        <Input
          placeholder="Search agents..."
          value={agentSearch}
          onChange={(e) => setAgentSearch(e.target.value)}
          className="h-8 pl-8 pr-2 text-xs"
        />
      </div>
      <Button
        size="icon"
        variant="outline"
        onClick={() => loadAgents()}
        title="Refresh agents"
        className="h-8 w-8 shrink-0"
      >
        <RefreshCw className={`h-3.5 w-3.5 ${loadingAgents ? "animate-spin" : ""}`} />
      </Button>
      <Button
        size="sm"
        onClick={() => router.push("/email/agents/create")}
        className="gap-1.5 text-xs h-8 bg-primary text-primary-foreground shadow-sm shrink-0"
      >
        <Plus className="h-3.5 w-3.5" /> Create Agent
      </Button>
    </div>
  );

  // Actions toolbar for Conversations View
  const conversationHeaderActions = useMemo(
    () => (
      <div className="flex flex-wrap items-center gap-1.5">
        <Button
          size="sm"
          variant="outline"
          onClick={handleBackToAgents}
          title="Back to agents list"
          className="h-8 gap-1.5 text-xs font-medium border-border/80 mr-1"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Back to Agents
        </Button>

        {/* Search Input - reduced width */}
        <div className="relative w-36 sm:w-44 lg:w-48">
          <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Search emails..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && fetchMessages()}
            className="h-8 pl-8 pr-2 text-xs"
          />
        </div>

        {/* Account Filter (Unified Multi-Inbox) - reduced width */}
        {accounts.length > 0 && (
          <Select value={accountFilter} onValueChange={(val) => setAccountFilter(val)}>
            <SelectTrigger className="h-8 text-xs w-[120px]">
              <SelectValue placeholder="All Inboxes" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Inboxes ({accounts.length})</SelectItem>
              {accounts.map((acc) => (
                <SelectItem key={`${acc.provider}-${acc.id}`} value={String(acc.id)}>
                  {acc.email || acc.email_address || `${acc.provider} #${acc.id}`}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {/* Provider Filter - reduced width */}
        <Select value={providerFilter} onValueChange={(val) => setProviderFilter(val)}>
          <SelectTrigger className="h-8 text-xs w-[95px]">
            <SelectValue placeholder="Provider" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Providers</SelectItem>
            <SelectItem value="gmail">Gmail</SelectItem>
            <SelectItem value="outlook">Outlook</SelectItem>
          </SelectContent>
        </Select>

        {/* Category Filter - reduced width */}
        <Select value={categoryFilter} onValueChange={(val) => setCategoryFilter(val)}>
          <SelectTrigger className="h-8 text-xs w-[105px]">
            <SelectValue placeholder="Category" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Categories</SelectItem>
            <SelectItem value="action_required">Action Required</SelectItem>
            <SelectItem value="important">Important</SelectItem>
            <SelectItem value="newsletter">Newsletter</SelectItem>
            <SelectItem value="promotional">Promotional</SelectItem>
            <SelectItem value="spam">Spam</SelectItem>
            <SelectItem value="general">General</SelectItem>
          </SelectContent>
        </Select>

        {/* Priority Filter - reduced width */}
        <Select value={priorityFilter} onValueChange={(val) => setPriorityFilter(val)}>
          <SelectTrigger className="h-8 text-xs w-[95px]">
            <SelectValue placeholder="Priority" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Priority</SelectItem>
            <SelectItem value="urgent">Urgent</SelectItem>
            <SelectItem value="high">High</SelectItem>
            <SelectItem value="normal">Normal</SelectItem>
            <SelectItem value="low">Low</SelectItem>
          </SelectContent>
        </Select>

        {/* Read / Unread Filter - reduced width */}
        <Select value={readFilter} onValueChange={(val) => setReadFilter(val)}>
          <SelectTrigger className="h-8 text-xs w-[85px]">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="unread">Unread</SelectItem>
            <SelectItem value="read">Read</SelectItem>
          </SelectContent>
        </Select>

        {/* Archived Filter - reduced width */}
        <Select value={archivedFilter} onValueChange={(val) => setArchivedFilter(val)}>
          <SelectTrigger className="h-8 text-xs w-[100px]">
            <SelectValue placeholder="Inbox" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="false">Active Inbox</SelectItem>
            <SelectItem value="true">Archived</SelectItem>
          </SelectContent>
        </Select>

        {/* Refresh Button */}
        <Button
          size="sm"
          variant="outline"
          onClick={() => fetchMessages()}
          title="Refresh emails"
          className="h-8 w-8 p-0 shrink-0"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loadingList ? "animate-spin" : ""}`} />
        </Button>
      </div>
    ),
    [
      search,
      accounts,
      accountFilter,
      providerFilter,
      categoryFilter,
      priorityFilter,
      readFilter,
      archivedFilter,
      loadingList,
      fetchMessages,
    ]
  );

  // 1. Loading Agents State
  if (loadingAgents) {
    return <InboxSkeleton />;
  }

  // 2. Empty State: No agents created yet
  if (!loadingAgents && agents.length === 0) {
    return (
      <>
        <PageHeader title="Email conversations" />
        <div className="flex flex-1 items-center justify-center p-6">
          <Card className="max-w-md w-full border border-dashed border-border/80 text-center">
            <CardContent className="flex flex-col items-center justify-center gap-3 py-12">
              <div
                className="flex h-14 w-14 items-center justify-center rounded-full"
                style={{
                  background: "color-mix(in oklch, var(--cta) 14%, transparent)",
                  color: "var(--cta)",
                }}
              >
                <Mail className="h-7 w-7" />
              </div>
              <h3 className="text-lg font-semibold text-foreground">No conversations yet</h3>
              <p className="text-sm text-muted-foreground max-w-sm">
                No email agents found. Please create an email agent and assign a mailbox to start monitoring and managing automated email conversations.
              </p>
              <Button
                onClick={() => router.push("/email/agents/create")}
                className="mt-2 gap-2 text-xs bg-primary text-primary-foreground shadow-sm"
              >
                <Plus className="h-4 w-4" /> Create Email Agent
              </Button>
            </CardContent>
          </Card>
        </div>
      </>
    );
  }

  // 3. Agent List State: Minimum one agent exists, show agents table
  if (!selectedAgent) {
    return (
      <>
        <PageHeader
          title="Email conversations"
          subtitle="Select an email agent to view conversations"
          actions={agentHeaderActions}
        />
        <div className="flex flex-1 flex-col min-h-0 overflow-hidden">
          <Card className="flex-1 flex flex-col min-h-0 overflow-hidden border border-border/70 shadow-xs">
            <div className="flex-1 min-h-0 overflow-y-auto">
              <Table>
                <TableHeader className="bg-muted/40 sticky top-0 z-10">
                  <TableRow>
                    <TableHead className="font-semibold text-xs">Agent Name</TableHead>
                    <TableHead className="font-semibold text-xs">Assigned Mailbox</TableHead>
                    <TableHead className="font-semibold text-xs">Provider</TableHead>
                    <TableHead className="font-semibold text-xs">Mode</TableHead>
                    <TableHead className="font-semibold text-xs">Status</TableHead>
                    <TableHead className="font-semibold text-xs text-right pr-6">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredAgents.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="h-32 text-center text-sm text-muted-foreground">
                        No agents match your search.
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredAgents.map((agent) => (
                      <TableRow
                        key={agent.id}
                        onClick={() => handleSelectAgent(agent)}
                        className="cursor-pointer hover:bg-muted/50 transition-colors group"
                      >
                        <TableCell>
                          <div className="flex items-center gap-2.5">
                            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary shrink-0">
                              <Bot className="h-4 w-4" />
                            </div>
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="font-medium text-xs sm:text-sm text-foreground truncate">{agent.name}</span>
                              </div>
                              {agent.description && (
                                <p className="text-[11px] text-muted-foreground truncate max-w-sm">{agent.description}</p>
                              )}
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          {agent.assigned_email ? (
                            <div className="flex items-center gap-1.5">
                              <Mail className="h-3.5 w-3.5 text-muted-foreground" />
                              <span className="text-xs font-mono font-medium">{agent.assigned_email}</span>
                            </div>
                          ) : (
                            <span className="text-xs text-muted-foreground italic">All Inboxes</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <span className="text-xs uppercase font-mono text-muted-foreground">
                            {agent.assigned_provider || (agent.gmail_account_id ? "gmail" : agent.outlook_account_id ? "outlook" : "all")}
                          </span>
                        </TableCell>
                        <TableCell>
                          {agent.auto_reply_enabled ? (
                            <Badge className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20 text-xs">
                              Auto-reply
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="text-xs text-amber-600 dark:text-amber-400 border-amber-500/20">
                              Draft Mode
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          {agent.is_active !== false ? (
                            <Badge className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20 text-xs">
                              Active
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="text-xs text-muted-foreground">
                              Inactive
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-right pr-6">
                          <Button
                            size="sm"
                            variant="ghost"
                            className="gap-1.5 text-xs text-primary hover:text-primary hover:bg-primary/10 group-hover:translate-x-0.5 transition-transform"
                          >
                            View conversations <ArrowRight className="h-3.5 w-3.5" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </Card>
        </div>
      </>
    );
  }

  // 4. Conversations View State: Agent selected, show two-pane email conversation view
  return (
    <>
      <PageHeader
        title={`Email conversations / ${selectedAgent.name}`}
        actions={conversationHeaderActions}
      />
      <div className="flex flex-1 min-h-0 h-full flex-col overflow-hidden">
        {/* Main Two-Pane Container */}
        <div className="grid flex-1 min-h-0 grid-cols-12 gap-3 overflow-hidden">
          {/* Left Column: Email List */}
          <div className="col-span-12 flex flex-col h-full min-h-0 rounded-lg border border-border/60 bg-card overflow-hidden lg:col-span-5 shadow-xs">
            <div className="border-b border-border/60 px-3.5 py-2 text-xs font-semibold text-muted-foreground flex items-center justify-between shrink-0">
              <span>
                {Array.isArray(messages) ? messages.length : 0}{" "}
                {(Array.isArray(messages) ? messages.length : 0) === 1 ? "Email" : "Emails"}
              </span>
              <span className="text-[11px] font-normal">Click to preview & act</span>
            </div>

          <div className="flex-1 min-h-0 overflow-y-auto divide-y divide-border/40">
            {loadingList ? (
              <div className="p-4 space-y-3">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="space-y-2">
                    <Skeleton className="h-4 w-3/4" />
                    <Skeleton className="h-3 w-1/2" />
                    <Skeleton className="h-3 w-full" />
                  </div>
                ))}
              </div>
            ) : !Array.isArray(messages) || messages.length === 0 ? (
              <div className="flex flex-col items-center justify-center p-8 text-center text-muted-foreground">
                <Inbox className="h-10 w-10 opacity-30 mb-2" />
                <p className="text-sm font-medium">No emails found</p>
                <p className="text-xs max-w-xs mt-1">
                  Adjust your search or filter options, or trigger account sync.
                </p>
              </div>
            ) : (
              messages.map((msg) => {
                const isSelected = selectedMessage?.id === msg.id;
                const catClass = msg.ai_category ? CATEGORY_COLORS[msg.ai_category] : "";

                return (
                  <div
                    key={msg.id}
                    onClick={() => handleSelectMessage(msg)}
                    className={cn(
                      "cursor-pointer p-3.5 transition-colors hover:bg-muted/40",
                      isSelected && "bg-muted/60 border-l-4 border-l-primary",
                      !msg.is_read && "font-medium bg-primary/5"
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 min-w-0">
                        {!msg.is_read && (
                          <div className="h-2 w-2 rounded-full bg-primary shrink-0" />
                        )}
                        <span className="text-xs text-foreground truncate font-medium">
                          {msg.sender}
                        </span>
                      </div>
                      <span className="text-[11px] text-muted-foreground shrink-0">
                        {formatMailDate(msg.received_at || msg.internal_date || msg.created_at)}
                      </span>
                    </div>

                    <h4 className="text-xs font-semibold text-foreground truncate mt-1">
                      {msg.subject || "(No Subject)"}
                    </h4>

                    <p className="text-[11px] text-muted-foreground line-clamp-2 mt-0.5">
                      {msg.snippet || msg.body_text || "No preview available"}
                    </p>

                    <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                      <span className="text-[10px] uppercase font-semibold text-muted-foreground px-1.5 py-0.5 rounded bg-muted/60">
                        {msg.provider}
                      </span>
                      {(() => {
                        const acc = accounts.find(
                          (a) =>
                            (msg.gmail_account_id && a.id === msg.gmail_account_id) ||
                            (msg.outlook_account_id && a.id === msg.outlook_account_id) ||
                            a.id === msg.account_id
                        );
                        const accEmail = acc?.email || acc?.email_address;
                        return accEmail ? (
                          <span className="text-[10px] text-muted-foreground font-mono bg-muted/40 px-1.5 py-0.5 rounded truncate max-w-[140px]">
                            {accEmail}
                          </span>
                        ) : null;
                      })()}
                      {msg.ai_category && (
                        <Badge
                          variant="outline"
                          className={cn("text-[10px] py-0 px-1.5 font-normal", catClass)}
                        >
                          {msg.ai_category.replace(/_/g, " ")}
                        </Badge>
                      )}
                      {msg.ai_priority && msg.ai_priority !== "normal" && (
                        <span
                          className={cn(
                            "text-[10px] rounded px-1.5 py-0 font-medium",
                            PRIORITY_COLORS[msg.ai_priority] || ""
                          )}
                        >
                          {msg.ai_priority}
                        </span>
                      )}
                      {msg.attachments && msg.attachments.length > 0 && (
                        <Paperclip className="h-3 w-3 text-muted-foreground" />
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Right Column: Email Detail & AI Assistant */}
        <div className="col-span-12 flex flex-col h-full min-h-0 rounded-lg border border-border/60 bg-card overflow-hidden lg:col-span-7 shadow-xs">
          {!selectedMessage ? (
            <div className="flex flex-1 flex-col items-center justify-center p-8 text-center text-muted-foreground">
              <Mail className="h-12 w-12 opacity-30 mb-2" />
              <p className="text-sm font-medium">Select an email to view</p>
              <p className="text-xs max-w-sm mt-1">
                Read message content, view AI insights, and generate context-aware email replies.
              </p>
            </div>
          ) : (
            <div className="flex flex-1 flex-col min-h-0 overflow-hidden">
              {/* Detail Header & Action Toolbar */}
              <div className="border-b border-border/60 p-3.5 bg-muted/10 shrink-0">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <h3 className="text-base font-bold text-foreground">
                      {selectedMessage.subject || "(No Subject)"}
                    </h3>
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                      <span>
                        <strong className="text-foreground">From:</strong> {selectedMessage.sender}
                      </span>
                      <span>
                        <strong className="text-foreground">Date:</strong>{" "}
                        {formatMailDate(
                          selectedMessage.received_at ||
                            selectedMessage.internal_date ||
                            selectedMessage.created_at,
                          true
                        )}
                      </span>
                    </div>
                    {selectedMessage.recipients && selectedMessage.recipients.length > 0 && (
                      <div className="text-[11px] text-muted-foreground mt-0.5 truncate">
                        <strong>To:</strong> {selectedMessage.recipients.join(", ")}
                      </div>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1.5 shrink-0">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={handleToggleRead}
                      className="h-8 text-xs gap-1"
                      title={selectedMessage.is_read ? "Mark Unread" : "Mark Read"}
                    >
                      {selectedMessage.is_read ? (
                        <>
                          <Mail className="h-3.5 w-3.5" />
                          Unread
                        </>
                      ) : (
                        <>
                          <MailOpen className="h-3.5 w-3.5" />
                          Read
                        </>
                      )}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={handleToggleArchive}
                      className="h-8 text-xs gap-1"
                      title={selectedMessage.is_archived ? "Unarchive" : "Archive"}
                    >
                      <Archive className="h-3.5 w-3.5" />
                      {selectedMessage.is_archived ? "Unarchive" : "Archive"}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={handleReanalyze}
                      disabled={analyzing}
                      className="h-8 text-xs gap-1"
                      title="Trigger AI analysis"
                    >
                      <Sparkles className={`h-3.5 w-3.5 ${analyzing ? "animate-spin" : ""}`} />
                      Analyze
                    </Button>
                  </div>
                </div>

                {/* AI Summary and Classification Banner */}
                {(selectedMessage.ai_summary || selectedMessage.ai_category) && (
                  <div className="mt-3.5 rounded-lg border border-primary/20 bg-primary/5 p-3 text-xs">
                    <div className="flex items-center justify-between gap-2 mb-1.5">
                      <div className="flex items-center gap-1.5 font-semibold text-primary">
                        <Sparkles className="h-3.5 w-3.5" />
                        AI Summary & Analysis
                      </div>
                      {selectedMessage.confidence_score && (
                        <span className="text-[11px] text-muted-foreground">
                          Confidence: {Math.round(selectedMessage.confidence_score * 100)}%
                        </span>
                      )}
                    </div>
                    {selectedMessage.ai_summary && (
                      <p className="text-foreground leading-relaxed">{selectedMessage.ai_summary}</p>
                    )}

                    {selectedMessage.ai_key_points && selectedMessage.ai_key_points.length > 0 && (
                      <div className="mt-2 space-y-1">
                        <strong className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">
                          Key Points:
                        </strong>
                        <ul className="list-disc list-inside space-y-0.5 text-foreground/90 pl-1">
                          {selectedMessage.ai_key_points.map((pt, i) => (
                            <li key={i}>{pt}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {selectedMessage.suggested_action && (
                      <div className="mt-2 flex items-center gap-1.5 text-xs text-primary font-medium">
                        <Tag className="h-3.5 w-3.5" />
                        Suggested Action: {selectedMessage.suggested_action}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Message Body - scrollable */}
              <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4">
                {loadingDetail ? (
                  <div className="space-y-3">
                    <Skeleton className="h-4 w-full" />
                    <Skeleton className="h-4 w-5/6" />
                    <Skeleton className="h-4 w-4/6" />
                  </div>
                ) : (
                  <div className="prose prose-sm dark:prose-invert max-w-none">
                    {selectedMessage.body_html ? (
                      <div
                        className="email-body-html font-sans text-xs leading-relaxed text-foreground"
                        dangerouslySetInnerHTML={{ __html: selectedMessage.body_html }}
                      />
                    ) : (
                      <pre className="whitespace-pre-wrap font-sans text-xs text-foreground leading-relaxed">
                        {selectedMessage.body_text || selectedMessage.snippet || "No message content."}
                      </pre>
                    )}
                  </div>
                )}

                {/* Attachments List */}
                {selectedMessage.attachments && selectedMessage.attachments.length > 0 && (
                  <div className="mt-6 border-t border-border/50 pt-4">
                    <h5 className="text-xs font-semibold text-foreground mb-2 flex items-center gap-1.5">
                      <Paperclip className="h-3.5 w-3.5" />
                      Attachments ({selectedMessage.attachments.length})
                    </h5>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {selectedMessage.attachments.map((att) => (
                        <div
                          key={att.id}
                          className="flex items-center justify-between rounded border border-border/60 p-2 bg-muted/20 text-xs"
                        >
                          <span className="truncate font-medium pr-2">{att.filename}</span>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-6 w-6 p-0 shrink-0"
                            disabled={downloadingAttId === att.id}
                            onClick={() => handleDownloadAttachment(att)}
                          >
                            <Download className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* AI Draft Reply Section - pinned at bottom */}
              <div className="border-t border-border/60 p-3.5 bg-muted/15 space-y-3 shrink-0">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 font-semibold text-xs text-foreground">
                    <Wand2 className="h-3.5 w-3.5 text-primary" />
                    AI Reply Assistant
                  </div>
                  {draftReplyText && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={handleCopyDraft}
                      className="h-7 text-xs gap-1 text-primary"
                    >
                      <Copy className="h-3.5 w-3.5" />
                      Copy Draft
                    </Button>
                  )}
                </div>

                <div className="flex gap-2">
                  <Input
                    placeholder="Instructions for AI (e.g. 'Politely accept the meeting for Thursday at 3pm')..."
                    value={userGuidance}
                    onChange={(e) => setUserGuidance(e.target.value)}
                    className="text-xs flex-1"
                  />
                  <Button
                    size="sm"
                    disabled={generatingDraft}
                    onClick={() => handleGenerateDraft(false)}
                    className="gap-1.5 text-xs shrink-0"
                  >
                    {generatingDraft ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Sparkles className="h-3.5 w-3.5" />
                    )}
                    Generate
                  </Button>
                  {draftReplyText && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={generatingDraft}
                      onClick={() => handleGenerateDraft(true)}
                      className="text-xs shrink-0"
                      title="Regenerate with revised instructions"
                    >
                      Regenerate
                    </Button>
                  )}
                </div>

                {draftReplyText && (
                  <div className="space-y-1.5">
                    <Textarea
                      value={draftReplyText}
                      onChange={(e) => setDraftReplyText(e.target.value)}
                      rows={5}
                      className="text-xs font-sans leading-relaxed resize-none"
                    />
                    <p className="text-[11px] text-muted-foreground">
                      Review and edit before sending. (Automatic outbound delivery is disabled for safety).
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  </>
);
}

export default function UnifiedInboxPage() {
  return (
    <Suspense fallback={<InboxSkeleton />}>
      <UnifiedInboxContent />
    </Suspense>
  );
}
