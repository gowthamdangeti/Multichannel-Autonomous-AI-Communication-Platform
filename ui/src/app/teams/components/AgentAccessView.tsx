"use client";

import {
  AlertCircle,
  Crown,
  KeyRound,
  Lock,
  MessageCircle,
  MessageSquare,
  Mic,
  RefreshCw,
  Search,
  ShieldCheck,
  UserMinus,
  UserPlus,
  Users,
} from "lucide-react";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { TablePagination } from "@/components/layout/TablePagination";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { AGENT_UTILIZATION_OPTIONS, type AgentUtilization } from "@/constants/agentUtilization";
import { type Breadcrumb, PageHeader } from "@/context/HeaderContext";
import { usePagination } from "@/hooks/usePagination";
import { detailFromError } from "@/lib/apiError";
import { cn } from "@/lib/utils";

import {
  type AccessDecision,
  accessibleUsersLabel,
  accessStatusOf,
  collectOrgMembers,
  computeAccessMatrix,
  grantsForSelection,
  normalizePolicy,
  type OrgMember,
  parseOrgMembers,
  recommendPolicyForTargets,
} from "./agentAccess";
import { getRoleAvatarStyle, getRoleLabel } from "./roleStyles";
import type { HierarchyNode } from "./types";

interface AgentAccessViewProps {
  /** Authenticated fetch owned by the page (token + 401 handling). */
  authFetch: (path: string, init?: RequestInit) => Promise<Response>;
  /** Organization hierarchy already fetched by the page — reused, not refetched. */
  hierarchyTree: HierarchyNode | null;
  currentUserId?: string | number | null;
}

export type AgentType = "voice" | "chat" | "whatsapp";

interface AgentRecord {
  id: number;
  key: string;
  name: string;
  agent_type: AgentType;
  status: string;
  created_at: string;
  utilization_type: string;
  created_by_user_id: number | null;
  private_allowed_user_ids: number[];
  is_creator: boolean;
  total_runs: number;
}

interface AgentRow extends AgentRecord {
  creator: OrgMember | null;
  matrix: Map<number, AccessDecision>;
  accessibleCount: number;
  accessibleLabel: string;
  explicitGrantCount: number;
  accessStatus: "granted" | "restricted";
}

const POLICY_OPTIONS = AGENT_UTILIZATION_OPTIONS;
const PAGE_SIZE = 8;

function policyLabel(value: string | null | undefined): string {
  const resolved = normalizePolicy(value);
  return POLICY_OPTIONS.find((option) => option.value === resolved)?.label ?? resolved;
}

function policyDescription(value: string | null | undefined): string {
  const resolved = normalizePolicy(value);
  return POLICY_OPTIONS.find((option) => option.value === resolved)?.description ?? "";
}

function policyBadgeVariant(value: string | null | undefined) {
  const resolved = normalizePolicy(value);
  if (resolved === "public") return "success" as const;
  if (resolved === "private") return "destructive" as const;
  return "violet" as const;
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString();
}

/** Narrow a workflow-list payload row (Voice agent). */
function toVoiceAgentRecord(item: unknown): AgentRecord | null {
  if (!item || typeof item !== "object" || !("id" in item) || typeof item.id !== "number") {
    return null;
  }
  return {
    id: item.id,
    key: `voice-${item.id}`,
    name: "name" in item && typeof item.name === "string" ? item.name : `Voice Agent #${item.id}`,
    agent_type: "voice",
    status: "status" in item && typeof item.status === "string" ? item.status : "active",
    created_at: "created_at" in item && typeof item.created_at === "string" ? item.created_at : "",
    utilization_type:
      "utilization_type" in item && typeof item.utilization_type === "string"
        ? item.utilization_type
        : "public",
    created_by_user_id:
      "created_by_user_id" in item && typeof item.created_by_user_id === "number"
        ? item.created_by_user_id
        : ("user_id" in item && typeof item.user_id === "number" ? item.user_id : null),
    private_allowed_user_ids:
      "private_allowed_user_ids" in item && Array.isArray(item.private_allowed_user_ids)
        ? item.private_allowed_user_ids.filter(
            (value: unknown): value is number => typeof value === "number"
          )
        : [],
    is_creator: "is_creator" in item && item.is_creator === true,
    total_runs:
      "total_runs" in item && typeof item.total_runs === "number" ? item.total_runs : 0,
  };
}

/** Narrow a chat agent payload row. */
function toChatAgentRecord(item: unknown): AgentRecord | null {
  if (!item || typeof item !== "object" || !("id" in item) || typeof item.id !== "number") {
    return null;
  }
  return {
    id: item.id,
    key: `chat-${item.id}`,
    name: "name" in item && typeof item.name === "string" ? item.name : `Chat Agent #${item.id}`,
    agent_type: "chat",
    status: "is_active" in item && item.is_active === false ? "inactive" : "active",
    created_at: "created_at" in item && typeof item.created_at === "string" ? item.created_at : "",
    utilization_type: "public",
    created_by_user_id: null,
    private_allowed_user_ids: [],
    is_creator: false,
    total_runs: 0,
  };
}

/** Narrow a WhatsApp agent payload row. */
function toWhatsAppAgentRecord(item: unknown): AgentRecord | null {
  if (!item || typeof item !== "object" || !("id" in item) || typeof item.id !== "number") {
    return null;
  }
  return {
    id: item.id,
    key: `whatsapp-${item.id}`,
    name: "name" in item && typeof item.name === "string" ? item.name : `WhatsApp Agent #${item.id}`,
    agent_type: "whatsapp",
    status: "active",
    created_at: "created_at" in item && typeof item.created_at === "string" ? item.created_at : "",
    utilization_type: "public",
    created_by_user_id: null,
    private_allowed_user_ids: [],
    is_creator: false,
    total_runs: 0,
  };
}

function StatTile({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-3.5 shadow-surface">
      <p className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">{label}</p>
      <p className={cn("mt-1 text-xl font-semibold tabular-nums text-foreground", tone)}>{value}</p>
    </div>
  );
}

function MemberAvatar({ member }: { member: OrgMember }) {
  const initials = member.name
    .trim()
    .split(/\s+/)
    .map((part) => part[0] ?? "")
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <span
      className={cn(
        "grid size-8 shrink-0 place-items-center rounded-full border text-[11px] font-semibold",
        getRoleAvatarStyle(member.role)
      )}
    >
      {initials || "?"}
    </span>
  );
}

function AccessBadge({ decision }: { decision: AccessDecision }) {
  return decision.granted ? (
    <Badge variant="success" className="gap-1 text-[10px]" title={decision.reason}>
      <ShieldCheck className="size-3" />
      Can access
    </Badge>
  ) : (
    <Badge variant="secondary" className="gap-1 text-[10px]" title={decision.reason}>
      <Lock className="size-3" />
      Restricted
    </Badge>
  );
}

/** One row of the member picker / access list: identity plus why they have access. */
function MemberLine({
  member,
  manager,
  decision,
  selected,
  onToggle,
  locked = false,
}: {
  member: OrgMember;
  manager: OrgMember | null;
  decision: AccessDecision | null;
  selected?: boolean;
  onToggle?: (userId: number) => void;
  /** Always-granted rows (the agent creator): shown checked and not toggleable. */
  locked?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-lg border px-3 py-2",
        locked
          ? "border-violet-500/30 bg-violet-500/5"
          : selected
            ? "border-primary/50 bg-primary/5"
            : "border-border/60 bg-card"
      )}
    >
      {onToggle && (
        <Checkbox
          checked={locked || Boolean(selected)}
          disabled={locked}
          onCheckedChange={() => !locked && onToggle(member.userId)}
          aria-label={`Select ${member.name}`}
        />
      )}
      <MemberAvatar member={member} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-xs font-semibold text-foreground">{member.name}</span>
          {locked && (
            <Badge variant="violet" className="py-0 text-[10px]">
              Creator
            </Badge>
          )}
          <Badge variant="secondary" className="hidden py-0 text-[10px] sm:inline-flex">
            {getRoleLabel(member.role)}
          </Badge>
          {member.teamName && (
            <Badge variant="outline" className="hidden py-0 text-[10px] md:inline-flex">
              {member.teamName}
            </Badge>
          )}
        </div>
        <p className="truncate text-[11px] text-muted-foreground">
          {member.email ?? "no email"}
          {manager ? ` · reports to ${manager.name}` : " · no reporting manager"}
        </p>
      </div>
      {decision && <AccessBadge decision={decision} />}
    </div>
  );
}

export function AgentAccessView({ authFetch, hierarchyTree }: AgentAccessViewProps) {
  const [agents, setAgents] = useState<AgentRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [policyFilter, setPolicyFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [selectedAgentKey, setSelectedAgentKey] = useState<string | null>(null);
  const [grantOpen, setGrantOpen] = useState(false);
  const hasFetched = useRef(false);

  const loadAgents = useCallback(
    async (showSpinner = true) => {
      if (showSpinner) setLoading(true);
      try {
        const [voiceRes, chatRes, whatsappRes] = await Promise.allSettled([
          authFetch("/api/v1/workflow/fetch"),
          authFetch("/api/v1/chat/agents"),
          authFetch("/api/v1/whatsapp/agents"),
        ]);

        const allRecords: AgentRecord[] = [];

        if (voiceRes.status === "fulfilled" && voiceRes.value.ok) {
          const voiceData: unknown = await voiceRes.value.json().catch(() => []);
          if (Array.isArray(voiceData)) {
            allRecords.push(
              ...voiceData
                .map(toVoiceAgentRecord)
                .filter((record): record is AgentRecord => record !== null)
            );
          }
        }

        if (chatRes.status === "fulfilled" && chatRes.value.ok) {
          const chatData: unknown = await chatRes.value.json().catch(() => []);
          if (Array.isArray(chatData)) {
            allRecords.push(
              ...chatData
                .map(toChatAgentRecord)
                .filter((record): record is AgentRecord => record !== null)
            );
          }
        }

        if (whatsappRes.status === "fulfilled" && whatsappRes.value.ok) {
          const whatsappData: unknown = await whatsappRes.value.json().catch(() => []);
          if (Array.isArray(whatsappData)) {
            allRecords.push(
              ...whatsappData
                .map(toWhatsAppAgentRecord)
                .filter((record): record is AgentRecord => record !== null)
            );
          }
        }

        setAgents(allRecords);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load agents.");
      } finally {
        setLoading(false);
      }
    },
    [authFetch]
  );

  useEffect(() => {
    if (hasFetched.current) return;
    hasFetched.current = true;
    void loadAgents();
  }, [loadAgents]);

  const members = useMemo(() => collectOrgMembers(hierarchyTree), [hierarchyTree]);
  const memberById = useMemo(
    () => new Map(members.map((member) => [member.userId, member])),
    [members]
  );

  const rows = useMemo<AgentRow[]>(
    () =>
      agents.map((agent) => {
        const matrix = computeAccessMatrix(
          agent.utilization_type,
          agent.created_by_user_id,
          members,
          agent.private_allowed_user_ids
        );
        let explicitGrantCount = 0;
        for (const decision of matrix.values()) {
          if (decision.granted && decision.source === "explicit") explicitGrantCount += 1;
        }
        const accessible = accessibleUsersLabel(agent.utilization_type, matrix);
        return {
          ...agent,
          creator:
            agent.created_by_user_id === null
              ? null
              : memberById.get(agent.created_by_user_id) ?? null,
          matrix,
          accessibleCount: accessible.total,
          accessibleLabel: accessible.label,
          explicitGrantCount,
          accessStatus: accessStatusOf(agent.utilization_type),
        };
      }),
    [agents, members, memberById]
  );

  const stats = useMemo(
    () => ({
      total: rows.length,
      public: rows.filter((row) => normalizePolicy(row.utilization_type) === "public").length,
      private: rows.filter((row) => normalizePolicy(row.utilization_type) === "private").length,
      internal: rows.filter((row) => normalizePolicy(row.utilization_type) === "closed").length,
    }),
    [rows]
  );

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return rows
      .filter((row) => {
        if (
          term &&
          !row.name.toLowerCase().includes(term) &&
          !(row.creator?.name.toLowerCase().includes(term) ?? false)
        ) {
          return false;
        }
        if (typeFilter !== "all" && row.agent_type !== typeFilter) {
          return false;
        }
        if (policyFilter !== "all" && normalizePolicy(row.utilization_type) !== policyFilter) {
          return false;
        }
        if (statusFilter !== "all" && row.accessStatus !== statusFilter) return false;
        return true;
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [rows, search, typeFilter, policyFilter, statusFilter]);

  const { pageItems, page, totalPages, totalCount, setPage } = usePagination(filtered, PAGE_SIZE);

  const selectedAgent = useMemo(
    () => rows.find((row) => row.key === selectedAgentKey) ?? null,
    [rows, selectedAgentKey]
  );


  const applyPolicy = useCallback(
    async (agentId: number, policy: AgentUtilization, allowedUserIds?: number[]) => {
      const res = await authFetch(`/api/v1/workflow/${agentId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          allowedUserIds === undefined
            ? { utilization_type: policy }
            : { utilization_type: policy, private_allowed_user_ids: allowedUserIds }
        ),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(detailFromError(err, "Failed to update agent access."));
      }
      await loadAgents(false);
    },
    [authFetch, loadAgents]
  );

  const handleRefresh = useCallback(() => {
    void loadAgents();
  }, [loadAgents]);

  const breadcrumbs = useMemo<Breadcrumb[]>(() => {
    return [
      { label: "Teams", href: "/teams?tab=hierarchy" },
      { label: "Agent Access" },
    ];
  }, []);

  const headerActions = useMemo(
    () => (
      <div className="flex items-center gap-2">
        <div className="relative w-40 sm:w-48 lg:w-56">
          <Search className="size-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search agents or creators…"
            aria-label="Search agents"
            className="h-8 pl-8 text-xs rounded-xl border-border/70 bg-muted/30"
          />
        </div>
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="h-8 w-32 sm:w-34 text-xs rounded-xl border-border/70 bg-muted/30 font-medium" aria-label="Filter by agent type">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All agent types</SelectItem>
            <SelectItem value="voice">Voice Agents</SelectItem>
            <SelectItem value="chat">Chat Agents</SelectItem>
            <SelectItem value="whatsapp">WhatsApp Agents</SelectItem>
          </SelectContent>
        </Select>
        <Select value={policyFilter} onValueChange={setPolicyFilter}>
          <SelectTrigger className="h-8 w-30 sm:w-32 text-xs rounded-xl border-border/70 bg-muted/30 font-medium" aria-label="Filter by utilisation">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All utilisation</SelectItem>
            {POLICY_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="h-8 w-34 sm:w-38 text-xs rounded-xl border-border/70 bg-muted/30 font-medium" aria-label="Filter by access status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All access statuses</SelectItem>
            <SelectItem value="granted">Granted (org-wide)</SelectItem>
            <SelectItem value="restricted">Restricted (scoped)</SelectItem>
          </SelectContent>
        </Select>
      </div>
    ),
    [search, typeFilter, policyFilter, statusFilter]
  );

  return (
    <div className="space-y-4">
      <PageHeader
        title="Agent Access"
        breadcrumbs={breadcrumbs}
        actions={headerActions}
      />

      {/* Access overview */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Total Agents" value={stats.total} />
        <StatTile label="Public Agents" value={stats.public} />
        <StatTile label="Private Agents" value={stats.private} />
        <StatTile label="Internal Agents" value={stats.internal} />
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-destructive/20 bg-destructive/10 p-4 text-xs text-destructive">
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Agent access table */}
      <Card className="overflow-hidden rounded-xl border border-border shadow-surface">
        <CardHeader className="border-b border-border/50 bg-muted/15 px-5 py-3.5">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <CardTitle className="flex items-center gap-2 text-sm font-semibold">
                <KeyRound className="size-4 text-primary" />
                Agent access
              </CardTitle>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Access is derived from each agent&apos;s utilisation policy and the reporting
                hierarchy.
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Button
                variant="outline"
                size="sm"
                onClick={handleRefresh}
                disabled={loading}
                className="size-8 p-0 cursor-pointer rounded-xl border-border/70 shadow-xs"
                title="Refresh"
                aria-label="Refresh"
              >
                <RefreshCw className={cn("size-3.5", loading && "animate-spin")} />
              </Button>
              <Button
                size="sm"
                onClick={() => setGrantOpen(true)}
                disabled={rows.length === 0}
                className="h-8 text-xs gap-1.5 cursor-pointer rounded-xl shadow-xs"
              >
                <UserPlus className="size-3.5" />
                Grant Access
              </Button>
            </div>
          </div>
        </CardHeader>

        <CardContent className="p-0">
          {loading ? (
            <div className="space-y-2 p-4">
              {[1, 2, 3].map((index) => (
                <div key={index} className="h-12 animate-pulse rounded-lg bg-muted/40" />
              ))}
            </div>
          ) : totalCount === 0 ? (
            <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
              <span className="grid size-10 place-items-center rounded-xl border border-border bg-muted/30 text-muted-foreground">
                <KeyRound className="size-5" />
              </span>
              <p className="text-sm font-medium text-foreground">
                {rows.length === 0 ? "No agents yet" : "No agents match your filters"}
              </p>
              <p className="max-w-md text-xs text-muted-foreground">
                {rows.length === 0
                  ? "Create an agent first — its utilisation policy determines who can view and use it."
                  : "Adjust the search or filters to see more agents."}
              </p>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Agent</TableHead>
                      <TableHead className="hidden sm:table-cell">Type</TableHead>
                      <TableHead className="hidden md:table-cell">Creator</TableHead>
                      <TableHead>Utilisation</TableHead>
                      <TableHead>Usage</TableHead>
                      <TableHead className="hidden md:table-cell">Accessible users</TableHead>
                      <TableHead className="hidden sm:table-cell">Access status</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pageItems.map((row) => {
                      const policy = normalizePolicy(row.utilization_type);
                      const isPublic = policy === "public";
                      const isPrivate = policy === "private";

                      return (
                        <TableRow
                          key={row.key}
                          onClick={() => {
                            if (isPublic) return; // Public agents do not open an Off-Canvas or panel
                            setTimeout(() => setSelectedAgentKey(row.key), 0);
                          }}
                          className={cn(
                            isPublic
                              ? "cursor-default hover:bg-muted/30"
                              : "cursor-pointer hover:bg-muted/50"
                          )}
                        >
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <span className="truncate text-xs font-semibold text-foreground">
                                {row.name}
                              </span>
                              <Badge variant="secondary" className="py-0 text-[10px]">
                                {row.status}
                              </Badge>
                            </div>
                          </TableCell>
                          <TableCell className="hidden sm:table-cell">
                            {row.agent_type === "voice" ? (
                              <Badge variant="outline" className="gap-1 py-0 text-[10px] text-sky-600 border-sky-200 bg-sky-50 dark:bg-sky-950/30 dark:border-sky-800 dark:text-sky-400">
                                <Mic className="size-3" /> Voice
                              </Badge>
                            ) : row.agent_type === "chat" ? (
                              <Badge variant="outline" className="gap-1 py-0 text-[10px] text-emerald-600 border-emerald-200 bg-emerald-50 dark:bg-emerald-950/30 dark:border-emerald-800 dark:text-emerald-400">
                                <MessageSquare className="size-3" /> Chat
                              </Badge>
                            ) : (
                              <Badge variant="outline" className="gap-1 py-0 text-[10px] text-emerald-700 border-emerald-300 bg-emerald-50 dark:bg-emerald-950/30 dark:border-emerald-700 dark:text-emerald-300">
                                <MessageCircle className="size-3" /> WhatsApp
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell className="hidden md:table-cell">
                            {row.creator ? (
                              <span className="flex items-center gap-2">
                                <MemberAvatar member={row.creator} />
                                <span className="truncate text-xs">{row.creator.name}</span>
                              </span>
                            ) : (
                              <span className="text-xs text-muted-foreground">No creator recorded</span>
                            )}
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant={policyBadgeVariant(row.utilization_type)}
                              className="text-[10px]"
                              title={policyDescription(row.utilization_type)}
                            >
                              {policyLabel(row.utilization_type)}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <span className="text-xs text-muted-foreground tabular-nums">
                              {row.total_runs} {row.total_runs === 1 ? "run" : "runs"}
                            </span>
                          </TableCell>
                          <TableCell className="hidden md:table-cell">
                            <span className="text-xs tabular-nums">
                              {row.accessibleLabel}
                              <span className="text-muted-foreground"> / {members.length}</span>
                            </span>
                          </TableCell>
                          <TableCell className="hidden sm:table-cell">
                            {row.accessStatus === "granted" ? (
                              <Badge variant="success" className="gap-1 text-[10px]">
                                <ShieldCheck className="size-3" />
                                Granted
                              </Badge>
                            ) : (
                              <Badge
                                variant="secondary"
                                className="gap-1 text-[10px]"
                                title={
                                  isPrivate
                                    ? `Private (Creator & Selected Members) — ${row.explicitGrantCount} explicitly granted`
                                    : "Internal — creator and reporting descendants only"
                                }
                              >
                                <Lock className="size-3" />
                                Restricted
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-right" onClick={(event) => event.stopPropagation()}>
                            {isPublic ? (
                              <span
                                className="text-xs text-muted-foreground px-2 py-1 select-none"
                                title="Public agents are accessible to all organization members and do not require individual access management"
                              >
                                —
                              </span>
                            ) : isPrivate ? (
                              <Button
                                variant={row.is_creator ? "outline" : "ghost"}
                                size="sm"
                                className="text-xs h-8"
                                onClick={() => {
                                  setTimeout(() => setSelectedAgentKey(row.key), 0);
                                }}
                              >
                                {row.is_creator ? "Manage Access" : "View Access"}
                              </Button>
                            ) : (
                              <Button
                                variant="outline"
                                size="sm"
                                className="text-xs h-8"
                                onClick={() => {
                                  setTimeout(() => setSelectedAgentKey(row.key), 0);
                                }}
                              >
                                {row.is_creator ? "Manage Scope" : "View Scope"}
                              </Button>
                            )}
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
                totalCount={totalCount}
                setPage={setPage}
              />
            </>
          )}
        </CardContent>
      </Card>

      <AgentDetailsSheet
        agent={selectedAgent}
        open={Boolean(selectedAgent)}
        members={members}
        memberById={memberById}
        authFetch={authFetch}
        onClose={() => {
          setSelectedAgentKey(null);
          document.body.style.pointerEvents = "";
          document.body.removeAttribute("data-scroll-locked");
        }}
        onApply={applyPolicy}
        onApplyGrants={(agentId, allowedUserIds) =>
          applyPolicy(agentId, "private", allowedUserIds)
        }
      />

      <GrantAccessSheet
        open={grantOpen}
        rows={rows}
        members={members}
        authFetch={authFetch}
        initialAgentId={selectedAgent?.id ?? null}
        onClose={() => {
          setGrantOpen(false);
          document.body.style.pointerEvents = "";
          document.body.removeAttribute("data-scroll-locked");
        }}
        onApply={applyPolicy}
        onApplyGrants={(agentId, allowedUserIds) =>
          applyPolicy(agentId, "private", allowedUserIds)
        }
      />
    </div>
  );
}

function AgentDetailsSheet({
  agent,
  open,
  members,
  memberById,
  authFetch,
  onClose,
  onApply,
  onApplyGrants,
}: {
  agent: AgentRow | null;
  open: boolean;
  members: OrgMember[];
  memberById: Map<number, OrgMember>;
  authFetch: (path: string, init?: RequestInit) => Promise<Response>;
  onClose: () => void;
  onApply: (agentId: number, policy: AgentUtilization) => Promise<void>;
  onApplyGrants: (agentId: number, allowedUserIds: number[]) => Promise<void>;
}) {
  const activeAgentRef = useRef<AgentRow | null>(agent);
  if (agent) {
    activeAgentRef.current = agent;
  }
  const displayAgent = agent ?? activeAgentRef.current;

  const [pendingPolicy, setPendingPolicy] = useState<AgentUtilization>(
    displayAgent ? normalizePolicy(displayAgent.utilization_type) : "private"
  );
  const [saving, setSaving] = useState(false);
  const [revokingUserId, setRevokingUserId] = useState<number | null>(null);
  const [grantableMembers, setGrantableMembers] = useState<OrgMember[]>(members);
  const [grantableLoading, setGrantableLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedNewUserIds, setSelectedNewUserIds] = useState<number[]>([]);
  const [activeDetailsTab, setActiveDetailsTab] = useState<string>("info");

  useEffect(() => {
    if (displayAgent) {
      setPendingPolicy(normalizePolicy(displayAgent.utilization_type));
      setSelectedNewUserIds([]);
      setSearchQuery("");
      setActiveDetailsTab("info");
    }
  }, [displayAgent]);

  // If creator opens a private agent, fetch freshest grantable members for this organization
  useEffect(() => {
    if (!displayAgent || !displayAgent.is_creator || normalizePolicy(displayAgent.utilization_type) !== "private") {
      setGrantableMembers(members);
      return;
    }

    let active = true;
    setGrantableLoading(true);
    void (async () => {
      try {
        const response = await authFetch(`/api/v1/workflow/${displayAgent.id}/grantable-users`);
        if (!response.ok) {
          throw new Error("Failed to load grantable members");
        }
        const options = parseOrgMembers(await response.json());
        if (active && options.length > 0) {
          setGrantableMembers(options);
        }
      } catch {
        if (active) setGrantableMembers(members);
      } finally {
        if (active) setGrantableLoading(false);
      }
    })();

    return () => {
      active = false;
    };
  }, [displayAgent, authFetch, members]);

  useEffect(() => {
    return () => {
      document.body.style.pointerEvents = "";
      document.body.removeAttribute("data-scroll-locked");
      document.body.style.overflow = "";
      document.body.style.paddingRight = "";
    };
  }, []);

  const handleOpenChange = (isOpen: boolean) => {
    if (!isOpen) {
      onClose();
      document.body.style.pointerEvents = "";
      document.body.removeAttribute("data-scroll-locked");
      document.body.style.overflow = "";
      document.body.style.paddingRight = "";
    }
  };

  if (!displayAgent) {
    return null;
  }

  const isCreator = displayAgent.is_creator;
  const policy = normalizePolicy(displayAgent.utilization_type);
  const isPrivate = policy === "private";
  const isInternal = policy === "closed";
  const isPublic = policy === "public";
  const policyChanged = pendingPolicy !== policy;

  const grantableMemberById = new Map(grantableMembers.map((m) => [m.userId, m]));
  const currentGrantIds = displayAgent.private_allowed_user_ids ?? [];
  const creatorId = displayAgent.created_by_user_id;

  // Resolve members who currently have explicit access (creator handled separately)
  const explicitlyGrantedMembers = currentGrantIds.map((uid) => {
    return (
      grantableMemberById.get(uid) ??
      memberById.get(uid) ?? {
        userId: uid,
        name: `User #${uid}`,
        email: null,
        role: "member",
        teamName: null,
        parentUserId: null,
      }
    );
  });

  // Eligible ungranted members for this agent (strictly prevents duplicates and cross-org members)
  const ungrantedMembers = grantableMembers.filter(
    (m) => m.userId !== creatorId && !currentGrantIds.includes(m.userId)
  );

  const filteredUngranted = ungrantedMembers.filter((m) => {
    const term = searchQuery.trim().toLowerCase();
    if (!term) return true;
    return (
      m.name.toLowerCase().includes(term) ||
      Boolean(m.email?.toLowerCase().includes(term)) ||
      Boolean(m.teamName?.toLowerCase().includes(term))
    );
  });

  const handleRevoke = async (userId: number) => {
    if (!isCreator) return;
    setRevokingUserId(userId);
    try {
      const nextIds = currentGrantIds.filter((id) => id !== userId);
      await onApplyGrants(displayAgent.id, nextIds);
      toast.success("Access revoked successfully.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to revoke access.");
    } finally {
      setRevokingUserId(null);
    }
  };

  const handleToggleNewUser = (userId: number) => {
    setSelectedNewUserIds((prev) =>
      prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId]
    );
  };

  const handleGrantSelected = async () => {
    if (!isCreator || selectedNewUserIds.length === 0) return;
    setSaving(true);
    try {
      const nextIds = [...currentGrantIds, ...selectedNewUserIds];
      await onApplyGrants(displayAgent.id, nextIds);
      setSelectedNewUserIds([]);
      setSearchQuery("");
      toast.success(`Access granted to ${selectedNewUserIds.length} member(s).`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to grant access.");
    } finally {
      setSaving(false);
    }
  };

  const handleSavePolicy = async () => {
    if (!isCreator || !policyChanged) return;
    setSaving(true);
    try {
      await onApply(displayAgent.id, pendingPolicy);
      toast.success(`Utilisation updated to ${policyLabel(pendingPolicy)}.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update utilisation.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent side="right" className="flex flex-col h-full p-0 sm:max-w-2xl gap-0">
        {/* Accessible hidden header for screen readers */}
        <div className="sr-only">
          <SheetTitle>{displayAgent.name} Access Details</SheetTitle>
          <SheetDescription>{policyDescription(displayAgent.utilization_type)}</SheetDescription>
        </div>

        {/* Tabs Container - starts directly with the tabs */}
        <Tabs
          value={activeDetailsTab}
          onValueChange={setActiveDetailsTab}
          className="flex flex-col flex-1 overflow-hidden gap-0"
        >
          {/* Navigation Tab Bar starting directly at the top */}
          {isPrivate ? (
            <div className="border-b border-border bg-card shrink-0 px-6 pr-16">
              <nav className="flex items-center gap-4 sm:gap-5">
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeDetailsTab === "info"}
                  onClick={() => setActiveDetailsTab("info")}
                  className={cn(
                    "py-3 border-b-2 text-xs transition-colors cursor-pointer -mb-px whitespace-nowrap",
                    activeDetailsTab === "info"
                      ? "border-foreground text-foreground font-semibold"
                      : "border-transparent text-muted-foreground hover:text-foreground font-medium"
                  )}
                >
                  Agent Info
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeDetailsTab === "granted"}
                  onClick={() => setActiveDetailsTab("granted")}
                  className={cn(
                    "py-3 border-b-2 text-xs transition-colors cursor-pointer -mb-px whitespace-nowrap",
                    activeDetailsTab === "granted"
                      ? "border-foreground text-foreground font-semibold"
                      : "border-transparent text-muted-foreground hover:text-foreground font-medium"
                  )}
                >
                  Granted Members ({explicitlyGrantedMembers.length + (displayAgent.creator ? 1 : 0)})
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeDetailsTab === "grant"}
                  onClick={() => setActiveDetailsTab("grant")}
                  className={cn(
                    "py-3 border-b-2 text-xs transition-colors cursor-pointer -mb-px whitespace-nowrap",
                    activeDetailsTab === "grant"
                      ? "border-foreground text-foreground font-semibold"
                      : "border-transparent text-muted-foreground hover:text-foreground font-medium"
                  )}
                >
                  Grant Access ({ungrantedMembers.length})
                </button>
              </nav>
            </div>
          ) : isInternal ? (
            <div className="border-b border-border bg-card shrink-0 px-6 pr-16">
              <nav className="flex items-center gap-4 sm:gap-5">
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeDetailsTab === "info"}
                  onClick={() => setActiveDetailsTab("info")}
                  className={cn(
                    "py-3 border-b-2 text-xs transition-colors cursor-pointer -mb-px whitespace-nowrap",
                    activeDetailsTab === "info"
                      ? "border-foreground text-foreground font-semibold"
                      : "border-transparent text-muted-foreground hover:text-foreground font-medium"
                  )}
                >
                  Agent Info
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeDetailsTab === "branch"}
                  onClick={() => setActiveDetailsTab("branch")}
                  className={cn(
                    "py-3 border-b-2 text-xs transition-colors cursor-pointer -mb-px whitespace-nowrap",
                    activeDetailsTab === "branch"
                      ? "border-foreground text-foreground font-semibold"
                      : "border-transparent text-muted-foreground hover:text-foreground font-medium"
                  )}
                >
                  Branch Scope
                </button>
              </nav>
            </div>
          ) : null}

          {/* Scrollable Body for Tab Contents */}
          <div className="flex-1 overflow-y-auto px-6 py-5">
            {/* Tab 1: Agent Information */}
            <TabsContent value="info" className="space-y-5 outline-none m-0">
              <section className="space-y-2">
                <div className="space-y-0.5">
                  <h3 className="text-sm font-semibold text-foreground">
                    Agent Information
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    Basic configuration, execution stats, and creator details.
                  </p>
                </div>
                <div className="rounded-xl border border-border overflow-hidden bg-card shadow-xs">
                  <table className="w-full text-xs border-collapse">
                    <tbody>
                      <tr className="border-b border-border/70">
                        <td className="w-1/3 py-2.5 px-3.5 font-medium text-muted-foreground bg-muted/20">
                          Status
                        </td>
                        <td className="w-2/3 py-2.5 px-3.5">
                          <Badge variant="secondary" className="capitalize text-[10px]">
                            {displayAgent.status}
                          </Badge>
                        </td>
                      </tr>
                      <tr className="border-b border-border/70">
                        <td className="w-1/3 py-2.5 px-3.5 font-medium text-muted-foreground bg-muted/20">
                          Usage
                        </td>
                        <td className="w-2/3 py-2.5 px-3.5 tabular-nums text-foreground font-medium">
                          {displayAgent.total_runs} {displayAgent.total_runs === 1 ? "run" : "runs"}
                        </td>
                      </tr>
                      <tr className="border-b border-border/70">
                        <td className="w-1/3 py-2.5 px-3.5 font-medium text-muted-foreground bg-muted/20">
                          Created Date
                        </td>
                        <td className="w-2/3 py-2.5 px-3.5 text-foreground">
                          {formatDate(displayAgent.created_at)}
                        </td>
                      </tr>
                      <tr className="border-b border-border/70">
                        <td className="w-1/3 py-2.5 px-3.5 font-medium text-muted-foreground bg-muted/20">
                          Utilisation
                        </td>
                        <td className="w-2/3 py-2.5 px-3.5">
                          <Badge variant={policyBadgeVariant(displayAgent.utilization_type)} className="text-[10px]">
                            {policyLabel(displayAgent.utilization_type)}
                          </Badge>
                        </td>
                      </tr>
                      <tr>
                        <td className="w-1/3 py-2.5 px-3.5 font-medium text-muted-foreground bg-muted/20 align-top">
                          Creator Details
                        </td>
                        <td className="w-2/3 py-2.5 px-3.5">
                          {displayAgent.creator ? (
                            <div className="flex items-center gap-2.5">
                              <MemberAvatar member={displayAgent.creator} />
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  <span className="font-semibold text-foreground text-xs">
                                    {displayAgent.creator.name}
                                  </span>
                                  <Badge variant="violet" className="py-0 text-[10px]">
                                    Creator &amp; Owner
                                  </Badge>
                                  <Badge variant="secondary" className="py-0 text-[10px]">
                                    {getRoleLabel(displayAgent.creator.role)}
                                  </Badge>
                                </div>
                                <p className="text-[11px] text-muted-foreground truncate">
                                  {displayAgent.creator.email ?? "No email"}
                                  {displayAgent.creator.teamName ? ` · ${displayAgent.creator.teamName}` : ""}
                                </p>
                              </div>
                            </div>
                          ) : (
                            <span className="text-muted-foreground">No creator recorded</span>
                          )}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </section>

              {/* Utilisation Policy Changer */}
              <section className="space-y-2 border-t border-border/60 pt-4">
                <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                  Utilisation Policy
                </h3>
                <p className="text-xs text-muted-foreground">
                  Controls who can view and execute this agent across the organization.
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <Select
                    value={pendingPolicy}
                    onValueChange={(value) => setPendingPolicy(value as AgentUtilization)}
                    disabled={!isCreator || saving}
                  >
                    <SelectTrigger className="h-9 w-44 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {POLICY_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button size="sm" onClick={handleSavePolicy} disabled={!isCreator || !policyChanged || saving}>
                    {saving ? "Saving…" : "Apply Policy"}
                  </Button>
                  {!isCreator && (
                    <span className="text-[11px] text-muted-foreground">
                      Only the agent creator can change its utilisation.
                    </span>
                  )}
                </div>
              </section>

              {isPublic && (
                <div className="rounded-lg border border-border bg-card p-4 space-y-2">
                  <h3 className="text-xs font-semibold text-foreground flex items-center gap-2">
                    <Users className="size-4 text-primary" />
                    Public Agent Access
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    This agent has Public utilisation. Every member across the organization can view and execute it.
                    Individual member grants and revokes do not apply.
                  </p>
                </div>
              )}
            </TabsContent>

            {/* Tab 2: Granted Members (Private) */}
            {isPrivate && (
              <TabsContent value="granted" className="space-y-4 outline-none m-0">
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <h3 className="text-sm font-semibold text-foreground">
                      Granted Organization Members ({explicitlyGrantedMembers.length + (displayAgent.creator ? 1 : 0)})
                    </h3>
                    <p className="text-xs text-muted-foreground">
                      Only the creator and explicitly granted organization members can view and execute this agent.
                    </p>
                  </div>
                  <Badge variant="outline" className="text-[10px] text-muted-foreground border-border">
                    Strict Private Policy
                  </Badge>
                </div>

                <div className="rounded-xl border border-border overflow-hidden bg-card shadow-xs">
                  <table className="w-full text-xs border-collapse">
                    <thead className="bg-muted/40 border-b border-border/80 text-muted-foreground">
                      <tr>
                        <th className="py-2.5 px-3.5 text-left font-medium">Member</th>
                        <th className="py-2.5 px-3.5 text-left font-medium">Role</th>
                        <th className="py-2.5 px-3.5 text-left font-medium">Team</th>
                        <th className="py-2.5 px-3.5 text-right font-medium">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {/* Creator is in the first row */}
                      {displayAgent.creator && (
                        <tr className="border-b border-border/60 bg-violet-500/5">
                          <td className="py-2.5 px-3.5">
                            <div className="flex items-center gap-2.5">
                              <MemberAvatar member={displayAgent.creator} />
                              <div className="min-w-0">
                                <div className="flex items-center gap-1.5">
                                  <span className="font-semibold text-foreground truncate">
                                    {displayAgent.creator.name}
                                  </span>
                                  <Badge variant="violet" className="py-0 text-[10px]">
                                    Creator
                                  </Badge>
                                </div>
                                <p className="text-[11px] text-muted-foreground truncate">
                                  {displayAgent.creator.email ?? "No email"}
                                </p>
                              </div>
                            </div>
                          </td>
                          <td className="py-2.5 px-3.5">
                            <Badge variant="secondary" className="text-[10px]">
                              {getRoleLabel(displayAgent.creator.role)}
                            </Badge>
                          </td>
                          <td className="py-2.5 px-3.5 text-muted-foreground">
                            {displayAgent.creator.teamName ?? "—"}
                          </td>
                          <td className="py-2.5 px-3.5 text-right">
                            <Badge variant="success" className="gap-1 text-[10px]">
                              <ShieldCheck className="size-3" />
                              Always Granted
                            </Badge>
                          </td>
                        </tr>
                      )}

                      {/* Explicitly granted members */}
                      {explicitlyGrantedMembers.map((member) => (
                        <tr key={member.userId} className="border-b border-border/60 last:border-b-0 hover:bg-muted/20">
                          <td className="py-2.5 px-3.5">
                            <div className="flex items-center gap-2.5">
                              <MemberAvatar member={member} />
                              <div className="min-w-0">
                                <span className="font-medium text-foreground block truncate">{member.name}</span>
                                <p className="text-[11px] text-muted-foreground truncate">{member.email ?? "No email"}</p>
                              </div>
                            </div>
                          </td>
                          <td className="py-2.5 px-3.5">
                            <Badge variant="secondary" className="text-[10px]">
                              {getRoleLabel(member.role)}
                            </Badge>
                          </td>
                          <td className="py-2.5 px-3.5 text-muted-foreground">
                            {member.teamName ?? "—"}
                          </td>
                          <td className="py-2.5 px-3.5 text-right">
                            <div className="inline-flex items-center justify-end gap-1.5">
                              <Badge variant="success" className="gap-1 text-[10px]">
                                <ShieldCheck className="size-3" />
                                Granted
                              </Badge>
                              {isCreator && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="text-destructive hover:bg-destructive/10 hover:text-destructive h-6 px-1.5 text-[11px] gap-1"
                                  onClick={() => handleRevoke(member.userId)}
                                  disabled={saving || revokingUserId === member.userId}
                                  title="Revoke access"
                                >
                                  <UserMinus className="size-3" />
                                  Revoke
                                </Button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>

                  {/* Empty state below table */}
                  {explicitlyGrantedMembers.length === 0 && (
                    <div className="py-3 px-4 text-center text-xs text-muted-foreground border-t border-border/60 bg-muted/10">
                      No additional members
                    </div>
                  )}
                </div>
              </TabsContent>
            )}

            {/* Tab 3: Grant Access (Private) */}
            {isPrivate && (
              <TabsContent value="grant" className="space-y-4 outline-none m-0">
                {isCreator ? (
                  <>
                    <div className="flex items-center justify-between">
                      <div className="space-y-0.5">
                        <h3 className="text-sm font-semibold text-foreground">
                          Grant Access to Additional Members
                        </h3>
                        <p className="text-xs text-muted-foreground">
                          Select organization members to grant execution permission. Duplicate grants are prevented.
                        </p>
                      </div>
                      <Badge variant="outline" className="text-[10px] text-muted-foreground border-border">
                        {ungrantedMembers.length} eligible
                      </Badge>
                    </div>

                    {/* Search bar */}
                    <div className="relative">
                      <Input
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="Search ungranted members..."
                        className="h-8 text-xs rounded-lg"
                      />
                    </div>

                    {/* Table */}
                    <div className="rounded-xl border border-border overflow-hidden bg-card shadow-xs">
                      <table className="w-full text-xs border-collapse">
                        <thead className="bg-muted/40 border-b border-border/80 text-muted-foreground">
                          <tr>
                            <th className="w-10 py-2.5 px-3.5 text-center">
                              <Checkbox
                                checked={
                                  filteredUngranted.length > 0 &&
                                  filteredUngranted.every((m) => selectedNewUserIds.includes(m.userId))
                                }
                                onCheckedChange={(checked) => {
                                  if (checked) {
                                    const toAdd = filteredUngranted.map((m) => m.userId);
                                    setSelectedNewUserIds((prev) => Array.from(new Set([...prev, ...toAdd])));
                                  } else {
                                    const toRemove = new Set(filteredUngranted.map((m) => m.userId));
                                    setSelectedNewUserIds((prev) => prev.filter((id) => !toRemove.has(id)));
                                  }
                                }}
                                aria-label="Select all ungranted members"
                              />
                            </th>
                            <th className="py-2.5 px-3.5 text-left font-medium">Member</th>
                            <th className="py-2.5 px-3.5 text-left font-medium">Role</th>
                            <th className="py-2.5 px-3.5 text-left font-medium">Team</th>
                          </tr>
                        </thead>
                        <tbody>
                          {grantableLoading ? (
                            <tr>
                              <td colSpan={4} className="py-4 px-3.5 text-center text-muted-foreground">
                                Loading members…
                              </td>
                            </tr>
                          ) : filteredUngranted.length === 0 ? (
                            <tr>
                              <td colSpan={4} className="py-4 px-3.5 text-center text-muted-foreground">
                                {ungrantedMembers.length === 0
                                  ? "All organization members currently have access."
                                  : "No members match your search."}
                              </td>
                            </tr>
                          ) : (
                            filteredUngranted.map((member) => {
                              const isSelected = selectedNewUserIds.includes(member.userId);
                              return (
                                <tr
                                  key={member.userId}
                                  onClick={() => handleToggleNewUser(member.userId)}
                                  className={cn(
                                    "border-b border-border/60 last:border-b-0 cursor-pointer transition-colors",
                                    isSelected ? "bg-primary/5" : "hover:bg-muted/20"
                                  )}
                                >
                                  <td className="w-10 py-2.5 px-3.5 text-center" onClick={(e) => e.stopPropagation()}>
                                    <Checkbox
                                      checked={isSelected}
                                      onCheckedChange={() => handleToggleNewUser(member.userId)}
                                      aria-label={`Select ${member.name}`}
                                    />
                                  </td>
                                  <td className="py-2.5 px-3.5">
                                    <div className="flex items-center gap-2.5">
                                      <MemberAvatar member={member} />
                                      <div className="min-w-0">
                                        <span className="font-medium text-foreground block truncate">{member.name}</span>
                                        <p className="text-[11px] text-muted-foreground truncate">{member.email ?? "No email"}</p>
                                      </div>
                                    </div>
                                  </td>
                                  <td className="py-2.5 px-3.5">
                                    <Badge variant="secondary" className="text-[10px]">
                                      {getRoleLabel(member.role)}
                                    </Badge>
                                  </td>
                                  <td className="py-2.5 px-3.5 text-muted-foreground">
                                    {member.teamName ?? "—"}
                                  </td>
                                </tr>
                              );
                            })
                          )}
                        </tbody>
                      </table>
                    </div>

                    {/* Aligned neatly below this table: Policy Dropdown and Grant Access button */}
                    <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-border/60">
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] text-muted-foreground font-medium">Policy:</span>
                        <Select
                          value={pendingPolicy}
                          onValueChange={(value) => setPendingPolicy(value as AgentUtilization)}
                          disabled={!isCreator || saving}
                        >
                          <SelectTrigger className="h-8 w-36 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {POLICY_OPTIONS.map((option) => (
                              <SelectItem key={option.value} value={option.value}>
                                {option.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {policyChanged && (
                          <Button size="sm" variant="outline" className="h-8 text-xs" onClick={handleSavePolicy} disabled={saving}>
                            {saving ? "Saving…" : "Apply Policy"}
                          </Button>
                        )}
                      </div>

                      <div className="flex items-center gap-2">
                        {selectedNewUserIds.length > 0 && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setSelectedNewUserIds([])}
                            disabled={saving}
                            className="h-8 text-xs text-muted-foreground"
                          >
                            Clear
                          </Button>
                        )}
                        <Button
                          size="sm"
                          onClick={handleGrantSelected}
                          disabled={selectedNewUserIds.length === 0 || saving}
                          className="h-8 text-xs gap-1.5"
                        >
                          <UserPlus className="size-3.5" />
                          Grant Access ({selectedNewUserIds.length})
                        </Button>
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="flex items-center gap-2 rounded-lg border border-amber-500/20 bg-amber-500/10 p-3 text-xs text-amber-500">
                    <Lock className="size-4 shrink-0" />
                    <span>
                      Only the agent creator ({displayAgent.creator?.name ?? "Creator"}) can grant or revoke access.
                    </span>
                  </div>
                )}
              </TabsContent>
            )}

            {/* Tab: Branch Scope (Internal) */}
            {isInternal && (
              <TabsContent value="branch" className="space-y-3 outline-none m-0">
                <div className="space-y-0.5">
                  <h3 className="text-sm font-semibold text-foreground">
                    Reporting Branch Scope
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    Internal utilisation grants access strictly along the creator&apos;s reporting branch.
                    The creator and all team members below them in the hierarchy automatically inherit access.
                  </p>
                </div>
                <div className="rounded-xl border border-border overflow-hidden bg-card shadow-xs">
                  <table className="w-full text-xs border-collapse">
                    <thead className="bg-muted/40 border-b border-border/80 text-muted-foreground">
                      <tr>
                        <th className="py-2.5 px-3.5 text-left font-medium">Member</th>
                        <th className="py-2.5 px-3.5 text-left font-medium">Role</th>
                        <th className="py-2.5 px-3.5 text-right font-medium">Access</th>
                      </tr>
                    </thead>
                    <tbody>
                      {displayAgent.creator && (
                        <tr className="border-b border-border/60 bg-violet-500/5">
                          <td className="py-2.5 px-3.5">
                            <div className="flex items-center gap-2.5">
                              <MemberAvatar member={displayAgent.creator} />
                              <div className="min-w-0">
                                <span className="font-semibold text-foreground block truncate">{displayAgent.creator.name}</span>
                                <p className="text-[11px] text-muted-foreground truncate">{displayAgent.creator.email ?? "No email"}</p>
                              </div>
                            </div>
                          </td>
                          <td className="py-2.5 px-3.5">
                            <Badge variant="violet" className="text-[10px]">Branch Root</Badge>
                          </td>
                          <td className="py-2.5 px-3.5 text-right">
                            <Badge variant="success" className="gap-1 text-[10px]">
                              <ShieldCheck className="size-3" /> Root
                            </Badge>
                          </td>
                        </tr>
                      )}
                      {members
                        .filter((m) => m.userId !== creatorId && displayAgent.matrix.get(m.userId)?.granted)
                        .map((member) => (
                          <tr key={member.userId} className="border-b border-border/60 last:border-b-0">
                            <td className="py-2.5 px-3.5">
                              <div className="flex items-center gap-2.5">
                                <MemberAvatar member={member} />
                                <div className="min-w-0">
                                  <span className="font-medium text-foreground block truncate">{member.name}</span>
                                  <p className="text-[11px] text-muted-foreground truncate">{member.email ?? "No email"}</p>
                                </div>
                              </div>
                            </td>
                            <td className="py-2.5 px-3.5">
                              <Badge variant="secondary" className="text-[10px]">
                                {getRoleLabel(member.role)}
                              </Badge>
                            </td>
                            <td className="py-2.5 px-3.5 text-right">
                              <Badge variant="success" className="gap-1 text-[10px]">
                                <ShieldCheck className="size-3" /> Inherited
                              </Badge>
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </TabsContent>
            )}
          </div>
        </Tabs>

        {/* Fixed Footer */}
        <SheetFooter className="px-6 py-3 border-t border-border shrink-0 bg-card/95 backdrop-blur-xs flex sm:flex-row items-center justify-between gap-3 sm:justify-between">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>Current Utilisation:</span>
            <Badge variant={policyBadgeVariant(displayAgent.utilization_type)} className="text-[10px]">
              {policyLabel(displayAgent.utilization_type)}
            </Badge>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={onClose} className="h-8 text-xs cursor-pointer">
              Cancel
            </Button>
            {isPrivate && isCreator && activeDetailsTab === "grant" && selectedNewUserIds.length > 0 ? (
              <Button
                size="sm"
                onClick={handleGrantSelected}
                disabled={saving}
                className="h-8 text-xs gap-1.5 cursor-pointer shadow-xs"
              >
                <UserPlus className="size-3.5" />
                Grant Access ({selectedNewUserIds.length})
              </Button>
            ) : (
              <Button size="sm" onClick={onClose} className="h-8 text-xs cursor-pointer">
                Done
              </Button>
            )}
          </div>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

function GrantAccessSheet({
  open,
  rows,
  members,
  authFetch,
  initialAgentId,
  onClose,
  onApply,
  onApplyGrants,
}: {
  open: boolean;
  rows: AgentRow[];
  members: OrgMember[];
  authFetch: (path: string, init?: RequestInit) => Promise<Response>;
  initialAgentId: number | null;
  onClose: () => void;
  onApply: (agentId: number, policy: AgentUtilization) => Promise<void>;
  onApplyGrants: (agentId: number, allowedUserIds: number[]) => Promise<void>;
}) {
  const [agentId, setAgentId] = useState<number | null>(initialAgentId ?? rows[0]?.id ?? null);
  const [selection, setSelection] = useState<number[]>([]);
  const [grantMembers, setGrantMembers] = useState<OrgMember[]>(members);
  const [grantMembersLoading, setGrantMembersLoading] = useState(false);
  const [grantMembersError, setGrantMembersError] = useState<string | null>(null);
  const [memberSearch, setMemberSearch] = useState("");
  const [saving, setSaving] = useState(false);

  const agent = rows.find((row) => row.id === agentId) ?? null;
  const isPrivate = Boolean(agent && normalizePolicy(agent.utilization_type) === "private");
  const isCreator = Boolean(agent?.is_creator);

  // Fetch the whole organization directory only through the creator-only
  // workflow endpoint. The Teams API remains scoped to the caller's team.
  useEffect(() => {
    if (!agent || !isCreator) {
      setGrantMembers(members);
      setSelection([]);
      setGrantMembersError(null);
      return;
    }

    let active = true;
    setGrantMembersLoading(true);
    setGrantMembersError(null);
    void (async () => {
      try {
        const response = await authFetch(`/api/v1/workflow/${agent.id}/grantable-users`);
        if (!response.ok) {
          const error = await response.json().catch(() => ({}));
          throw new Error(detailFromError(error, "Failed to load grantable members."));
        }
        const options = parseOrgMembers(await response.json());
        if (!active) return;
        setGrantMembers(options);
        setSelection(
          normalizePolicy(agent.utilization_type) === "private"
            ? grantsForSelection(agent.created_by_user_id, options, agent.private_allowed_user_ids ?? [])
            : []
        );
      } catch (error) {
        if (!active) return;
        setGrantMembersError(error instanceof Error ? error.message : "Failed to load grantable members.");
        setGrantMembers(members);
        setSelection([]);
      } finally {
        if (active) setGrantMembersLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [agent, authFetch, isCreator, members]);

  const filteredMembers = useMemo(() => {
    const term = memberSearch.trim().toLowerCase();
    if (!term) return grantMembers;
    return grantMembers.filter(
      (member) =>
        member.name.toLowerCase().includes(term) ||
        Boolean(member.email?.toLowerCase().includes(term)) ||
        Boolean(member.teamName?.toLowerCase().includes(term))
    );
  }, [grantMembers, memberSearch]);

  const grantMemberById = useMemo(
    () => new Map(grantMembers.map((member) => [member.userId, member])),
    [grantMembers]
  );

  const grantMatrix = useMemo(
    () =>
      agent
        ? computeAccessMatrix(
            agent.utilization_type,
            agent.created_by_user_id,
            grantMembers,
            agent.private_allowed_user_ids ?? []
          )
        : new Map<number, AccessDecision>(),
    [agent, grantMembers]
  );

  const recommended = useMemo(
    () =>
      agent ? recommendPolicyForTargets(grantMembers, agent.created_by_user_id, selection) : null,
    [agent, grantMembers, selection]
  );

  const alreadyCovered = useMemo(
    () => selection.every((userId) => grantMatrix.get(userId)?.granted),
    [grantMatrix, selection]
  );

  const existingGrants = useMemo(
    () =>
      agent
        ? grantsForSelection(
            agent.created_by_user_id,
            grantMembers,
            agent.private_allowed_user_ids ?? []
          )
        : [],
    [agent, grantMembers]
  );

  const grantsDirty = useMemo(() => {
    if (!isPrivate) return false;
    const next = grantsForSelection(agent?.created_by_user_id, grantMembers, selection);
    return next.join(",") !== existingGrants.join(",");
  }, [isPrivate, agent, grantMembers, selection, existingGrants]);

  const toggle = (userId: number) => {
    setSelection((previous) =>
      previous.includes(userId)
        ? previous.filter((id) => id !== userId)
        : [...previous, userId]
    );
  };

  const submit = async () => {
    if (!agent || !isCreator) return;
    setSaving(true);
    try {
      if (isPrivate) {
        const next = grantsForSelection(agent.created_by_user_id, grantMembers, selection);
        await onApplyGrants(agent.id, next);
        toast.success(
          `Access updated: “${agent.name}” now grants ${next.length} ${next.length === 1 ? "member" : "members"} in addition to the creator.`
        );
      } else {
        if (!recommended) return;
        await onApply(agent.id, recommended);
        toast.success(
          `Access updated: “${agent.name}” is now ${policyLabel(recommended)} — covers ${selection.length} selected ${selection.length === 1 ? "member" : "members"}.`
        );
      }
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update access.");
    } finally {
      setSaving(false);
    }
  };


  useEffect(() => {
    return () => {
      document.body.style.pointerEvents = "";
      document.body.removeAttribute("data-scroll-locked");
      document.body.style.overflow = "";
      document.body.style.paddingRight = "";
    };
  }, []);

  const handleOpenChange = (isOpen: boolean) => {
    if (!isOpen) {
      onClose();
      document.body.style.pointerEvents = "";
      document.body.removeAttribute("data-scroll-locked");
      document.body.style.overflow = "";
      document.body.style.paddingRight = "";
    }
  };

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2 text-base">
            <UserPlus className="size-4 text-primary" />
            Grant agent access
          </SheetTitle>
          <SheetDescription className="text-xs">
            Private agents take explicit member grants; Public and Internal agents derive access
            from the organization and the reporting hierarchy.
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-4 px-4 pb-6">
          <section className="space-y-2">
            <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              1 · Agent
            </h3>
            <Select
              value={agentId === null ? undefined : String(agentId)}
              onValueChange={(value) => setAgentId(Number(value))}
            >
              <SelectTrigger className="h-9 w-full text-xs">
                <SelectValue placeholder="Select an agent" />
              </SelectTrigger>
              <SelectContent>
                {rows.map((row) => (
                  <SelectItem key={row.id} value={String(row.id)}>
                    {row.name} · {policyLabel(row.utilization_type)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </section>

          <section className="space-y-2">
            <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              2 · Members
            </h3>
            {!isCreator ? (
              <p className="rounded-lg border border-border/60 bg-muted/10 px-3 py-2 text-xs text-muted-foreground">
                Only the agent creator can manage its access list.
              </p>
            ) : (
              <>
                <div className="relative">
                  <Input
                    value={memberSearch}
                    onChange={(event) => setMemberSearch(event.target.value)}
                    placeholder="Search members by name, email or team…"
                    aria-label="Search members"
                    className="h-9 w-full text-xs"
                  />
                </div>
                {grantMembersLoading && (
                  <p className="px-3 py-2 text-xs text-muted-foreground">Loading organization members…</p>
                )}
                {grantMembersError && (
                  <p className="rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                    {grantMembersError}
                  </p>
                )}
                {!grantMembersLoading && !grantMembersError && (
                  <div className="max-h-64 space-y-1.5 overflow-y-auto pr-1">
                    {filteredMembers.map((member) => (
                      <MemberLine
                        key={member.userId}
                        member={member}
                        manager={member.parentUserId ? grantMemberById.get(member.parentUserId) ?? null : null}
                        decision={grantMatrix.get(member.userId) ?? null}
                        selected={selection.includes(member.userId)}
                        onToggle={toggle}
                        locked={member.userId === agent?.created_by_user_id}
                      />
                    ))}
                    {filteredMembers.length === 0 && (
                      <p className="px-3 py-2 text-xs text-muted-foreground">No members match.</p>
                    )}
                  </div>
                )}
              </>
            )}
          </section>

          <section className="space-y-2">
            <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              3 · Review
            </h3>
            <div className="rounded-xl border border-border bg-card p-4 text-xs">
              {isPrivate ? (
                <div className="space-y-1">
                  <p className="text-foreground">
                    Explicit grants: <span className="font-semibold">{selection.length}</span>{" "}
                    {selection.length === 1 ? "member" : "members"} + the creator.
                  </p>
                  <p className="text-muted-foreground">
                    Checked members appear in the stored grant list. Unchecking a member who
                    currently has access revokes it.
                  </p>
                  {existingGrants.length > 0 && (
                    <p className="text-muted-foreground">
                      Currently granted: {existingGrants.length} ({existingGrants.length === 1 ? "member" : "members"}).
                    </p>
                  )}
                  {!grantsDirty && (
                    <p className="text-muted-foreground">No changes to save.</p>
                  )}
                </div>
              ) : (
                <>
                  <p className="text-muted-foreground">
                    {selection.length === 0
                      ? "Select the members who should be able to view and utilise this agent."
                      : `${selection.length} selected.`}
                  </p>
                  {selection.length > 0 && recommended && (
                    <div className="mt-2 space-y-1">
                      <div className="flex flex-wrap items-center gap-1.5 text-foreground">
                        <span>Narrowest policy that covers the selection:</span>
                        <Badge variant={policyBadgeVariant(recommended)} className="text-[10px]">
                          {policyLabel(recommended)}
                        </Badge>
                      </div>
                      <p className="text-muted-foreground">{policyDescription(recommended)}</p>
                      {alreadyCovered && (
                        <p className="text-status-success">
                          Every selected member already has access — applying this is a no-op.
                        </p>
                      )}
                    </div>
                  )}
                  {selection.length > 0 && !recommended && (
                    <p className="mt-2 text-destructive">
                      The selection cannot be expressed by any utilisation policy.
                    </p>
                  )}
                </>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button
                onClick={submit}
                disabled={
                  !agent ||
                  !isCreator ||
                  saving ||
                  (isPrivate ? !grantsDirty : !recommended)
                }
              >
                {saving ? "Applying…" : isPrivate ? "Save access list" : "Grant access"}
              </Button>
              <Button variant="outline" onClick={onClose}>
                Cancel
              </Button>
              {agent && !isCreator && (
                <span className="text-[11px] text-muted-foreground">
                  Only the agent creator can change who can access it.
                </span>
              )}
            </div>

            <p className="flex items-start gap-1.5 rounded-lg border border-border/60 bg-muted/10 px-3 py-2 text-[11px] text-muted-foreground">
              <Crown className="mt-0.5 size-3.5 shrink-0" />
              Inherited access is never overridden: Public covers the whole organization, Internal
              covers the creator plus their reporting descendants, Private covers the creator plus
              the members granted above.
            </p>
          </section>
        </div>
      </SheetContent>
    </Sheet>
  );
}
