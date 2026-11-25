"use client";

import {
  AlertCircle,
  ArrowUpRight,
  CheckCircle2,
  Clock,
  CreditCard,
  IndianRupee,
  Loader2,
  Search,
  ShieldCheck,
  TrendingUp,
  WalletIcon,
  XIcon,
  Zap,
} from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Pagination, PaginationContent, PaginationEllipsis, PaginationItem, PaginationLink, PaginationNext, PaginationPrevious } from "@/components/ui/pagination";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeader } from "@/context/HeaderContext";
import { getBackendApiUrl } from "@/lib/apiClient";
import { useAuth } from "@/lib/auth";

interface RazorpayHandlerResponse {
  razorpay_payment_id: string;
  razorpay_order_id?: string;
  razorpay_signature?: string;
  razorpay_subscription_id?: string;
}

interface Plan {
  id: number;
  name: string;
  description: string | null;
  currency: string;
  price_per_month: number;
  included_minutes: number;
  included_messages: number;
  price_per_extra_minute: number;
  price_per_extra_message: number;
}
interface Wallet {
  organization_id: number;
  balance: number;
  currency: string;
  gateway: string;
  exhaustion_policy: string;
  billing_plan_id: number | null;
  plan_expires_at: string | null;
}
interface Transaction {
  id: number;
  amount: number;
  currency: string;
  tx_type: string;
  description: string | null;
  balance_after: number;
  workflow_run_id?: number | null;
  created_at: string;
}

const fmt = (n: number, cur: string) =>
  new Intl.NumberFormat("en", { style: "currency", currency: cur, maximumFractionDigits: 2 }).format(n);


const TX: Record<string, { label: string; cls: string }> = {
  subscription_credit: { label: "Subscription", cls: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20" },
  topup:               { label: "Top-up",        cls: "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20" },
  usage_debit:         { label: "Usage",          cls: "bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20" },
  refund:              { label: "Refund",         cls: "bg-muted text-muted-foreground border-border" },
};

export default function BillingPage() {
  const { user, loading: authLoading, getAccessToken } = useAuth();
  const searchParams = useSearchParams();
  const hasFetched = useRef(false);
  const confirmed = useRef(false);

  const [plans, setPlans] = useState<Plan[]>([]);
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [txs, setTxs] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [topupOpen, setTopupOpen] = useState(false);
  const [subOpen, setSubOpen] = useState(false);
  const [mins, setMins] = useState(100);
  const [working, setWorking] = useState(false);
  const [activePlan, setActivePlan] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [page, setPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);

  const ITEMS_PER_PAGE = 10;
  const totalPages = Math.max(1, Math.ceil(totalCount / ITEMS_PER_PAGE));

  const buildHdrs = async () => {
    const token = await getAccessToken();
    return {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "ngrok-skip-browser-warning": "true",
    };
  };

  const fetchAll = async () => {
    setLoading(true);
    try {
      const h = await buildHdrs();
      const baseUrl = getBackendApiUrl();
      const [pr, wr, tr, tc] = await Promise.all([
        fetch(`${baseUrl}/api/v1/billing/plans`, { headers: h }),
        fetch(`${baseUrl}/api/v1/billing/wallet`, { headers: h }),
        fetch(`${baseUrl}/api/v1/billing/transactions?limit=${ITEMS_PER_PAGE}&offset=${(page - 1) * ITEMS_PER_PAGE}`, { headers: h }),
        fetch(`${baseUrl}/api/v1/billing/transactions/count`, { headers: h }),
      ]);
      if (pr.ok) setPlans(await pr.json());
      if (wr.ok) setWallet(await wr.json());
      if (tr.ok) setTxs(await tr.json());
      if (tc.ok) {
        const body = await tc.json();
        setTotalCount(body.count ?? 0);
      }
    } catch (e) {
      console.error("Failed to fetch billing details:", e);
    } finally {
      setLoading(false);
    }
  };

  const confirmStripeSession = async () => {
    if (confirmed.current) return;
    const sessionId = searchParams.get("session_id");
    if (!sessionId) return;
    confirmed.current = true;
    try {
      const h = await buildHdrs();
      const baseUrl = getBackendApiUrl();
      const res = await fetch(`${baseUrl}/api/v1/billing/confirm/stripe`, {
        method: "POST",
        headers: h,
        body: JSON.stringify({ session_id: sessionId }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.detail ?? "Failed to confirm Stripe session");
      } else {
        toast.success("Payment confirmed successfully!");
      }
    } catch (e) {
      console.error("Stripe confirm error", e);
      toast.error("Failed to confirm payment");
    }
  };

  useEffect(() => {
    if (authLoading || !user || hasFetched.current) return;
    hasFetched.current = true;
    const isReturn = searchParams.get("topup") === "ok" || searchParams.get("sub") === "ok";
    const hasSession = !!searchParams.get("session_id");
    if (isReturn || hasSession) {
      confirmStripeSession().finally(fetchAll);
    } else {
      fetchAll();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, user]);

  // Refetch transactions on page change
  useEffect(() => {
    if (!user || authLoading) return;
    fetchAll();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  // Keep Razorpay modal backdrop transparent & translucent over our page (avoids solid white background)
  useEffect(() => {
    const fixRazorpayBackdrop = () => {
      const iframes = document.querySelectorAll<HTMLIFrameElement>('iframe[src*="razorpay"], iframe.razorpay-checkout-frame');
      iframes.forEach((frame) => {
        frame.style.setProperty("background-color", "transparent", "important");
        frame.style.setProperty("background", "transparent", "important");
        frame.style.setProperty("color-scheme", "light", "important");
        frame.setAttribute("allowtransparency", "true");
      });
      const containers = document.querySelectorAll<HTMLElement>('.razorpay-container, [class*="razorpay"]');
      containers.forEach((el) => {
        el.style.setProperty("color-scheme", "light", "important");
      });
    };

    fixRazorpayBackdrop();
    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.addedNodes.length > 0) {
          fixRazorpayBackdrop();
        }
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  const currency = wallet?.currency ?? "USD";
  const gateway = wallet?.gateway ?? "stripe";
  const isRzp = gateway === "razorpay";
  const cur = plans.find((p) => p.id === wallet?.billing_plan_id) ?? null;
  const rate = cur?.price_per_extra_minute ?? 0.05;
  const topupTotal = mins * rate;
  const topupMinor = Math.round(topupTotal * 100);
  const usedMins = cur ? Math.max(0, cur.included_minutes - (wallet?.balance ?? 0) / rate) : 0;
  const usagePct = cur ? Math.min(100, (usedMins / cur.included_minutes) * 100) : 0;
  // Pay-as-you-go totals for 0/250 style display
  const totalPurchasedMins = !cur ? Math.floor(txs.filter(t => t.tx_type === "topup" || t.tx_type === "subscription_credit").reduce((s, t) => s + t.amount, 0) / (rate || 0.05)) : 0;
  const availableMins = !cur ? Math.floor((wallet?.balance ?? 0) / (rate || 0.05)) : 0;
  const payGoUsed = !cur ? Math.max(0, totalPurchasedMins - availableMins) : 0;
  const payGoPct = !cur && totalPurchasedMins > 0 ? Math.min(100, (payGoUsed / totalPurchasedMins) * 100) : 0;

  const doTopup = async () => {
    setWorking(true);
    const h = await buildHdrs();
    const baseUrl = getBackendApiUrl();
    try {
      if (isRzp) {
        const res = await fetch(`${baseUrl}/api/v1/billing/topup/razorpay`, { method: "POST", headers: h, body: JSON.stringify({ amount_paise: topupMinor, minutes: mins }) });
        const d = await res.json();
        if (!res.ok) throw new Error(d.detail ?? "Failed");
        setTopupOpen(false);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        new (window as any).Razorpay({
          key: d.key_id,
          order_id: d.order_id,
          amount: d.amount,
          currency: "INR",
          name: "Convozent",
          description: `${mins} minutes`,
          modal: {
            backdropclose: true,
            escape: true,
            ondismiss: () => {
              setWorking(false);
            },
          },
          handler: async (response: RazorpayHandlerResponse) => {
            try {
              const confirmRes = await fetch(`${baseUrl}/api/v1/billing/confirm/razorpay`, {
                method: "POST",
                headers: h,
                body: JSON.stringify({
                  razorpay_order_id: response.razorpay_order_id,
                  razorpay_payment_id: response.razorpay_payment_id,
                  razorpay_signature: response.razorpay_signature,
                }),
              });
              const confirmData = await confirmRes.json();
              if (!confirmRes.ok) {
                toast.error(confirmData.detail ?? "Payment confirmation failed");
              } else {
                toast.success(`${mins} minutes added to your wallet!`);
              }
            } catch (err) {
              console.error("Razorpay confirm error", err);
              toast.error("Failed to confirm payment");
            } finally {
              setTopupOpen(false);
              hasFetched.current = false;
              fetchAll();
            }
          },
        }).open();
      } else {
        const res = await fetch(`${baseUrl}/api/v1/billing/topup/stripe`, { method: "POST", headers: h, body: JSON.stringify({ amount_cents: topupMinor, currency, minutes: mins, success_url: `${location.origin}/billing?topup=ok&session_id={CHECKOUT_SESSION_ID}`, cancel_url: `${location.origin}/billing` }) });
        const d = await res.json();
        if (!res.ok) throw new Error(d.detail ?? "Failed");
        location.href = d.url;
      }
    } catch (e: unknown) { toast.error(e instanceof Error ? e.message : "Failed"); }
    finally { setWorking(false); }
  };

  const doSubscribe = async (plan: Plan) => {
    setActivePlan(plan.id); setWorking(true);
    const h = await buildHdrs();
    const baseUrl = getBackendApiUrl();
    try {
      if (isRzp) {
        const res = await fetch(`${baseUrl}/api/v1/billing/subscribe/razorpay`, { method: "POST", headers: h, body: JSON.stringify({ plan_id: plan.id }) });
        const d = await res.json();
        if (!res.ok) throw new Error(d.detail ?? "Failed");
        setSubOpen(false);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        new (window as any).Razorpay({
          key: d.key_id,
          subscription_id: d.subscription_id,
          name: "Convozent",
          description: `${plan.name} plan`,
          modal: {
            backdropclose: true,
            escape: true,
            ondismiss: () => {
              setWorking(false);
              setActivePlan(null);
            },
          },
          handler: async (response: RazorpayHandlerResponse) => {
            try {
              const confirmRes = await fetch(`${baseUrl}/api/v1/billing/confirm/razorpay`, {
                method: "POST",
                headers: h,
                body: JSON.stringify({
                  razorpay_subscription_id: response.razorpay_subscription_id,
                  razorpay_payment_id: response.razorpay_payment_id,
                  razorpay_signature: response.razorpay_signature,
                }),
              });
              const confirmData = await confirmRes.json();
              if (!confirmRes.ok) {
                toast.error(confirmData.detail ?? "Subscription confirmation failed");
              } else {
                toast.success(`Subscribed to ${plan.name}!`);
              }
            } catch (err) {
              console.error("Razorpay sub confirm error", err);
              toast.error("Failed to confirm subscription");
            } finally {
              setSubOpen(false);
              hasFetched.current = false;
              fetchAll();
            }
          },
        }).open();
      } else {
        const res = await fetch(`${baseUrl}/api/v1/billing/subscribe/stripe`, { method: "POST", headers: h, body: JSON.stringify({ plan_id: plan.id, success_url: `${location.origin}/billing?sub=ok&session_id={CHECKOUT_SESSION_ID}`, cancel_url: `${location.origin}/billing` }) });
        const d = await res.json();
        if (!res.ok) throw new Error(d.detail ?? "Failed");
        location.href = d.url;
      }
    } catch (e: unknown) { toast.error(e instanceof Error ? e.message : "Failed"); }
    finally { setWorking(false); setActivePlan(null); }
  };


  if (loading) return <div className="p-12 flex justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;

  return (
    <>
      {isRzp && <script src="https://checkout.razorpay.com/v1/checkout.js" async />}
      <style>{`
        .razorpay-container {
          color-scheme: light !important;
          background-color: rgba(0, 0, 0, 0.7) !important;
          background: rgba(0, 0, 0, 0.7) !important;
          backdrop-filter: blur(4px) !important;
          -webkit-backdrop-filter: blur(4px) !important;
          position: fixed !important;
          inset: 0 !important;
          z-index: 2147483647 !important;
        }
        .razorpay-container *,
        .razorpay-checkout-frame,
        iframe[src*="razorpay"],
        iframe.razorpay-checkout-frame,
        [class*="razorpay"] {
          color-scheme: light !important;
          background-color: transparent !important;
          background: transparent !important;
        }
      `}</style>
      <div className="px-4 lg:px-6 pt-1 pb-6 space-y-4">
        <PageHeader
          title="Billing & Subscription"
          subtitle="Manage your billing plan, wallet credits, and view transaction history."
                onRefresh={() => { hasFetched.current = false; void fetchAll(); }}
                isRefreshing={loading}
                primaryAction={<Button variant="outline" onClick={() => setSubOpen(true)}>
                    <Zap className="h-3.5 w-3.5 mr-1.5 text-amber-500 fill-amber-500" />
                    Change Plan
                  </Button>}
            />

        {/* Overview Stat Cards Grid */}
        <div className="grid gap-4 sm:grid-cols-3">
          {/* Wallet Balance Card */}
          <Card className="relative overflow-hidden border-border/80 shadow-sm hover:shadow transition-shadow flex flex-col justify-between">
            <div className="space-y-3">
              <CardHeader className="p-4 pb-0 flex flex-row items-center justify-between space-y-0">
                <div className="space-y-1">
                  <CardDescription className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Wallet Balance
                  </CardDescription>
                  <CardTitle className="text-3xl font-extrabold tracking-tight">
                    {fmt(wallet?.balance ?? 0, currency)}
                  </CardTitle>
                </div>
                <div className="h-10 w-10 rounded-md bg-primary/10 flex items-center justify-center text-primary shrink-0">
                  <WalletIcon className="h-5 w-5" />
                </div>
              </CardHeader>
              <CardContent className="p-4 pt-0">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <ShieldCheck className="h-3.5 w-3.5 text-emerald-500" />
                    {isRzp ? "Razorpay Gateway (INR)" : "Stripe Gateway (USD)"}
                  </span>
                </div>
              </CardContent>
            </div>
            <CardContent className="p-4 pt-0">
              <Button size="sm" className="w-full gap-1.5 font-medium shadow-xs" onClick={() => setTopupOpen(true)}>
                {isRzp ? <IndianRupee className="h-3.5 w-3.5" /> : <CreditCard className="h-3.5 w-3.5" />}
                Add Credits / Buy Minutes
              </Button>
            </CardContent>
          </Card>

          {/* Current Subscription Plan Card */}
          <Card className="relative overflow-hidden border-border/80 shadow-sm hover:shadow transition-shadow flex flex-col justify-between">
            <div className="space-y-3">
              <CardHeader className="p-4 pb-0 flex flex-row items-center justify-between space-y-0">
                <div className="space-y-1">
                  <CardDescription className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Current Plan
                  </CardDescription>
                  <CardTitle className="text-2xl font-bold truncate">
                    {cur?.name ?? ((wallet?.balance ?? 0) > 0 ? "Pay-as-you-go" : "Free Tier")}
                  </CardTitle>
                </div>
                <div className="h-10 w-10 rounded-md bg-amber-500/10 flex items-center justify-center text-amber-500 shrink-0">
                  <Zap className="h-5 w-5 fill-amber-500" />
                </div>
              </CardHeader>
              <CardContent className="p-4 pt-0 space-y-2">
                {cur ? (
                  <>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">
                        {fmt(cur.price_per_month, currency)}/mo · {cur.included_minutes} min included
                      </span>
                      <Badge variant="outline" className="text-[10px] bg-emerald-500/10 text-emerald-600 border-emerald-500/20">
                        Active
                      </Badge>
                    </div>
                    {wallet?.plan_expires_at && (
                      <p className="text-[11px] text-muted-foreground">
                        Renews on <span className="font-medium text-foreground">{new Date(wallet.plan_expires_at).toLocaleDateString()}</span>
                      </p>
                    )}
                  </>
                ) : (wallet?.balance ?? 0) > 0 ? (
                  <>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">
                        {Math.floor((wallet?.balance ?? 0) / rate)} min available · {fmt(rate, currency)}/min
                      </span>
                      <Badge variant="outline" className="text-[10px] bg-blue-500/10 text-blue-600 border-blue-500/20">
                        Credits
                      </Badge>
                    </div>
                    <p className="text-[11px] text-muted-foreground">Pay-as-you-go — add a plan for included minutes & lower rates.</p>
                  </>
                ) : (
                  <p className="text-xs text-muted-foreground">Subscribe to a plan to unlock full agent capacity and lower minute rates.</p>
                )}
              </CardContent>
            </div>
            <CardContent className="p-4 pt-0 flex gap-2">
              {cur ? (
                <>
                  <Button size="sm" variant="outline" className="flex-1" onClick={() => setSubOpen(true)}>
                    Upgrade / Switch
                  </Button>
                  <Button size="sm" variant="ghost" className="text-xs text-muted-foreground hover:text-destructive" onClick={async () => {
                    if (!confirm(`Cancel ${cur.name} plan? Balance retained, plan will be removed.`)) return;
                    const h = await buildHdrs();
                    const res = await fetch("/api/v1/billing/subscription", { method: "DELETE", headers: h });
                    if (res.ok) { toast.success("Subscription cancelled"); hasFetched.current = false; fetchAll(); }
                    else { const d = await res.json().catch(()=>({detail:"Failed"})); toast.error((d as {detail?:string}).detail ?? "Cancel failed"); }
                  }}>
                    Cancel
                  </Button>
                </>
              ) : (
                <Button size="sm" className="w-full gap-1.5" onClick={() => setSubOpen(true)}>
                  <Zap className="h-3.5 w-3.5 fill-current" />
                  Subscribe to Plan
                </Button>
              )}
            </CardContent>
          </Card>

          {/* Usage Stats Card */}
          <Card className="relative overflow-hidden border-border/80 shadow-sm hover:shadow transition-shadow flex flex-col justify-between">
            <div className="space-y-3">
              <CardHeader className="p-4 pb-0 flex flex-row items-center justify-between space-y-0">
                <div className="space-y-1">
                  <CardDescription className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Monthly Usage
                  </CardDescription>
                  <CardTitle className="text-2xl font-bold">
                    {cur ? `${Math.round(usedMins)} / ${cur.included_minutes} min` : (wallet?.balance ?? 0) > 0 ? `${payGoUsed} / ${totalPurchasedMins} min` : "—"}
                  </CardTitle>
                </div>
                <div className="h-10 w-10 rounded-md bg-blue-500/10 flex items-center justify-center text-blue-500 shrink-0">
                  <TrendingUp className="h-5 w-5" />
                </div>
              </CardHeader>
              <CardContent className="p-4 pt-0">
                {cur ? <Progress value={usagePct} className="h-2 rounded-full" /> : (wallet?.balance ?? 0) > 0 ? <Progress value={payGoPct} className="h-2 rounded-full" /> : null}
              </CardContent>
            </div>
            <CardContent className="p-4 pt-0">
              {cur ? (
                <div className="flex items-center justify-between text-xs text-muted-foreground min-h-[36px]">
                  <span>{Math.round(usagePct)}% quota used</span>
                  <Badge variant="secondary" className="text-[10px]">
                    {wallet?.exhaustion_policy === "pause" ? "Auto-pause" : "Auto-overage"}
                  </Badge>
                </div>
              ) : (wallet?.balance ?? 0) > 0 ? (
                <div className="flex items-center justify-between text-xs text-muted-foreground min-h-[36px]">
                  <span>{Math.round(payGoPct)}% used · {availableMins} min left · {fmt(rate, currency)}/min</span>
                  <Badge variant="secondary" className="text-[10px]">
                    {wallet?.exhaustion_policy === "pause" ? "Auto-pause" : "Auto-overage"}
                  </Badge>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground min-h-[36px] flex items-center">Subscribe to a plan to track usage metrics and minute quotas.</p>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Transactions Table Card */}
        {(() => {
          const filteredTxs = txs.filter((tx) => {
            if (!searchQuery.trim()) return true;
            const q = searchQuery.toLowerCase().trim();
            const match = tx.description?.match(/Usage:\s*run\s*(\d+)/i);
            const runId = tx.workflow_run_id ?? (match ? parseInt(match[1], 10) : null);
            const runIdStr = runId ? `#${runId}` : "";
            return (
              (runId ? runId.toString().includes(q) || runIdStr.toLowerCase().includes(q) : false) ||
              (tx.description ?? "").toLowerCase().includes(q) ||
              (tx.tx_type ?? "").toLowerCase().includes(q) ||
              tx.amount.toString().includes(q)
            );
          });

          return (
            <Card className="border-border/80 shadow-sm">
              <CardHeader className="p-4 pb-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-border/40">
                <div>
                  <CardTitle className="text-base font-semibold">Transaction History</CardTitle>
                  <CardDescription>Recent credits, top-ups, and usage deductions for your organization.</CardDescription>
                </div>
                <div className="relative w-44 sm:w-64">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search transactions..."
                    value={searchQuery}
                    onChange={(e) => { setSearchQuery(e.target.value); setPage(1); }}
                    className="pl-10 h-9 w-full"
                  />
                </div>
              </CardHeader>
              <CardContent className="p-0 overflow-hidden">
                {txs.length === 0 ? (
                  <div className="text-center py-12">
                    <Clock className="w-10 h-10 text-muted-foreground/60 mx-auto mb-3" />
                    <p className="text-sm font-medium text-muted-foreground">No transactions recorded yet.</p>
                    <p className="text-xs text-muted-foreground/70 mt-1">Top-ups and usage debits will appear here.</p>
                  </div>
                ) : filteredTxs.length === 0 ? (
                  <div className="text-center py-12">
                    <Search className="w-10 h-10 text-muted-foreground/60 mx-auto mb-3" />
                    <p className="text-sm font-medium text-muted-foreground">No matching transactions found.</p>
                    <p className="text-xs text-muted-foreground/70 mt-1">Try adjusting your search query &quot;{searchQuery}&quot;.</p>
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow className="hover:bg-transparent">
                        <TableHead className="font-bold pl-6 text-muted-foreground">Type</TableHead>
                        <TableHead className="font-bold text-muted-foreground">Run ID</TableHead>
                        <TableHead className="font-bold text-muted-foreground">Description</TableHead>
                        <TableHead className="text-right font-bold text-muted-foreground">Amount</TableHead>
                        <TableHead className="text-right font-bold text-muted-foreground">Balance After</TableHead>
                        <TableHead className="text-right font-bold text-muted-foreground pr-6">Date</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredTxs.map((tx) => {
                        const b = TX[tx.tx_type] ?? { label: tx.tx_type, cls: "bg-muted text-muted-foreground border-border" };
                        const isD = tx.tx_type === "usage_debit";
                        const match = tx.description?.match(/Usage:\s*run\s*(\d+)/i);
                        const runId = tx.workflow_run_id ?? (match ? parseInt(match[1], 10) : null);
                        return (
                          <TableRow key={tx.id} className="hover:bg-accent/40 transition-colors">
                            <TableCell className="pl-6">
                              <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${b.cls}`}>
                                {b.label}
                              </span>
                            </TableCell>
                            <TableCell className="whitespace-nowrap">
                              {runId ? (
                                <span className="inline-flex items-center font-mono text-xs font-semibold text-foreground bg-muted px-2 py-0.5 rounded border border-border/50">
                                  #{runId}
                                </span>
                              ) : (
                                <span className="text-muted-foreground/50 text-xs">—</span>
                              )}
                            </TableCell>
                            <TableCell className="text-sm text-muted-foreground max-w-[280px] truncate">
                              {tx.description ?? "—"}
                            </TableCell>
                            <TableCell className={`text-right text-sm font-medium ${isD ? "text-rose-500" : "text-emerald-500"}`}>
                              {isD ? "−" : "+"}{fmt(tx.amount, tx.currency)}
                            </TableCell>
                            <TableCell className="text-right text-sm font-medium">
                              {fmt(tx.balance_after, tx.currency)}
                            </TableCell>
                            <TableCell className="text-right pr-6 text-sm font-medium whitespace-nowrap">
                              {new Date(tx.created_at).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" })}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
              {totalPages > 1 && (
                <div className="flex items-center justify-between p-4 px-6 border-t border-border bg-muted/10">
                  <p className="text-sm text-muted-foreground">
                    Page {Math.min(page, totalPages)} of {totalPages} ({totalCount} total items)
                  </p>
                  <Pagination className="mx-0 w-auto justify-end">
                    <PaginationContent>
                      <PaginationItem>
                        <PaginationPrevious
                          onClick={() => setPage(page - 1)}
                          className={page <= 1 ? 'pointer-events-none opacity-50' : 'cursor-pointer'}
                        />
                      </PaginationItem>
                      {(() => {
                        const pages: (number | 'ellipsis')[] = [];
                        if (totalPages <= 7) {
                          for (let i = 1; i <= totalPages; i++) pages.push(i);
                        } else {
                          pages.push(1);
                          if (page > 3) pages.push('ellipsis');
                          for (let i = Math.max(2, page - 1); i <= Math.min(totalPages - 1, page + 1); i++) {
                            pages.push(i);
                          }
                          if (page < totalPages - 2) pages.push('ellipsis');
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
                                isActive={p === page}
                                onClick={() => setPage(p)}
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
                          onClick={() => setPage(page + 1)}
                          className={page >= totalPages ? 'pointer-events-none opacity-50' : 'cursor-pointer'}
                        />
                      </PaginationItem>
                    </PaginationContent>
                  </Pagination>
                </div>
              )}
            </Card>
          );
        })()}
      </div>

      {/* Top-up Minutes Dialog */}
      <Dialog open={topupOpen} onOpenChange={setTopupOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-lg">
              <CreditCard className="h-5 w-5 text-primary" />
              Add Wallet Credits / Minutes
            </DialogTitle>
            <DialogDescription>
              Select the number of minutes to add to your organization&apos;s wallet balance.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-3">
            <div className="space-y-2">
              <div className="flex justify-between items-center text-xs font-medium">
                <Label>Minutes to add</Label>
                <span className="text-muted-foreground">{fmt(rate, currency)} / minute</span>
              </div>
              <Input
                type="number"
                min={10}
                step={10}
                value={mins}
                onChange={(e) => setMins(Number(e.target.value))}
                className="text-base font-semibold"
              />
            </div>

            {/* Quick minute selection pills */}
            <div className="flex gap-2">
              {[50, 100, 250, 500].map((quick) => (
                <Button
                  key={quick}
                  type="button"
                  variant={mins === quick ? "default" : "outline"}
                  size="sm"
                  className="flex-1 text-xs"
                  onClick={() => setMins(quick)}
                >
                  +{quick} min
                </Button>
              ))}
            </div>

            {/* Price breakdown card */}
            <div className="rounded-xl border border-border/80 p-4 bg-muted/30 space-y-2">
              <div className="flex justify-between items-center text-sm">
                <span className="text-muted-foreground">{mins} minutes × {fmt(rate, currency)}</span>
                <span className="text-lg font-bold text-foreground">{fmt(topupTotal, currency)}</span>
              </div>
              <div className="flex items-center justify-between text-xs text-muted-foreground pt-1 border-t border-border/40">
                <span>Payment Gateway</span>
                <span className="font-medium text-foreground">{isRzp ? "Razorpay (INR)" : "Stripe (USD)"}</span>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setTopupOpen(false)}>
              Cancel
            </Button>
            <Button onClick={doTopup} disabled={working} className="gap-1.5 font-semibold">
              {working ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUpRight className="h-4 w-4" />}
              Pay {fmt(topupTotal, currency)}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Plan Selection Modal */}
      <Dialog open={subOpen} onOpenChange={setSubOpen}>
        <DialogContent className="sm:max-w-xl p-5" hideCloseButton>
          <DialogHeader className="relative flex-row items-start gap-0 pr-10">
            <div className="flex-1">
              <DialogTitle className="text-base">
                Choose Subscription Plan
              </DialogTitle>
              <DialogDescription className="text-xs">
                Select a plan to unlock higher agent volume and minute quotas.
              </DialogDescription>
            </div>
            <DialogClose className="absolute right-0 top-1/2 -translate-y-1/2 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none [&_svg]:size-4 cursor-pointer bg-background/60 hover:bg-background/80 h-8 w-8 flex items-center justify-center">
              <XIcon />
              <span className="sr-only">Close</span>
            </DialogClose>
          </DialogHeader>

          <div className="space-y-3 py-3 max-h-[60vh] overflow-y-auto pr-1">
            {plans
              .filter((p) => p.currency === currency)
              .map((plan) => {
                const isCur = plan.id === wallet?.billing_plan_id;
                return (
                  <div
                    key={plan.id}
                    className={`rounded-xl border p-4 transition-all ${
                      isCur
                        ? "border-primary bg-primary/5 shadow-xs"
                        : "border-border/80 hover:border-border bg-card"
                    }`}
                  >
                    <div className="flex items-start justify-between mb-2">
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="font-bold text-base">{plan.name}</p>
                          {isCur && (
                            <Badge variant="default" className="text-[10px] px-2 py-0">
                              Current Plan
                            </Badge>
                          )}
                        </div>
                        {plan.description && (
                          <p className="text-xs text-muted-foreground mt-0.5">{plan.description}</p>
                        )}
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-xl font-extrabold">
                          {fmt(plan.price_per_month, plan.currency)}
                          <span className="text-xs font-normal text-muted-foreground">/mo</span>
                        </p>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground my-3 pt-2 border-t border-border/40">
                      <div className="flex items-center gap-1.5">
                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                        <span>{plan.included_minutes} voice minutes</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                        <span>{plan.included_messages.toLocaleString()} messages</span>
                      </div>
                      <div className="flex items-center gap-1.5 col-span-2">
                        <AlertCircle className="h-3.5 w-3.5 text-muted-foreground/70 shrink-0" />
                        <span>Extra rate: {fmt(plan.price_per_extra_minute, plan.currency)}/min</span>
                      </div>
                    </div>

                    <Button
                      size="sm"
                      className="w-full gap-1.5 font-semibold"
                      variant={isCur ? "secondary" : "default"}
                      disabled={isCur || (working && activePlan === plan.id)}
                      onClick={() => doSubscribe(plan)}
                    >
                      {working && activePlan === plan.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : isCur ? (
                        "Active Plan"
                      ) : (
                        `Subscribe to ${plan.name}`
                      )}
                    </Button>
                  </div>
                );
              })}
            {plans.filter((p) => p.currency === currency).length === 0 && (
              <div className="text-center py-8">
                <p className="text-sm text-muted-foreground">No billing plans configured for currency {currency}.</p>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

