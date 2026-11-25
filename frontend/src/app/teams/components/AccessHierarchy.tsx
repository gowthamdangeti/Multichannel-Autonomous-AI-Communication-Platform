"use client";

import {
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Crown,
  Layers,
  LayoutGrid,
  Lock,
  Network,
  RotateCcw,
  Search,
  ShieldCheck,
  Sparkles,
  User,
  Users,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import React, { useMemo, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import type { AccessDecision } from "./agentAccess";
import { getRoleAvatarStyle, getRoleLabel } from "./roleStyles";
import type { HierarchyNode } from "./types";

interface AccessHierarchyProps {
  tree: HierarchyNode;
  /** Agent creator — rendered with a Creator badge. */
  creatorUserId: number | null;
  currentUserId?: string | number | null;
  /** Present when an agent is selected; drives the access indicators. */
  accessMatrix?: Map<number, AccessDecision> | null;
  /** user_ids to outline (e.g. the current grant selection). */
  agentName?: string;
  agentPolicy?: string;
}

type ViewMode = "tree" | "teams" | "list";
type AccessFilter = "all" | "granted" | "restricted";

export function AccessHierarchy({
  tree,
  creatorUserId,
  currentUserId,
  accessMatrix = null,
  agentName,
  agentPolicy,
}: AccessHierarchyProps) {
  const [viewMode, setViewMode] = useState<ViewMode>("tree");
  const [accessFilter, setAccessFilter] = useState<AccessFilter>("all");
  const [search, setSearch] = useState("");
  const [zoom, setZoom] = useState<number>(100);
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());

  const term = search.trim().toLowerCase();

  // ─────────────────────────────────────────────────────────────────────────────
  // 1. Canonical Tree & Member Graph Construction (Deduplicated by user_id)
  // ─────────────────────────────────────────────────────────────────────────────
  const { topMemberNodes, allMembers, teamClusters, allNodeIds } = useMemo(() => {
    const memberNodesMap = new Map<number, HierarchyNode>();
    const multiTeamMap = new Map<number, string[]>();
    const ids = new Set<string>();

    const isPerson = (node: HierarchyNode) =>
      node.type === "team_leader" || node.type === "member";

    function scan(node: HierarchyNode, currentTeamName: string | null) {
      ids.add(node.id);
      const team = node.type === "team" ? (node.team_name ?? node.name) : currentTeamName;
      if (isPerson(node) && node.user_id) {
        if (!memberNodesMap.has(node.user_id)) {
          memberNodesMap.set(node.user_id, {
            id: `access-member-${node.user_id}`,
            type: node.type,
            name: node.name,
            email: node.email,
            role: node.role,
            team_id: node.team_id,
            team_name: node.team_name ?? team,
            user_id: node.user_id,
            parent_user_id: node.parent_user_id,
            direct_reports_count: 0,
            total_descendants_count: 0,
            children: [],
          });
        }
        const existing = memberNodesMap.get(node.user_id)!;
        if (team && existing.team_name && team !== existing.team_name) {
          const list = multiTeamMap.get(node.user_id) ?? [];
          if (!list.includes(team)) {
            list.push(team);
            multiTeamMap.set(node.user_id, list);
          }
        }
      }
      for (const child of node.children ?? []) {
        scan(child, team);
      }
    }
    scan(tree, null);

    // Build parent-child relationships with cycle prevention
    const hasParentInOrg = new Set<number>();
    function causesCycle(childId: number, parentId: number): boolean {
      let curr: number | null | undefined = parentId;
      const seen = new Set<number>();
      while (curr) {
        if (curr === childId) return true;
        if (seen.has(curr)) return true;
        seen.add(curr);
        const pNode = memberNodesMap.get(curr);
        curr = pNode?.parent_user_id;
      }
      return false;
    }

    memberNodesMap.forEach((node, userId) => {
      const parentId = node.parent_user_id;
      if (parentId && parentId !== userId && memberNodesMap.has(parentId)) {
        if (!causesCycle(userId, parentId)) {
          const parent = memberNodesMap.get(parentId)!;
          if (!parent.children) parent.children = [];
          if (!parent.children.some((c) => c.user_id === userId)) {
            parent.children.push(node);
          }
          hasParentInOrg.add(userId);
        }
      }
    });

    // Top roots are strictly members without a parent in the org
    const roots: HierarchyNode[] = [];
    memberNodesMap.forEach((node, userId) => {
      if (!hasParentInOrg.has(userId)) {
        roots.push(node);
      }
    });

    if (roots.length === 0 && memberNodesMap.size > 0) {
      const all = Array.from(memberNodesMap.values());
      const leader = all.find((m) => m.role === "team_leader" || m.role === "admin") || all[0];
      if (leader) roots.push(leader);
    }

    // Compute report counts
    function countReports(n: HierarchyNode) {
      const children = n.children ?? [];
      n.direct_reports_count = children.length;
      let total = children.length;
      for (const child of children) {
        countReports(child);
        total += child.total_descendants_count ?? 0;
      }
      n.total_descendants_count = total;
    }
    roots.forEach(countReports);

    // Group members into Team Clusters
    const clusterMap = new Map<string, HierarchyNode[]>();
    memberNodesMap.forEach((node) => {
      const teamKey = node.team_name || "Unassigned Members";
      const list = clusterMap.get(teamKey) ?? [];
      list.push(node);
      clusterMap.set(teamKey, list);
    });

    return {
      topMemberNodes: roots,
      allMembers: Array.from(memberNodesMap.values()),
      teamClusters: Array.from(clusterMap.entries()),
      allNodeIds: ids,
    };
  }, [tree]);

  // Initial expansion
  React.useEffect(() => {
    setExpandedNodes(new Set(allNodeIds));
  }, [allNodeIds]);

  const toggleExpand = (nodeId: string) => {
    setExpandedNodes((prev) => {
      const next = new Set(prev);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      return next;
    });
  };

  const expandAll = () => setExpandedNodes(new Set(allNodeIds));
  const collapseAll = () => setExpandedNodes(new Set());

  // Filter & Search
  const matchesSearch = (node: HierarchyNode): boolean => {
    if (!term) return true;
    return Boolean(
      node.name.toLowerCase().includes(term) ||
        (node.email && node.email.toLowerCase().includes(term)) ||
        (node.team_name && node.team_name.toLowerCase().includes(term)) ||
        (node.role && node.role.toLowerCase().includes(term))
    );
  };

  const matchesAccess = (node: HierarchyNode): boolean => {
    if (accessFilter === "all" || !node.user_id) return true;
    const decision = accessMatrix?.get(node.user_id);
    const granted = decision ? decision.granted : false;
    return accessFilter === "granted" ? granted : !granted;
  };

  // Stats
  const stats = useMemo(() => {
    let granted = 0;
    let restricted = 0;
    allMembers.forEach((m) => {
      if (m.user_id) {
        const dec = accessMatrix?.get(m.user_id);
        if (dec?.granted) granted++;
        else restricted++;
      }
    });
    const total = allMembers.length || 1;
    const percent = Math.round((granted / total) * 100);
    return { granted, restricted, total: allMembers.length, percent };
  }, [allMembers, accessMatrix]);

  const policyColor =
    agentPolicy === "public"
      ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20"
      : agentPolicy === "closed"
      ? "bg-violet-500/10 text-violet-600 dark:text-violet-400 border-violet-500/20"
      : "bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20";

  return (
    <div className="space-y-4">
      {/* ───────────────────────────────────────────────────────────────────── */}
      {/* Agent Access Context Banner */}
      {/* ───────────────────────────────────────────────────────────────────── */}
      {agentName && (
        <div className="flex flex-wrap items-center justify-between gap-3 p-3.5 rounded-xl border border-border/80 bg-gradient-to-r from-card via-muted/20 to-card shadow-xs">
          <div className="flex items-center gap-3 min-w-0">
            <div className="size-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary shrink-0">
              <Sparkles className="size-5" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-foreground truncate max-w-sm">
                  {agentName}
                </span>
                {agentPolicy && (
                  <Badge variant="outline" className={cn("text-[10px] capitalize font-medium", policyColor)}>
                    {agentPolicy === "closed" ? "Internal (Reporting Line)" : agentPolicy}
                  </Badge>
                )}
              </div>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                Real-time visibility into who in the organization can utilize this agent.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-4 shrink-0">
            <div className="flex items-center gap-2">
              <div className="text-right">
                <div className="text-xs font-semibold text-foreground">
                  <span className="text-emerald-600 dark:text-emerald-400 font-bold">{stats.granted}</span>
                  <span className="text-muted-foreground mx-1">/</span>
                  <span>{stats.total}</span>
                  <span className="text-[11px] text-muted-foreground ml-1.5 font-normal">
                    ({stats.percent}% accessible)
                  </span>
                </div>
                <div className="w-36 h-1.5 bg-muted rounded-full mt-1.5 overflow-hidden">
                  <div
                    className="h-full bg-emerald-500 transition-all duration-300 rounded-full"
                    style={{ width: `${stats.percent}%` }}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ───────────────────────────────────────────────────────────────────── */}
      {/* Unified Toolbar & Filters */}
      {/* ───────────────────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-3 p-2.5 rounded-xl border border-border/80 bg-card shadow-xs">
        {/* Left: Search & Access Filter */}
        <div className="flex items-center gap-2 flex-wrap flex-1 min-w-[280px]">
          <div className="relative w-56 max-w-full">
            <Search className="size-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter by name, email, role…"
              className="h-8 pl-8 text-xs bg-muted/30 border-border/60 rounded-lg"
            />
          </div>

          {/* Quick Access Status Filters */}
          <div className="flex items-center p-0.5 rounded-lg border border-border/60 bg-muted/30 text-xs">
            <button
              type="button"
              onClick={() => setAccessFilter("all")}
              className={cn(
                "px-2.5 py-1 rounded-md text-[11px] font-medium transition-all cursor-pointer",
                accessFilter === "all"
                  ? "bg-card text-foreground shadow-xs font-semibold"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              All ({stats.total})
            </button>
            <button
              type="button"
              onClick={() => setAccessFilter("granted")}
              className={cn(
                "px-2.5 py-1 rounded-md text-[11px] font-medium transition-all flex items-center gap-1 cursor-pointer",
                accessFilter === "granted"
                  ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 font-semibold shadow-xs"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <ShieldCheck className="size-3 text-emerald-600 dark:text-emerald-400" />
              Granted ({stats.granted})
            </button>
            <button
              type="button"
              onClick={() => setAccessFilter("restricted")}
              className={cn(
                "px-2.5 py-1 rounded-md text-[11px] font-medium transition-all flex items-center gap-1 cursor-pointer",
                accessFilter === "restricted"
                  ? "bg-rose-500/10 text-rose-700 dark:text-rose-300 font-semibold shadow-xs"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Lock className="size-3 text-muted-foreground" />
              Restricted ({stats.restricted})
            </button>
          </div>
        </div>

        {/* Right: View Mode Toggle & Canvas Controls */}
        <div className="flex items-center gap-2">
          {/* Zoom controls for Tree View */}
          {viewMode === "tree" && (
            <div className="flex items-center gap-1 bg-muted/40 p-0.5 rounded-lg border border-border/60">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setZoom((prev) => Math.max(50, prev - 10))}
                disabled={zoom <= 50}
                className="h-7 w-7 p-0 cursor-pointer text-muted-foreground hover:text-foreground"
                title="Zoom out"
              >
                <ZoomOut className="size-3.5" />
              </Button>
              <span className="text-[11px] font-mono px-1 min-w-[40px] text-center text-muted-foreground">
                {zoom}%
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setZoom((prev) => Math.min(150, prev + 10))}
                disabled={zoom >= 150}
                className="h-7 w-7 p-0 cursor-pointer text-muted-foreground hover:text-foreground"
                title="Zoom in"
              >
                <ZoomIn className="size-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setZoom(100)}
                className="h-7 px-1.5 text-[11px] cursor-pointer text-muted-foreground hover:text-foreground"
                title="Reset zoom"
              >
                <RotateCcw className="size-3 mr-1" />
                Reset
              </Button>
            </div>
          )}

          {/* Expand / Collapse All */}
          <div className="flex items-center gap-1 border-l border-border/60 pl-2">
            <Button
              variant="outline"
              size="sm"
              onClick={expandAll}
              className="h-7 text-[11px] px-2 cursor-pointer"
            >
              Expand All
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={collapseAll}
              className="h-7 text-[11px] px-2 cursor-pointer"
            >
              Collapse
            </Button>
          </div>

          {/* View Mode Switcher */}
          <div className="flex items-center p-0.5 rounded-lg border border-border/60 bg-muted/30">
            <Button
              variant={viewMode === "tree" ? "secondary" : "ghost"}
              size="sm"
              onClick={() => setViewMode("tree")}
              className="h-7 px-2.5 text-[11px] gap-1.5 cursor-pointer"
              title="Interactive Visual Org Tree"
            >
              <Network className="size-3.5" />
              Tree
            </Button>
            <Button
              variant={viewMode === "teams" ? "secondary" : "ghost"}
              size="sm"
              onClick={() => setViewMode("teams")}
              className="h-7 px-2.5 text-[11px] gap-1.5 cursor-pointer"
              title="Team Clusters"
            >
              <LayoutGrid className="size-3.5" />
              Teams
            </Button>
            <Button
              variant={viewMode === "list" ? "secondary" : "ghost"}
              size="sm"
              onClick={() => setViewMode("list")}
              className="h-7 px-2.5 text-[11px] gap-1.5 cursor-pointer"
              title="Hierarchical Explorer List"
            >
              <Layers className="size-3.5" />
              List
            </Button>
          </div>
        </div>
      </div>

      {/* ───────────────────────────────────────────────────────────────────── */}
      {/* View Mode 1: Interactive Visual Tree Canvas */}
      {/* ───────────────────────────────────────────────────────────────────── */}
      {viewMode === "tree" && (
        <div className="relative min-h-[520px] rounded-2xl border border-border/80 bg-muted/10 overflow-auto p-8 shadow-inner select-none bg-[radial-gradient(#e5e7eb_1px,transparent_1px)] dark:bg-[radial-gradient(#1f2937_1px,transparent_1px)] [background-size:16px_16px]">
          <div
            className="flex items-start justify-center min-w-max mx-auto transition-transform duration-200"
            style={{
              transform: `scale(${zoom / 100})`,
              transformOrigin: "top center",
            }}
          >
            <div className="flex items-start gap-12 pt-4">
              {topMemberNodes.map((rootNode) => (
                <VisualAccessCard
                  key={rootNode.id}
                  node={rootNode}
                  isTopLevel={true}
                  creatorUserId={creatorUserId}
                  currentUserId={currentUserId}
                  accessMatrix={accessMatrix}
                  matchesSearch={matchesSearch(rootNode)}
                  matchesAccess={matchesAccess(rootNode)}
                  expandedNodes={expandedNodes}
                  onToggleExpand={toggleExpand}
                  checkFilterMatchesSearch={matchesSearch}
                  checkFilterMatchesAccess={matchesAccess}
                />
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ───────────────────────────────────────────────────────────────────── */}
      {/* View Mode 2: Team Clusters Grid View */}
      {/* ───────────────────────────────────────────────────────────────────── */}
      {viewMode === "teams" && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {teamClusters.map(([teamName, members]) => {
            const visibleMembers = members.filter(
              (m) => matchesSearch(m) && matchesAccess(m)
            );
            if (visibleMembers.length === 0 && (term || accessFilter !== "all")) {
              return null;
            }

            const teamGranted = members.filter(
              (m) => m.user_id && accessMatrix?.get(m.user_id)?.granted
            ).length;
            const teamPercent = Math.round((teamGranted / members.length) * 100);

            return (
              <Card
                key={teamName}
                className="overflow-hidden border border-border/80 rounded-2xl shadow-xs hover:border-primary/40 transition-all"
              >
                <div className="p-4 border-b border-border/60 bg-muted/20 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="size-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
                      <Users className="size-4" />
                    </div>
                    <div className="min-w-0">
                      <h4 className="text-xs font-semibold text-foreground truncate">
                        {teamName}
                      </h4>
                      <p className="text-[10px] text-muted-foreground">
                        {members.length} {members.length === 1 ? "member" : "members"}
                      </p>
                    </div>
                  </div>

                  <Badge
                    variant="outline"
                    className={cn(
                      "text-[10px] font-medium shrink-0",
                      teamGranted === members.length
                        ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20"
                        : teamGranted === 0
                        ? "bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20"
                        : "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20"
                    )}
                  >
                    {teamGranted}/{members.length} Granted ({teamPercent}%)
                  </Badge>
                </div>

                <CardContent className="p-3 space-y-2 max-h-[380px] overflow-y-auto">
                  {visibleMembers.map((member) => (
                    <TeamClusterMemberItem
                      key={member.id}
                      node={member}
                      creatorUserId={creatorUserId}
                      currentUserId={currentUserId}
                      accessMatrix={accessMatrix}
                    />
                  ))}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* ───────────────────────────────────────────────────────────────────── */}
      {/* View Mode 3: Hierarchical Explorer List */}
      {/* ───────────────────────────────────────────────────────────────────── */}
      {viewMode === "list" && (
        <div className="rounded-2xl border border-border/80 bg-card p-3 shadow-xs space-y-1.5 max-h-[580px] overflow-y-auto">
          {topMemberNodes.map((rootNode) => (
            <HierarchicalListRow
              key={rootNode.id}
              node={rootNode}
              level={0}
              creatorUserId={creatorUserId}
              currentUserId={currentUserId}
              accessMatrix={accessMatrix}
              expandedNodes={expandedNodes}
              onToggleExpand={toggleExpand}
              matchesSearch={matchesSearch}
              matchesAccess={matchesAccess}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Subcomponent: Visual Org Chart Card for Agent Access
// ─────────────────────────────────────────────────────────────────────────────

interface VisualAccessCardProps {
  node: HierarchyNode;
  isTopLevel: boolean;
  creatorUserId: number | null;
  currentUserId?: string | number | null;
  accessMatrix?: Map<number, AccessDecision> | null;
  matchesSearch: boolean;
  matchesAccess: boolean;
  expandedNodes: Set<string>;
  onToggleExpand: (id: string) => void;
  checkFilterMatchesSearch: (node: HierarchyNode) => boolean;
  checkFilterMatchesAccess: (node: HierarchyNode) => boolean;
}

function VisualAccessCard({
  node,
  isTopLevel,
  creatorUserId,
  currentUserId,
  accessMatrix,
  matchesSearch,
  matchesAccess,
  expandedNodes,
  onToggleExpand,
  checkFilterMatchesSearch,
  checkFilterMatchesAccess,
}: VisualAccessCardProps) {
  const [copied, setCopied] = useState(false);
  const userId = node.user_id;
  const isExpanded = expandedNodes.has(node.id);
  const isLeader = node.role === "team_leader" || node.type === "team_leader";
  const isCreator = Boolean(userId && userId === creatorUserId);
  const isSelf = Boolean(userId && String(userId) === String(currentUserId ?? ""));
  const decision = userId ? accessMatrix?.get(userId) : undefined;
  const hasAccess = Boolean(decision?.granted);

  const children = node.children ?? [];
  const hasChildren = children.length > 0;

  const copyEmail = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (node.email) {
      navigator.clipboard.writeText(node.email);
      setCopied(true);
      toast.success("Email copied to clipboard");
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const getInitials = (name: string) => {
    const parts = name.trim().split(/\s+/);
    if (parts.length === 0 || !parts[0]) return "U";
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  };

  return (
    <div className="flex flex-col items-center">
      <div
        className={cn(
          "relative w-[275px] rounded-2xl border transition-all duration-200 bg-card shadow-xs group",
          hasAccess
            ? "border-emerald-500/40 bg-gradient-to-b from-card to-emerald-500/[0.02] hover:border-emerald-500 hover:shadow-md"
            : "border-border/80 hover:border-border hover:shadow-sm opacity-90",
          matchesSearch && "ring-2 ring-primary/40",
          !matchesAccess && "opacity-40"
        )}
      >
        {/* Floating Badges Over Top Border */}
        {isTopLevel && !isSelf && (
          <div className="absolute -top-2.5 left-1/2 -translate-x-1/2 pointer-events-none">
            <span className="inline-flex items-center px-3 py-0.5 rounded-full text-[10px] font-bold bg-[#7c3aed] text-white shadow-xs tracking-wide">
              Top
            </span>
          </div>
        )}

        {isCreator && (
          <div className="absolute -top-2.5 left-4 pointer-events-none">
            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-violet-600 text-white shadow-xs">
              <Crown className="size-2.5 stroke-[2.5]" />
              Creator
            </span>
          </div>
        )}

        {isSelf && !isCreator && (
          <div className="absolute -top-2.5 left-4 pointer-events-none">
            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-blue-600 text-white shadow-xs">
              <User className="size-2.5 stroke-[2.5]" />
              You
            </span>
          </div>
        )}

        {isLeader && !isTopLevel && (
          <div className="absolute -top-2.5 right-4 pointer-events-none">
            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-500 text-black shadow-xs">
              <Crown className="size-2.5 stroke-[2.5]" />
              Leader
            </span>
          </div>
        )}

        {/* Card Body */}
        <div className="pt-6 pb-4 px-4 flex flex-col items-center text-center">
          {/* Avatar with deterministic role style */}
          <div className="relative mb-2.5">
            <div
              className={cn(
                "size-13 rounded-full flex items-center justify-center font-bold text-sm border shadow-xs transition-transform group-hover:scale-105",
                getRoleAvatarStyle(node.role, node.type)
              )}
            >
              {getInitials(node.name)}
            </div>
            {isLeader && !isTopLevel && (
              <div
                className="absolute -bottom-1 -right-1 size-5 rounded-full bg-amber-500 text-black flex items-center justify-center shadow-xs"
                title="Team Leader"
              >
                <Crown className="size-3 stroke-[2.5]" />
              </div>
            )}
          </div>

          {/* Name */}
          <h4
            className="font-semibold text-xs text-foreground truncate max-w-[220px]"
            title={node.name}
          >
            {node.name}
          </h4>

          {/* Email + Copy button */}
          {node.email && (
            <div className="flex items-center justify-center gap-1 mt-0.5 max-w-[220px]">
              <span className="text-[11px] text-muted-foreground/75 truncate font-mono">
                {node.email}
              </span>
              <button
                type="button"
                onClick={copyEmail}
                className="size-4 inline-flex items-center justify-center text-muted-foreground/50 hover:text-foreground cursor-pointer transition-colors"
                title="Copy email"
              >
                {copied ? <Check className="size-3 text-emerald-500" /> : <Copy className="size-3" />}
              </button>
            </div>
          )}

          {/* Role & Team Badges */}
          <div className="flex items-center justify-center gap-1.5 flex-wrap mt-2">
            <span
              className={cn(
                "text-[10px] font-semibold px-2 py-0.5 rounded-full",
                node.role === "team_leader"
                  ? "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300"
                  : node.role === "admin"
                  ? "bg-violet-100 text-violet-800 dark:bg-violet-950/60 dark:text-violet-300"
                  : "bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300"
              )}
            >
              {getRoleLabel(node.role, node.type)}
            </span>
            {node.team_name && (
              <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                {node.team_name}
              </Badge>
            )}
          </div>

          {/* Access Status Banner inside Card */}
          <div className="w-full mt-3 pt-2.5 border-t border-border/50">
            {decision ? (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div
                      className={cn(
                        "w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg border text-xs cursor-default transition-all",
                        hasAccess
                          ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30"
                          : "bg-muted/50 text-muted-foreground border-border/60"
                      )}
                    >
                      <span className="flex items-center gap-1.5 font-medium text-[11px]">
                        {hasAccess ? (
                          <>
                            <ShieldCheck className="size-3.5 text-emerald-600 dark:text-emerald-400" />
                            Access Granted
                          </>
                        ) : (
                          <>
                            <Lock className="size-3.5 text-muted-foreground" />
                            Restricted
                          </>
                        )}
                      </span>
                      <span className="text-[10px] font-mono text-muted-foreground truncate max-w-[80px]">
                        {decision.source ? decision.source : "private"}
                      </span>
                    </div>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="text-xs max-w-xs p-2">
                    <p className="font-semibold mb-0.5">
                      {hasAccess ? "Access Granted" : "Access Restricted"}
                    </p>
                    <p className="text-muted-foreground text-[11px] leading-relaxed">
                      {decision.reason}
                    </p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            ) : (
              <div className="text-[11px] text-muted-foreground py-1">No policy applied</div>
            )}
          </div>
        </div>
      </div>

      {/* Vertical connector & Expand Toggle */}
      {hasChildren && (
        <div className="flex flex-col items-center">
          <div className="w-px h-6 bg-border/80" />
          <button
            type="button"
            onClick={() => onToggleExpand(node.id)}
            className="flex items-center gap-1 px-2.5 py-0.5 rounded-full border border-border/80 bg-card hover:bg-muted text-[10px] font-medium text-muted-foreground hover:text-foreground cursor-pointer shadow-xs transition-colors z-10"
          >
            <span>
              {children.length} {children.length === 1 ? "reportee" : "reportees"}
            </span>
            {isExpanded ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
          </button>

          {/* Children Subtree */}
          {isExpanded && (
            <div className="flex flex-col items-center pt-2">
              <div className="w-px h-4 bg-border/80" />
              <div className="flex items-start justify-center relative pt-1">
                {children.map((child, idx) => {
                  const isFirst = idx === 0;
                  const isLast = idx === children.length - 1;
                  return (
                    <div key={child.id} className="flex flex-col items-center relative px-4">
                      {/* Crossbar */}
                      <div
                        className={cn(
                          "absolute top-0 h-px bg-border/80",
                          isFirst ? "left-1/2 right-0" : "",
                          isLast ? "left-0 right-1/2" : "",
                          !isFirst && !isLast ? "left-0 right-0" : ""
                        )}
                      />
                      {/* Vertical Drop Line */}
                      <div className="w-px h-6 bg-border/80 mb-2" />
                      <VisualAccessCard
                        node={child}
                        isTopLevel={false}
                        creatorUserId={creatorUserId}
                        currentUserId={currentUserId}
                        accessMatrix={accessMatrix}
                        matchesSearch={checkFilterMatchesSearch(child)}
                        matchesAccess={checkFilterMatchesAccess(child)}
                        expandedNodes={expandedNodes}
                        onToggleExpand={onToggleExpand}
                        checkFilterMatchesSearch={checkFilterMatchesSearch}
                        checkFilterMatchesAccess={checkFilterMatchesAccess}
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Subcomponent: Team Cluster Member Item
// ─────────────────────────────────────────────────────────────────────────────

function TeamClusterMemberItem({
  node,
  creatorUserId,
  currentUserId,
  accessMatrix,
}: {
  node: HierarchyNode;
  creatorUserId: number | null;
  currentUserId?: string | number | null;
  accessMatrix?: Map<number, AccessDecision> | null;
}) {
  const userId = node.user_id;
  const isLeader = node.role === "team_leader" || node.type === "team_leader";
  const isCreator = Boolean(userId && userId === creatorUserId);
  const isSelf = Boolean(userId && String(userId) === String(currentUserId ?? ""));
  const decision = userId ? accessMatrix?.get(userId) : undefined;
  const hasAccess = Boolean(decision?.granted);

  return (
    <div
      className={cn(
        "flex items-center justify-between gap-3 p-2 rounded-xl border transition-all",
        hasAccess
          ? "border-emerald-500/30 bg-emerald-500/[0.03]"
          : "border-border/60 bg-card hover:bg-muted/30"
      )}
    >
      <div className="flex items-center gap-2.5 min-w-0">
        <div
          className={cn(
            "size-8 rounded-full border flex items-center justify-center font-bold text-xs shrink-0",
            getRoleAvatarStyle(node.role, node.type)
          )}
        >
          {node.name.slice(0, 2).toUpperCase()}
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-semibold text-foreground truncate">{node.name}</span>
            {isCreator && (
              <Badge variant="violet" className="text-[9px] px-1 py-0">
                Creator
              </Badge>
            )}
            {isSelf && (
              <Badge variant="info" className="text-[9px] px-1 py-0">
                You
              </Badge>
            )}
            {isLeader && (
              <Badge variant="warning" className="text-[9px] px-1 py-0">
                Leader
              </Badge>
            )}
          </div>
          {node.email && (
            <p className="text-[10px] text-muted-foreground font-mono truncate">{node.email}</p>
          )}
        </div>
      </div>

      <div className="shrink-0">
        {hasAccess ? (
          <Badge variant="success" className="text-[10px] gap-1 py-0.5">
            <ShieldCheck className="size-3" />
            Access
          </Badge>
        ) : (
          <Badge variant="secondary" className="text-[10px] gap-1 py-0.5">
            <Lock className="size-3" />
            Restricted
          </Badge>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Subcomponent: Hierarchical List Explorer Row
// ─────────────────────────────────────────────────────────────────────────────

interface HierarchicalListRowProps {
  node: HierarchyNode;
  level: number;
  creatorUserId: number | null;
  currentUserId?: string | number | null;
  accessMatrix?: Map<number, AccessDecision> | null;
  expandedNodes: Set<string>;
  onToggleExpand: (id: string) => void;
  matchesSearch: (node: HierarchyNode) => boolean;
  matchesAccess: (node: HierarchyNode) => boolean;
}

function HierarchicalListRow({
  node,
  level,
  creatorUserId,
  currentUserId,
  accessMatrix,
  expandedNodes,
  onToggleExpand,
  matchesSearch,
  matchesAccess,
}: HierarchicalListRowProps) {
  const userId = node.user_id;
  const isExpanded = expandedNodes.has(node.id);
  const children = node.children ?? [];
  const hasChildren = children.length > 0;
  const isLeader = node.role === "team_leader" || node.type === "team_leader";
  const isCreator = Boolean(userId && userId === creatorUserId);
  const isSelf = Boolean(userId && String(userId) === String(currentUserId ?? ""));
  const decision = userId ? accessMatrix?.get(userId) : undefined;
  const hasAccess = Boolean(decision?.granted);

  const visibleSelf = matchesSearch(node) && matchesAccess(node);

  return (
    <div className="space-y-1">
      {visibleSelf && (
        <div
          className={cn(
            "flex items-center gap-3 p-2.5 rounded-xl border transition-all bg-card/80 hover:bg-muted/20",
            hasAccess ? "border-emerald-500/30" : "border-border/60"
          )}
          style={{ marginLeft: `${level * 24}px` }}
        >
          <button
            type="button"
            onClick={() => onToggleExpand(node.id)}
            className={cn(
              "size-6 flex items-center justify-center rounded-md transition-colors shrink-0",
              hasChildren
                ? "text-muted-foreground hover:text-foreground hover:bg-muted cursor-pointer"
                : "opacity-0 pointer-events-none"
            )}
          >
            {isExpanded ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
          </button>

          <div
            className={cn(
              "size-8 rounded-full border flex items-center justify-center font-bold text-xs shrink-0",
              getRoleAvatarStyle(node.role, node.type)
            )}
          >
            {node.name.slice(0, 2).toUpperCase()}
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold text-xs text-foreground truncate">{node.name}</span>
              <Badge
                variant={isLeader ? "warning" : node.role === "admin" ? "violet" : "secondary"}
                className="text-[10px]"
              >
                {getRoleLabel(node.role, node.type)}
              </Badge>
              {node.team_name && (
                <Badge variant="outline" className="text-[10px]">
                  {node.team_name}
                </Badge>
              )}
              {isCreator && (
                <Badge variant="violet" className="text-[10px]">
                  Creator
                </Badge>
              )}
              {isSelf && (
                <Badge variant="info" className="text-[10px]">
                  You
                </Badge>
              )}
            </div>
            {node.email && (
              <div className="text-[11px] text-muted-foreground/70 font-mono truncate">{node.email}</div>
            )}
          </div>

          <div className="shrink-0">
            {decision && (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    {hasAccess ? (
                      <Badge variant="success" className="text-[10px] gap-1 cursor-default py-0.5">
                        <ShieldCheck className="size-3" />
                        Access
                      </Badge>
                    ) : (
                      <Badge variant="secondary" className="text-[10px] gap-1 cursor-default py-0.5">
                        <Lock className="size-3" />
                        Restricted
                      </Badge>
                    )}
                  </TooltipTrigger>
                  <TooltipContent side="left" className="text-xs max-w-xs">
                    {decision.reason}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
          </div>
        </div>
      )}

      {hasChildren && isExpanded && (
        <div className="space-y-1">
          {children.map((child) => (
            <HierarchicalListRow
              key={child.id}
              node={child}
              level={level + 1}
              creatorUserId={creatorUserId}
              currentUserId={currentUserId}
              accessMatrix={accessMatrix}
              expandedNodes={expandedNodes}
              onToggleExpand={onToggleExpand}
              matchesSearch={matchesSearch}
              matchesAccess={matchesAccess}
            />
          ))}
        </div>
      )}
    </div>
  );
}
