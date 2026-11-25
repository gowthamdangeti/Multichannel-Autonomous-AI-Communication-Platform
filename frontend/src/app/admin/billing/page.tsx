"use client";

import { ArrowDown, ArrowUp, ArrowUpDown, Pencil, Plus } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { PageFilterSelect } from "@/components/layout/PageFilterSelect";
import { PageSearchInput } from "@/components/layout/PageSearchInput";
import { RowAction, RowActionsMenu } from "@/components/layout/RowActionsMenu";
import { TablePagination } from "@/components/layout/TablePagination";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { PageHeader } from "@/context/HeaderContext";
import { usePagination } from "@/hooks/usePagination";
import { getBackendApiUrl } from "@/lib/apiClient";
import { useAuth } from "@/lib/auth";
import { ACTIVE_FILTER_OPTIONS, ALL_FILTER, filterBySearch,matchesFilter, toActiveValue, toFilterOptions } from "@/lib/searchFilter";

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
  stripe_product_id: string | null;
  stripe_price_id: string | null;
  razorpay_plan_id: string | null;
  is_active: boolean;
}

type PlanForm = Omit<Plan, "id" | "stripe_product_id" | "stripe_price_id" | "razorpay_plan_id">;

const EMPTY: PlanForm = {
  name: "",
  description: "",
  currency: "USD",
  price_per_month: 999,
  included_minutes: 100,
  included_messages: 1000,
  price_per_extra_minute: 0.05,
  price_per_extra_message: 0.001,
  is_active: true,
};

const fmt = (n: number, cur: string) =>
  new Intl.NumberFormat("en", { style: "currency", currency: cur, maximumFractionDigits: 2 }).format(n);

export default function AdminBillingPage() {
  const { user, loading: authLoading, getAccessToken } = useAuth();
  const hasFetched = useRef(false);

  const [plans, setPlans] = useState<Plan[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState(ALL_FILTER);
  const [currencyFilter, setCurrencyFilter] = useState(ALL_FILTER);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Plan | null>(null);
  const [form, setForm] = useState<PlanForm>(EMPTY);
  const [saving, setSaving] = useState(false);

  const buildHdrs = useCallback(async () => {
    const t = await getAccessToken();
    return {
      Authorization: `Bearer ${t}`,
      "Content-Type": "application/json",
      "ngrok-skip-browser-warning": "true",
    };
  }, [getAccessToken]);

  const fetchPlans = useCallback(async () => {
    setLoading(true);
    try {
      const h = await buildHdrs();
      const baseUrl = getBackendApiUrl();
      const res = await fetch(`${baseUrl}/api/v1/admin/billing/plans`, { headers: h });
      const contentType = res.headers.get("content-type") || "";

      if (res.ok && contentType.includes("application/json")) {
        const data = await res.json();
        setPlans(Array.isArray(data) ? data : []);
      } else {
        const errData = contentType.includes("application/json") ? await res.json() : {};
        const msg = errData.detail || `HTTP ${res.status} ${res.statusText}`;
        console.error("Failed to fetch admin billing plans:", msg);
        toast.error(`Error loading plans: ${msg}`);
      }
    } catch (e) {
      console.error("Network error fetching admin billing plans:", e);
      toast.error("Network error loading billing plans");
    } finally {
      setLoading(false);
    }
  }, [buildHdrs]);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      setLoading(false);
      return;
    }
    if (hasFetched.current) return;
    hasFetched.current = true;
    fetchPlans();
  }, [authLoading, user, fetchPlans]);

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY);
    setDialogOpen(true);
  };

  const openEdit = (p: Plan) => {
    setEditing(p);
    const { stripe_product_id: _sp, stripe_price_id: _si, razorpay_plan_id: _rp, ...editForm } = p;
    void _sp;
    void _si;
    void _rp;
    setForm(editForm);
    setDialogOpen(true);
  };

  // Header sorting (client-side, current list only; null = server order).
  type PlanSortKey = 'id' | 'name' | 'currency' | 'price_per_month' | 'included_minutes' | 'included_messages' | 'is_active';
  const [sortKey, setSortKey] = useState<PlanSortKey | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const toggleSort = (key: PlanSortKey) => {
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
  const SortIcon = ({ column }: { column: PlanSortKey }) => {
    if (sortKey !== column) return <ArrowUpDown className="h-3.5 w-3.5 text-muted-foreground/60" />;
    return sortDir === 'asc'
      ? <ArrowUp className="h-3.5 w-3.5 text-foreground" />
      : <ArrowDown className="h-3.5 w-3.5 text-foreground" />;
  };
  const sortedPlans = useMemo(() => {
    if (!sortKey) return plans;
    const dir = sortDir === 'asc' ? 1 : -1;
    return [...plans].sort((a, b) => {
      switch (sortKey) {
        case 'id':
          return (a.id - b.id) * dir;
        case 'name':
          return (a.name ?? '').localeCompare(b.name ?? '') * dir;
        case 'currency':
          return (a.currency ?? '').localeCompare(b.currency ?? '') * dir;
        case 'price_per_month':
          return ((a.price_per_month ?? 0) - (b.price_per_month ?? 0)) * dir;
        case 'included_minutes':
          return ((a.included_minutes ?? 0) - (b.included_minutes ?? 0)) * dir;
        case 'included_messages':
          return ((a.included_messages ?? 0) - (b.included_messages ?? 0)) * dir;
        case 'is_active':
          return ((a.is_active ? 1 : 0) - (b.is_active ? 1 : 0)) * dir;
      }
    });
  }, [plans, sortKey, sortDir]);
  const visiblePlans = filterBySearch(sortedPlans, searchQuery, (p) => p.name).filter((p) => matchesFilter(toActiveValue(p.is_active), statusFilter) && matchesFilter(p.currency, currencyFilter));
  const planPagination = usePagination(visiblePlans);

  const save = async () => {
    setSaving(true);
    try {
      const h = await buildHdrs();
      const baseUrl = getBackendApiUrl();
      const url = editing
        ? `${baseUrl}/api/v1/admin/billing/plans/${editing.id}`
        : `${baseUrl}/api/v1/admin/billing/plans`;
      const method = editing ? "PATCH" : "POST";
      const res = await fetch(url, { method, headers: h, body: JSON.stringify(form) });
      const contentType = res.headers.get("content-type") || "";

      if (!res.ok) {
        const d = contentType.includes("application/json") ? await res.json() : {};
        throw new Error(d.detail ?? `HTTP ${res.status} ${res.statusText}`);
      }
      toast.success(editing ? "Plan updated" : "Plan created");
      setDialogOpen(false);
      fetchPlans();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Failed to save plan");
    } finally {
      setSaving(false);
    }
  };

  const field = (key: keyof PlanForm, label: string, type = "text", placeholder = "") => (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      <Input
        type={type}
        placeholder={placeholder}
        value={String(form[key] ?? "")}
        onChange={(e) =>
          setForm((f) => ({ ...f, [key]: type === "number" ? Number(e.target.value) : e.target.value }))
        }
      />
    </div>
  );

  return (
    <div className="space-y-4 pt-0">
      <PageHeader
        title="Billing Plans"
        subtitle="Create and manage subscription plans. Assign them to orgs via the Organizations page."
                onRefresh={() => void fetchPlans()}
                isRefreshing={loading}
                primaryAction={<Button onClick={openCreate}>
                        <Plus className="h-4 w-4 mr-1" />
                        New Plan
                    </Button>}
                toolbar={
                    <>
                        <PageSearchInput placeholder="Search plans..." value={searchQuery} onChange={setSearchQuery} />
                        <PageFilterSelect allLabel="All statuses" value={statusFilter} options={ACTIVE_FILTER_OPTIONS} onChange={setStatusFilter} />
                        <PageFilterSelect allLabel="All currencies" value={currencyFilter} options={toFilterOptions(plans, (p) => p.currency, (currency) => currency.toUpperCase())} onChange={setCurrencyFilter} />
                    </>
                }
            />

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-8 text-center text-sm text-muted-foreground space-y-2">
              <div className="size-5 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto" />
              <p>Loading billing plans from database...</p>
            </div>
          ) : plans.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground space-y-2">
              <p>No plans found in database.</p>
              <Button size="sm" variant="outline" onClick={openCreate}>
                <Plus className="h-4 w-4 mr-1" /> Create your first plan
              </Button>
            </div>
          ) : (
            <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>
                    <button onClick={() => toggleSort('id')} className="inline-flex items-center gap-1 hover:text-foreground cursor-pointer" aria-label="Sort by ID">
                      ID <SortIcon column="id" />
                    </button>
                  </TableHead>
                  <TableHead>
                    <button onClick={() => toggleSort('name')} className="inline-flex items-center gap-1 hover:text-foreground cursor-pointer" aria-label="Sort by name">
                      Name <SortIcon column="name" />
                    </button>
                  </TableHead>
                  <TableHead>
                    <button onClick={() => toggleSort('currency')} className="inline-flex items-center gap-1 hover:text-foreground cursor-pointer" aria-label="Sort by currency">
                      Currency <SortIcon column="currency" />
                    </button>
                  </TableHead>
                  <TableHead className="text-right">
                    <button onClick={() => toggleSort('price_per_month')} className="inline-flex items-center gap-1 hover:text-foreground cursor-pointer ml-auto" aria-label="Sort by price">
                      Price/mo <SortIcon column="price_per_month" />
                    </button>
                  </TableHead>
                  <TableHead className="text-right">
                    <button onClick={() => toggleSort('included_minutes')} className="inline-flex items-center gap-1 hover:text-foreground cursor-pointer ml-auto" aria-label="Sort by minutes">
                      Minutes <SortIcon column="included_minutes" />
                    </button>
                  </TableHead>
                  <TableHead className="text-right">
                    <button onClick={() => toggleSort('included_messages')} className="inline-flex items-center gap-1 hover:text-foreground cursor-pointer ml-auto" aria-label="Sort by messages">
                      Messages <SortIcon column="included_messages" />
                    </button>
                  </TableHead>
                  <TableHead>Gateway IDs</TableHead>
                  <TableHead>
                    <button onClick={() => toggleSort('is_active')} className="inline-flex items-center gap-1 hover:text-foreground cursor-pointer" aria-label="Sort by status">
                      Status <SortIcon column="is_active" />
                    </button>
                  </TableHead>
                  <TableHead className="text-center">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {planPagination.pageItems.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="text-muted-foreground font-mono text-xs">
                      #{p.id}
                    </TableCell>
                    <TableCell className="font-medium">
                      {p.name}
                      {p.description && (
                        <p className="text-xs text-foreground font-normal">{p.description}</p>
                      )}
                    </TableCell>
                    <TableCell>{p.currency}</TableCell>
                    <TableCell className="text-right">{fmt(p.price_per_month, p.currency)}</TableCell>
                    <TableCell className="text-right">{p.included_minutes}</TableCell>
                    <TableCell className="text-right">{p.included_messages.toLocaleString()}</TableCell>
                    <TableCell className="text-xs space-y-1">
                      {p.stripe_price_id ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-blue-500/10 text-blue-600 border border-blue-500/20 px-2 py-0.5 font-mono">
                          Stripe ✓
                        </span>
                      ) : (
                        p.currency !== "INR" && <span className="text-foreground">Stripe —</span>
                      )}
                      {p.razorpay_plan_id ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-green-500/10 text-green-600 border border-green-500/20 px-2 py-0.5 font-mono ml-1">
                          Razorpay ✓
                        </span>
                      ) : (
                        p.currency === "INR" && <span className="text-foreground ml-1">Razorpay —</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant={p.is_active ? "default" : "secondary"}>
                        {p.is_active ? "active" : "inactive"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                        <RowActionsMenu label={`Actions for ${p.name}`}>
                            <RowAction icon={<Pencil />} onClick={() => openEdit(p)}>Edit</RowAction>
                        </RowActionsMenu>
</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <TablePagination {...planPagination} />
            </>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Plan" : "Create Plan"}</DialogTitle>
            <DialogDescription className="sr-only">
              Configure subscription plan details and pricing
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-3 py-2 grid-cols-2">
            <div className="col-span-2">{field("name", "Plan name", "text", "e.g. Starter Plan")}</div>
            <div className="col-span-2 space-y-1">
              <Label className="text-xs">Description</Label>
              <Textarea
                placeholder="Optional description"
                rows={2}
                value={form.description ?? ""}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Currency</Label>
              <Select value={form.currency} onValueChange={(v) => setForm((f) => ({ ...f, currency: v }))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="USD">USD (Stripe)</SelectItem>
                  <SelectItem value="INR">INR (Razorpay)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {field("price_per_month", "Price / month", "number", "999")}
            {field("included_minutes", "Included minutes", "number", "100")}
            {field("included_messages", "Included messages", "number", "1000")}
            {field("price_per_extra_minute", "Extra minute price", "number", "0.05")}
            {field("price_per_extra_message", "Extra message price", "number", "0.001")}

            {editing && (editing.stripe_price_id || editing.razorpay_plan_id) && (
              <div className="col-span-2 rounded-lg border border-border bg-muted/30 p-3 space-y-1.5">
                <p className="text-xs font-medium text-muted-foreground">Auto-provisioned IDs</p>
                {editing.stripe_price_id && (
                  <div className="flex items-center gap-2 text-xs">
                    <span className="text-muted-foreground w-24">Stripe Price</span>
                    <span className="font-mono bg-background border border-border rounded px-2 py-0.5 text-blue-600">
                      {editing.stripe_price_id}
                    </span>
                  </div>
                )}
                {editing.stripe_product_id && (
                  <div className="flex items-center gap-2 text-xs">
                    <span className="text-muted-foreground w-24">Stripe Product</span>
                    <span className="font-mono bg-background border border-border rounded px-2 py-0.5 text-blue-600">
                      {editing.stripe_product_id}
                    </span>
                  </div>
                )}
                {editing.razorpay_plan_id && (
                  <div className="flex items-center gap-2 text-xs">
                    <span className="text-muted-foreground w-24">Razorpay Plan</span>
                    <span className="font-mono bg-background border border-border rounded px-2 py-0.5 text-green-600">
                      {editing.razorpay_plan_id}
                    </span>
                  </div>
                )}
              </div>
            )}

            {!editing && (
              <div className="col-span-2 rounded-lg border border-dashed border-border p-3">
                <p className="text-xs text-muted-foreground text-center">
                  {form.currency === "INR"
                    ? "A Razorpay plan will be created automatically on save."
                    : "A Stripe product + price will be created automatically on save."}
                </p>
              </div>
            )}

            <div className="col-span-2 flex items-center gap-2">
              <input
                type="checkbox"
                id="is_active"
                checked={form.is_active}
                onChange={(e) => setForm((f) => ({ ...f, is_active: e.target.checked }))}
              />
              <Label htmlFor="is_active" className="text-xs cursor-pointer">
                Active (visible to orgs)
              </Label>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={save} disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
