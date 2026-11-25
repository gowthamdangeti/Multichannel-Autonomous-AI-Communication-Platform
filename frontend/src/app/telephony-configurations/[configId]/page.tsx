"use client";

import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  ArrowUpDown,
  Copy,
  ExternalLink,
  Pencil,
  Phone,
  Plus,
  Search,
  Star,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import {
  deletePhoneNumberApiV1OrganizationsTelephonyConfigsConfigIdPhoneNumbersPhoneNumberIdDelete,
  getTelephonyConfigurationByIdApiV1OrganizationsTelephonyConfigsConfigIdGet,
  listPhoneNumbersApiV1OrganizationsTelephonyConfigsConfigIdPhoneNumbersGet,
  setDefaultCallerIdApiV1OrganizationsTelephonyConfigsConfigIdPhoneNumbersPhoneNumberIdSetDefaultCallerPost,
  setDefaultOutboundApiV1OrganizationsTelephonyConfigsConfigIdSetDefaultOutboundPost,
} from "@/client/sdk.gen";
import type {
  PhoneNumberResponse,
  TelephonyConfigurationDetail,
} from "@/client/types.gen";
import { RowAction, RowActionSeparator, RowActionsMenu } from "@/components/layout/RowActionsMenu";
import { TablePagination } from "@/components/layout/TablePagination";
import { ConfigFormDialog } from "@/components/telephony/ConfigFormDialog";
import { PhoneNumberDialog } from "@/components/telephony/PhoneNumberDialog";
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
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
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
import { usePagination } from "@/hooks/usePagination";
import { detailFromError } from "@/lib/apiError";
import { useAuth } from "@/lib/auth";

const INBOUND_WEBHOOK_PATH = "/api/v1/telephony/inbound/run";

function getInboundWebhookUrl(): string {
  const backendUrl =
    process.env.NEXT_PUBLIC_BACKEND_URL ||
    (typeof window !== "undefined" ? window.location.origin : "");
  return `${backendUrl}${INBOUND_WEBHOOK_PATH}`;
}

export default function TelephonyConfigurationDetailPage() {
  const router = useRouter();
  const params = useParams<{ configId: string }>();
  const configId = Number(params.configId);

  const { user, getAccessToken, loading: authLoading } = useAuth();
  const [config, setConfig] = useState<TelephonyConfigurationDetail | null>(null);
  const breadcrumbs = useMemo<Breadcrumb[]>(
    () => [
      { label: "Telephony", href: "/telephony-configurations" },
      { label: config?.provider ? `${config.provider} Configuration` : "Configuration Details" },
    ],
    [config?.provider]
  );
  const [phoneNumbers, setPhoneNumbers] = useState<PhoneNumberResponse[]>([]);
  const [phoneSearchQuery, setPhoneSearchQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [editConfigOpen, setEditConfigOpen] = useState(false);

  const [phoneDialogOpen, setPhoneDialogOpen] = useState(false);
  const [phoneEditTarget, setPhoneEditTarget] = useState<PhoneNumberResponse | null>(
    null,
  );
  const [phoneDeleteTarget, setPhoneDeleteTarget] = useState<PhoneNumberResponse | null>(
    null,
  );

  const fetchAll = useCallback(async () => {
    if (authLoading || !user || !configId) return;
    setLoading(true);
    try {
      const token = await getAccessToken();
      const [cfgRes, numbersRes] = await Promise.all([
        getTelephonyConfigurationByIdApiV1OrganizationsTelephonyConfigsConfigIdGet({
          headers: { Authorization: `Bearer ${token}` },
          path: { config_id: configId },
        }),
        listPhoneNumbersApiV1OrganizationsTelephonyConfigsConfigIdPhoneNumbersGet({
          headers: { Authorization: `Bearer ${token}` },
          path: { config_id: configId },
        }),
      ]);

      if (cfgRes.error) throw new Error(detailFromError(cfgRes.error));
      if (numbersRes.error) throw new Error(detailFromError(numbersRes.error));

      setConfig(cfgRes.data ?? null);
      setPhoneNumbers(numbersRes.data?.phone_numbers ?? []);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load configuration");
    } finally {
      setLoading(false);
    }
  }, [authLoading, user, configId, getAccessToken]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const onSetDefaultOutbound = async () => {
    if (!config) return;
    try {
      const token = await getAccessToken();
      const res = await setDefaultOutboundApiV1OrganizationsTelephonyConfigsConfigIdSetDefaultOutboundPost(
        {
          headers: { Authorization: `Bearer ${token}` },
          path: { config_id: config.id },
        },
      );
      if (res.error) throw new Error(detailFromError(res.error));
      toast.success("Set as default outbound");
      fetchAll();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to set default");
    }
  };

  const onSetDefaultCaller = async (n: PhoneNumberResponse) => {
    try {
      const token = await getAccessToken();
      const res = await setDefaultCallerIdApiV1OrganizationsTelephonyConfigsConfigIdPhoneNumbersPhoneNumberIdSetDefaultCallerPost(
        {
          headers: { Authorization: `Bearer ${token}` },
          path: { config_id: configId, phone_number_id: n.id },
        },
      );
      if (res.error) throw new Error(detailFromError(res.error));
      toast.success(`${n.address} is now the default caller ID`);
      fetchAll();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to set default caller");
    }
  };

  const onConfirmDeletePhone = async () => {
    if (!phoneDeleteTarget) return;
    try {
      const token = await getAccessToken();
      const res = await deletePhoneNumberApiV1OrganizationsTelephonyConfigsConfigIdPhoneNumbersPhoneNumberIdDelete(
        {
          headers: { Authorization: `Bearer ${token}` },
          path: {
            config_id: configId,
            phone_number_id: phoneDeleteTarget.id,
          },
        },
      );
      if (res.error) throw new Error(detailFromError(res.error));
      toast.success("Phone number deleted");
      setPhoneDeleteTarget(null);
      fetchAll();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete phone number");
    }
  };

  const filteredPhoneNumbers = phoneNumbers.filter((n) => {
    if (!phoneSearchQuery.trim()) return true;
    const q = phoneSearchQuery.toLowerCase();
    return (
      n.address.toLowerCase().includes(q) ||
      (n.label && n.label.toLowerCase().includes(q)) ||
      n.address_type.toLowerCase().includes(q) ||
      (n.inbound_workflow_name && n.inbound_workflow_name.toLowerCase().includes(q)) ||
      String(n.inbound_workflow_id ?? "").includes(q)
    );
  });

  // Header sorting (client-side, current list only).
  type PhoneSortKey = 'address' | 'address_type' | 'label' | 'is_active';
  const [phoneSortKey, setPhoneSortKey] = useState<PhoneSortKey | null>(null);
  const [phoneSortDir, setPhoneSortDir] = useState<'asc' | 'desc'>('asc');
  const togglePhoneSort = (key: PhoneSortKey) => {
    if (phoneSortKey !== key) {
      setPhoneSortKey(key);
      setPhoneSortDir('asc');
    } else if (phoneSortDir === 'asc') {
      setPhoneSortDir('desc');
    } else {
      setPhoneSortKey(null);
      setPhoneSortDir('asc');
    }
  };
  const PhoneSortIcon = ({ column }: { column: PhoneSortKey }) => {
    if (phoneSortKey !== column) return <ArrowUpDown className="h-3.5 w-3.5 text-muted-foreground/60" />;
    return phoneSortDir === 'asc'
      ? <ArrowUp className="h-3.5 w-3.5 text-foreground" />
      : <ArrowDown className="h-3.5 w-3.5 text-foreground" />;
  };
  const sortedPhoneNumbers = useMemo(() => {
    if (!phoneSortKey) return filteredPhoneNumbers;
    const dir = phoneSortDir === 'asc' ? 1 : -1;
    return [...filteredPhoneNumbers].sort((a, b) => {
      switch (phoneSortKey) {
        case 'address':
          return (a.address ?? '').localeCompare(b.address ?? '') * dir;
        case 'address_type':
          return (a.address_type ?? '').localeCompare(b.address_type ?? '') * dir;
        case 'label':
          return (a.label ?? '').localeCompare(b.label ?? '') * dir;
        case 'is_active':
          return ((a.is_active ? 1 : 0) - (b.is_active ? 1 : 0)) * dir;
      }
    });
  }, [filteredPhoneNumbers, phoneSortKey, phoneSortDir]);
  const numberPagination = usePagination(sortedPhoneNumbers);

  if (loading) {
    return (
      <div className="px-4 lg:px-6 pt-2 pb-6 space-y-3">
        <Skeleton className="h-10 w-1/3" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!config) {
    return (
      <div className="px-4 lg:px-6 pt-2 pb-6">
        <Button variant="ghost" onClick={() => router.push("/telephony-configurations")}>
          <ArrowLeft className="h-4 w-4 mr-2" /> Back
        </Button>
        <p className="mt-4 text-muted-foreground">Configuration not found.</p>
      </div>
    );
  }

  return (
    <div className="px-4 lg:px-6 pt-2 pb-6 space-y-6">
      <PageHeader
        breadcrumbs={breadcrumbs}
        title={
          <div className="flex items-center gap-3">
            <Link
              href="/telephony-configurations"
              className="shrink-0 transition-opacity hover:opacity-70"
              aria-label="Back to telephony configurations"
            >
              <ArrowLeft className="h-5 w-5" />
            </Link>
            <div className="flex flex-col">
              <span>Telephony configurations</span>
              <span className="mt-0.5 text-xs font-normal leading-normal text-muted-foreground">
                Connect and manage your telephony provider accounts.{" "}
                <a
                  href="https://docs.autonomous-ai-os.enterprise/integrations/telephony/overview"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-0.5 underline hover:text-foreground"
                >
                  Learn more <ExternalLink className="h-3 w-3" />
                </a>
              </span>
            </div>
          </div>
        }
      />

      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div className="space-y-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <CardTitle className="truncate">{config.name}</CardTitle>
              <Badge variant="indigo" className="capitalize font-medium">{config.provider}</Badge>
              {config.is_default_outbound && (
                <Badge variant="purple" className="font-medium gap-1">
                  <Star className="h-3 w-3 fill-current text-purple-600 dark:text-purple-300" />
                  Default Outbound
                </Badge>
              )}
            </div>
            <CardDescription>
              Updated {new Date(config.updated_at).toLocaleString()}
            </CardDescription>
            <button
              type="button"
              onClick={() => {
                navigator.clipboard
                  .writeText(String(config.id))
                  .then(() => toast.success("Configuration ID copied"))
                  .catch(() => toast.error("Failed to copy ID"));
              }}
              title="Click to copy"
              className="inline-flex items-center gap-1 self-start rounded font-mono text-xs text-muted-foreground hover:text-foreground"
            >
              <span className="truncate">Configuration ID: {config.id}</span>
              <Copy className="h-3 w-3 shrink-0" />
            </button>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {!config.is_default_outbound && (
              <Button variant="outline" size="sm" onClick={onSetDefaultOutbound}>
                <Star className="h-4 w-4 mr-2" /> Set as default
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={() => setEditConfigOpen(true)}>
              <Pencil className="h-4 w-4 mr-2" /> Edit credentials
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-sm">
            {Object.entries(config.credentials ?? {}).map(([k, v]) => (
              <div key={k} className="flex justify-between gap-3">
                <dt className="text-muted-foreground">{k}</dt>
                <dd className="font-mono text-right truncate max-w-[60%]">
                  {String(v ?? "")}
                </dd>
              </div>
            ))}
          </dl>
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">Inbound webhook URL</p>
            <button
              type="button"
              onClick={() => {
                const url = getInboundWebhookUrl();
                navigator.clipboard
                  .writeText(url)
                  .then(() => toast.success("Inbound webhook URL copied"))
                  .catch(() => toast.error("Failed to copy URL"));
              }}
              title="Click to copy inbound webhook URL"
              aria-label="Copy inbound webhook URL"
              className="inline-flex items-center gap-1 self-start rounded font-mono text-xs text-muted-foreground hover:text-foreground"
            >
              <span className="truncate">{getInboundWebhookUrl()}</span>
              <Copy className="h-3 w-3 shrink-0" />
            </button>
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="space-y-1">
          <h3 className="text-base font-semibold text-foreground">Phone numbers</h3>
          <p className="text-xs text-muted-foreground">
            Numbers used as caller ID for outbound and accepted for inbound matching.{" "}
            <a
              href="https://docs.autonomous-ai-os.enterprise/integrations/telephony/inbound"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-0.5 underline hover:text-foreground"
            >
              Inbound docs <ExternalLink className="h-3 w-3" />
            </a>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {phoneNumbers.length > 0 && (
            <div className="relative w-full sm:w-60">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                type="search"
                placeholder="Search numbers..."
                className="pl-9 h-9 w-full text-sm"
                value={phoneSearchQuery}
                onChange={(e) => setPhoneSearchQuery(e.target.value)}
              />
            </div>
          )}
          <Button
            size="sm"
            className="h-9"
            onClick={() => {
              setPhoneEditTarget(null);
              setPhoneDialogOpen(true);
            }}
          >
            <Plus className="h-4 w-4 mr-2" /> Add phone number
          </Button>
        </div>
      </div>

      <Card className="overflow-hidden">
        <CardContent className="p-0">
          {phoneNumbers.length === 0 ? (
            <div className="text-center py-12 px-4">
              <Phone className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
              <p className="text-sm font-medium mb-1">No phone numbers yet</p>
              <p className="text-sm text-muted-foreground max-w-sm mx-auto mb-4">
                Add one to start placing or receiving calls on this configuration.
              </p>
              <Button
                size="sm"
                onClick={() => {
                  setPhoneEditTarget(null);
                  setPhoneDialogOpen(true);
                }}
              >
                <Plus className="h-4 w-4 mr-2" /> Add phone number
              </Button>
            </div>
          ) : sortedPhoneNumbers.length === 0 ? (
            <div className="text-center py-12 px-4">
              <Search className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">
                No phone numbers match &quot;{phoneSearchQuery}&quot;
              </p>
            </div>
          ) : (
            <div className="relative w-full overflow-auto">
              <Table>
                <TableHeader className="bg-muted/50">
                  <TableRow>
                    <TableHead className="h-10 px-4 text-left align-middle font-medium text-muted-foreground">
                      <button onClick={() => togglePhoneSort('address')} className="inline-flex items-center gap-1 hover:text-foreground cursor-pointer" aria-label="Sort by address">
                        Address <PhoneSortIcon column="address" />
                      </button>
                    </TableHead>
                    <TableHead className="h-10 px-4 text-left align-middle font-medium text-muted-foreground">
                      <button onClick={() => togglePhoneSort('address_type')} className="inline-flex items-center gap-1 hover:text-foreground cursor-pointer" aria-label="Sort by type">
                        Type <PhoneSortIcon column="address_type" />
                      </button>
                    </TableHead>
                    <TableHead className="h-10 px-4 text-left align-middle font-medium text-muted-foreground">
                      <button onClick={() => togglePhoneSort('label')} className="inline-flex items-center gap-1 hover:text-foreground cursor-pointer" aria-label="Sort by label">
                        Label <PhoneSortIcon column="label" />
                      </button>
                    </TableHead>
                    <TableHead className="h-10 px-4 text-left align-middle font-medium text-muted-foreground">
                      <button onClick={() => togglePhoneSort('is_active')} className="inline-flex items-center gap-1 hover:text-foreground cursor-pointer" aria-label="Sort by status">
                        Status <PhoneSortIcon column="is_active" />
                      </button>
                    </TableHead>
                    <TableHead className="h-10 px-4 text-left align-middle font-medium text-muted-foreground">Inbound workflow</TableHead>
                    <TableHead className="h-10 px-4 align-middle font-medium text-muted-foreground text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {numberPagination.pageItems.map((n) => (
                    <TableRow key={n.id} className="hover:bg-muted/50 border-b border-border">
                      <TableCell className="p-4 align-middle font-mono font-medium">
                        <div className="flex items-center gap-2">
                          <Phone className="w-4 h-4 text-primary shrink-0" />
                          <span>{n.address}</span>
                          <button
                            type="button"
                            onClick={() => {
                              navigator.clipboard
                                .writeText(n.address)
                                .then(() => toast.success("Phone number copied"))
                                .catch(() => toast.error("Failed to copy"));
                            }}
                            title="Copy number"
                            className="text-muted-foreground hover:text-foreground p-0.5 rounded"
                          >
                            <Copy className="h-3 w-3 shrink-0" />
                          </button>
                        </div>
                      </TableCell>
                      <TableCell className="p-4 align-middle">
                        <Badge variant="outline" className="uppercase font-medium text-[10px]">
                          {n.address_type}
                        </Badge>
                      </TableCell>
                      <TableCell className="p-4 align-middle text-foreground text-sm">
                        {n.label ?? "-"}
                      </TableCell>
                      <TableCell className="p-4 align-middle">
                        <div className="flex flex-wrap gap-1 items-center">
                          {n.is_active ? (
                            <Badge variant="success" className="font-medium">
                              Active
                            </Badge>
                          ) : (
                            <Badge variant="secondary" className="font-medium">Inactive</Badge>
                          )}
                          {n.is_default_caller_id && (
                            <Badge variant="purple" className="font-medium gap-1">
                              <Star className="h-3 w-3 fill-current text-purple-600 dark:text-purple-300" /> Default caller
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="p-4 align-middle text-foreground text-sm">
                        {n.inbound_workflow_id ? (
                          <Link
                            href={`/workflow/${n.inbound_workflow_id}`}
                            className="inline-flex items-center gap-1.5 hover:underline hover:text-foreground font-medium"
                          >
                            <span>#{n.inbound_workflow_id}</span>
                            {n.inbound_workflow_name && (
                              <span
                                className="truncate max-w-[160px] text-xs font-normal"
                                title={n.inbound_workflow_name}
                              >
                                ({n.inbound_workflow_name.length > 20
                                  ? `${n.inbound_workflow_name.slice(0, 20)}…`
                                  : n.inbound_workflow_name})
                              </span>
                            )}
                          </Link>
                        ) : (
                          "-"
                        )}
                      </TableCell>
                      <TableCell className="p-4 align-middle text-right">
                          <RowActionsMenu label={`Actions for ${n.address}`}>
                              <RowAction icon={<Pencil />} onClick={() => {
                              setPhoneEditTarget(n);
                              setPhoneDialogOpen(true);
                            }}>Edit</RowAction>
                              {!n.is_default_caller_id && n.is_active && (
                                  <RowAction icon={<Star />} onClick={() => onSetDefaultCaller(n)}>Set as default caller ID</RowAction>
                              )}
                              <RowActionSeparator />
                              <RowAction icon={<Trash2 />} onClick={() => setPhoneDeleteTarget(n)} destructive>Delete</RowAction>
                          </RowActionsMenu>
</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <TablePagination {...numberPagination} />
            </div>
          )}
        </CardContent>
      </Card>

      <ConfigFormDialog
        open={editConfigOpen}
        onOpenChange={setEditConfigOpen}
        existing={config}
        onSaved={fetchAll}
      />

      <PhoneNumberDialog
        open={phoneDialogOpen}
        onOpenChange={setPhoneDialogOpen}
        configId={configId}
        existing={phoneEditTarget}
        onSaved={fetchAll}
      />

      <AlertDialog
        open={!!phoneDeleteTarget}
        onOpenChange={(o) => !o && setPhoneDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete phone number?</AlertDialogTitle>
            <AlertDialogDescription>
              {phoneDeleteTarget?.address} will no longer accept inbound calls or be
              available as a caller ID for this configuration.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={onConfirmDeletePhone}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
