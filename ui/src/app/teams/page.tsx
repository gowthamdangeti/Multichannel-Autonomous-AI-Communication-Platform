"use client";

import {
  Building2,
  ChevronDown,
  Plus,
  Search,
  UserPlus,
  Users,
} from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { type Breadcrumb, PageHeader } from "@/context/HeaderContext";
import { useTeamsAccess } from "@/context/TeamsAccessContext";
import { getBackendApiUrl } from "@/lib/apiClient";
import { detailFromError } from "@/lib/apiError";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";

import { AgentAccessView } from "./components/AgentAccessView";
import { OrgChartTree } from "./components/OrgChartTree";
import {
  AddMemberModal,
  CreateTeamModal,
  EditMemberModal,
  EditTeamModal,
  ReportingChainModal,
} from "./components/TeamModals";
import { TeamsAndMembers } from "./components/TeamsAndMembers";
import type {
  HierarchyResponse,
  MemberItem,
  MemberReportingData,
  TeamItem,
} from "./components/types";

export default function TeamsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, loading: authLoading, getAccessToken, redirectToLogin } = useAuth();
  const {
    access: teamsAccess,
    status: teamsAccessStatus,
    error: teamsAccessError,
    refresh: refreshTeamsAccess,
  } = useTeamsAccess();
  const currentUserEmail =
    user && "email" in user && typeof user.email === "string" ? user.email : null;
  // Guards against the effect firing more than once (React strict mode, refreshes)
  // and against repeated redirects when several requests see the same expired session.
  const hasFetched = useRef(false);
  const sessionExpiredRef = useRef(false);

  // Active Tab synchronization
  const tabParam = searchParams.get("tab");
  const activeTab = useMemo(() => {
    if (
      tabParam &&
      ["hierarchy", "teams-members", "agent-access"].includes(tabParam)
    ) {
      return tabParam;
    }
    return "hierarchy";
  }, [tabParam]);

  // Sub-view synchronization for Teams & Members ("teams" vs "directory")
  const subviewParam = searchParams.get("view");
  const subView: "teams" | "directory" =
    subviewParam === "directory" || subviewParam === "members" ? "directory" : "teams";

  const handleSubViewChange = useCallback(
    (newView: "teams" | "directory") => {
      const params = new URLSearchParams(searchParams.toString());
      params.set("tab", "teams-members");
      params.set("view", newView);
      router.replace(`/teams?${params.toString()}`);
    },
    [router, searchParams]
  );

  // Primary Data State
  const [hierarchyData, setHierarchyData] = useState<HierarchyResponse | null>(null);
  const [teams, setTeams] = useState<TeamItem[]>([]);
  const [members, setMembers] = useState<MemberItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  // Modal States
  const [isCreateTeamOpen, setIsCreateTeamOpen] = useState(false);
  const [editingTeam, setEditingTeam] = useState<TeamItem | null>(null);
  const [isEditTeamOpen, setIsEditTeamOpen] = useState(false);

  const [isAddMemberOpen, setIsAddMemberOpen] = useState(false);
  const [preselectedTeamId, setPreselectedTeamId] = useState<number | null>(null);
  const [preselectedManagerId, setPreselectedManagerId] = useState<number | null>(null);

  const [editingMember, setEditingMember] = useState<MemberItem | null>(null);
  const [isEditMemberOpen, setIsEditMemberOpen] = useState(false);

  const [reportingChainData, setReportingChainData] = useState<MemberReportingData | null>(null);
  const [isReportingChainOpen, setIsReportingChainOpen] = useState(false);

  // Members Map
  const membersMap = useMemo(() => {
    const map = new Map<number, MemberItem>();
    members.forEach((m) => map.set(m.user_id, m));
    return map;
  }, [members]);

  // Derived Org Display Name
  const orgDisplayName = useMemo(() => {
    return hierarchyData?.organization_name || "Organization Workspace";
  }, [hierarchyData]);

  // Handle an expired/invalid session exactly once: surface a message and send
  // the user back to the login surface for the active auth provider.
  const handleSessionExpired = useCallback(() => {
    if (sessionExpiredRef.current) return;
    sessionExpiredRef.current = true;
    toast.error("Your session has expired. Please sign in again.");
    redirectToLogin();
  }, [redirectToLogin]);

  // Single authenticated fetch used by every Teams request: attaches the bearer
  // token from the active auth session and surfaces 401s as a session-expired
  // state instead of silently failing or retrying in a loop.
  const authFetch = useCallback(
    async (path: string, init: RequestInit = {}): Promise<Response> => {
      const token = await getAccessToken();
      const headers = new Headers(init.headers);
      headers.set("Authorization", `Bearer ${token}`);
      if (!headers.has("ngrok-skip-browser-warning")) {
        headers.set("ngrok-skip-browser-warning", "true");
      }

      const res = await fetch(`${getBackendApiUrl()}${path}`, { ...init, headers });

      if (res.status === 401) {
        handleSessionExpired();
      }
      return res;
    },
    [getAccessToken, handleSessionExpired]
  );

  // Fetch all primary teams data
  const fetchData = useCallback(
    async (isBackground = false) => {
      if (!teamsAccess?.canView) {
        setLoading(false);
        setRefreshing(false);
        return;
      }
      if (!isBackground) setLoading(true);
      else setRefreshing(true);

      try {
        const [hierRes, teamsRes, membersRes] = await Promise.all([
          authFetch("/api/v1/teams/hierarchy"),
          authFetch("/api/v1/teams"),
          authFetch("/api/v1/teams/members"),
        ]);

        if (hierRes.ok) {
          const hierData: HierarchyResponse = await hierRes.json();
          setHierarchyData(hierData);
        }

        if (teamsRes.ok) {
          const teamsData: TeamItem[] = await teamsRes.json();
          setTeams(teamsData);
        }

        if (membersRes.ok) {
          const membersData: MemberItem[] = await membersRes.json();
          setMembers(membersData);
        }

        // Surface the first non-auth failure. 401s are already handled above by
        // handleSessionExpired, so they are intentionally excluded here.
        const failed = [hierRes, teamsRes, membersRes].find(
          (res) => !res.ok && res.status !== 401
        );
        if (failed) {
          const err = await failed.json().catch(() => ({}));
          throw new Error(detailFromError(err, "Failed to fetch teams and hierarchy data."));
        }
      } catch (err) {
        console.error("Failed to load organization data:", err);
        toast.error(
          err instanceof Error ? err.message : "Failed to fetch teams and hierarchy data."
        );
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [authFetch, teamsAccess]
  );

  // Redirect if unauthenticated
  useEffect(() => {
    if (!authLoading && !user) {
      redirectToLogin();
    }
  }, [authLoading, user, redirectToLogin]);

  // The shared access context is refreshed on focus, membership-change events,
  // and a bounded interval. Fetch protected data only after it grants access.
  useEffect(() => {
    if (authLoading || teamsAccessStatus === "loading" || !user || hasFetched.current) return;
    if (teamsAccessStatus !== "allowed" || !teamsAccess?.canView) {
      setLoading(false);
      return;
    }
    hasFetched.current = true;
    void fetchData();
  }, [authLoading, teamsAccessStatus, teamsAccess, user, fetchData]);

  useEffect(() => {
    if (teamsAccessStatus === "denied" || teamsAccessStatus === "error") {
      hasFetched.current = false;
      setHierarchyData(null);
      setTeams([]);
      setMembers([]);
      setLoading(false);
    }
  }, [teamsAccessStatus]);

  const notifyTeamsMembershipChanged = useCallback(() => {
    if (typeof window === "undefined") return;
    window.dispatchEvent(new Event("teams:membership-changed"));
    void refreshTeamsAccess();
  }, [refreshTeamsAccess]);

  // ───────────────────────────────────────────────────────────────────────────
  // Handlers for Modals
  // ───────────────────────────────────────────────────────────────────────────

  const handleCreateTeamSubmit = async (name: string, leaderUserId: number | null) => {
    const res = await authFetch("/api/v1/teams", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, leader_user_id: leaderUserId }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(detailFromError(err, "Failed to create team."));
    }

    toast.success(`Team "${name}" created successfully!`);
    notifyTeamsMembershipChanged();
    fetchData(true);
  };

  const handleEditTeamSubmit = async (
    teamId: number,
    name: string,
    leaderUserId: number | null
  ) => {
    const res = await authFetch(`/api/v1/teams/${teamId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, leader_user_id: leaderUserId }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(detailFromError(err, "Failed to update team."));
    }

    toast.success("Team updated successfully!");
    notifyTeamsMembershipChanged();
    fetchData(true);
  };

  const handleDeleteTeam = async (teamId: number, teamName: string) => {
    if (!confirm(`Are you sure you want to delete the team "${teamName}"? Members will be unassigned.`)) {
      return;
    }
    try {
      const res = await authFetch(`/api/v1/teams/${teamId}`, { method: "DELETE" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(detailFromError(err, "Failed to delete team."));
      }
      toast.success(`Team "${teamName}" deleted.`);
      notifyTeamsMembershipChanged();
      fetchData(true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete team.");
    }
  };

  const handleAddMemberSubmit = async (payload: {
    email: string;
    first_name?: string;
    last_name?: string;
    role: string;
    team_id?: number | null;
    parent_user_id?: number | null;
  }) => {
    const res = await authFetch("/api/v1/teams/members", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(detailFromError(err, "Failed to add member."));
    }

    toast.success(`Member ${payload.email} added successfully!`);
    notifyTeamsMembershipChanged();
    fetchData(true);
  };

  const handleEditMemberSubmit = async (
    userId: number,
    payload: {
      role: string;
      team_id?: number | null;
      parent_user_id?: number | null;
      clear_team?: boolean;
      clear_parent?: boolean;
    }
  ) => {
    const res = await authFetch(`/api/v1/teams/members/${userId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(detailFromError(err, "Failed to update member."));
    }

    toast.success("Member updated successfully!");
    notifyTeamsMembershipChanged();
    fetchData(true);
  };

  const handleRemoveMember = async (userId: number, fromTeamOnly: boolean) => {
    const member = membersMap.get(userId);
    const label = member?.name || "Member";
    const confirmMsg = fromTeamOnly
      ? `Detach ${label} from team?`
      : `Remove ${label} completely from this organization?`;

    if (!confirm(confirmMsg)) return;

    try {
      const res = await authFetch(
        `/api/v1/teams/members/${userId}?from_team_only=${fromTeamOnly}`,
        { method: "DELETE" }
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(detailFromError(err, "Failed to remove member."));
      }
      toast.success(fromTeamOnly ? "Member detached from team." : "Member removed.");
      notifyTeamsMembershipChanged();
      fetchData(true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to remove member.");
    }
  };

  const handleViewReporting = async (userId: number) => {
    try {
      const res = await authFetch(`/api/v1/teams/members/${userId}/reporting`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(detailFromError(err, "Failed to fetch reporting hierarchy."));
      }
      const data: MemberReportingData = await res.json();
      setReportingChainData(data);
      setIsReportingChainOpen(true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load reporting line.");
    }
  };

  const openAddMemberForTeam = useCallback((teamId?: number) => {
    setPreselectedTeamId(teamId || null);
    setPreselectedManagerId(null);
    setIsAddMemberOpen(true);
  }, []);

  const openAddMemberWithManager = useCallback((managerUserId: number) => {
    setPreselectedManagerId(managerUserId);
    setPreselectedTeamId(null);
    setIsAddMemberOpen(true);
  }, []);

  // Header title for the active module. The Teams module deliberately renders
  // no per-tab subtitle/description block — the title + actions are enough.
  const pageTitle = useMemo(() => {
    switch (activeTab) {
      case "hierarchy":
        return "Reporting Hierarchy";
      case "teams-members":
        return "Teams & Members";
      case "agent-access":
        return "Agent Access";
      default:
        return "Teams & Organization";
    }
  }, [activeTab]);

  const breadcrumbs = useMemo<Breadcrumb[]>(() => {
    return [
      { label: "Teams", href: "/teams?tab=hierarchy" },
      { label: pageTitle },
    ];
  }, [pageTitle]);

  const viewDropdown = useMemo(() => {
    if (activeTab !== "teams-members") return null;
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className="h-8 text-xs gap-1.5 cursor-pointer rounded-xl border-border/70 shadow-xs font-medium"
            aria-label="Switch between Teams and Members Directory"
          >
            {subView === "teams" ? (
              <>
                <Building2 className="size-3.5 text-blue-400" />
                <span>Teams ({teams.length})</span>
              </>
            ) : (
              <>
                <Users className="size-3.5 text-sky-400" />
                <span>Members Directory ({members.length})</span>
              </>
            )}
            <ChevronDown className="size-3 text-muted-foreground ml-0.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52 p-1.5 shadow-surface rounded-xl">
          <DropdownMenuItem
            onClick={() => handleSubViewChange("teams")}
            className={cn(
              "flex items-center justify-between py-2 px-2.5 cursor-pointer rounded-lg text-xs",
              subView === "teams" && "bg-muted font-semibold text-foreground"
            )}
          >
            <div className="flex items-center gap-2">
              <Building2 className="size-3.5 text-blue-400" />
              <span>Teams</span>
            </div>
            <Badge variant="secondary" className="text-[10px] px-1.5 py-0 font-mono">
              {teams.length}
            </Badge>
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => handleSubViewChange("directory")}
            className={cn(
              "flex items-center justify-between py-2 px-2.5 cursor-pointer rounded-lg text-xs",
              subView === "directory" && "bg-muted font-semibold text-foreground"
            )}
          >
            <div className="flex items-center gap-2">
              <Users className="size-3.5 text-sky-400" />
              <span>Members Directory</span>
            </div>
            <Badge variant="secondary" className="text-[10px] px-1.5 py-0 font-mono">
              {members.length}
            </Badge>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }, [activeTab, subView, teams.length, members.length, handleSubViewChange]);

  const headerActions = useMemo(() => {
    return (
      <div className="flex items-center gap-2">
        {viewDropdown}
        {teamsAccess?.canManage && (
          <>
            <Button
              size="sm"
              onClick={() => setIsCreateTeamOpen(true)}
              className="text-xs gap-1.5 cursor-pointer rounded-xl shadow-xs"
            >
              <Plus className="size-3.5" />
              New Team
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => openAddMemberForTeam()}
              className="text-xs gap-1.5 cursor-pointer rounded-xl border-border/70 shadow-xs"
            >
              <UserPlus className="size-3.5" />
              Add Member
            </Button>
          </>
        )}
      </div>
    );
  }, [viewDropdown, teamsAccess?.canManage, openAddMemberForTeam]);

  const searchBar = useMemo(() => {
    return (
      <div className="relative w-44 sm:w-56 md:w-64">
        <Search className="size-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder={
            activeTab === "hierarchy"
              ? "Search member in chart..."
              : activeTab === "teams-members" && subView === "directory"
              ? "Search members..."
              : "Search teams or leaders..."
          }
          className="h-8 pl-8 text-xs bg-muted/30 border-border/60 rounded-xl"
        />
      </div>
    );
  }, [searchQuery, activeTab, subView]);

  if (authLoading || teamsAccessStatus === "loading") {
    return (
      <div className="px-4 pt-2 pb-6 lg:px-6" aria-busy="true">
        <div className="space-y-4 py-6">
          <Skeleton className="h-12 w-64" />
          <Skeleton className="h-64 w-full rounded-xl" />
        </div>
      </div>
    );
  }

  if (!teamsAccess?.canView) {
    return (
      <div className="px-4 pt-2 pb-6 lg:px-6">
        <div role="alert" className="rounded-xl border border-border bg-card p-5 shadow-surface">
          <h1 className="text-base font-semibold text-foreground">Teams access unavailable</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {teamsAccessError ?? "You need an active team assignment or organization administrator access to view Teams."}
          </p>
          <Link href="/overview" className="mt-3 inline-flex text-sm font-medium text-primary hover:underline">
            Back to Overview
          </Link>
        </div>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-6 px-4 pt-2 pb-6 lg:px-6">
      {/* Page Header with Actions (rendered here for teams-members; hierarchy and agent-access manage their own) */}
      {activeTab === "teams-members" && (
        <PageHeader
          title={pageTitle}
          breadcrumbs={breadcrumbs}
          actions={headerActions}
          searchBar={searchBar}
          isRefreshing={refreshing}
        />
      )}
      {activeTab === "hierarchy" && loading && (
        <PageHeader
          title={pageTitle}
          breadcrumbs={breadcrumbs}
          isRefreshing={refreshing}
        />
      )}

      {/* Main Content Area */}
      {loading ? (
        <div className="space-y-4 py-6">
          <Skeleton className="h-24 w-full rounded-2xl" />
          <Skeleton className="h-96 w-full rounded-2xl" />
        </div>
      ) : (
        <div>
          {/* Tab 1: Hierarchy Tree */}
          {activeTab === "hierarchy" && hierarchyData?.tree && (
            <OrgChartTree
              tree={hierarchyData.tree}
              canManage={teamsAccess.canManage}
              currentUserId={user?.id}
              currentUserEmail={currentUserEmail}
              onViewReporting={handleViewReporting}
              onEditMember={(m) => {
                setEditingMember(m);
                setIsEditMemberOpen(true);
              }}
              onAddMemberWithManager={openAddMemberWithManager}
              membersMap={membersMap}
              onCreateTeamClick={() => setIsCreateTeamOpen(true)}
              onAddMemberClick={() => openAddMemberForTeam()}
              searchQuery={searchQuery}
              onSearchQueryChange={setSearchQuery}
            />
          )}

          {/* Tab 2: Teams & Members */}
          {activeTab === "teams-members" && (
            <TeamsAndMembers
              teams={teams}
              canManage={teamsAccess.canManage}
              members={members}
              orgDisplayName={orgDisplayName}
              searchQuery={searchQuery}
              onSearchQueryChange={setSearchQuery}
              subView={subView}
              onSubViewChange={handleSubViewChange}
              onEditTeam={(t) => {
                setEditingTeam(t);
                setIsEditTeamOpen(true);
              }}
              onDeleteTeam={handleDeleteTeam}
              onCreateTeamClick={() => setIsCreateTeamOpen(true)}
              onAddMemberClick={openAddMemberForTeam}
              onEditMember={(m) => {
                setEditingMember(m);
                setIsEditMemberOpen(true);
              }}
              onRemoveMember={handleRemoveMember}
              onViewReporting={handleViewReporting}
            />
          )}

          {/* Tab 3: Agent Access */}
          {activeTab === "agent-access" && (
            <AgentAccessView
              authFetch={authFetch}
              hierarchyTree={hierarchyData?.tree ?? null}
              currentUserId={user?.id}
            />
          )}

        </div>
      )}

      {/* ── Dialogs & Modals ── */}
      {teamsAccess.canManage && (
        <>
      <CreateTeamModal
        open={isCreateTeamOpen}
        onOpenChange={setIsCreateTeamOpen}
        members={members}
        onSubmit={handleCreateTeamSubmit}
      />

      <EditTeamModal
        team={editingTeam}
        open={isEditTeamOpen}
        onOpenChange={setIsEditTeamOpen}
        members={members}
        onSubmit={handleEditTeamSubmit}
      />

      <AddMemberModal
        open={isAddMemberOpen}
        onOpenChange={setIsAddMemberOpen}
        teams={teams}
        members={members}
        preselectedTeamId={preselectedTeamId}
        preselectedManagerId={preselectedManagerId}
        onSubmit={handleAddMemberSubmit}
      />

      <EditMemberModal
        member={editingMember}
        open={isEditMemberOpen}
        onOpenChange={setIsEditMemberOpen}
        teams={teams}
        members={members}
        onSubmit={handleEditMemberSubmit}
      />
        </>
      )}

      <ReportingChainModal
        data={reportingChainData}
        open={isReportingChainOpen}
        onOpenChange={setIsReportingChainOpen}
      />
    </div>
  );
}
