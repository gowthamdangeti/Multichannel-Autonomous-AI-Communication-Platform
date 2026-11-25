"use client";

import {
  AlertCircle,
  AlertTriangle,
  Building2,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Crown,
  GitFork,
  Layers,
  MoreHorizontal,
  Network,
  Search,
  ShieldAlert,
  User,
  UserPlus,
  Users,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import React, { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/context/HeaderContext";
import { cn } from "@/lib/utils";

import { buildHierarchyLayout } from "./hierarchyLayout";
import { getRoleAvatarStyle, getRoleLabel } from "./roleStyles";
import type { HierarchyNode, MemberItem } from "./types";

interface OrgChartTreeProps {
  tree: HierarchyNode;
  currentUserId?: string | number | null;
  currentUserEmail?: string | null;
  onViewReporting: (userId: number) => void;
  onEditMember: (member: MemberItem) => void;
  onAddMemberWithManager?: (managerUserId: number) => void;
  membersMap: Map<number, MemberItem>;
  onCreateTeamClick: () => void;
  onAddMemberClick: () => void;
  canManage: boolean;
  searchQuery?: string;
  onSearchQueryChange?: (query: string) => void;
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0 || !parts[0]) return "U";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function OrgChartTree({
  tree,
  currentUserId,
  currentUserEmail,
  onViewReporting,
  onEditMember,
  onAddMemberWithManager,
  membersMap,
  onCreateTeamClick,
  onAddMemberClick,
  canManage,
  searchQuery,
  onSearchQueryChange,
}: OrgChartTreeProps) {
  const [zoom, setZoom] = useState<number>(100);
  const searchTerm = searchQuery || "";
  const [viewMode, setViewMode] = useState<"tree" | "table">("tree");
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());
  const [accessStates, setAccessStates] = useState<Record<number, boolean>>({});

  // Search results categorization across all organization members
  const query = searchTerm.trim().toLowerCase();
  const isKeywordUnassigned = query === "unassigned" || query === "not assigned";

  const searchResults = useMemo(() => {
    if (!query) {
      return {
        all: [] as MemberItem[],
        assigned: [] as MemberItem[],
        unassigned: [] as MemberItem[],
        highlightedTeams: new Set<string>(),
      };
    }

    const allMembers = Array.from(membersMap.values());
    const matched = allMembers.filter((m) => {
      if (isKeywordUnassigned) {
        return m.team_id === null;
      }
      return (
        m.name.toLowerCase().includes(query) ||
        Boolean(m.email && m.email.toLowerCase().includes(query)) ||
        Boolean(m.team_name && m.team_name.toLowerCase().includes(query))
      );
    });

    const assigned = matched.filter((m) => m.team_id !== null);
    const unassigned = matched.filter((m) => m.team_id === null);

    const highlightedTeams = new Set<string>();
    assigned.forEach((m) => {
      if (m.team_name) highlightedTeams.add(m.team_name.toLowerCase());
    });

    return { all: matched, assigned, unassigned, highlightedTeams };
  }, [membersMap, query, isKeywordUnassigned]);

  // When search query is entered:
  // - If assigned members match: Tree is visible and highlights the matched member/team
  // - If unassigned member(s) match OR no results match: Tree must be hidden/blurred with clear empty state
  const hasSearch = Boolean(query);
  const isAssigned = searchResults.assigned.length > 0;
  const isUnassigned = searchResults.unassigned.length > 0 && searchResults.assigned.length === 0;
  const shouldHideTree = hasSearch && !isAssigned;

  // Reporting roots and multi-team annotations. The layout builder guarantees
  // one card per person (see hierarchyLayout.ts), so a user can never be drawn
  // twice — even when the backend repeats them across teams or a leader appears
  // inside their own team branch.
  const { roots: topMemberNodes, allNodeIds, multiTeamMap } = useMemo(
    () => buildHierarchyLayout(tree, membersMap),
    [tree, membersMap]
  );

  // Initial expansion & auto-expand on search
  React.useEffect(() => {
    setExpandedNodes(new Set(allNodeIds));
  }, [allNodeIds]);

  React.useEffect(() => {
    if (searchTerm.trim().length > 0) {
      setExpandedNodes(new Set(allNodeIds));
    }
  }, [searchTerm, allNodeIds]);

  const toggleExpand = (nodeId: string) => {
    setExpandedNodes((prev) => {
      const next = new Set(prev);
      if (next.has(nodeId)) {
        next.delete(nodeId);
      } else {
        next.add(nodeId);
      }
      return next;
    });
  };

  const expandAll = useCallback(() => setExpandedNodes(new Set(allNodeIds)), [allNodeIds]);
  const collapseAll = useCallback(() => setExpandedNodes(new Set()), []);

  const handleZoom = useCallback((delta: number) => {
    setZoom((prev) => Math.min(150, Math.max(50, prev + delta)));
  }, []);

  const toggleAccess = (userId: number) => {
    setAccessStates((prev) => {
      const current = prev[userId] ?? true;
      const next = !current;
      toast.info(
        `Member access ${next ? "enabled" : "disabled"} for Internal agents simulation`
      );
      return { ...prev, [userId]: next };
    });
  };

  const breadcrumbs = useMemo(
    () => [
      { label: "Teams", href: "/teams?tab=hierarchy" },
      { label: "Reporting Hierarchy" },
    ],
    []
  );

  const hierarchyToolbar = useMemo(
    () => (
      <div className="flex items-center gap-2">
        {/* Zoom & Expand/Collapse Controls for Tree Chart Mode */}
        {viewMode === "tree" && (
          <div className="flex items-center gap-1 bg-muted/40 p-0.5 rounded-lg border border-border/60">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => handleZoom(-10)}
              disabled={zoom <= 50}
              className="h-7 w-7 p-0 cursor-pointer text-muted-foreground hover:text-foreground"
              title="Zoom out"
              aria-label="Zoom out"
            >
              <ZoomOut className="size-3.5" />
            </Button>
            <span className="text-[11px] font-mono px-1 text-muted-foreground min-w-[38px] text-center select-none">
              {zoom}%
            </span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => handleZoom(10)}
              disabled={zoom >= 150}
              className="h-7 w-7 p-0 cursor-pointer text-muted-foreground hover:text-foreground"
              title="Zoom in"
              aria-label="Zoom in"
            >
              <ZoomIn className="size-3.5" />
            </Button>
            <div className="w-px h-3.5 bg-border/60 mx-0.5" />
            <Button
              variant="ghost"
              size="sm"
              onClick={expandAll}
              className="h-7 px-2 text-[11px] cursor-pointer text-muted-foreground hover:text-foreground"
            >
              Expand All
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={collapseAll}
              className="h-7 px-2 text-[11px] cursor-pointer text-muted-foreground hover:text-foreground"
            >
              Collapse
            </Button>
          </div>
        )}

        {/* Tree Chart / List Explorer View Toggle */}
        <div className="inline-flex rounded-lg bg-muted/40 p-0.5 border border-border/60">
          <button
            type="button"
            onClick={() => setViewMode("tree")}
            className={cn(
              "px-2.5 py-1 text-xs rounded-md font-medium transition-colors cursor-pointer flex items-center gap-1.5",
              viewMode === "tree"
                ? "bg-card text-foreground shadow-xs font-semibold"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <GitFork className="size-3.5 text-purple-400" />
            Tree Chart
          </button>
          <button
            type="button"
            onClick={() => setViewMode("table")}
            className={cn(
              "px-2.5 py-1 text-xs rounded-md font-medium transition-colors cursor-pointer flex items-center gap-1.5",
              viewMode === "table"
                ? "bg-card text-foreground shadow-xs font-semibold"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <Layers className="size-3.5 text-blue-400" />
            List Explorer
          </button>
        </div>
      </div>
    ),
    [viewMode, zoom, handleZoom, expandAll, collapseAll]
  );

  const searchBarElement = useMemo(
    () =>
      onSearchQueryChange ? (
        <div className="relative w-40 sm:w-48 lg:w-56">
          <Search className="size-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
          <Input
            value={searchQuery || ""}
            onChange={(e) => onSearchQueryChange(e.target.value)}
            placeholder="Search member in chart…"
            aria-label="Search member in chart"
            className="h-8 pl-8 text-xs rounded-xl border-border/70 bg-muted/30"
          />
        </div>
      ) : undefined,
    [onSearchQueryChange, searchQuery]
  );

  if (topMemberNodes.length === 0) {
    return (
      <div className="space-y-4">
        <PageHeader
          title="Reporting Hierarchy"
          breadcrumbs={breadcrumbs}
          actions={hierarchyToolbar}
          searchBar={searchBarElement}
        />
        <Card className="border border-dashed border-border/70 p-12 text-center bg-card/60 rounded-2xl">
          <div className="size-14 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary mx-auto mb-4">
            <Network className="size-7" />
          </div>
          <h3 className="text-base font-semibold text-foreground">
            No reporting hierarchy defined
          </h3>
          <p className="text-xs text-muted-foreground mt-1 max-w-md mx-auto leading-relaxed">
            Create teams and assign reporting managers to team members to visualize your organizational chart.
          </p>
          {canManage && (
            <div className="flex items-center justify-center gap-2.5 mt-6">
              <Button size="sm" onClick={onAddMemberClick} className="text-xs gap-1.5 cursor-pointer">
                <UserPlus className="size-3.5" />
                Add Member
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={onCreateTeamClick}
                className="text-xs gap-1.5 cursor-pointer"
              >
                <Building2 className="size-3.5" />
                Create Team
              </Button>
            </div>
          )}
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Top Breadcrumb Line Header with Toolbar on Far Right */}
      <PageHeader
        title="Reporting Hierarchy"
        breadcrumbs={breadcrumbs}
        actions={hierarchyToolbar}
        searchBar={searchBarElement}
      />

      {/* Search Feedback Banners */}
      {hasSearch && (
        <>
          {isUnassigned ? (
            <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 shadow-surface animate-in fade-in duration-200">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div className="flex items-start sm:items-center gap-3">
                  <div className="size-9 rounded-xl bg-amber-500/20 text-amber-500 flex items-center justify-center shrink-0">
                    <ShieldAlert className="size-5" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-semibold text-foreground">
                        {searchResults.unassigned.length === 1
                          ? `Unassigned Member Found: ${searchResults.unassigned[0].name}`
                          : `${searchResults.unassigned.length} Unassigned Members Found`}
                      </span>
                      <Badge variant="warning" className="text-[10px]">
                        Unassigned
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {searchResults.unassigned.length === 1
                        ? `${searchResults.unassigned[0].email ? `${searchResults.unassigned[0].email} · ` : ""}This user is not part of any team. The hierarchy tree is disabled.`
                        : "These members are not part of any team. The hierarchy tree is disabled."}
                    </p>
                  </div>
                </div>
                {canManage && searchResults.unassigned.length === 1 && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => onEditMember(searchResults.unassigned[0])}
                    className="text-xs gap-1.5 shrink-0 border-amber-500/40 text-foreground hover:bg-amber-500/20 cursor-pointer self-start sm:self-center"
                  >
                    <Users className="size-3.5 text-amber-500" />
                    Assign to Team
                  </Button>
                )}
              </div>
            </div>
          ) : isAssigned ? (
            <div className="rounded-xl border border-primary/30 bg-primary/5 p-3 shadow-surface flex items-center justify-between gap-3 flex-wrap animate-in fade-in duration-200">
              <div className="flex items-center gap-2.5">
                <div className="size-7 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
                  <Check className="size-4" />
                </div>
                <div className="text-xs">
                  <span className="font-semibold text-foreground">
                    {searchResults.assigned.length === 1
                      ? searchResults.assigned[0].name
                      : `${searchResults.assigned.length} matching members`}
                  </span>
                  <span className="text-muted-foreground">
                    {" "}found in{" "}
                  </span>
                  <span className="font-semibold text-primary">
                    {Array.from(searchResults.highlightedTeams).join(", ")}
                  </span>
                  <span className="text-muted-foreground"> — highlighted in hierarchy below</span>
                </div>
              </div>
              {searchResults.unassigned.length > 0 && (
                <Badge variant="warning" className="text-[10px]">
                  +{searchResults.unassigned.length} unassigned member{searchResults.unassigned.length > 1 ? "s" : ""} also matched
                </Badge>
              )}
            </div>
          ) : (
            <div className="rounded-xl border border-border bg-muted/20 p-3 shadow-surface flex items-center justify-center gap-2 text-xs text-muted-foreground animate-in fade-in duration-200">
              <AlertCircle className="size-4 text-muted-foreground" />
              <span>
                No members or teams found matching &ldquo;<span className="font-medium text-foreground">{searchTerm}</span>&rdquo;
              </span>
            </div>
          )}
        </>
      )}

      {/* Main Canvas / Content */}
      {viewMode === "tree" ? (
        <div className="relative w-full rounded-xl border border-border bg-card overflow-hidden shadow-surface min-h-[580px]">
          {/* Subtle grid background */}
          <div
            className="absolute inset-0 opacity-[0.03] pointer-events-none"
            style={{
              backgroundImage: `radial-gradient(currentColor 1px, transparent 1px)`,
              backgroundSize: "24px 24px",
            }}
          />

          {/* Org Chart Zoomable Surface */}
          <div
            className={cn(
              "w-full overflow-x-auto overflow-y-auto p-12 min-h-[560px] transition-all duration-200",
              shouldHideTree && "filter blur-sm opacity-20 pointer-events-none select-none"
            )}
          >
            <div
              style={{
                transform: `scale(${zoom / 100})`,
                transformOrigin: "top center",
                transition: "transform 180ms ease-out",
              }}
              className="flex justify-center items-start gap-12 min-w-max mx-auto pt-4 pb-16"
            >
              {topMemberNodes.map((rootNode) => (
                <OrgChartCard
                  key={rootNode.id}
                  node={rootNode}
                  canManage={canManage}
                  isTopLevel={true}
                  searchTerm={searchTerm}
                  highlightedTeams={searchResults.highlightedTeams}
                  currentUserId={currentUserId}
                  currentUserEmail={currentUserEmail}
                  onViewReporting={onViewReporting}
                  onEditMember={onEditMember}
                  onAddMemberWithManager={onAddMemberWithManager}
                  membersMap={membersMap}
                  accessStates={accessStates}
                  onToggleAccess={toggleAccess}
                  expandedNodes={expandedNodes}
                  onToggleExpand={toggleExpand}
                  multiTeamMap={multiTeamMap}
                />
              ))}
            </div>
          </div>

          {/* Centered Overlay when searched user is Unassigned or No Results */}
          {shouldHideTree && (
            <div className="absolute inset-0 z-20 flex items-center justify-center p-6 bg-background/50 backdrop-blur-[2px]">
              <Card className="max-w-md w-full border border-border bg-card/95 shadow-xl p-6 text-center rounded-2xl animate-in fade-in zoom-in-95 duration-200">
                {isUnassigned ? (
                  <>
                    <div className="size-12 rounded-2xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-500 mx-auto mb-3.5">
                      <ShieldAlert className="size-6" />
                    </div>
                    <h3 className="text-sm font-semibold text-foreground">
                      This user is not part of any team
                    </h3>
                    <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed">
                      {searchResults.unassigned.length === 1 ? (
                        <>
                          <strong className="text-foreground">{searchResults.unassigned[0].name}</strong> is currently unassigned. Reporting hierarchy requires an active team assignment.
                        </>
                      ) : (
                        <>
                          The matched members are currently unassigned and not part of any team.
                        </>
                      )}
                    </p>
                    {canManage && searchResults.unassigned.length === 1 && (
                      <div className="mt-5 flex items-center justify-center gap-2">
                        <Button
                          size="sm"
                          onClick={() => onEditMember(searchResults.unassigned[0])}
                          className="text-xs gap-1.5 cursor-pointer shadow-xs"
                        >
                          <Users className="size-3.5" />
                          Assign to a Team
                        </Button>
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    <div className="size-12 rounded-2xl bg-muted/60 border border-border flex items-center justify-center text-muted-foreground mx-auto mb-3.5">
                      <AlertCircle className="size-6" />
                    </div>
                    <h3 className="text-sm font-semibold text-foreground">
                      No matching members found
                    </h3>
                    <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed">
                      No team members match &ldquo;<span className="font-medium text-foreground">{searchTerm}</span>&rdquo;. Clear or refine your search to view the organizational tree.
                    </p>
                  </>
                )}
              </Card>
            </div>
          )}
        </div>
      ) : (
        /* Table / List Explorer View */
        <Card className="relative border border-border rounded-xl overflow-hidden shadow-surface">
          <CardHeader className="py-3.5 px-5 border-b border-border/50 bg-muted/15">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <Network className="size-4 text-purple-400" />
                  Hierarchical Explorer
                </CardTitle>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Browse organization reporting relationships level-by-level
                </p>
              </div>
            </div>
          </CardHeader>
          <CardContent
            className={cn(
              "p-4 overflow-x-auto transition-all duration-200",
              shouldHideTree && "filter blur-sm opacity-20 pointer-events-none select-none"
            )}
          >
            <div className="space-y-1.5 min-w-[500px]">
              {topMemberNodes.map((rootNode) => (
                <HierarchyListRow
                  key={rootNode.id}
                  node={rootNode}
                  canManage={canManage}
                  level={0}
                  searchTerm={searchTerm}
                  highlightedTeams={searchResults.highlightedTeams}
                  expandedNodes={expandedNodes}
                  onToggleExpand={toggleExpand}
                  onViewReporting={onViewReporting}
                  onEditMember={onEditMember}
                  membersMap={membersMap}
                  multiTeamMap={multiTeamMap}
                />
              ))}
            </div>
          </CardContent>

          {/* Centered Overlay when searched user is Unassigned or No Results */}
          {shouldHideTree && (
            <div className="absolute inset-0 z-20 flex items-center justify-center p-6 bg-background/50 backdrop-blur-[2px]">
              <Card className="max-w-md w-full border border-border bg-card/95 shadow-xl p-6 text-center rounded-2xl animate-in fade-in zoom-in-95 duration-200">
                {isUnassigned ? (
                  <>
                    <div className="size-12 rounded-2xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-500 mx-auto mb-3.5">
                      <ShieldAlert className="size-6" />
                    </div>
                    <h3 className="text-sm font-semibold text-foreground">
                      This user is not part of any team
                    </h3>
                    <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed">
                      {searchResults.unassigned.length === 1 ? (
                        <>
                          <strong className="text-foreground">{searchResults.unassigned[0].name}</strong> is currently unassigned. Reporting hierarchy requires an active team assignment.
                        </>
                      ) : (
                        <>
                          The matched members are currently unassigned and not part of any team.
                        </>
                      )}
                    </p>
                    {canManage && searchResults.unassigned.length === 1 && (
                      <div className="mt-5 flex items-center justify-center gap-2">
                        <Button
                          size="sm"
                          onClick={() => onEditMember(searchResults.unassigned[0])}
                          className="text-xs gap-1.5 cursor-pointer shadow-xs"
                        >
                          <Users className="size-3.5" />
                          Assign to a Team
                        </Button>
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    <div className="size-12 rounded-2xl bg-muted/60 border border-border flex items-center justify-center text-muted-foreground mx-auto mb-3.5">
                      <AlertCircle className="size-6" />
                    </div>
                    <h3 className="text-sm font-semibold text-foreground">
                      No matching members found
                    </h3>
                    <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed">
                      No team members match &ldquo;<span className="font-medium text-foreground">{searchTerm}</span>&rdquo;. Clear or refine your search to view the organizational tree.
                    </p>
                  </>
                )}
              </Card>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Org Chart Card (Matches User's Reference Layout)
// ─────────────────────────────────────────────────────────────────────────────

interface OrgChartCardProps {
  node: HierarchyNode;
  isTopLevel?: boolean;
  canManage: boolean;
  searchTerm?: string;
  highlightedTeams?: Set<string>;
  currentUserId?: string | number | null;
  currentUserEmail?: string | null;
  onViewReporting: (userId: number) => void;
  onEditMember: (member: MemberItem) => void;
  onAddMemberWithManager?: (managerUserId: number) => void;
  membersMap: Map<number, MemberItem>;
  accessStates: Record<number, boolean>;
  onToggleAccess: (userId: number) => void;
  expandedNodes: Set<string>;
  onToggleExpand: (nodeId: string) => void;
  /** user_id → other teams this member is assigned to (multi-team assignment). */
  multiTeamMap: Map<number, string[]>;
}

function OrgChartCard({
  node,
  isTopLevel = false,
  searchTerm = "",
  highlightedTeams,
  currentUserId,
  currentUserEmail,
  canManage,
  onViewReporting,
  onEditMember,
  onAddMemberWithManager,
  membersMap,
  accessStates,
  onToggleAccess,
  expandedNodes,
  onToggleExpand,
  multiTeamMap,
}: OrgChartCardProps) {
  const [copied, setCopied] = useState(false);
  const userId = node.user_id;
  const memberObj = userId ? membersMap.get(userId) : undefined;
  const isLeader = node.role === "team_leader" || node.type === "team_leader";
  const otherTeams = userId ? (multiTeamMap.get(userId) ?? []) : [];

  const isCurrentUser =
    (userId && currentUserId && String(userId) === String(currentUserId)) ||
    (node.email && currentUserEmail && node.email.toLowerCase() === currentUserEmail.toLowerCase());

  const isAccessEnabled = userId ? accessStates[userId] ?? true : true;
  const hasChildren = Boolean(node.children && node.children.length > 0);
  const isExpanded = expandedNodes.has(node.id);
  const directReportsCount = node.direct_reports_count ?? (node.children ? node.children.length : 0);

  const trimmedSearch = searchTerm.trim().toLowerCase();
  const matchesSearch =
    trimmedSearch.length > 0 &&
    (node.name.toLowerCase().includes(trimmedSearch) ||
      Boolean(node.email && node.email.toLowerCase().includes(trimmedSearch)));

  const isTeamHighlighted =
    Boolean(node.team_name && highlightedTeams?.has(node.team_name.toLowerCase()));

  const copyEmail = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (node.email) {
      navigator.clipboard.writeText(node.email);
      setCopied(true);
      toast.success("Email copied to clipboard");
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="flex flex-col items-center select-none">
      <div
        className={cn(
          "relative w-72 rounded-2xl border transition-all duration-200 bg-card shadow-xs group hover:border-purple-500 hover:shadow-md",
          matchesSearch
            ? "border-primary ring-2 ring-primary/50 shadow-md bg-primary/[0.03]"
            : isTeamHighlighted
            ? "border-primary/60 ring-2 ring-primary/25 bg-primary/[0.015]"
            : isTopLevel
            ? "border-[#8b5cf6]/50 dark:border-[#8b5cf6]/60"
            : "border-border/80"
        )}
      >
        {/* Floating Badges over Top Border */}
        {matchesSearch && (
          <div className="absolute -top-2.5 right-4 pointer-events-none">
            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-primary text-primary-foreground shadow-xs">
              <Check className="size-2.5 stroke-[2.5]" />
              Matched
            </span>
          </div>
        )}

        {isTopLevel && !isCurrentUser && (
          <div className="absolute -top-2.5 left-1/2 -translate-x-1/2 pointer-events-none">
            <span className="inline-flex items-center px-3 py-0.5 rounded-full text-[10px] font-bold bg-[#7c3aed] text-white shadow-xs tracking-wide">
              Top
            </span>
          </div>
        )}

        {isCurrentUser && (
          <div className="absolute -top-2.5 left-4 pointer-events-none">
            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-[#2563eb] text-white shadow-xs">
              <User className="size-2.5 stroke-[2.5]" />
              You
            </span>
          </div>
        )}

        {isCurrentUser && isTopLevel && (
          <div className="absolute -top-2.5 right-4 pointer-events-none">
            <span className="inline-flex items-center px-3 py-0.5 rounded-full text-[10px] font-bold bg-[#7c3aed] text-white shadow-xs tracking-wide">
              Top
            </span>
          </div>
        )}

        {!isTopLevel && isLeader && !matchesSearch && (
          <div className="absolute -top-2.5 right-4 pointer-events-none">
            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-500 text-black shadow-xs">
              <Crown className="size-2.5 stroke-[2.5]" />
              Leader
            </span>
          </div>
        )}

        {/* Card Body */}
        <div className="pt-6 pb-5 px-5 flex flex-col items-center text-center">
          {/* Avatar with pastel circle initials */}
          <div className="relative mb-3">
            <div
              className={cn(
                "size-14 rounded-full flex items-center justify-center font-bold text-base border shadow-xs transition-transform group-hover:scale-105",
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

          {/* Name & Quick Action Menu */}
          <div className="w-full flex items-center justify-center gap-1 relative">
            <h4
              className="font-semibold text-sm text-foreground truncate max-w-[200px]"
              title={node.name}
            >
              {node.name}
            </h4>
            {userId && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="size-6 p-0 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer shrink-0 absolute -right-2 top-0"
                  >
                    <MoreHorizontal className="size-3.5 text-muted-foreground" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-52 text-xs">
                  <DropdownMenuItem
                    onClick={() => onViewReporting(userId)}
                    className="cursor-pointer gap-2"
                  >
                    <GitFork className="size-3.5 text-primary" />
                    View Reporting Chain
                  </DropdownMenuItem>
                  {canManage && memberObj && (
                    <DropdownMenuItem
                      onClick={() => onEditMember(memberObj)}
                      className="cursor-pointer gap-2"
                    >
                      <Users className="size-3.5 text-muted-foreground" />
                      Edit / Move Team
                    </DropdownMenuItem>
                  )}
                  {canManage && onAddMemberWithManager && (
                    <DropdownMenuItem
                      onClick={() => onAddMemberWithManager(userId)}
                      className="cursor-pointer gap-2"
                    >
                      <UserPlus className="size-3.5 text-emerald-500" />
                      Add Direct Report
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>

          {/* Email with copy button */}
          {node.email && (
            <div className="mt-1 flex items-center justify-center gap-1.5 text-xs text-muted-foreground/80 max-w-full">
              <span className="truncate max-w-[190px] font-mono text-[11px]" title={node.email}>
                {node.email}
              </span>
              <button
                type="button"
                onClick={copyEmail}
                title="Copy email"
                className="text-muted-foreground/60 hover:text-foreground transition-colors p-0.5 rounded cursor-pointer"
              >
                {copied ? <Check className="size-3 text-emerald-500" /> : <Copy className="size-3" />}
              </button>
            </div>
          )}

          {/* Role / Designation & Multi-Team Badges */}
          <div className="mt-1 flex items-center justify-center gap-1.5 flex-wrap">
            <span className="text-xs font-medium text-muted-foreground/90">
              {getRoleLabel(node.role, node.type)}
            </span>
            {node.team_name && (
              <span
                className={cn(
                  "text-[11px] transition-colors",
                  isTeamHighlighted
                    ? "px-1.5 py-0.5 rounded bg-primary/15 text-primary font-semibold ring-1 ring-primary/30"
                    : "text-muted-foreground/60"
                )}
              >
                {isTeamHighlighted ? `Team: ${node.team_name}` : `· ${node.team_name}`}
              </span>
            )}
            {otherTeams.map((otherTeam) => (
              <Badge
                key={otherTeam}
                variant="warning"
                className="py-0 px-1.5 text-[10px] font-medium"
                title={`Assigned to multiple teams: also in ${otherTeam}`}
              >
                <AlertTriangle className="size-2.5" />
                Also in {otherTeam}
              </Badge>
            ))}
          </div>

          {canManage && (
            <div className="w-full mt-4 pt-3.5 border-t border-border/40 flex items-center justify-between px-1">
              <span className="text-xs text-muted-foreground font-medium">Access Simulation</span>
              <button
                type="button"
                role="switch"
                aria-checked={isAccessEnabled}
                aria-label={`Simulate access for ${node.name}`}
                onClick={() => userId && onToggleAccess(userId)}
                className={cn(
                  "relative inline-flex h-5 w-9 items-center rounded-full transition-colors",
                  isAccessEnabled ? "bg-cta" : "bg-input"
                )}
              >
                <span
                  className={cn(
                    "pointer-events-none size-4 rounded-full bg-card shadow transition-transform",
                    isAccessEnabled ? "translate-x-4" : "translate-x-0.5"
                  )}
                />
              </button>
            </div>
          )}
        </div>

        {/* Overlapping Bottom Reportee Pill */}
        {directReportsCount > 0 && (
          <div className="absolute -bottom-3.5 left-1/2 -translate-x-1/2 flex justify-center z-10">
            <button
              type="button"
              onClick={() => onToggleExpand(node.id)}
              className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-medium bg-card border border-border/90 text-foreground shadow-xs hover:bg-muted transition-all cursor-pointer"
            >
              <span>
                {directReportsCount} {directReportsCount === 1 ? "reportee" : "reportees"}
              </span>
              <ChevronDown
                className={cn(
                  "size-3 text-muted-foreground transition-transform duration-200",
                  isExpanded ? "rotate-180" : ""
                )}
              />
            </button>
          </div>
        )}
      </div>

      {/* Downward Connector & Subordinates */}
      {hasChildren && isExpanded && (
        <div className="flex flex-col items-center mt-3.5">
          {/* Vertical Stem Line down from parent card with arrow circle */}
          <div className="w-px h-8 bg-border/80 relative">
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 size-4 rounded-full bg-card border border-border flex items-center justify-center text-muted-foreground shadow-xs">
              <ChevronDown className="size-2.5 stroke-[2.5]" />
            </div>
          </div>

          {/* Children container */}
          <div className="pt-2">
            {node.children.length === 1 ? (
              <div className="pt-1">
                <OrgChartCard
                  node={node.children[0]}
                  canManage={canManage}
                  isTopLevel={false}
                  searchTerm={searchTerm}
                  highlightedTeams={highlightedTeams}
                  currentUserId={currentUserId}
                  currentUserEmail={currentUserEmail}
                  onViewReporting={onViewReporting}
                  onEditMember={onEditMember}
                  onAddMemberWithManager={onAddMemberWithManager}
                  membersMap={membersMap}
                  accessStates={accessStates}
                  onToggleAccess={onToggleAccess}
                  expandedNodes={expandedNodes}
                  onToggleExpand={onToggleExpand}
                  multiTeamMap={multiTeamMap}
                />
              </div>
            ) : (
              <div className="flex items-start justify-center relative pt-1">
                {node.children.map((child, idx) => {
                  const isFirst = idx === 0;
                  const isLast = idx === node.children.length - 1;
                  return (
                    <div
                      key={child.id || idx}
                      className="flex flex-col items-center relative px-4"
                    >
                      {/* Horizontal Crossbar connecting branch */}
                      <div
                        className={cn(
                          "absolute top-0 h-px bg-border/80",
                          isFirst ? "left-1/2 right-0" : "",
                          isLast ? "left-0 right-1/2" : "",
                          !isFirst && !isLast ? "left-0 right-0" : ""
                        )}
                      />
                      {/* Vertical Drop Line into Child Card */}
                      <div className="w-px h-6 bg-border/80 mb-2" />
                      <OrgChartCard
                        node={child}
                        canManage={canManage}
                        isTopLevel={false}
                        searchTerm={searchTerm}
                        highlightedTeams={highlightedTeams}
                        currentUserId={currentUserId}
                        currentUserEmail={currentUserEmail}
                        onViewReporting={onViewReporting}
                        onEditMember={onEditMember}
                        onAddMemberWithManager={onAddMemberWithManager}
                        membersMap={membersMap}
                        accessStates={accessStates}
                        onToggleAccess={onToggleAccess}
                        expandedNodes={expandedNodes}
                        onToggleExpand={onToggleExpand}
                        multiTeamMap={multiTeamMap}
                      />
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Hierarchy List Explorer Row
// ─────────────────────────────────────────────────────────────────────────────

function HierarchyListRow({
  node,
  level = 0,
  searchTerm,
  highlightedTeams,
  expandedNodes,
  onToggleExpand,
  onViewReporting,
  onEditMember,
  membersMap,
  canManage,
  multiTeamMap,
}: {
  node: HierarchyNode;
  level: number;
  searchTerm?: string;
  highlightedTeams?: Set<string>;
  expandedNodes: Set<string>;
  onToggleExpand: (nodeId: string) => void;
  onViewReporting: (userId: number) => void;
  onEditMember: (member: MemberItem) => void;
  membersMap: Map<number, MemberItem>;
  multiTeamMap: Map<number, string[]>;
  canManage: boolean;
}) {
  const hasChildren = Boolean(node.children && node.children.length > 0);
  const isExpanded = expandedNodes.has(node.id);
  const userId = node.user_id;
  const memberObj = userId ? membersMap.get(userId) : undefined;
  const isLeader = node.role === "team_leader" || node.type === "team_leader";
  const otherTeams = userId ? (multiTeamMap.get(userId) ?? []) : [];

  const trimmedSearch = (searchTerm || "").trim().toLowerCase();
  const matchesSearch =
    trimmedSearch.length > 0 &&
    (node.name.toLowerCase().includes(trimmedSearch) ||
      Boolean(node.email && node.email.toLowerCase().includes(trimmedSearch)));

  const isTeamHighlighted =
    Boolean(node.team_name && highlightedTeams?.has(node.team_name.toLowerCase()));

  return (
    <div className="space-y-1">
      <div
        className={cn(
          "flex items-center gap-3 p-2.5 rounded-xl border transition-all bg-card/80 hover:bg-muted/20",
          matchesSearch
            ? "border-primary ring-2 ring-primary/40 bg-primary/5"
            : isTeamHighlighted
            ? "border-primary/50 bg-primary/[0.02]"
            : isLeader
            ? "border-amber-500/30"
            : "border-border/60"
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
            "size-8 rounded-full border flex items-center justify-center font-semibold text-xs shrink-0",
            getRoleAvatarStyle(node.role, node.type)
          )}
        >
          {getInitials(node.name)}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-xs text-foreground truncate">{node.name}</span>
            {matchesSearch && (
              <Badge variant="default" className="text-[10px] bg-primary text-primary-foreground font-semibold">
                Matched
              </Badge>
            )}
            {isLeader && (
              <Badge variant="warning" className="text-[10px]">
                Team Leader
              </Badge>
            )}
            {node.team_name && (
              <Badge
                variant={isTeamHighlighted ? "default" : "secondary"}
                className={cn(
                  "text-[10px]",
                  isTeamHighlighted && "bg-primary text-primary-foreground font-semibold"
                )}
              >
                {node.team_name}
              </Badge>
            )}
            {otherTeams.map((otherTeam) => (
              <Badge
                key={otherTeam}
                variant="warning"
                className="py-0 px-1.5 text-[10px] font-medium"
                title={`Assigned to multiple teams: also in ${otherTeam}`}
              >
                Also in {otherTeam}
              </Badge>
            ))}
          </div>
          {node.email && (
            <div className="text-[11px] text-muted-foreground/70 font-mono truncate">{node.email}</div>
          )}
        </div>

        {node.direct_reports_count > 0 && (
          <span className="text-[11px] text-muted-foreground font-medium shrink-0">
            {node.direct_reports_count} direct {node.direct_reports_count === 1 ? "report" : "reports"}
          </span>
        )}

        {userId && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="size-7 p-0 cursor-pointer shrink-0">
                <MoreHorizontal className="size-3.5 text-muted-foreground" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48 text-xs">
              <DropdownMenuItem onClick={() => onViewReporting(userId)} className="cursor-pointer gap-2">
                <GitFork className="size-3.5 text-primary" />
                View Reporting Chain
              </DropdownMenuItem>
              {canManage && memberObj && (
                <DropdownMenuItem onClick={() => onEditMember(memberObj)} className="cursor-pointer gap-2">
                  <Users className="size-3.5 text-muted-foreground" />
                  Edit Member
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      {hasChildren && isExpanded && (
        <div className="space-y-1">
          {node.children.map((child) => (
            <HierarchyListRow
              key={child.id}
              node={child}
              canManage={canManage}
              level={level + 1}
              searchTerm={searchTerm}
              highlightedTeams={highlightedTeams}
              expandedNodes={expandedNodes}
              onToggleExpand={onToggleExpand}
              onViewReporting={onViewReporting}
              onEditMember={onEditMember}
              membersMap={membersMap}
              multiTeamMap={multiTeamMap}
            />
          ))}
        </div>
      )}
    </div>
  );
}

