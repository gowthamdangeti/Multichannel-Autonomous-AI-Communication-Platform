"use client";

import {
  Building2,
  Crown,
  GitFork,
  UserPlus,
  Users,
} from "lucide-react";
import React, { useEffect, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import type { MemberItem, MemberReportingData, TeamItem } from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// 1. Create Team Modal
// ─────────────────────────────────────────────────────────────────────────────

interface CreateTeamModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  members: MemberItem[];
  onSubmit: (name: string, leaderUserId: number | null) => Promise<void>;
}

export function CreateTeamModal({
  open,
  onOpenChange,
  members,
  onSubmit,
}: CreateTeamModalProps) {
  const [name, setName] = useState("");
  const [leaderId, setLeaderId] = useState<string>("none");
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      toast.error("Please enter a valid team name.");
      return;
    }
    setSaving(true);
    try {
      await onSubmit(name.trim(), leaderId !== "none" ? Number(leaderId) : null);
      setName("");
      setLeaderId("none");
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create team.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[440px] rounded-2xl">
        <DialogHeader>
          <div className="size-10 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-400 mb-2">
            <Building2 className="size-5" />
          </div>
          <DialogTitle className="text-base font-semibold">Create New Team</DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            Teams group members into functional units and enable downward Internal agent utilisation.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 pt-2">
          <div className="space-y-1.5">
            <Label htmlFor="team-name" className="text-xs font-semibold">
              Team Name <span className="text-destructive">*</span>
            </Label>
            <Input
              id="team-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Sales, Customer Support, Engineering"
              className="h-9 text-xs rounded-xl"
              autoFocus
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="team-leader" className="text-xs font-semibold">
              Team Leader <span className="text-muted-foreground font-normal">(Optional)</span>
            </Label>
            <Select value={leaderId} onValueChange={setLeaderId}>
              <SelectTrigger id="team-leader" className="h-9 text-xs rounded-xl">
                <SelectValue placeholder="Assign a Team Leader..." />
              </SelectTrigger>
              <SelectContent className="text-xs">
                <SelectItem value="none">No leader assigned</SelectItem>
                {members.map((m) => (
                  <SelectItem key={m.user_id} value={String(m.user_id)}>
                    {m.name} {m.email ? `(${m.email})` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground">
              Team Leaders can distribute internal agents downwards across their reporting tree.
            </p>
          </div>

          <DialogFooter className="pt-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onOpenChange(false)}
              className="text-xs rounded-xl cursor-pointer"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={saving || !name.trim()}
              className="text-xs rounded-xl cursor-pointer"
            >
              {saving ? "Creating..." : "Create Team"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Edit Team Modal
// ─────────────────────────────────────────────────────────────────────────────

interface EditTeamModalProps {
  team: TeamItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  members: MemberItem[];
  onSubmit: (teamId: number, name: string, leaderUserId: number | null) => Promise<void>;
}

export function EditTeamModal({
  team,
  open,
  onOpenChange,
  members,
  onSubmit,
}: EditTeamModalProps) {
  const [name, setName] = useState("");
  const [leaderId, setLeaderId] = useState<string>("none");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (team) {
      setName(team.name);
      setLeaderId(team.leader_user_id ? String(team.leader_user_id) : "none");
    }
  }, [team]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!team || !name.trim()) return;
    setSaving(true);
    try {
      await onSubmit(team.id, name.trim(), leaderId !== "none" ? Number(leaderId) : null);
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update team.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[440px] rounded-2xl">
        <DialogHeader>
          <div className="size-10 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-400 mb-2">
            <Building2 className="size-5" />
          </div>
          <DialogTitle className="text-base font-semibold">Edit Team</DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            Update team name and leadership assignment.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 pt-2">
          <div className="space-y-1.5">
            <Label htmlFor="edit-team-name" className="text-xs font-semibold">
              Team Name
            </Label>
            <Input
              id="edit-team-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="h-9 text-xs rounded-xl"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="edit-team-leader" className="text-xs font-semibold">
              Team Leader
            </Label>
            <Select value={leaderId} onValueChange={setLeaderId}>
              <SelectTrigger id="edit-team-leader" className="h-9 text-xs rounded-xl">
                <SelectValue placeholder="Assign a Team Leader..." />
              </SelectTrigger>
              <SelectContent className="text-xs">
                <SelectItem value="none">No leader assigned</SelectItem>
                {members.map((m) => (
                  <SelectItem key={m.user_id} value={String(m.user_id)}>
                    {m.name} {m.email ? `(${m.email})` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <DialogFooter className="pt-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onOpenChange(false)}
              className="text-xs rounded-xl cursor-pointer"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={saving || !name.trim()}
              className="text-xs rounded-xl cursor-pointer"
            >
              {saving ? "Saving..." : "Save Changes"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Add Member Modal
// ─────────────────────────────────────────────────────────────────────────────

interface AddMemberModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  teams: TeamItem[];
  members: MemberItem[];
  preselectedTeamId?: number | null;
  preselectedManagerId?: number | null;
  onSubmit: (payload: {
    email: string;
    first_name?: string;
    last_name?: string;
    role: string;
    team_id?: number | null;
    parent_user_id?: number | null;
  }) => Promise<void>;
}

export function AddMemberModal({
  open,
  onOpenChange,
  teams,
  members,
  preselectedTeamId,
  preselectedManagerId,
  onSubmit,
}: AddMemberModalProps) {
  const [email, setEmail] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [role, setRole] = useState("member");
  const [teamId, setTeamId] = useState<string>("none");
  const [managerId, setManagerId] = useState<string>("none");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (preselectedTeamId) setTeamId(String(preselectedTeamId));
    if (preselectedManagerId) setManagerId(String(preselectedManagerId));
  }, [preselectedTeamId, preselectedManagerId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) {
      toast.error("Please enter a valid email address.");
      return;
    }
    setSaving(true);
    try {
      await onSubmit({
        email: email.trim().toLowerCase(),
        first_name: firstName.trim() || undefined,
        last_name: lastName.trim() || undefined,
        role,
        team_id: teamId !== "none" ? Number(teamId) : null,
        parent_user_id: managerId !== "none" ? Number(managerId) : null,
      });
      setEmail("");
      setFirstName("");
      setLastName("");
      setRole("member");
      setTeamId("none");
      setManagerId("none");
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to add member.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[460px] rounded-2xl">
        <DialogHeader>
          <div className="size-10 rounded-xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center text-purple-400 mb-2">
            <UserPlus className="size-5" />
          </div>
          <DialogTitle className="text-base font-semibold">Add Organization Member</DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            Invite an employee and configure their role, team, and reporting manager.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-3.5 pt-2">
          <div className="space-y-1.5">
            <Label htmlFor="mem-email" className="text-xs font-semibold">
              Email Address <span className="text-destructive">*</span>
            </Label>
            <Input
              id="mem-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="colleague@company.com"
              className="h-9 text-xs rounded-xl"
              autoFocus
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="mem-fname" className="text-xs font-semibold">
                First Name
              </Label>
              <Input
                id="mem-fname"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                placeholder="Jane"
                className="h-9 text-xs rounded-xl"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="mem-lname" className="text-xs font-semibold">
                Last Name
              </Label>
              <Input
                id="mem-lname"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                placeholder="Doe"
                className="h-9 text-xs rounded-xl"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="mem-role" className="text-xs font-semibold">
                Role
              </Label>
              <Select value={role} onValueChange={setRole}>
                <SelectTrigger id="mem-role" className="h-9 text-xs rounded-xl">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="text-xs">
                  <SelectItem value="member">Member</SelectItem>
                  <SelectItem value="team_leader">Team Leader</SelectItem>
                  <SelectItem value="admin">Organization Admin</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="mem-team" className="text-xs font-semibold">
                Team
              </Label>
              <Select value={teamId} onValueChange={setTeamId}>
                <SelectTrigger id="mem-team" className="h-9 text-xs rounded-xl">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="text-xs">
                  <SelectItem value="none">No Team (Unassigned)</SelectItem>
                  {teams.map((t) => (
                    <SelectItem key={t.id} value={String(t.id)}>
                      {t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="mem-manager" className="text-xs font-semibold">
              Reporting Manager <span className="text-muted-foreground font-normal">(Controls internal access)</span>
            </Label>
            <Select value={managerId} onValueChange={setManagerId}>
              <SelectTrigger id="mem-manager" className="h-9 text-xs rounded-xl">
                <SelectValue placeholder="Select reporting manager..." />
              </SelectTrigger>
              <SelectContent className="text-xs">
                <SelectItem value="none">Top Level (Reports to nobody)</SelectItem>
                {members.map((m) => (
                  <SelectItem key={m.user_id} value={String(m.user_id)}>
                    {m.name} {m.team_name ? `(${m.team_name})` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <DialogFooter className="pt-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onOpenChange(false)}
              className="text-xs rounded-xl cursor-pointer"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={saving || !email.trim()}
              className="text-xs rounded-xl cursor-pointer"
            >
              {saving ? "Adding..." : "Add Member"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. Edit Member Modal
// ─────────────────────────────────────────────────────────────────────────────

interface EditMemberModalProps {
  member: MemberItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  teams: TeamItem[];
  members: MemberItem[];
  onSubmit: (
    userId: number,
    payload: {
      role: string;
      team_id?: number | null;
      parent_user_id?: number | null;
      clear_team?: boolean;
      clear_parent?: boolean;
    }
  ) => Promise<void>;
}

export function EditMemberModal({
  member,
  open,
  onOpenChange,
  teams,
  members,
  onSubmit,
}: EditMemberModalProps) {
  const [role, setRole] = useState("member");
  const [teamId, setTeamId] = useState<string>("none");
  const [managerId, setManagerId] = useState<string>("none");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (member) {
      setRole(member.role || "member");
      setTeamId(member.team_id ? String(member.team_id) : "none");
      setManagerId(member.parent_user_id ? String(member.parent_user_id) : "none");
    }
  }, [member]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!member) return;
    setSaving(true);
    try {
      await onSubmit(member.user_id, {
        role,
        team_id: teamId !== "none" ? Number(teamId) : null,
        clear_team: teamId === "none",
        parent_user_id: managerId !== "none" ? Number(managerId) : null,
        clear_parent: managerId === "none",
      });
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update member.");
    } finally {
      setSaving(false);
    }
  };

  const eligibleManagers = members.filter((m) => m.user_id !== member?.user_id);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[440px] rounded-2xl">
        <DialogHeader>
          <div className="size-10 rounded-xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center text-purple-400 mb-2">
            <Users className="size-5" />
          </div>
          <DialogTitle className="text-base font-semibold">
            Edit Member: {member?.name}
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            Update role, assign to a team, or reassign reporting line.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 pt-2">
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold">Role</Label>
            <Select value={role} onValueChange={setRole}>
              <SelectTrigger className="h-9 text-xs rounded-xl">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="text-xs">
                <SelectItem value="member">Member</SelectItem>
                <SelectItem value="team_leader">Team Leader</SelectItem>
                <SelectItem value="admin">Organization Admin</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs font-semibold">Assigned Team</Label>
            <Select value={teamId} onValueChange={setTeamId}>
              <SelectTrigger className="h-9 text-xs rounded-xl">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="text-xs">
                <SelectItem value="none">No Team (Unassigned)</SelectItem>
                {teams.map((t) => (
                  <SelectItem key={t.id} value={String(t.id)}>
                    {t.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs font-semibold">Reporting Manager</Label>
            <Select value={managerId} onValueChange={setManagerId}>
              <SelectTrigger className="h-9 text-xs rounded-xl">
                <SelectValue placeholder="Select manager..." />
              </SelectTrigger>
              <SelectContent className="text-xs">
                <SelectItem value="none">Top Level (No superior)</SelectItem>
                {eligibleManagers.map((m) => (
                  <SelectItem key={m.user_id} value={String(m.user_id)}>
                    {m.name} {m.team_name ? `(${m.team_name})` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground">
              Circular reporting is automatically prevented by the server.
            </p>
          </div>

          <DialogFooter className="pt-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onOpenChange(false)}
              className="text-xs rounded-xl cursor-pointer"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={saving}
              className="text-xs rounded-xl cursor-pointer"
            >
              {saving ? "Saving..." : "Save Changes"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. Reporting Chain Modal
// ─────────────────────────────────────────────────────────────────────────────

interface ReportingChainModalProps {
  data: MemberReportingData | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ReportingChainModal({
  data,
  open,
  onOpenChange,
}: ReportingChainModalProps) {
  if (!data) return null;
  const { member, manager_chain, direct_reports, total_descendants_count } = data;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px] rounded-2xl">
        <DialogHeader>
          <div className="size-10 rounded-xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center text-purple-400 mb-2">
            <GitFork className="size-5" />
          </div>
          <DialogTitle className="text-base font-semibold">
            Reporting Hierarchy: {member.name}
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            Upward management line and downward subordinate reporting structure.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 pt-2">
          {/* Upward Manager Chain */}
          <div>
            <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider block mb-2">
              Management Chain (Upward)
            </span>
            {manager_chain.length === 0 ? (
              <div className="p-3 rounded-xl border border-border/60 bg-muted/20 text-xs text-muted-foreground italic">
                {member.name} is at the top level and reports to no superior.
              </div>
            ) : (
              <div className="space-y-1.5">
                {manager_chain.map((mgr, idx) => (
                  <div
                    key={mgr.user_id}
                    className="flex items-center gap-2 p-2.5 rounded-xl border border-border/60 bg-muted/15 text-xs"
                  >
                    <span className="text-[10px] font-mono text-muted-foreground w-5 shrink-0">
                      L{manager_chain.length - idx}
                    </span>
                    <span className="font-semibold text-foreground truncate">{mgr.name}</span>
                    <span className="text-[11px] text-muted-foreground/80 font-mono truncate">
                      {mgr.email}
                    </span>
                    {mgr.role === "team_leader" && (
                      <Crown className="size-3 text-amber-500 ml-auto shrink-0" />
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Current Target Member Highlight */}
          <div className="p-3.5 rounded-xl border-2 border-primary/40 bg-primary/8 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="size-8 rounded-full bg-primary/20 text-primary font-bold text-xs flex items-center justify-center">
                {member.name.slice(0, 2).toUpperCase()}
              </div>
              <div>
                <span className="font-semibold text-xs text-foreground block">{member.name}</span>
                <span className="text-[11px] text-muted-foreground font-mono">{member.email}</span>
              </div>
            </div>
            <Badge variant="outline" className="text-[10px] bg-primary/10 text-primary border-primary/30">
              Active Member
            </Badge>
          </div>

          {/* Downward Subordinates */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                Direct Reports ({directReportsCount(direct_reports)})
              </span>
              <span className="text-[11px] text-purple-400 font-medium">
                {total_descendants_count} Total Downstream
              </span>
            </div>

            {direct_reports.length === 0 ? (
              <div className="p-3 rounded-xl border border-border/60 bg-muted/20 text-xs text-muted-foreground italic">
                No direct subordinates reporting to {member.name}.
              </div>
            ) : (
              <div className="space-y-1.5 max-h-48 overflow-y-auto">
                {direct_reports.map((sub) => (
                  <div
                    key={sub.user_id}
                    className="flex items-center justify-between gap-2 p-2 rounded-xl border border-border/50 bg-card text-xs"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="size-6 rounded-full bg-muted flex items-center justify-center text-[10px] font-bold">
                        {sub.name.slice(0, 2).toUpperCase()}
                      </div>
                      <span className="font-medium text-foreground truncate">{sub.name}</span>
                    </div>
                    <span className="text-[11px] text-muted-foreground font-mono truncate">
                      {sub.email}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <DialogFooter className="pt-2">
          <Button
            type="button"
            size="sm"
            onClick={() => onOpenChange(false)}
            className="text-xs rounded-xl cursor-pointer"
          >
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function directReportsCount(list: MemberItem[]): number {
  return list ? list.length : 0;
}

