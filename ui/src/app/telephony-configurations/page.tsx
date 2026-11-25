"use client";

import { Eye } from "lucide-react";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Copy,
  ExternalLink,
  Pencil,
  PhoneCall,
  Plus,
  Search,
  Star,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import {
  deleteTelephonyConfigurationApiV1OrganizationsTelephonyConfigsConfigIdDelete,
  getTelephonyConfigurationByIdApiV1OrganizationsTelephonyConfigsConfigIdGet,
  listTelephonyConfigurationsApiV1OrganizationsTelephonyConfigsGet,
  setDefaultOutboundApiV1OrganizationsTelephonyConfigsConfigIdSetDefaultOutboundPost,
} from "@/client/sdk.gen";
import type {
  TelephonyConfigurationDetail,
  TelephonyConfigurationListItem,
} from "@/client/types.gen";
import { PageFilterSelect } from "@/components/layout/PageFilterSelect";
import { PageSearchInput } from "@/components/layout/PageSearchInput";
import { RowAction, RowActionSeparator, RowActionsMenu } from "@/components/layout/RowActionsMenu";
import { TablePagination } from "@/components/layout/TablePagination";
import { ConfigFormDialog } from "@/components/telephony/ConfigFormDialog";
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
import {
  Card,
  CardContent,
} from "@/components/ui/card";
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
import { useTelephonyConfigWarnings } from "@/context/TelephonyConfigWarningsContext";
import { usePagination } from "@/hooks/usePagination";
import { detailFromError } from "@/lib/apiError";
import { useAuth } from "@/lib/auth";
import { ALL_FILTER, matchesFilter, toFilterOptions } from "@/lib/searchFilter";

export default function TelephonyConfigurationsPage() {
  const { user, getAccessToken, loading: authLoading } = useAuth();
  const {
    telnyxMissingWebhookPublicKeyCount,
    refresh: refreshWarnings,
  } = useTelephonyConfigWarnings();
  const [items, setItems] = useState<TelephonyConfigurationListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<TelephonyConfigurationDetail | null>(
    null,
  );
  const [editOpen, setEditOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] =
    useState<TelephonyConfigurationListItem | null>(null);

  const fetchItems = useCallback(async () => {
    if (authLoading || !user) return;
    setLoading(true);
    try {
      const token = await getAccessToken();
      const res = await listTelephonyConfigurationsApiV1OrganizationsTelephonyConfigsGet(
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (res.error) throw new Error(detailFromError(res.error));
      setItems(res.data?.configurations ?? []);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load configurations");
    } finally {
      setLoading(false);
    }
  }, [authLoading, user, getAccessToken]);

  // After a save (create/update), the backing config may have flipped between
  // missing/present webhook_public_key — refresh the cached warning state so
  // the page banner and nav badge update without a manual reload.
  const onSaved = useCallback(async () => {
    await fetchItems();
    await refreshWarnings();
  }, [fetchItems, refreshWarnings]);

  useEffect(() => {
    fetchItems();
  }, [fetchItems]);

  const onEdit = async (item: TelephonyConfigurationListItem) => {
    try {
      const token = await getAccessToken();
      const res = await getTelephonyConfigurationByIdApiV1OrganizationsTelephonyConfigsConfigIdGet(
        {
          headers: { Authorization: `Bearer ${token}` },
          path: { config_id: item.id },
        },
      );
      if (res.error) throw new Error(detailFromError(res.error));
      setEditTarget(res.data ?? null);
      setEditOpen(true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load configuration");
    }
  };

  const onSetDefault = async (item: TelephonyConfigurationListItem) => {
    try {
      const token = await getAccessToken();
      const res = await setDefaultOutboundApiV1OrganizationsTelephonyConfigsConfigIdSetDefaultOutboundPost(
        {
          headers: { Authorization: `Bearer ${token}` },
          path: { config_id: item.id },
        },
      );
      if (res.error) throw new Error(detailFromError(res.error));
      toast.success(`${item.name} is now the default outbound configuration`);
      fetchItems();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to set default");
    }
  };

  const onConfirmDelete = async () => {
    if (!deleteTarget) return;
    try {
      const token = await getAccessToken();
      const res = await deleteTelephonyConfigurationApiV1OrganizationsTelephonyConfigsConfigIdDelete(
        {
          headers: { Authorization: `Bearer ${token}` },
          path: { config_id: deleteTarget.id },
        },
      );
      if (res.error) throw new Error(detailFromError(res.error));
      toast.success("Configuration deleted");
      setDeleteTarget(null);
      fetchItems();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete configuration");
    }
  };

  const [providerFilter, setProviderFilter] = useState(ALL_FILTER);
  const filteredItems = items.filter((item) => {
    if (!matchesFilter(item.provider, providerFilter)) return false;
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      item.name.toLowerCase().includes(q) ||
      item.provider.toLowerCase().includes(q) ||
      String(item.id).includes(q)
    );
  });

  // Header sorting (client-side, current list only).
  type TelephonySortKey = 'id' | 'name' | 'provider' | 'phone_number_count' | 'created_at' | 'is_default_outbound';
  const [sortKey, setSortKey] = useState<TelephonySortKey | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const toggleSort = (key: TelephonySortKey) => {
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
  const SortIcon = ({ column }: { column: TelephonySortKey }) => {
    if (sortKey !== column) return <ArrowUpDown className="h-3.5 w-3.5 text-muted-foreground/60" />;
    return sortDir === 'asc'
      ? <ArrowUp className="h-3.5 w-3.5 text-foreground" />
      : <ArrowDown className="h-3.5 w-3.5 text-foreground" />;
  };
  const sortedItems = useMemo(() => {
    if (!sortKey) return filteredItems;
    const dir = sortDir === 'asc' ? 1 : -1;
    return [...filteredItems].sort((a, b) => {
      switch (sortKey) {
        case 'id':
          return (a.id - b.id) * dir;
        case 'name':
          return (a.name ?? '').localeCompare(b.name ?? '') * dir;
        case 'provider':
          return (a.provider ?? '').localeCompare(b.provider ?? '') * dir;
        case 'phone_number_count':
          return ((a.phone_number_count ?? 0) - (b.phone_number_count ?? 0)) * dir;
        case 'created_at':
          return (new Date(a.created_at).getTime() - new Date(b.created_at).getTime()) * dir;
        case 'is_default_outbound':
          return ((a.is_default_outbound ? 1 : 0) - (b.is_default_outbound ? 1 : 0)) * dir;
      }
    });
  }, [filteredItems, sortKey, sortDir]);
  const configPagination = usePagination(sortedItems);

  return (
    <div className="px-4 lg:px-6 pt-2 pb-6 space-y-4">
      <PageHeader
        title="Telephony configurations"
        subtitle={
          <span>
            Connect and manage your telephony provider accounts.{" "}
            <a
              href="https://docs.convozent.ai/integrations/telephony/overview"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-0.5 underline hover:text-foreground"
            >
              Learn more <ExternalLink className="h-3 w-3" />
            </a>
          </span>
        }
                onRefresh={() => void fetchItems()}
                isRefreshing={loading}
                primaryAction={<Button onClick={() => setCreateOpen(true)}>
                        <Plus className="h-4 w-4 mr-2" /> Add configuration
                    </Button>}
                toolbar={
                    <>
                        <PageSearchInput placeholder="Search configurations..." value={searchQuery} onChange={setSearchQuery} />
                        <PageFilterSelect allLabel="All providers" value={providerFilter} options={toFilterOptions(items, (item) => item.provider)} onChange={setProviderFilter} />
                    </>
                }
            />

      {telnyxMissingWebhookPublicKeyCount > 0 && (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-4 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
          <div className="flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 shrink-0 mt-0.5" />
            <div className="space-y-1 text-sm">
              <p className="font-medium">Webhook public key not configured</p>
              <p>
                {telnyxMissingWebhookPublicKeyCount === 1
                  ? "1 Telnyx configuration is"
                  : `${telnyxMissingWebhookPublicKeyCount} Telnyx configurations are`}{" "}
                missing a webhook public key. Without it, Telnyx call status
                updates and inbound calls are being rejected. Copy your
                public key from{" "}
                <span className="whitespace-nowrap">
                  Mission Control Portal → Keys &amp; Credentials → Public Key
                </span>{" "}
                and paste it into the affected Telnyx configuration below.
              </p>
            </div>
          </div>
        </div>
      )}

      <Card className="overflow-hidden">
        <CardContent className="p-0">
          {loading ? (
            <div className="p-4 space-y-3">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : items.length === 0 ? (
            <div className="text-center py-12 px-4">
              <PhoneCall className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="font-semibold text-lg mb-1">No telephony configurations yet</h3>
              <p className="text-sm text-muted-foreground max-w-sm mx-auto mb-4">
                Add one to enable outbound calls and receive inbound voice workflows.
              </p>
              <Button onClick={() => setCreateOpen(true)} size="sm">
                <Plus className="h-4 w-4 mr-2" /> Add configuration
              </Button>
            </div>
          ) : sortedItems.length === 0 ? (
            <div className="text-center py-12 px-4">
              <Search className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">
                No configurations match &quot;{searchQuery}&quot;
              </p>
            </div>
          ) : (
            <div className="relative w-full overflow-auto">
              <Table>
                <TableHeader className="bg-muted/50">
                  <TableRow>
                    <TableHead className="h-10 px-4 text-left align-middle font-medium text-muted-foreground">
                      <button onClick={() => toggleSort('id')} className="inline-flex items-center gap-1 hover:text-foreground cursor-pointer" aria-label="Sort by ID">
                        ID <SortIcon column="id" />
                      </button>
                    </TableHead>
                    <TableHead className="h-10 px-4 text-left align-middle font-medium text-muted-foreground">
                      <button onClick={() => toggleSort('name')} className="inline-flex items-center gap-1 hover:text-foreground cursor-pointer" aria-label="Sort by configuration name">
                        Configuration Name <SortIcon column="name" />
                      </button>
                    </TableHead>
                    <TableHead className="h-10 px-4 text-left align-middle font-medium text-muted-foreground">
                      <button onClick={() => toggleSort('provider')} className="inline-flex items-center gap-1 hover:text-foreground cursor-pointer" aria-label="Sort by provider">
                        Provider <SortIcon column="provider" />
                      </button>
                    </TableHead>
                    <TableHead className="h-10 px-4 text-left align-middle font-medium text-muted-foreground">
                      <button onClick={() => toggleSort('phone_number_count')} className="inline-flex items-center gap-1 hover:text-foreground cursor-pointer" aria-label="Sort by phone numbers">
                        Phone Numbers <SortIcon column="phone_number_count" />
                      </button>
                    </TableHead>
                    <TableHead className="h-10 px-4 text-left align-middle font-medium text-muted-foreground">
                      <button onClick={() => toggleSort('created_at')} className="inline-flex items-center gap-1 hover:text-foreground cursor-pointer" aria-label="Sort by created date">
                        Created <SortIcon column="created_at" />
                      </button>
                    </TableHead>
                    <TableHead className="h-10 px-4 text-left align-middle font-medium text-muted-foreground">
                      <button onClick={() => toggleSort('is_default_outbound')} className="inline-flex items-center gap-1 hover:text-foreground cursor-pointer" aria-label="Sort by outbound status">
                        Outbound Status <SortIcon column="is_default_outbound" />
                      </button>
                    </TableHead>
                    <TableHead className="h-10 px-4 align-middle font-medium text-muted-foreground text-right">
                      Actions
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {configPagination.pageItems.map((item) => (
                    <TableRow key={item.id} className="hover:bg-muted/50">
                      <TableCell className="p-4 align-middle">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            navigator.clipboard
                              .writeText(String(item.id))
                              .then(() => toast.success("Configuration ID copied"))
                              .catch(() => toast.error("Failed to copy ID"));
                          }}
                          title="Click to copy ID"
                          className="inline-flex items-center gap-1 font-mono text-xs text-muted-foreground hover:text-foreground cursor-pointer"
                        >
                          <span>#{item.id}</span>
                          <Copy className="h-3 w-3 shrink-0" />
                        </button>
                      </TableCell>
                      <TableCell className="p-4 align-middle font-medium">
                        <Link
                          href={`/telephony-configurations/${item.id}`}
                          className="hover:underline text-foreground font-semibold flex items-center gap-1.5"
                        >
                          <span>{item.name}</span>
                        </Link>
                      </TableCell>
                      <TableCell className="p-4 align-middle">
                        <Badge variant="indigo" className="capitalize font-medium">
                          {item.provider}
                        </Badge>
                      </TableCell>
                      <TableCell className="p-4 align-middle">
                        <Link
                          href={`/telephony-configurations/${item.id}`}
                          className="inline-flex items-center gap-1 text-xs font-medium hover:underline text-foreground"
                        >
                          <Badge variant="secondary" className="font-normal">
                            {item.phone_number_count} {item.phone_number_count === 1 ? "number" : "numbers"}
                          </Badge>
                        </Link>
                      </TableCell>
                      <TableCell className="p-4 align-middle">
                        {new Date(item.created_at).toLocaleDateString()}
                      </TableCell>
                      <TableCell className="p-4 align-middle">
                        {item.is_default_outbound ? (
                          <Badge variant="purple" className="font-medium gap-1">
                            <Star className="h-3 w-3 fill-current text-purple-600 dark:text-purple-300" />
                            Default Outbound
                          </Badge>
                        ) : (
                          <span className="text-xs text-foreground">Standard</span>
                        )}
                      </TableCell>
                      <TableCell className="p-4 align-middle text-right">
                          <RowActionsMenu label={`Actions for ${item.name}`}>
                              <RowAction icon={<Eye />} href={`/telephony-configurations/${item.id}`}>View numbers</RowAction>
                              <RowAction icon={<Pencil />} onClick={() => onEdit(item)}>Edit</RowAction>
                              {!item.is_default_outbound && (
                                  <RowAction icon={<Star />} onClick={() => onSetDefault(item)}>Set as default</RowAction>
                              )}
                              <RowActionSeparator />
                              <RowAction icon={<Trash2 />} onClick={() => setDeleteTarget(item)} destructive>Delete</RowAction>
                          </RowActionsMenu>
</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <TablePagination {...configPagination} />
            </div>
          )}
        </CardContent>
      </Card>

      <ConfigFormDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        existing={null}
        onSaved={onSaved}
      />
      <ConfigFormDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        existing={editTarget}
        onSaved={onSaved}
      />

      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete configuration?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget?.name} and all of its phone numbers will be removed. Any
              campaigns that reference this configuration will block the deletion until
              they are reassigned.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={onConfirmDelete}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
