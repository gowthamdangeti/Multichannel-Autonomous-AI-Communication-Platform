"use client";

import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  ExternalLink,
  Layers,
  Mail,
  Plus,
  RefreshCw,
  ShieldCheck,
  Trash2,
  Unlink,
  Zap,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useAuth } from "@/lib/auth";
import {
  deleteEmailAccount,
  disconnectEmailAccount,
  EmailAccount,
  getEmailAccounts,
  getGmailOAuthUrl,
  getOutlookOAuthUrl,
  handleGmailOAuthCallback,
  handleOutlookOAuthCallback,
  reconnectEmailAccount,
  triggerAccountSync,
} from "@/lib/emailApi";

export default function SettingsPage() {
  const { user, loading: authLoading, getAccessToken } = useAuth();

  const [accounts, setAccounts] = useState<EmailAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncingId, setSyncingId] = useState<number | null>(null);
  const [connectingProvider, setConnectingProvider] = useState<string | null>(null);
  const [disconnectingAccount, setDisconnectingAccount] = useState<EmailAccount | null>(null);
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [deletingAccount, setDeletingAccount] = useState<EmailAccount | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [reconnectingId, setReconnectingId] = useState<number | null>(null);
  const [currentRedirectUri, setCurrentRedirectUri] = useState("http://localhost:3000/email/settings");

  useEffect(() => {
    if (typeof window !== "undefined") {
      setCurrentRedirectUri(`${window.location.origin}/email/settings`);
    }
  }, []);

  const loadAccounts = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getEmailAccounts(getAccessToken);
      setAccounts(Array.isArray(data) ? data : []);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to load accounts";
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }, [getAccessToken]);

  // Handle incoming OAuth callback if ?code= is present in URL
  useEffect(() => {
    if (typeof window === "undefined" || authLoading || !user) return;

    const urlParams = new URLSearchParams(window.location.search);
    const code = urlParams.get("code");
    const state = urlParams.get("state") || "";

    if (!code) return;

    const processOAuthCallback = async () => {
      const isOutlook = state.includes("outlook") || urlParams.get("scope")?.includes("graph.microsoft.com");
      const providerName = isOutlook ? "Outlook" : "Gmail";
      const toastId = toast.loading(`Connecting ${providerName} account...`);

      try {
        const redirectUri = `${window.location.origin}/email/settings`;
        if (isOutlook) {
          await handleOutlookOAuthCallback(code, getAccessToken, redirectUri);
        } else {
          await handleGmailOAuthCallback(code, getAccessToken, redirectUri);
        }
        toast.success(`Successfully connected your ${providerName} account!`, { id: toastId });
        await loadAccounts();

        const returnTo = typeof window !== "undefined" ? sessionStorage.getItem("oauth_return_to") : null;
        if (returnTo) {
          sessionStorage.removeItem("oauth_return_to");
          window.location.href = returnTo;
          return;
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : `Failed to connect ${providerName} account`;
        toast.error(msg, { id: toastId });
      } finally {
        // Strip the query parameters from URL without reloading
        window.history.replaceState({}, document.title, window.location.pathname);
      }
    };

    processOAuthCallback();
  }, [authLoading, user, getAccessToken, loadAccounts]);

  useEffect(() => {
    if (!authLoading && user) {
      loadAccounts();
    } else if (!authLoading && !user) {
      setLoading(false);
    }
  }, [authLoading, user, loadAccounts]);

  const handleConnect = async (provider: "gmail" | "outlook") => {
    setConnectingProvider(provider);
    try {
      const redirectUri = `${window.location.origin}/email/settings`;
      let res: { auth_url: string; provider: string };

      if (provider === "gmail") {
        res = await getGmailOAuthUrl(getAccessToken, redirectUri);
      } else {
        res = await getOutlookOAuthUrl(getAccessToken, redirectUri);
      }

      if (res?.auth_url) {
        toast.info(`Redirecting to ${provider === "gmail" ? "Google" : "Microsoft"} authorization...`);
        window.location.href = res.auth_url;
      } else {
        throw new Error("Did not receive authorization URL from server");
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : `Failed to initiate ${provider} connection`;
      toast.error(msg);
      setConnectingProvider(null);
    }
  };

  const handleSyncAccount = async (id: number, provider?: string) => {
    setSyncingId(id);
    try {
      await triggerAccountSync(id, getAccessToken, provider);
      toast.success("Synchronization started in background");
      setTimeout(() => loadAccounts(), 2500);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Sync trigger failed";
      toast.error(msg);
    } finally {
      setSyncingId(null);
    }
  };

  const handleConfirmDisconnect = async () => {
    if (!disconnectingAccount) return;
    setIsDisconnecting(true);
    try {
      await disconnectEmailAccount(disconnectingAccount.id, getAccessToken, disconnectingAccount.provider);
      toast.success(`Disconnected ${disconnectingAccount.email || disconnectingAccount.email_address}`);
      setDisconnectingAccount(null);
      await loadAccounts();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to disconnect account";
      toast.error(msg);
    } finally {
      setIsDisconnecting(false);
    }
  };

  const handleReconnect = async (acc: EmailAccount) => {
    setReconnectingId(acc.id);
    try {
      await reconnectEmailAccount(acc.id, getAccessToken, acc.provider);
      toast.success(`Reconnected ${acc.email || acc.email_address}`);
      await loadAccounts();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to reconnect account";
      toast.error(msg);
    } finally {
      setReconnectingId(null);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deletingAccount) return;
    setIsDeleting(true);
    try {
      await deleteEmailAccount(deletingAccount.id, getAccessToken, deletingAccount.provider);
      toast.success(`Deleted ${deletingAccount.email || deletingAccount.email_address}`);
      setDeletingAccount(null);
      await loadAccounts();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to delete account";
      toast.error(msg);
    } finally {
      setIsDeleting(false);
    }
  };

  const gmailCount = accounts.filter((a) => a.provider === "gmail").length;
  const outlookCount = accounts.filter((a) => a.provider === "outlook").length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-foreground">Email Account & Sync Settings</h2>
          <p className="text-sm text-muted-foreground">
            Connect and manage multiple Gmail and Outlook inboxes with unified multi-tenant sync.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={loadAccounts} className="gap-2">
          <RefreshCw className="h-4 w-4" /> Refresh Inboxes
        </Button>
      </div>

      {/* Connect Multiple Email Accounts Section */}
      <div className="grid gap-4 md:grid-cols-2">
        {/* Connect Gmail */}
        <Card className="border-border/60 hover:border-primary/40 transition-colors">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base font-semibold flex items-center gap-2">
                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-red-500/10 text-red-600 font-bold text-xs">
                  G
                </span>
                Google Workspace / Gmail
              </CardTitle>
              {gmailCount > 0 && (
                <Badge variant="secondary" className="text-xs">
                  {gmailCount} Connected
                </Badge>
              )}
            </div>
            <CardDescription className="text-xs">
              Connect personal (@gmail.com) or Google Workspace corporate email accounts.
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs text-muted-foreground">
                Syncs emails, drafts AI replies, and tracks Reply Zero follow-ups.
              </p>
              <Button
                size="sm"
                className="gap-2 shrink-0 bg-red-600 hover:bg-red-700 text-white"
                disabled={connectingProvider === "gmail"}
                onClick={() => handleConnect("gmail")}
              >
                {connectingProvider === "gmail" ? (
                  <RefreshCw className="h-4 w-4 animate-spin" />
                ) : (
                  <Plus className="h-4 w-4" />
                )}
                Connect Gmail
              </Button>
            </div>

            {/* Google Cloud Console Redirect URI helper */}
            <div className="mt-3.5 pt-3 border-t border-border/40">
              <div className="flex items-center justify-between text-[11px] mb-1">
                <span className="font-medium text-foreground">Required Redirect URI in Google Cloud:</span>
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(currentRedirectUri);
                    toast.success("Redirect URI copied to clipboard!");
                  }}
                  className="text-primary hover:underline font-mono text-[10px] flex items-center gap-1 cursor-pointer"
                >
                  <Copy className="h-3 w-3" /> Copy URI
                </button>
              </div>
              <code className="block font-mono bg-muted/60 px-2 py-1 rounded text-foreground text-[10px] break-all border border-border/40 select-all">
                {currentRedirectUri}
              </code>
              <p className="text-[10px] text-muted-foreground mt-1">
                Paste this into Google Cloud Console &rarr; Credentials &rarr; OAuth 2.0 Client &rarr; Authorized redirect URIs.
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Connect Outlook */}
        <Card className="border-border/60 hover:border-primary/40 transition-colors">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base font-semibold flex items-center gap-2">
                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-500/10 text-blue-600 font-bold text-xs">
                  M
                </span>
                Microsoft 365 / Outlook
              </CardTitle>
              {outlookCount > 0 && (
                <Badge variant="secondary" className="text-xs">
                  {outlookCount} Connected
                </Badge>
              )}
            </div>
            <CardDescription className="text-xs">
              Connect personal (outlook.com / hotmail) or enterprise Microsoft 365 mailboxes.
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs text-muted-foreground">
                Uses Microsoft Graph delta synchronization for instant message capture.
              </p>
              <Button
                size="sm"
                className="gap-2 shrink-0 bg-blue-600 hover:bg-blue-700 text-white"
                disabled={connectingProvider === "outlook"}
                onClick={() => handleConnect("outlook")}
              >
                {connectingProvider === "outlook" ? (
                  <RefreshCw className="h-4 w-4 animate-spin" />
                ) : (
                  <Plus className="h-4 w-4" />
                )}
                Connect Outlook
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Multi-Account Architecture Notice */}
      <Card className="border-primary/20 bg-primary/5">
        <CardContent className="py-3 px-4 flex items-center gap-3">
          <Layers className="h-5 w-5 text-primary shrink-0" />
          <div className="text-xs leading-normal">
            <span className="font-semibold text-foreground">Unified Multi-Account Engine:</span> All connected email inboxes
            aggregate automatically into your{" "}
            <a href="/email/inbox" className="underline font-medium text-primary hover:text-primary/80 inline-flex items-center gap-1">
              Unified Inbox <ExternalLink className="h-3 w-3" />
            </a>
            . You can connect unlimited mailboxes across team members, support desks, and personal aliases under this organization.
          </div>
        </CardContent>
      </Card>

      {/* Connected Inboxes Table */}
      <Card className="border-border/60">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base font-semibold">
              Connected Email Inboxes ({accounts.length})
            </CardTitle>
            <Badge variant="outline" className="text-xs">
              Tenant Isolated
            </Badge>
          </div>
          <CardDescription>
            Active synchronization pipelines for your organization. Each mailbox syncs on an autonomous 5-minute schedule.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-6 space-y-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : accounts.length === 0 ? (
            <div className="flex flex-col items-center justify-center p-12 text-center text-muted-foreground">
              <Mail className="h-10 w-10 opacity-30 mb-2" />
              <p className="text-sm font-medium text-foreground">No email accounts connected yet</p>
              <p className="text-xs max-w-sm mt-1 mb-4">
                Click &ldquo;Connect Gmail&rdquo; or &ldquo;Connect Outlook&rdquo; above to link your first inbox.
              </p>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" onClick={() => handleConnect("gmail")}>
                  Connect Gmail
                </Button>
                <Button size="sm" variant="outline" onClick={() => handleConnect("outlook")}>
                  Connect Outlook
                </Button>
              </div>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[120px]">Provider</TableHead>
                    <TableHead className="min-w-[220px]">Email Address</TableHead>
                    <TableHead className="w-[120px]">Status</TableHead>
                    <TableHead className="min-w-[160px]">Last Synced</TableHead>
                    <TableHead className="min-w-[140px]">Sync Cursor</TableHead>
                    <TableHead className="w-[160px] text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {accounts.map((acc) => (
                    <TableRow key={`${acc.provider}-${acc.id}`}>
                      <TableCell>
                        <Badge
                          variant={acc.provider === "gmail" ? "outline" : "secondary"}
                          className={`text-xs uppercase font-semibold tracking-wide ${
                            acc.provider === "gmail" ? "text-red-600 border-red-500/30" : "text-blue-600 border-blue-500/30"
                          }`}
                        >
                          {acc.provider}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-medium text-xs text-foreground">
                        <div className="flex items-center gap-1.5">
                          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                          <span>{acc.email_address || acc.email}</span>
                        </div>
                        {acc.error_message && (
                          <div className="text-[11px] text-destructive truncate max-w-xs mt-0.5">
                            {acc.error_message}
                          </div>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={acc.status === "connected" ? "default" : "secondary"}
                          className={`text-[10px] capitalize font-medium ${
                            acc.status === "connected"
                              ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-500/20"
                              : "bg-muted text-muted-foreground"
                          }`}
                        >
                          {acc.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {acc.last_synced_at
                          ? new Date(acc.last_synced_at).toLocaleString()
                          : "Never"}
                      </TableCell>
                      <TableCell className="text-xs font-mono text-muted-foreground">
                        {acc.sync_cursor ? (
                          <span className="truncate max-w-[120px] inline-block">
                            {acc.sync_cursor.substring(0, 16)}...
                          </span>
                        ) : (
                          "Initial"
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          {acc.status === "connected" ? (
                            <>
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 text-xs px-2.5 gap-1.5"
                                disabled={syncingId === acc.id}
                                onClick={() => handleSyncAccount(acc.id, acc.provider)}
                                title="Sync mailbox emails"
                              >
                                <RefreshCw
                                  className={`h-3.5 w-3.5 ${syncingId === acc.id ? "animate-spin" : ""}`}
                                />
                                Sync
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 text-xs px-2.5 gap-1.5 text-amber-600 hover:text-amber-700 hover:bg-amber-500/10 border-amber-500/30"
                                onClick={() => setDisconnectingAccount(acc)}
                                title="Disconnect account and pause sync"
                              >
                                <Unlink className="h-3.5 w-3.5" />
                                Disconnect
                              </Button>
                            </>
                          ) : (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 text-xs px-2.5 gap-1.5 text-primary hover:bg-primary/10"
                              disabled={reconnectingId === acc.id}
                              onClick={() => handleReconnect(acc)}
                              title="Resume synchronization"
                            >
                              <RefreshCw
                                className={`h-3.5 w-3.5 ${reconnectingId === acc.id ? "animate-spin" : ""}`}
                              />
                              Reconnect
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                            onClick={() => setDeletingAccount(acc)}
                            title="Delete account permanently"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Sync Architecture and OAuth Security Info */}
      <div className="grid gap-6 md:grid-cols-2">
        <Card className="border-border/60">
          <CardHeader>
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-emerald-500" />
              OAuth Security & Encryption
            </CardTitle>
            <CardDescription>
              Organization-level isolation and Fernet AES encryption
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-xs leading-relaxed text-muted-foreground">
            <p>
              • <strong>Encrypted at Rest:</strong> All OAuth tokens (refresh and access tokens) are encrypted with Fernet (AES-128-CBC with SHA256 HMAC) before storage. Plaintext credentials are never saved.
            </p>
            <p>
              • <strong>Strict Multi-Tenant Isolation:</strong> Inboxes, messages, AI summaries, attachments, and rules are strictly bound to your organization ID. Cross-tenant leakage is blocked at the database layer.
            </p>
            <p>
              • <strong>Granular Permissions:</strong> Only minimum required OAuth scopes are requested (Gmail <code>modify</code>, Microsoft Graph <code>Mail.ReadWrite</code>).
            </p>
          </CardContent>
        </Card>

        <Card className="border-border/60">
          <CardHeader>
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <Zap className="h-4 w-4 text-amber-500" />
              Background Schedulers & Workers
            </CardTitle>
            <CardDescription>
              Autonomous background tasks executed by Redis ARQ
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-xs leading-relaxed text-muted-foreground">
            <div className="flex items-center justify-between border-b border-border/40 pb-2">
              <span>Multi-Account Batch Sync</span>
              <Badge variant="outline" className="text-[10px]">Every 5 minutes</Badge>
            </div>
            <div className="flex items-center justify-between border-b border-border/40 pb-2">
              <span>Follow-Up SLA Status Checker</span>
              <Badge variant="outline" className="text-[10px]">Hourly</Badge>
            </div>
            <div className="flex items-center justify-between">
              <span>Daily AI Executive Digest</span>
              <Badge variant="outline" className="text-[10px]">Daily (Midnight UTC)</Badge>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Disconnect Account Confirmation Dialog */}
      <AlertDialog open={!!disconnectingAccount} onOpenChange={(open) => !open && setDisconnectingAccount(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Unlink className="h-5 w-5 text-amber-500" />
              Disconnect Email Account?
            </AlertDialogTitle>
            <AlertDialogDescription className="text-xs">
              Are you sure you want to disconnect{" "}
              <strong>{disconnectingAccount?.email || disconnectingAccount?.email_address}</strong>?
              This will stop automatic synchronization and AI auto-processing. Existing emails, categorization,
              and settings will remain safely preserved in your workspace.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDisconnecting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-amber-600 hover:bg-amber-700 text-white"
              disabled={isDisconnecting}
              onClick={handleConfirmDisconnect}
            >
              {isDisconnecting ? "Disconnecting..." : "Disconnect Account"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete Account Confirmation Dialog */}
      <AlertDialog open={!!deletingAccount} onOpenChange={(open) => !open && setDeletingAccount(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              Permanently Delete Email Account?
            </AlertDialogTitle>
            <AlertDialogDescription className="text-xs">
              Are you sure you want to permanently delete{" "}
              <strong>{deletingAccount?.email || deletingAccount?.email_address}</strong>?
              This will permanently remove the account and its synchronized data from your organization.
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive hover:bg-destructive/90 text-white"
              disabled={isDeleting}
              onClick={handleConfirmDelete}
            >
              {isDeleting ? "Deleting..." : "Delete Permanently"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
