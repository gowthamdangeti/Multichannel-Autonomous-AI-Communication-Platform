"use client";

import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Mail,
  Plus,
  RefreshCw,
  Trash2,
  Unlink,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { TablePagination } from "@/components/layout/TablePagination";
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
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PageHeader } from "@/context/HeaderContext";
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

export default function ConnectEmailPage() {
  const { user, loading: authLoading, getAccessToken } = useAuth();
  const processedCodeRef = useRef<string | null>(null);

  const [accounts, setAccounts] = useState<EmailAccount[]>([]);
  const [loading, setLoading] = useState(true);

  // Dropdown View: "email" (Gmail) or "outlook" (Outlook)
  const [selectedView, setSelectedView] = useState<"email" | "outlook">("email");
  const userSelectedViewRef = useRef<boolean>(false);

  // Pagination for accounts table
  const PAGE_SIZE = 10;
  const [page, setPage] = useState(1);

  const [connectingProvider, setConnectingProvider] = useState<string | null>(null);
  const [syncingId, setSyncingId] = useState<number | null>(null);
  const [reconnectingId, setReconnectingId] = useState<number | null>(null);

  const [disconnectingAccount, setDisconnectingAccount] = useState<EmailAccount | null>(null);
  const [isDisconnecting, setIsDisconnecting] = useState(false);

  const [deletingAccount, setDeletingAccount] = useState<EmailAccount | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      const viewParam = params.get("view");
      if (viewParam === "email" || viewParam === "outlook") {
        setSelectedView(viewParam);
        userSelectedViewRef.current = true;
      }
    }
  }, []);

  const handleViewChange = (newView: "email" | "outlook") => {
    userSelectedViewRef.current = true;
    setSelectedView(newView);
    setPage(1);
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.set("view", newView);
      window.history.replaceState({}, "", url.toString());
    }
  };

  const loadAccounts = useCallback(async () => {
    try {
      const data = await getEmailAccounts(getAccessToken);
      const accs = Array.isArray(data) ? data : [];
      setAccounts(accs);

      // Auto-default redirect / view logic if user hasn't explicitly chosen via ?view=
      if (!userSelectedViewRef.current) {
        const hasGmail = accs.some((a) => (a.provider || "gmail").toLowerCase() === "gmail");
        const hasOutlook = accs.some((a) => (a.provider || "").toLowerCase() === "outlook");

        if (hasGmail) {
          // If at least one email connected (or both connected) -> default email
          setSelectedView("email");
        } else if (hasOutlook) {
          // If no emails connect, and at least one outlook connected -> default outlook
          setSelectedView("outlook");
        } else {
          // Neither connected -> default email card
          setSelectedView("email");
        }
      }
    } catch (err: unknown) {
      console.error("Failed to load accounts:", err);
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
    if (processedCodeRef.current === code) return;
    processedCodeRef.current = code;

    const isOutlook = state.includes("outlook") || urlParams.get("scope")?.includes("graph.microsoft.com");
    const providerName = isOutlook ? "Outlook" : "Gmail";

    setSelectedView(isOutlook ? "outlook" : "email");
    window.history.replaceState({}, document.title, window.location.pathname);

    const processOAuthCallback = async () => {
      const toastId = toast.loading(`Connecting ${providerName} account...`);
      try {
        const redirectUri = `${window.location.origin}/connect-email`;
        if (isOutlook) {
          await handleOutlookOAuthCallback(code, getAccessToken, redirectUri);
        } else {
          await handleGmailOAuthCallback(code, getAccessToken, redirectUri);
        }
        toast.success(`Successfully connected your ${providerName} account!`, { id: toastId });
        await loadAccounts();
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : `Failed to connect ${providerName} account`;
        toast.error(msg, { id: toastId });
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

  // Auto-sync accounts every 2 seconds
  useEffect(() => {
    if (authLoading || !user) return;
    const interval = setInterval(() => {
      loadAccounts();
    }, 2000);
    return () => clearInterval(interval);
  }, [authLoading, user, loadAccounts]);

  const handleConnect = async (provider: "gmail" | "outlook") => {
    setConnectingProvider(provider);
    try {
      if (typeof window !== "undefined") {
        sessionStorage.setItem("oauth_return_to", "/connect-email");
      }
      // Use the registered OAuth redirect URI in Google/Microsoft consoles (/email/settings)
      // which immediately processes and returns back to /connect-email
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
      toast.success("Mailbox synchronization started");
      setTimeout(() => loadAccounts(), 2000);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Sync trigger failed";
      toast.error(msg);
    } finally {
      setSyncingId(null);
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

  const handleConfirmDelete = async () => {
    if (!deletingAccount) return;
    setIsDeleting(true);
    try {
      await deleteEmailAccount(deletingAccount.id, getAccessToken, deletingAccount.provider);
      toast.success("Email account deleted");
      setDeletingAccount(null);
      await loadAccounts();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to delete account";
      toast.error(msg);
    } finally {
      setIsDeleting(false);
    }
  };

  // Filter accounts according to selected dropdown view
  const currentProvider = selectedView === "email" ? "gmail" : "outlook";
  const displayedAccounts = useMemo(() => {
    return accounts.filter((acc) => {
      const provider = (acc.provider || "gmail").toLowerCase();
      return provider === currentProvider;
    });
  }, [accounts, currentProvider]);

  const totalPages = Math.ceil(displayedAccounts.length / PAGE_SIZE) || 1;
  const paginatedAccounts = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return displayedAccounts.slice(start, start + PAGE_SIZE);
  }, [displayedAccounts, page]);

  useEffect(() => {
    if (page > totalPages && totalPages > 0) {
      setPage(totalPages);
    }
  }, [page, totalPages]);

  const isEmailView = selectedView === "email";

  // Top Header Right Controls: Connect Email, Connect Outlook, and Dropdown
  const headerActions = useMemo(() => (
    <div className="flex items-center gap-2 flex-wrap">
      {/* 1. Connect Email */}
      <Button
        size="sm"
        onClick={() => handleConnect("gmail")}
        disabled={connectingProvider !== null}
        className="h-8 text-xs gap-1.5 font-medium bg-black dark:bg-white text-white dark:text-black hover:bg-black/90 shadow-sm"
      >
        {connectingProvider === "gmail" ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Plus className="h-3.5 w-3.5" />
        )}
        Connect Email
      </Button>

      {/* 2. Connect Outlook */}
      <Button
        size="sm"
        variant="outline"
        onClick={() => handleConnect("outlook")}
        disabled={connectingProvider !== null}
        className="h-8 text-xs gap-1.5 font-medium border-border hover:bg-muted/60"
      >
        {connectingProvider === "outlook" ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Plus className="h-3.5 w-3.5" />
        )}
        Connect Outlook
      </Button>

      {/* 3. Dropdown (Email / Outlook) */}
      <Select value={selectedView} onValueChange={(val: "email" | "outlook") => handleViewChange(val)}>
        <SelectTrigger className="h-8 text-xs w-[120px] bg-background border-border font-medium">
          <SelectValue placeholder="Provider" />
        </SelectTrigger>
        <SelectContent align="end">
          <SelectItem value="email" className="text-xs">
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-red-500" />
              <span>Email</span>
            </div>
          </SelectItem>
          <SelectItem value="outlook" className="text-xs">
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-blue-500" />
              <span>Outlook</span>
            </div>
          </SelectItem>
        </SelectContent>
      </Select>
    </div>
  ), [connectingProvider, selectedView]);

  return (
    <>
      {/* Places the 3 controls in the top header */}
      <PageHeader title="Connect Email" actions={headerActions} />

      <div className="w-full px-4 lg:px-6 py-6">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : displayedAccounts.length === 0 ? (
          /* The Clean Card from Image with both Connect Email & Connect Outlook buttons */
          <Card className="w-full border border-dashed border-border/80 rounded-2xl py-20 px-8 text-center bg-card shadow-sm">
            <CardContent className="space-y-6 max-w-xl mx-auto p-0">
              {/* Rounded Red Mail Icon Circle */}
              <div className="h-16 w-16 rounded-full bg-red-500/10 border border-red-500/20 text-red-500 flex items-center justify-center mx-auto">
                <Mail className="h-8 w-8" />
              </div>

              {/* Title & Description */}
              <div className="space-y-2">
                <h2 className="font-semibold text-lg sm:text-xl text-foreground tracking-tight">
                  {isEmailView ? "No Gmail accounts connected yet" : "No Outlook accounts connected yet"}
                </h2>
                <p className="text-xs sm:text-sm text-muted-foreground leading-relaxed">
                  {isEmailView
                    ? "Click 'Connect Email' in the top header to connect your first Google Workspace or Gmail inbox."
                    : "Click 'Connect Outlook' in the top header to connect your first Microsoft 365 or Outlook inbox."}
                </p>
              </div>

              {/* Action Buttons: Connect Email + Connect Outlook */}
              <div className="pt-3 flex flex-wrap items-center justify-center gap-3">
                <Button
                  onClick={() => handleConnect("gmail")}
                  disabled={connectingProvider !== null}
                  className="h-9 px-5 text-xs font-medium gap-2 bg-black dark:bg-white text-white dark:text-black hover:bg-black/90 shadow-sm"
                >
                  {connectingProvider === "gmail" ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Plus className="h-4 w-4" />
                  )}
                  Connect Email
                </Button>

                <Button
                  variant="outline"
                  onClick={() => handleConnect("outlook")}
                  disabled={connectingProvider !== null}
                  className="h-9 px-5 text-xs font-medium gap-2 border-border hover:bg-muted/60"
                >
                  {connectingProvider === "outlook" ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Plus className="h-4 w-4" />
                  )}
                  Connect Outlook
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : (
          /* Connected Accounts Table with Pagination */
          <Card className="w-full border border-border/80 rounded-2xl overflow-hidden bg-card shadow-sm">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/30">
                    <TableHead className="w-[120px]">Provider</TableHead>
                    <TableHead className="min-w-[220px]">Email Address</TableHead>
                    <TableHead className="w-[120px]">Status</TableHead>
                    <TableHead className="min-w-[160px]">Last Synced</TableHead>
                    <TableHead className="min-w-[130px]">Sync Cursor</TableHead>
                    <TableHead className="w-[180px] text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paginatedAccounts.map((acc) => {
                    const emailAddr = acc.email || acc.email_address || "Unknown email";
                    const isSyncing = syncingId === acc.id || acc.status === "syncing";
                    const isReconnecting = reconnectingId === acc.id;
                    const isGmail = (acc.provider || "gmail").toLowerCase() === "gmail";

                    return (
                      <TableRow key={`${acc.provider}-${acc.id}`} className="hover:bg-muted/40 transition-colors">
                        <TableCell>
                          <Badge
                            variant={isGmail ? "outline" : "secondary"}
                            className={`text-[11px] uppercase font-semibold tracking-wide ${
                              isGmail
                                ? "text-red-600 dark:text-red-400 border-red-500/30 bg-red-500/10"
                                : "text-blue-600 dark:text-blue-400 border-blue-500/30 bg-blue-500/10"
                            }`}
                          >
                            {isGmail ? "Gmail" : "Outlook"}
                          </Badge>
                        </TableCell>

                        <TableCell className="font-medium text-xs text-foreground">
                          <div className="flex items-center gap-1.5">
                            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                            <span className="truncate max-w-[240px]" title={emailAddr}>
                              {emailAddr}
                            </span>
                          </div>
                          {acc.error_message && (
                            <div className="text-[11px] text-destructive truncate max-w-xs mt-0.5" title={acc.error_message}>
                              {acc.error_message}
                            </div>
                          )}
                        </TableCell>

                        <TableCell>
                          {acc.status === "connected" && (
                            <Badge
                              variant="outline"
                              className="text-[10px] bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20 gap-1"
                            >
                              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                              Connected
                            </Badge>
                          )}
                          {acc.status === "syncing" && (
                            <Badge
                              variant="outline"
                              className="text-[10px] bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20 gap-1"
                            >
                              <Loader2 className="h-2.5 w-2.5 animate-spin" />
                              Syncing
                            </Badge>
                          )}
                          {acc.status === "error" && (
                            <Badge
                              variant="outline"
                              className="text-[10px] bg-destructive/10 text-destructive border-destructive/20 gap-1"
                            >
                              <AlertTriangle className="h-2.5 w-2.5" />
                              Error
                            </Badge>
                          )}
                          {acc.status !== "connected" && acc.status !== "syncing" && acc.status !== "error" && (
                            <Badge variant="outline" className="text-[10px] bg-muted text-muted-foreground border-border gap-1">
                              {acc.status || "Disconnected"}
                            </Badge>
                          )}
                        </TableCell>

                        <TableCell className="text-xs text-muted-foreground">
                          {acc.last_synced_at
                            ? new Date(acc.last_synced_at).toLocaleString([], {
                                dateStyle: "short",
                                timeStyle: "short",
                              })
                            : "Never"}
                        </TableCell>

                        <TableCell className="text-xs font-mono text-muted-foreground">
                          {acc.sync_cursor ? (
                            <span className="truncate max-w-[120px] inline-block" title={acc.sync_cursor}>
                              {acc.sync_cursor.substring(0, 14)}...
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
                                  disabled={isSyncing}
                                  onClick={() => handleSyncAccount(acc.id, acc.provider)}
                                  title="Sync mailbox emails"
                                >
                                  <RefreshCw className={`h-3 w-3 ${isSyncing ? "animate-spin" : ""}`} />
                                  Sync
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-7 text-xs px-2 gap-1 text-amber-600 hover:text-amber-700 hover:bg-amber-500/10 border-amber-500/30"
                                  onClick={() => setDisconnectingAccount(acc)}
                                  title="Disconnect mailbox"
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
                                disabled={isReconnecting}
                                onClick={() => handleReconnect(acc)}
                                title="Reconnect mailbox"
                              >
                                <RefreshCw className={`h-3 w-3 ${isReconnecting ? "animate-spin" : ""}`} />
                                Reconnect
                              </Button>
                            )}
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                              onClick={() => setDeletingAccount(acc)}
                              title="Delete mailbox permanently"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>

            <TablePagination
              page={page}
              totalPages={totalPages}
              totalCount={displayedAccounts.length}
              setPage={setPage}
              itemLabel="mailboxes"
            />
          </Card>
        )}

        {/* Disconnect Confirmation Dialog */}
        <AlertDialog open={!!disconnectingAccount} onOpenChange={(open) => !open && setDisconnectingAccount(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle className="text-base">Disconnect Mailbox?</AlertDialogTitle>
              <AlertDialogDescription className="text-xs">
                Are you sure you want to disconnect{" "}
                <strong className="text-foreground">
                  {disconnectingAccount?.email || disconnectingAccount?.email_address}
                </strong>
                ? Incoming emails will pause syncing until reconnected.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={isDisconnecting} className="text-xs">
                Cancel
              </AlertDialogCancel>
              <AlertDialogAction
                disabled={isDisconnecting}
                onClick={handleConfirmDisconnect}
                className="text-xs bg-amber-600 hover:bg-amber-700 text-white"
              >
                {isDisconnecting ? "Disconnecting..." : "Disconnect"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Delete Confirmation Dialog */}
        <AlertDialog open={!!deletingAccount} onOpenChange={(open) => !open && setDeletingAccount(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle className="text-base text-destructive flex items-center gap-2">
                <AlertTriangle className="h-4 w-4" />
                Remove Email Account?
              </AlertDialogTitle>
              <AlertDialogDescription className="text-xs">
                This will permanently delete{" "}
                <strong className="text-foreground">
                  {deletingAccount?.email || deletingAccount?.email_address}
                </strong>{" "}
                from your organization.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={isDeleting} className="text-xs">
                Cancel
              </AlertDialogCancel>
              <AlertDialogAction
                disabled={isDeleting}
                onClick={handleConfirmDelete}
                className="text-xs bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                {isDeleting ? "Deleting..." : "Delete Account"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </>
  );
}
