"use client";

import {
  AlertTriangle,
  Bot,
  Edit2,
  Mail,
  Plus,
  RefreshCw,
  Shield,
  Trash2,
  Zap,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { PageSearchInput } from "@/components/layout/PageSearchInput";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
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
  createEmailAgent,
  CreateEmailAgentPayload,
  deleteEmailAgent,
  EmailAccount,
  EmailAgent,
  getEmailAccounts,
  getEmailAgents,
  updateEmailAgent,
  UpdateEmailAgentPayload,
} from "@/lib/emailApi";

interface AgentFormData {
  name: string;
  description: string;
  mailboxSelection: string; // "all", "gmail:{id}", "outlook:{id}"
  tone: string;
  system_prompt: string;
  model_provider: string;
  model_name: string;
  require_human_approval: boolean;
  auto_reply_enabled: boolean;
  is_active: boolean;
}

const DEFAULT_FORM_DATA: AgentFormData = {
  name: "",
  description: "",
  mailboxSelection: "all",
  tone: "professional",
  system_prompt:
    "You are a dedicated email assistant. Read context carefully, extract key action items, and draft respectful, high-quality replies.",
  model_provider: "google",
  model_name: "gemini-2.5-flash",
  require_human_approval: true,
  auto_reply_enabled: false,
  is_active: true,
};

function formatAgentDate(dateVal?: string | null): string {
  if (!dateVal) return "";
  const d = new Date(dateVal);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString([], {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default function EmailAgentsPage() {
  const router = useRouter();
  const { user, loading: authLoading, getAccessToken } = useAuth();

  const [agents, setAgents] = useState<EmailAgent[]>([]);
  const [accounts, setAccounts] = useState<EmailAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  // Create / Edit modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [editingAgentId, setEditingAgentId] = useState<number | null>(null);
  const [formData, setFormData] = useState<AgentFormData>(DEFAULT_FORM_DATA);
  const [submitting, setSubmitting] = useState(false);

  // Delete modal state
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [agentToDelete, setAgentToDelete] = useState<EmailAgent | null>(null);
  const [deleting, setDeleting] = useState(false);

  const loadData = useCallback(async (silent = false) => {
    try {
      if (!silent) setLoading(true);
      const [agentsData, accountsData] = await Promise.all([
        getEmailAgents(getAccessToken).catch((err) => {
          console.warn("Failed to fetch email agents:", err);
          return [] as EmailAgent[];
        }),
        getEmailAccounts(getAccessToken).catch((err) => {
          console.warn("Failed to fetch email accounts:", err);
          return [] as EmailAccount[];
        }),
      ]);
      setAgents(Array.isArray(agentsData) ? agentsData : []);
      setAccounts(Array.isArray(accountsData) ? accountsData : []);
    } catch (err: unknown) {
      if (!silent) {
        console.error("Failed to load email agents data:", err);
        setAgents([]);
        setAccounts([]);
        const msg = err instanceof Error ? err.message : "Failed to load email agents";
        toast.error(msg);
      }
    } finally {
      if (!silent) setLoading(false);
    }
  }, [getAccessToken]);

  useEffect(() => {
    if (!authLoading && user) {
      loadData();
      const interval = setInterval(() => {
        loadData(true);
      }, 2000);
      return () => clearInterval(interval);
    } else if (!authLoading && !user) {
      setLoading(false);
    }
  }, [authLoading, user, loadData]);

  const safeAgents = Array.isArray(agents) ? agents : [];
  const safeAccounts = Array.isArray(accounts) ? accounts : [];

  const openEditModal = (agent: EmailAgent) => {
    setEditingAgentId(agent.id);
    let mailboxSelection = "all";
    if (agent.gmail_account_id) {
      mailboxSelection = `gmail:${agent.gmail_account_id}`;
    } else if (agent.outlook_account_id) {
      mailboxSelection = `outlook:${agent.outlook_account_id}`;
    }

    let modelRef: Record<string, unknown> = {};
    if (agent.model_config_ref && typeof agent.model_config_ref === "object") {
      modelRef = agent.model_config_ref as Record<string, unknown>;
    } else if (typeof agent.model_config_ref === "string") {
      try {
        modelRef = JSON.parse(agent.model_config_ref);
      } catch {
        modelRef = {};
      }
    }

    setFormData({
      name: agent.name || "",
      description: agent.description || "",
      mailboxSelection,
      tone: String(modelRef.tone || "professional"),
      system_prompt: agent.system_prompt || "",
      model_provider: String(modelRef.model_provider || "google"),
      model_name: String(modelRef.model_name || "gemini-2.5-flash"),
      require_human_approval: modelRef.require_human_approval !== false,
      auto_reply_enabled: Boolean(agent.auto_reply_enabled),
      is_active: Boolean(agent.is_active),
    });
    setModalOpen(true);
  };

  const handleSaveAgent = async () => {
    if (!formData.name.trim()) {
      toast.error("Agent name is required");
      return;
    }

    setSubmitting(true);
    try {
      let gmail_account_id: number | null = null;
      let outlook_account_id: number | null = null;

      if (formData.mailboxSelection.startsWith("gmail:")) {
        gmail_account_id = Number(formData.mailboxSelection.split(":")[1]);
      } else if (formData.mailboxSelection.startsWith("outlook:")) {
        outlook_account_id = Number(formData.mailboxSelection.split(":")[1]);
      }

      const modelConfig = {
        model_provider: formData.model_provider,
        model_name: formData.model_name,
        tone: formData.tone,
        require_human_approval: formData.require_human_approval,
      };

      if (editingAgentId) {
        const payload: UpdateEmailAgentPayload = {
          name: formData.name.trim(),
          description: formData.description.trim() || undefined,
          system_prompt: formData.system_prompt,
          gmail_account_id: gmail_account_id ?? 0,
          outlook_account_id: outlook_account_id ?? 0,
          model_config_ref: modelConfig,
          is_active: formData.is_active,
          auto_reply_enabled: formData.auto_reply_enabled,
        };
        const updated = await updateEmailAgent(editingAgentId, payload, getAccessToken);
        setAgents((prev) => prev.map((a) => (a.id === updated.id ? updated : a)));
        toast.success(`Agent "${updated.name}" updated successfully`);
      } else {
        const payload: CreateEmailAgentPayload = {
          name: formData.name.trim(),
          description: formData.description.trim() || undefined,
          system_prompt: formData.system_prompt,
          gmail_account_id: gmail_account_id,
          outlook_account_id: outlook_account_id,
          model_config_ref: modelConfig,
          is_active: formData.is_active,
          auto_reply_enabled: formData.auto_reply_enabled,
        };
        const created = await createEmailAgent(payload, getAccessToken);
        setAgents((prev) => [created, ...prev]);
        toast.success(`Email Agent "${created.name}" created successfully`);
      }

      setModalOpen(false);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to save agent";
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const confirmDelete = (agent: EmailAgent) => {
    setAgentToDelete(agent);
    setDeleteConfirmOpen(true);
  };

  const handleDeleteAgent = async () => {
    if (!agentToDelete) return;
    setDeleting(true);
    try {
      await deleteEmailAgent(agentToDelete.id, getAccessToken);
      setAgents((prev) => prev.filter((a) => a.id !== agentToDelete.id));
      toast.success(`Agent "${agentToDelete.name}" deleted`);
      setDeleteConfirmOpen(false);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to delete agent";
      toast.error(msg);
    } finally {
      setDeleting(false);
    }
  };

  const filteredAgents = useMemo(() => {
    if (!search.trim()) return safeAgents;
    const q = search.toLowerCase();
    return safeAgents.filter((agent) => {
      if (!agent) return false;
      const name = (agent.name || "").toLowerCase();
      const desc = (agent.description || "").toLowerCase();
      const email = (agent.assigned_email || "").toLowerCase();
      return name.includes(q) || desc.includes(q) || email.includes(q);
    });
  }, [safeAgents, search]);

  const headerActions = useMemo(() => (
    <div className="flex items-center gap-2 flex-wrap">
      <div className="w-48 sm:w-64">
        <PageSearchInput
          placeholder="Search agents..."
          value={search}
          onChange={setSearch}
        />
      </div>
      <Button
        variant="outline"
        size="icon"
        onClick={() => loadData()}
        disabled={loading}
        title="Refresh"
        aria-label="Refresh"
        className="h-9 w-9 shrink-0"
      >
        <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
      </Button>
      <Button
        size="sm"
        onClick={() => router.push("/email/agents/create")}
        className="gap-2 text-xs h-9 bg-primary text-primary-foreground shadow-sm shrink-0"
      >
        <Plus className="h-4 w-4" /> Create Agent
      </Button>
    </div>
  ), [search, loading, loadData, router]);

  if (authLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-48" />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-24 w-full rounded-xl" />
          ))}
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-64 w-full rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <>
      <PageHeader title="Email Agents" actions={headerActions} />
      <div className="space-y-6">
        {safeAgents.length === 0 ? (
          <div className="flex min-h-[60vh] items-center justify-center p-4">
            <Card className="w-full max-w-3xl border border-border/80 bg-card p-12 text-center shadow-sm">
              <CardContent className="flex flex-col items-center justify-center p-0">
                <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-muted text-foreground">
                  <Bot className="h-7 w-7" />
                </div>
                <h3 className="text-base font-bold text-foreground">
                  No email agents configured yet
                </h3>
                <p className="mx-auto mt-1 mb-6 max-w-md text-xs text-muted-foreground">
                  Create specialized AI email agents to triage support tickets, engage sales leads, or manage your executive inbox.
                </p>
                <Button
                  size="sm"
                  onClick={() => router.push("/email/agents/create")}
                  className="gap-2 text-xs bg-foreground text-background hover:bg-foreground/90 font-medium px-4 py-2"
                >
                  <Plus className="h-4 w-4" /> Create Your First Agent
                </Button>
              </CardContent>
            </Card>
          </div>
        ) : (
          <div className="rounded-xl border border-border/70 overflow-hidden bg-card/60 backdrop-blur-sm shadow-sm">
              <Table>
                <TableHeader className="bg-muted/40">
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="font-semibold text-xs py-3">Agent</TableHead>
                    <TableHead className="font-semibold text-xs py-3">Mailbox</TableHead>
                    <TableHead className="font-semibold text-xs py-3">Status</TableHead>
                    <TableHead className="font-semibold text-xs py-3">Execution Mode</TableHead>
                    <TableHead className="font-semibold text-xs py-3">Created</TableHead>
                    <TableHead className="font-semibold text-xs py-3 text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredAgents.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="h-32 text-center text-xs text-muted-foreground">
                        {search.trim() ? (
                          <span>No agents found matching &ldquo;{search}&rdquo;</span>
                        ) : (
                          <span>No email agents found</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredAgents.map((agent) => (
                      <TableRow key={agent.id} className="hover:bg-muted/30 transition-colors">
                        <TableCell className="py-3">
                          <span className="font-semibold text-xs text-foreground">{agent.name}</span>
                        </TableCell>
                        <TableCell className="py-3">
                          {agent.assigned_email ? (
                            <Badge variant="outline" className="text-[10px] gap-1 font-mono">
                              <Mail className="h-3 w-3 text-primary" />
                              {agent.assigned_email}
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="text-[10px] text-muted-foreground">
                              All Inboxes
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="py-3">
                          <Badge
                            variant={agent.is_active ? "default" : "secondary"}
                            className="text-[10px] capitalize"
                          >
                            {agent.is_active ? "Active" : "Paused"}
                          </Badge>
                        </TableCell>
                        <TableCell className="py-3 text-[11px] text-muted-foreground">
                          {agent.auto_reply_enabled ? "Auto-Reply" : "Drafts Only"}
                        </TableCell>
                        <TableCell className="py-3 text-[11px] text-muted-foreground whitespace-nowrap">
                          {agent.created_at ? formatAgentDate(agent.created_at) : "—"}
                        </TableCell>
                        <TableCell className="py-3 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => openEditModal(agent)}
                              title="Edit agent"
                              className="h-8 w-8 text-muted-foreground hover:text-foreground"
                            >
                              <Edit2 className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => confirmDelete(agent)}
                              title="Delete agent"
                              className="h-8 w-8 text-destructive hover:bg-destructive/10"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
        )}

      {/* Create / Edit Agent Dialog */}
      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="sm:max-w-xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-base font-bold flex items-center gap-2">
              <Bot className="h-5 w-5 text-primary" />
              Edit Email AI Agent
            </DialogTitle>
            <DialogDescription className="text-xs">
              Configure specialized instructions, tone of voice, assigned mailbox, and autonomous boundaries.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2 text-xs">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Agent Name *</Label>
                <Input
                  placeholder="e.g. Support Specialist"
                  value={formData.name}
                  onChange={(e) => setFormData((prev) => ({ ...prev, name: e.target.value }))}
                  className="text-xs"
                />
              </div>

              <div className="space-y-1">
                <Label className="text-xs">Tone of Voice</Label>
                <Select
                  value={formData.tone}
                  onValueChange={(val) => setFormData((prev) => ({ ...prev, tone: val }))}
                >
                  <SelectTrigger className="h-9 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="professional">Professional & Polished</SelectItem>
                    <SelectItem value="friendly">Friendly & Warm</SelectItem>
                    <SelectItem value="concise">Concise & Direct</SelectItem>
                    <SelectItem value="persuasive">Sales & Persuasive</SelectItem>
                    <SelectItem value="formal">Formal & Analytical</SelectItem>
                    {!["professional", "friendly", "concise", "persuasive", "formal"].includes(formData.tone) && (
                      <SelectItem value={formData.tone}>{formData.tone}</SelectItem>
                    )}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Assigned Mailbox</Label>
              <Select
                value={formData.mailboxSelection}
                onValueChange={(val) => setFormData((prev) => ({ ...prev, mailboxSelection: val }))}
              >
                <SelectTrigger className="h-9 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Inboxes (General Organization Agent)</SelectItem>
                  {safeAccounts.map((acc, idx) => {
                    const assignedAgent = safeAgents.find((a) => {
                      if (editingAgentId && a.id === editingAgentId) return false;
                      if (acc.provider === "gmail" && a.gmail_account_id === acc.id) return true;
                      if (acc.provider === "outlook" && a.outlook_account_id === acc.id) return true;
                      const mail = acc.email || acc.email_address;
                      if (mail && a.assigned_email && a.assigned_email.toLowerCase() === mail.toLowerCase()) return true;
                      return false;
                    });
                    const isAssigned = Boolean(assignedAgent);
                    return (
                      <SelectItem
                        key={`${acc.provider || "mail"}-${acc.id || idx}`}
                        value={`${acc.provider || "mail"}:${acc.id}`}
                        disabled={isAssigned}
                      >
                        {acc.provider === "gmail" ? "Gmail: " : "Outlook: "}
                        <span className={isAssigned ? "line-through opacity-50" : ""}>
                          {acc.email || acc.email_address || `Account #${acc.id}`}
                        </span>
                        {isAssigned && (
                          <span className="ml-1.5 text-[10px] text-muted-foreground italic">
                            (Assigned to {assignedAgent?.name})
                          </span>
                        )}
                      </SelectItem>
                    );
                  })}
                  {formData.mailboxSelection !== "all" &&
                    !safeAccounts.some((acc) => `${acc.provider}:${acc.id}` === formData.mailboxSelection) && (
                      <SelectItem value={formData.mailboxSelection}>
                        Linked Mailbox ({formData.mailboxSelection})
                      </SelectItem>
                    )}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground">
                Bind this agent to a specific connected account (e.g., support@domain.com) or let it handle all mailboxes.
              </p>
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Description</Label>
              <Input
                placeholder="Brief summary of what this agent is responsible for..."
                value={formData.description}
                onChange={(e) => setFormData((prev) => ({ ...prev, description: e.target.value }))}
                className="text-xs"
              />
            </div>

            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <Label className="text-xs">System Instructions & Persona Prompt *</Label>
                <span className="text-[10px] text-muted-foreground">Guides AI drafts & categorization</span>
              </div>
              <Textarea
                rows={5}
                placeholder="Explain the persona, response style, policies, and actions to take..."
                value={formData.system_prompt}
                onChange={(e) => setFormData((prev) => ({ ...prev, system_prompt: e.target.value }))}
                className="text-xs font-mono resize-none leading-relaxed"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">LLM Engine Provider</Label>
                <Select
                  value={formData.model_provider}
                  onValueChange={(val) => setFormData((prev) => ({ ...prev, model_provider: val }))}
                >
                  <SelectTrigger className="h-9 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="google">Google Gemini</SelectItem>
                    <SelectItem value="openai">OpenAI</SelectItem>
                    <SelectItem value="anthropic">Anthropic</SelectItem>
                    {!["google", "openai", "anthropic"].includes(formData.model_provider) && (
                      <SelectItem value={formData.model_provider}>{formData.model_provider}</SelectItem>
                    )}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1">
                <Label className="text-xs">Model Identifier</Label>
                <Input
                  value={formData.model_name}
                  onChange={(e) => setFormData((prev) => ({ ...prev, model_name: e.target.value }))}
                  placeholder="gemini-2.5-flash"
                  className="text-xs font-mono"
                />
              </div>
            </div>

            {/* Autonomous Safety Boundaries */}
            <div className="space-y-3 rounded-lg border border-border/60 p-3 bg-muted/20">
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-semibold text-foreground flex items-center gap-1.5">
                    <Shield className="h-3.5 w-3.5 text-emerald-500" />
                    Require Human Review (Drafts Only)
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    Generated replies appear as drafts in your inbox awaiting user confirmation
                  </div>
                </div>
                <Switch
                  checked={formData.require_human_approval}
                  onCheckedChange={(checked) =>
                    setFormData((prev) => ({ ...prev, require_human_approval: checked }))
                  }
                />
              </div>

              <div className="flex items-center justify-between border-t border-border/40 pt-2.5">
                <div>
                  <div className="font-semibold text-foreground flex items-center gap-1.5">
                    <Zap className="h-3.5 w-3.5 text-amber-500" />
                    Autonomous Auto-Reply
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    Allows the agent to send automated replies without human review (use cautiously)
                  </div>
                </div>
                <Switch
                  checked={formData.auto_reply_enabled}
                  onCheckedChange={(checked) =>
                    setFormData((prev) => ({ ...prev, auto_reply_enabled: checked }))
                  }
                />
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setModalOpen(false)}
              className="text-xs"
            >
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={submitting}
              onClick={handleSaveAgent}
              className="text-xs gap-1.5"
            >
              {submitting ? "Saving..." : "Update Agent"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Agent Confirmation Dialog */}
      <Dialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base font-bold text-destructive flex items-center gap-2">
              <AlertTriangle className="h-5 w-5" /> Delete Email Agent
            </DialogTitle>
            <DialogDescription className="text-xs">
              Are you sure you want to delete the email agent &ldquo;{agentToDelete?.name}&rdquo;?
              This action cannot be undone. Historical email logs will be preserved.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setDeleteConfirmOpen(false)}
              className="text-xs"
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              size="sm"
              disabled={deleting}
              onClick={handleDeleteAgent}
              className="text-xs gap-1.5"
            >
              {deleting ? "Deleting..." : "Confirm Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  </>
  );
}
