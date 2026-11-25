"use client";

import { ArrowLeft } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Breadcrumb, PageHeader } from "@/context/HeaderContext";
import { useAuth } from "@/lib/auth";
import {
  createEmailAgent,
  CreateEmailAgentPayload,
  EmailAccount,
  EmailAgent,
  getEmailAccounts,
  getEmailAgents,
} from "@/lib/emailApi";

export default function CreateEmailAgentPage() {
  const router = useRouter();
  const { user, getAccessToken } = useAuth();

  const [name, setName] = useState("");
  const [provider, setProvider] = useState<"email" | "outlook">("email");
  const [assignedMailbox, setAssignedMailbox] = useState<string>("all");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [autoReplyEnabled, setAutoReplyEnabled] = useState(false);

  const [accounts, setAccounts] = useState<EmailAccount[]>([]);
  const [agents, setAgents] = useState<EmailAgent[]>([]);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!user) return;
    (async () => {
      try {
        const [accountsData, agentsData] = await Promise.all([
          getEmailAccounts(getAccessToken).catch(() => [] as EmailAccount[]),
          getEmailAgents(getAccessToken).catch(() => [] as EmailAgent[]),
        ]);
        setAccounts(Array.isArray(accountsData) ? accountsData : []);
        setAgents(Array.isArray(agentsData) ? agentsData : []);
      } catch (err) {
        console.warn("Failed to fetch email accounts or agents:", err);
      }
    })();
  }, [user, getAccessToken]);

  const breadcrumbs = useMemo<Breadcrumb[]>(
    () => [
      { label: "Email agents", href: "/email/agents" },
      { label: "Create Email Agent" },
    ],
    []
  );

  const getAssignedAgent = (acc: EmailAccount) => {
    return agents.find((agent) => {
      if (acc.provider === "gmail" && agent.gmail_account_id === acc.id) return true;
      if (acc.provider === "outlook" && agent.outlook_account_id === acc.id) return true;
      const emailStr = (acc.email || acc.email_address || "").toLowerCase();
      if (agent.assigned_email && emailStr && agent.assigned_email.toLowerCase() === emailStr) {
        return true;
      }
      return false;
    });
  };

  const filteredAccounts = useMemo(() => {
    const list = Array.isArray(accounts) ? accounts : [];
    if (provider === "email") {
      return list.filter((acc) => acc.provider === "gmail");
    }
    if (provider === "outlook") {
      return list.filter((acc) => acc.provider === "outlook");
    }
    return [];
  }, [accounts, provider]);

  const handleCreateAgent = async () => {
    if (!name.trim()) {
      toast.error("Agent name is required");
      return;
    }

    const duplicate = agents.some(
      (a) => a.name.trim().toLowerCase() === name.trim().toLowerCase()
    );
    if (duplicate) {
      toast.error(`An email agent named "${name.trim()}" already exists`);
      return;
    }

    if (!systemPrompt.trim()) {
      toast.error("System prompt is required");
      return;
    }

    setSubmitting(true);
    try {
      let gmail_account_id: number | null = null;
      let outlook_account_id: number | null = null;

      if (assignedMailbox !== "all" && assignedMailbox !== "_none") {
        const selectedAccount = (accounts || []).find((a) => String(a.id) === assignedMailbox);
        if (selectedAccount) {
          const assigned = getAssignedAgent(selectedAccount);
          if (assigned) {
            toast.error(
              `"${selectedAccount.email || selectedAccount.email_address}" is already assigned to "${assigned.name}"`
            );
            return;
          }
        }
        if (provider === "email") {
          gmail_account_id = Number(assignedMailbox);
        } else if (provider === "outlook") {
          outlook_account_id = Number(assignedMailbox);
        }
      }

      const modelConfig = {
        model_provider: "google",
        model_name: "gemini-2.5-flash",
        tone: "professional",
        require_human_approval: !autoReplyEnabled,
      };

      const payload: CreateEmailAgentPayload = {
        name: name.trim(),
        system_prompt: systemPrompt.trim(),
        gmail_account_id,
        outlook_account_id,
        model_config_ref: modelConfig,
        is_active: true,
        auto_reply_enabled: autoReplyEnabled,
      };

      const created = await createEmailAgent(payload, getAccessToken);
      toast.success(`Email Agent "${created.name}" created successfully`);
      router.push("/email/agents");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to create agent";
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex-1 w-full min-h-0 overflow-y-auto">
      <PageHeader title="Create Email Agent" breadcrumbs={breadcrumbs} />

      <div className="flex min-h-[calc(100vh-120px)] w-full items-center justify-center p-4 sm:p-6">
        <div className="w-full max-w-2xl my-auto">
          <Card className="border border-border/80 shadow-sm">
            <CardHeader className="px-4 py-4 sm:px-6">
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => router.push("/email/agents")}
                  title="Back"
                  aria-label="Back"
                  className="h-8 w-8 text-muted-foreground hover:text-foreground shrink-0 -ml-1"
                >
                  <ArrowLeft className="h-4 w-4" />
                </Button>
                <CardTitle className="text-lg">Create Email Agent</CardTitle>
              </div>
            </CardHeader>

            <CardContent className="space-y-4 px-4 pb-6 pt-0 sm:px-6">
              {/* Agent Name */}
              <div className="space-y-1">
                <Label htmlFor="agent-name" className="text-xs">
                  Agent Name *
                </Label>
                <Input
                  id="agent-name"
                  placeholder="e.g., Support Assistant, Sales Qualifier"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="text-xs"
                />
              </div>

              {/* Email Provider Dropdown */}
              <div className="space-y-1">
                <Label htmlFor="email-provider" className="text-xs">
                  Email Provider *
                </Label>
                <Select
                  value={provider}
                  onValueChange={(val: "email" | "outlook") => {
                    setProvider(val);
                    setAssignedMailbox("all");
                  }}
                >
                  <SelectTrigger id="email-provider" className="h-9 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="email">Email</SelectItem>
                    <SelectItem value="outlook">Outlook</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Assigned Mailbox Dropdown (populated based on Email Provider) */}
              <div className="space-y-1">
                <Label htmlFor="assigned-mailbox" className="text-xs">
                  Assigned Mailbox
                </Label>
                <Select
                  value={assignedMailbox}
                  onValueChange={setAssignedMailbox}
                >
                  <SelectTrigger id="assigned-mailbox" className="h-9 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">
                      All Inboxes ({provider === "email" ? "All Email accounts" : "All Outlook accounts"})
                    </SelectItem>
                    {filteredAccounts.length === 0 ? (
                      <SelectItem value="_none" disabled>
                        No connected {provider === "email" ? "Email" : "Outlook"} accounts found
                      </SelectItem>
                    ) : (
                      filteredAccounts.map((acc) => {
                        const assignedAgent = getAssignedAgent(acc);
                        const isAssigned = Boolean(assignedAgent);
                        const emailStr = acc.email || acc.email_address || `Account #${acc.id}`;
                        return (
                          <SelectItem
                            key={acc.id}
                            value={String(acc.id)}
                            disabled={isAssigned}
                          >
                            <span className={isAssigned ? "line-through opacity-50" : ""}>
                              {emailStr}
                            </span>
                            {isAssigned && (
                              <span className="ml-2 text-[10px] text-muted-foreground italic">
                                (Assigned to {assignedAgent?.name})
                              </span>
                            )}
                          </SelectItem>
                        );
                      })
                    )}
                  </SelectContent>
                </Select>
                <p className="text-[11px] text-muted-foreground">
                  Select &ldquo;All Inboxes&rdquo; or a specific connected {provider === "email" ? "Email" : "Outlook"} account.
                </p>
              </div>

              {/* System Instructions / Persona Prompt (No default data, fixed height, scrollable) */}
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <Label htmlFor="system-prompt" className="text-xs">
                    System Prompt *
                  </Label>
                  <span className="text-[10px] text-muted-foreground">Guides AI replies &amp; categorization</span>
                </div>
                <Textarea
                  id="system-prompt"
                  placeholder="Explain the persona, response style, policies, and actions to take..."
                  value={systemPrompt}
                  onChange={(e) => setSystemPrompt(e.target.value)}
                  className="h-32 min-h-[128px] max-h-[128px] text-xs font-mono resize-none overflow-y-auto leading-relaxed"
                />
              </div>

              {/* Single Draft / Auto-Reply Toggle */}
              <div className="rounded-lg border border-border/60 p-3 bg-muted/20">
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <div className="font-semibold text-foreground text-xs flex items-center gap-2">
                      <span>Execution Mode:</span>
                      <span
                        className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${
                          autoReplyEnabled
                            ? "bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20"
                            : "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20"
                        }`}
                      >
                        {autoReplyEnabled ? "Auto-Reply" : "Drafts Only"}
                      </span>
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      {autoReplyEnabled
                        ? "Replies are sent automatically without human review"
                        : "Replies are saved as drafts in your inbox awaiting confirmation"}
                    </div>
                  </div>
                  <Switch
                    checked={autoReplyEnabled}
                    onCheckedChange={setAutoReplyEnabled}
                    aria-label="Toggle between drafts only and auto-reply"
                  />
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center justify-end gap-2 pt-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => router.push("/email/agents")}
                  className="text-xs"
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  disabled={submitting || !name.trim() || !systemPrompt.trim()}
                  onClick={handleCreateAgent}
                  className="text-xs gap-1.5"
                >
                  {submitting ? "Creating..." : "Create Agent"}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
