"use client";

import {
  ArrowRight,
  Building2,
  Check,
  ChevronDown,
  Crown,
  Eye,
  GitFork,
  MoreHorizontal,
  Plus,
  Search,
  Trash2,
  UserMinus,
  UserPlus,
  Users,
} from "lucide-react";
import React, { useEffect, useMemo, useRef, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Sheet,
  SheetContent,
  SheetDescription,
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
import { cn } from "@/lib/utils";

import { getRoleAvatarStyle, getRoleLabel } from "./roleStyles";
import type { MemberItem, TeamItem } from "./types";

interface TeamsAndMembersProps {
  teams: TeamItem[];
  members: MemberItem[];
  orgDisplayName: string;
  onEditTeam: (team: TeamItem) => void;
  onDeleteTeam: (teamId: number, teamName: string) => void;
  onCreateTeamClick: () => void;
  onAddMemberClick: (teamId?: number) => void;
  onEditMember: (member: MemberItem) => void;
  onRemoveMember: (userId: number, fromTeamOnly: boolean) => void;
  onViewReporting: (userId: number) => void;
  canManage: boolean;
  searchQuery?: string;
  onSearchQueryChange?: (query: string) => void;
  subView?: "teams" | "directory";
  onSubViewChange?: (subView: "teams" | "directory") => void;
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0 || !parts[0]) return "U";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function MemberAvatar({ name, role }: { name: string; role: string }) {
  return (
    <span
      className={cn(
        "grid size-9 shrink-0 place-items-center rounded-full border text-xs font-semibold",
        getRoleAvatarStyle(role)
      )}
    >
      {getInitials(name)}
    </span>
  );
}

export function TeamsAndMembers({
  teams,
  members,
  orgDisplayName,
  onEditTeam,
  onDeleteTeam,
  onCreateTeamClick,
  onAddMemberClick,
  onEditMember,
  onRemoveMember,
  onViewReporting,
  canManage,
  searchQuery = "",
  subView: externalSubView,
}: TeamsAndMembersProps) {
  const [internalSubView] = useState<"teams" | "directory">("teams");
  const activeSubView = externalSubView !== undefined ? externalSubView : internalSubView;
  const [teamFilter, setTeamFilter] = useState<string>("all");
  const [roleFilter, setRoleFilter] = useState<string>("all");
  const [openTeamId, setOpenTeamId] = useState<number | null>(null);

  // Members grouped by team once, instead of filtering the whole list per row.
  const membersByTeam = useMemo(() => {
    const grouped = new Map<number, MemberItem[]>();
    for (const member of members) {
      if (member.team_id === null) continue;
      const list = grouped.get(member.team_id);
      if (list) list.push(member);
      else grouped.set(member.team_id, [member]);
    }
    return grouped;
  }, [members]);

  const teamOptions = useMemo<SearchableDropdownOption[]>(() => [
    { value: "all", label: "All Teams" },
    { value: "unassigned", label: "Unassigned" },
    ...teams.map((t) => ({ value: String(t.id), label: t.name })),
  ], [teams]);

  const roleOptions = useMemo<SearchableDropdownOption[]>(() => [
    { value: "all", label: "All Roles" },
    { value: "leader", label: "Leaders" },
    { value: "member", label: "Members" },
  ], []);

  const filteredMembers = useMemo(() => {
    return members.filter((member) => {
      const q = searchQuery.toLowerCase().trim();
      const matchesSearch =
        !q ||
        member.name.toLowerCase().includes(q) ||
        (member.email && member.email.toLowerCase().includes(q)) ||
        (member.team_name && member.team_name.toLowerCase().includes(q)) ||
        (member.role && member.role.toLowerCase().includes(q));

      const matchesTeam =
        teamFilter === "all" ||
        (teamFilter === "unassigned" && member.team_id === null) ||
        String(member.team_id) === teamFilter;

      const matchesRole =
        roleFilter === "all" ||
        (roleFilter === "leader" && member.role === "team_leader") ||
        (roleFilter === "member" && member.role === "member");

      return matchesSearch && matchesTeam && matchesRole;
    });
  }, [members, searchQuery, teamFilter, roleFilter]);

  const filteredTeams = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return teams;
    return teams.filter(
      (team) =>
        team.name.toLowerCase().includes(q) ||
        Boolean(team.leader_name?.toLowerCase().includes(q))
    );
  }, [teams, searchQuery]);

  const openTeam = useMemo(
    () => teams.find((team) => team.id === openTeamId) ?? null,
    [teams, openTeamId]
  );

  const assignedCount = members.filter((m) => m.team_id !== null).length;
  const unassignedCount = members.filter((m) => m.team_id === null).length;
  const leadersCount = members.filter((m) => m.role === "team_leader").length;

  const leaderOf = (team: TeamItem): MemberItem | null => {
    const teamMembers = membersByTeam.get(team.id) ?? [];
    return teamMembers.find((member) => member.role === "team_leader") ?? null;
  };

  return (
    <div className="space-y-6">
      {/* 4 Stat Overview Metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="rounded-xl border border-border bg-card p-5 shadow-surface">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">Total Teams</span>
            <div className="size-8 rounded-lg bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-400">
              <Building2 className="size-4" />
            </div>
          </div>
          <div className="text-2xl font-bold tracking-tight text-foreground mt-2 leading-none">
            {teams.length}
          </div>
          <div className="text-[11px] text-muted-foreground mt-1.5">
            Functional working groups
          </div>
        </Card>

        <Card className="rounded-xl border border-border bg-card p-5 shadow-surface">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">Total Members</span>
            <div className="size-8 rounded-lg bg-sky-500/10 border border-sky-500/20 flex items-center justify-center text-sky-400">
              <Users className="size-4" />
            </div>
          </div>
          <div className="text-2xl font-bold tracking-tight text-foreground mt-2 leading-none">
            {members.length}
          </div>
          <div className="text-[11px] text-muted-foreground mt-1.5">
            {assignedCount} assigned · {unassignedCount} unassigned
          </div>
        </Card>

        <Card className="rounded-xl border border-border bg-card p-5 shadow-surface">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">Team Leaders</span>
            <div className="size-8 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-500">
              <Crown className="size-4" />
            </div>
          </div>
          <div className="text-2xl font-bold tracking-tight text-amber-500 mt-2 leading-none">
            {leadersCount}
          </div>
          <div className="text-[11px] text-muted-foreground mt-1.5">
            Managing agent access
          </div>
        </Card>

        <Card className="rounded-xl border border-border bg-card p-5 shadow-surface">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">Organization</span>
            <div className="size-8 rounded-lg bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400">
              <GitFork className="size-4" />
            </div>
          </div>
          <div className="text-base font-bold text-foreground mt-2 truncate" title={orgDisplayName}>
            {orgDisplayName}
          </div>
          <div className="text-[11px] text-primary mt-1.5 font-medium">
            Active Workspace
          </div>
        </Card>
      </div>

      {activeSubView === "teams" ? (
        /* ── Teams Data Table ── */
        <Card className="border border-border rounded-xl overflow-hidden shadow-surface">
          <CardHeader className="py-3 px-5 border-b border-border/50 bg-muted/15">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Building2 className="size-4 text-blue-400" />
              Teams
            </CardTitle>
            <p className="text-xs text-muted-foreground mt-0.5">
              Showing {filteredTeams.length} of {teams.length} teams · select a row for details
            </p>
          </CardHeader>
          <CardContent className="p-0 [&>div]:max-h-[60vh]">
            {filteredTeams.length === 0 ? (
              <div className="p-12 text-center">
                <span className="mx-auto mb-3 grid size-12 place-items-center rounded-2xl border border-blue-500/20 bg-blue-500/10 text-blue-400">
                  <Building2 className="size-6" />
                </span>
                <h3 className="text-sm font-semibold text-foreground">
                  {searchQuery ? "No matching teams found" : "No teams created yet"}
                </h3>
                <p className="mx-auto mt-1 max-w-sm text-xs text-muted-foreground">
                  {searchQuery
                    ? `No teams match "${searchQuery}". Try clearing search.`
                    : "Create functional teams to group members and assign leaders."}
                </p>
                {!searchQuery && (
                  <Button
                    size="sm"
                    onClick={onCreateTeamClick}
                    className="mt-4 text-xs gap-1.5 cursor-pointer rounded-xl"
                  >
                    <Plus className="size-3.5" />
                    Create First Team
                  </Button>
                )}
              </div>
            ) : (
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-card">
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="text-xs font-semibold text-foreground">Team</TableHead>
                    <TableHead className="text-xs font-semibold text-foreground">
                      Team Leader
                    </TableHead>
                    <TableHead className="hidden text-xs font-semibold text-foreground sm:table-cell">
                      Total Members
                    </TableHead>
                    <TableHead className="text-right text-xs font-semibold text-foreground">
                      Actions
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredTeams.map((team) => {
                    const teamMembers = membersByTeam.get(team.id) ?? [];
                    const leader = leaderOf(team);
                    return (
                      <TableRow
                        key={team.id}
                        onClick={() => {
                          setTimeout(() => setOpenTeamId(team.id), 0);
                        }}
                        className="cursor-pointer border-b border-border/50 hover:bg-muted/30"
                      >
                        <TableCell className="py-3">
                          <div className="flex items-center gap-3">
                            <span className="grid size-9 shrink-0 place-items-center rounded-lg border border-blue-500/20 bg-blue-500/10 text-blue-400">
                              <Building2 className="size-4" />
                            </span>
                            <div className="min-w-0">
                              <div className="truncate text-xs font-semibold text-foreground">
                                {team.name}
                              </div>
                              <div className="text-[11px] text-muted-foreground">
                                {teamMembers.length} {teamMembers.length === 1 ? "member" : "members"}
                              </div>
                            </div>
                          </div>
                        </TableCell>

                        <TableCell className="py-3">
                          {leader || team.leader_name ? (
                            <div className="flex items-center gap-2">
                              <MemberAvatar
                                name={leader?.name ?? team.leader_name ?? "TL"}
                                role="team_leader"
                              />
                              <div className="min-w-0">
                                <div className="truncate text-xs font-medium text-foreground">
                                  {leader?.name ?? team.leader_name}
                                </div>
                                {leader?.email && (
                                  <div className="truncate font-mono text-[11px] text-muted-foreground">
                                    {leader.email}
                                  </div>
                                )}
                              </div>
                              <Crown className="size-3.5 shrink-0 text-amber-500" />
                            </div>
                          ) : (
                            <span className="text-xs italic text-muted-foreground">
                              No leader assigned
                            </span>
                          )}
                        </TableCell>

                        <TableCell className="hidden py-3 sm:table-cell">
                          <span className="text-xs tabular-nums text-foreground">
                            {teamMembers.length}
                          </span>
                        </TableCell>

                        <TableCell className="py-3 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              aria-label={`View ${team.name}`}
                              onClick={(event) => {
                                event.stopPropagation();
                                setTimeout(() => setOpenTeamId(team.id), 0);
                              }}
                              className="size-8 p-0 cursor-pointer"
                            >
                              <Eye className="size-4 text-muted-foreground" />
                            </Button>
                            {canManage && (
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    aria-label={`Actions for ${team.name}`}
                                    onClick={(event) => event.stopPropagation()}
                                    className="size-8 p-0 cursor-pointer"
                                  >
                                    <MoreHorizontal className="size-4 text-muted-foreground" />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end" className="w-44 text-xs">
                                  <DropdownMenuItem
                                    onClick={() => onEditTeam(team)}
                                    className="cursor-pointer gap-2"
                                  >
                                    <Building2 className="size-3.5 text-muted-foreground" />
                                    Edit Team
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    onClick={() => onAddMemberClick(team.id)}
                                    className="cursor-pointer gap-2"
                                  >
                                    <UserPlus className="size-3.5 text-primary" />
                                    Add Member
                                  </DropdownMenuItem>
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem
                                    onClick={() => onDeleteTeam(team.id, team.name)}
                                    className="cursor-pointer gap-2 text-destructive focus:text-destructive"
                                  >
                                    <Trash2 className="size-3.5" />
                                    Delete Team
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      ) : (
        /* ── Members Directory Table ── */
        <Card className="border border-border rounded-xl overflow-hidden shadow-surface">
          <CardHeader className="py-3 px-5 border-b border-border/50 bg-muted/15 flex flex-row items-center justify-between flex-wrap gap-3">
            <div>
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Users className="size-4 text-sky-400" />
                Organization Member Directory
              </CardTitle>
              <p className="text-xs text-muted-foreground mt-0.5">
                Showing {filteredMembers.length} of {members.length} total organization members
              </p>
            </div>

            {/* Directory Filters */}
            <div className="flex items-center gap-2 flex-wrap">
              <SearchableDropdown
                value={teamFilter}
                onValueChange={setTeamFilter}
                options={teamOptions}
                placeholder="All Teams"
                searchPlaceholder="Search teams..."
                className="w-36"
                popoverWidth="w-48"
              />

              <SearchableDropdown
                value={roleFilter}
                onValueChange={setRoleFilter}
                options={roleOptions}
                placeholder="All Roles"
                searchPlaceholder="Search roles..."
                className="w-32"
                popoverWidth="w-40"
              />
            </div>
          </CardHeader>
          <CardContent className="p-0 overflow-x-auto">
            {filteredMembers.length === 0 ? (
              <div className="p-12 text-center">
                <Users className="size-8 mx-auto text-muted-foreground/40 mb-2 stroke-[1.5]" />
                <div className="text-sm font-medium text-foreground">No members found</div>
                <p className="text-xs text-muted-foreground mt-1 max-w-sm mx-auto">
                  {searchQuery || teamFilter !== "all" || roleFilter !== "all"
                    ? "Try adjusting your search criteria or clearing active filters."
                    : "Add members to your organization to get started."}
                </p>
              </div>
            ) : (
              <Table>
                <TableHeader className="bg-muted/30">
                  <TableRow className="border-border/60 hover:bg-transparent">
                    <TableHead className="text-xs font-semibold text-foreground h-10">Member</TableHead>
                    <TableHead className="text-xs font-semibold text-foreground h-10">Role</TableHead>
                    <TableHead className="text-xs font-semibold text-foreground h-10">Team</TableHead>
                    <TableHead className="text-xs font-semibold text-foreground h-10">Reports To</TableHead>
                    <TableHead className="text-xs font-semibold text-foreground h-10 text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredMembers.map((member) => {
                    const isLeader = member.role === "team_leader";
                    return (
                      <TableRow key={member.user_id} className="border-border/50 hover:bg-muted/15">
                        <TableCell className="py-3">
                          <div className="flex items-center gap-3">
                            <MemberAvatar name={member.name} role={member.role} />
                            <div className="min-w-0">
                              <div className="font-semibold text-xs text-foreground truncate flex items-center gap-1.5">
                                {member.name}
                                {isLeader && <Crown className="size-3 text-amber-500" />}
                              </div>
                              {member.email && (
                                <div className="text-[11px] text-muted-foreground/75 font-mono truncate">
                                  {member.email}
                                </div>
                              )}
                            </div>
                          </div>
                        </TableCell>

                        <TableCell className="py-3">
                          <Badge
                            variant={isLeader ? "warning" : "secondary"}
                            className="text-[11px]"
                          >
                            {getRoleLabel(member.role)}
                          </Badge>
                        </TableCell>

                        <TableCell className="py-3">
                          {member.team_name ? (
                            <span className="inline-flex items-center gap-1.5 text-xs text-foreground font-medium">
                              <Building2 className="size-3.5 text-blue-400" />
                              {member.team_name}
                            </span>
                          ) : (
                            <span className="text-xs text-muted-foreground italic">Unassigned</span>
                          )}
                        </TableCell>

                        <TableCell className="py-3">
                          {member.parent_user_name ? (
                            <span className="inline-flex items-center gap-1.5 text-xs text-foreground">
                              <ArrowRight className="size-3 text-muted-foreground" />
                              {member.parent_user_name}
                            </span>
                          ) : (
                            <span className="text-xs text-purple-400 font-medium">Top Level (Root)</span>
                          )}
                        </TableCell>

                        <TableCell className="py-3 text-right">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="sm" className="size-8 p-0 cursor-pointer">
                                <MoreHorizontal className="size-4 text-muted-foreground" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-52 text-xs">
                              <DropdownMenuItem
                                onClick={() => onViewReporting(member.user_id)}
                                className="cursor-pointer gap-2"
                              >
                                <GitFork className="size-3.5 text-primary" />
                                View Reporting Chain
                              </DropdownMenuItem>
                              {canManage && (
                                <DropdownMenuItem
                                  onClick={() => onEditMember(member)}
                                  className="cursor-pointer gap-2"
                                >
                                  <Users className="size-3.5 text-muted-foreground" />
                                  Edit / Move Team
                                </DropdownMenuItem>
                              )}
                              {canManage && <DropdownMenuSeparator />}
                              {canManage && member.team_id && (
                                <DropdownMenuItem
                                  onClick={() => onRemoveMember(member.user_id, true)}
                                  className="cursor-pointer gap-2 text-amber-500"
                                >
                                  <UserMinus className="size-3.5" />
                                  Remove from Team
                                </DropdownMenuItem>
                              )}
                              {canManage && (
                                <DropdownMenuItem
                                  onClick={() => onRemoveMember(member.user_id, false)}
                                  className="cursor-pointer gap-2 text-destructive focus:text-destructive"
                                >
                                  <Trash2 className="size-3.5" />
                                  Remove from Organization
                                </DropdownMenuItem>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}

      <TeamDetailsSheet
        team={openTeam}
        open={Boolean(openTeam)}
        teamMembers={openTeam ? (membersByTeam.get(openTeam.id) ?? []) : []}
        onClose={() => {
          setOpenTeamId(null);
          document.body.style.pointerEvents = "";
          document.body.removeAttribute("data-scroll-locked");
        }}
        onAddMemberClick={onAddMemberClick}
        onEditTeam={onEditTeam}
        onDeleteTeam={onDeleteTeam}
        onEditMember={onEditMember}
        onRemoveMember={onRemoveMember}
        canManage={canManage}
        onViewReporting={onViewReporting}
      />
    </div>
  );
}

interface SearchableDropdownOption {
  value: string;
  label: string;
}

interface SearchableDropdownProps {
  value: string;
  onValueChange: (value: string) => void;
  options: SearchableDropdownOption[];
  placeholder?: string;
  searchPlaceholder?: string;
  className?: string;
  popoverWidth?: string;
}

function SearchableDropdown({
  value,
  onValueChange,
  options,
  placeholder = "Select...",
  searchPlaceholder = "Search...",
  className,
  popoverWidth = "w-44",
}: SearchableDropdownProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const selectedOption = options.find((opt) => opt.value === value);

  const filteredOptions = useMemo(() => {
    if (!search.trim()) return options;
    const lower = search.toLowerCase();
    return options.filter((opt) => opt.label.toLowerCase().includes(lower));
  }, [options, search]);

  return (
    <Popover
      open={open}
      onOpenChange={(isOpen) => {
        setOpen(isOpen);
        if (!isOpen) setSearch("");
      }}
    >
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn(
            "h-8 text-xs font-normal justify-between rounded-xl bg-muted/30 border-border/60 hover:bg-muted/50 px-2.5",
            className
          )}
        >
          <span className="truncate">{selectedOption?.label ?? placeholder}</span>
          <ChevronDown className="ml-1.5 size-3.5 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className={cn("p-1.5 rounded-xl border border-border shadow-surface-lg z-50 bg-popover", popoverWidth)}
      >
        <div className="space-y-1">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={searchPlaceholder}
              className="h-7 pl-7 text-xs bg-muted/20 border-border/50 rounded-lg"
              autoFocus
            />
          </div>
          <div className="max-h-48 overflow-y-auto space-y-0.5 pt-0.5">
            {filteredOptions.length === 0 ? (
              <div className="py-2.5 text-center text-[11px] text-muted-foreground">
                No results found
              </div>
            ) : (
              filteredOptions.map((opt) => {
                const isSelected = opt.value === value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => {
                      onValueChange(opt.value);
                      setOpen(false);
                      setSearch("");
                    }}
                    className={cn(
                      "w-full flex items-center justify-between px-2 py-1.5 text-xs rounded-lg text-left transition-colors cursor-pointer",
                      isSelected
                        ? "bg-accent text-accent-foreground font-medium"
                        : "text-foreground hover:bg-muted/50"
                    )}
                  >
                    <span className="truncate">{opt.label}</span>
                    {isSelected && <Check className="size-3.5 shrink-0 text-primary" />}
                  </button>
                );
              })
            )}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function TeamDetailsSheet({
  team,
  open,
  teamMembers,
  onClose,
  onAddMemberClick,
  onEditTeam,
  onDeleteTeam,
  onEditMember,
  onRemoveMember,
  onViewReporting,
  canManage,
}: {
  team: TeamItem | null;
  open: boolean;
  teamMembers: MemberItem[];
  onClose: () => void;
  onAddMemberClick: (teamId?: number) => void;
  onEditTeam: (team: TeamItem) => void;
  onDeleteTeam: (teamId: number, teamName: string) => void;
  onEditMember: (member: MemberItem) => void;
  onRemoveMember: (userId: number, fromTeamOnly: boolean) => void;
  onViewReporting: (userId: number) => void;
  canManage: boolean;
}) {
  const activeTeamRef = useRef<TeamItem | null>(team);
  const activeMembersRef = useRef<MemberItem[]>(teamMembers);

  if (team) {
    activeTeamRef.current = team;
    activeMembersRef.current = teamMembers;
  }

  const displayTeam = team ?? activeTeamRef.current;
  const displayMembers = team ? teamMembers : activeMembersRef.current;

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

  if (!displayTeam) {
    return null;
  }

  const leader = displayMembers.find((member) => member.role === "team_leader") ?? null;

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2 text-base">
            <span className="grid size-8 shrink-0 place-items-center rounded-lg border border-blue-500/20 bg-blue-500/10 text-blue-400">
              <Building2 className="size-4" />
            </span>
            {displayTeam.name}
          </SheetTitle>
          <SheetDescription className="sr-only">
            Details and members for team {displayTeam.name}
          </SheetDescription>
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Badge variant="violet" className="gap-1.5 text-[10px]">
              <span className="size-1.5 rounded-full bg-current" />
              Internal Sharing Active
            </Badge>
            <Badge variant="secondary" className="text-[10px]">
              {displayMembers.length} {displayMembers.length === 1 ? "member" : "members"}
            </Badge>
          </div>
        </SheetHeader>

        <div className="space-y-5 px-4 pb-6">
          <section className="space-y-2">
            <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              Team leader
            </h3>
            {leader || displayTeam.leader_name ? (
              <div className="flex items-center gap-3 rounded-xl border border-amber-500/30 bg-amber-500/5 p-4">
                <MemberAvatar
                  name={leader?.name ?? displayTeam.leader_name ?? "TL"}
                  role="team_leader"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-xs font-semibold text-foreground">
                      {leader?.name ?? displayTeam.leader_name}
                    </span>
                    <Crown className="size-3.5 shrink-0 text-amber-500" />
                  </div>
                  {leader?.email && (
                    <div className="truncate font-mono text-[11px] text-muted-foreground">
                      {leader.email}
                    </div>
                  )}
                </div>
                {leader && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onViewReporting(leader.user_id)}
                    className="shrink-0 text-xs"
                  >
                    <GitFork className="size-3.5" />
                    Reporting
                  </Button>
                )}
              </div>
            ) : (
              <div className="flex items-center justify-between rounded-xl border border-border/60 bg-muted/10 p-4">
                <span className="text-xs italic text-muted-foreground">
                  No leader assigned to this team.
                </span>
                {canManage && (
                  <Button variant="outline" size="sm" onClick={() => onEditTeam(displayTeam)}>
                    Assign
                  </Button>
                )}
              </div>
            )}
          </section>

          <section className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                Team members
              </h3>
              {canManage && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => onAddMemberClick(displayTeam.id)}
                  className="text-xs"
                >
                  <UserPlus className="size-3.5" />
                  Add Member
                </Button>
              )}
            </div>
            {displayMembers.length === 0 ? (
              <p className="rounded-lg border border-border/60 bg-muted/10 px-3 py-3 text-xs text-muted-foreground">
                {canManage
                  ? "No members in this team yet. Use “Add Member” to assign someone."
                  : "No members in this team yet."}
              </p>
            ) : (
              <div className="space-y-1.5">
                {displayMembers.map((member) => (
                  <div
                    key={member.user_id}
                    className="flex items-center gap-3 rounded-lg border border-border/60 bg-card px-3 py-2"
                  >
                    <MemberAvatar name={member.name} role={member.role} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate text-xs font-semibold text-foreground">
                          {member.name}
                        </span>
                        <Badge
                          variant={member.role === "team_leader" ? "warning" : "secondary"}
                          className="shrink-0 py-0 text-[10px]"
                        >
                          {getRoleLabel(member.role)}
                        </Badge>
                      </div>
                      <div className="truncate text-[11px] text-muted-foreground">
                        {member.email ?? "no email"}
                        {member.parent_user_name ? ` · reports to ${member.parent_user_name}` : ""}
                      </div>
                    </div>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label={`Actions for ${member.name}`}
                          className="size-8 shrink-0 p-0 cursor-pointer"
                        >
                          <MoreHorizontal className="size-4 text-muted-foreground" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-52 text-xs">
                        <DropdownMenuItem
                          onClick={() => onViewReporting(member.user_id)}
                          className="cursor-pointer gap-2"
                        >
                          <GitFork className="size-3.5 text-primary" />
                          View Reporting Chain
                        </DropdownMenuItem>
                        {canManage && (
                          <>
                            <DropdownMenuItem
                              onClick={() => onEditMember(member)}
                              className="cursor-pointer gap-2"
                            >
                              <Users className="size-3.5 text-muted-foreground" />
                              Edit / Move Team
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              onClick={() => onRemoveMember(member.user_id, true)}
                              className="cursor-pointer gap-2 text-amber-500"
                            >
                              <UserMinus className="size-3.5" />
                              Remove from Team
                            </DropdownMenuItem>
                          </>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                ))}
              </div>
            )}
          </section>

          {canManage && (
            <section className="flex flex-wrap items-center gap-2 border-t border-border/50 pt-4">
              <Button variant="outline" size="sm" onClick={() => onEditTeam(displayTeam)} className="text-xs">
                Edit Team
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => onDeleteTeam(displayTeam.id, displayTeam.name)}
                className="text-xs text-destructive hover:text-destructive"
              >
                <Trash2 className="size-3.5" />
                Delete Team
              </Button>
            </section>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
