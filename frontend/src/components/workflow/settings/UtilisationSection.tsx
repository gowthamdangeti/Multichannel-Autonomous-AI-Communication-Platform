"use client";

import { Loader2, Search, Users } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { getRoleAvatarStyle, getRoleLabel } from "@/app/teams/components/roleStyles";
import { updateWorkflowApiV1WorkflowWorkflowIdPut } from "@/client/sdk.gen";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
    AGENT_UTILIZATION_OPTIONS,
    type AgentUtilization,
    agentUtilizationOption,
    DEFAULT_AGENT_UTILIZATION,
} from "@/constants/agentUtilization";
import { detailFromError } from "@/lib/apiError";
import { useAuth } from "@/lib/auth";
import { fetchOrgMembers, type OrgMemberOption } from "@/lib/orgMembers";
import { cn } from "@/lib/utils";

interface UtilisationSectionProps {
    workflowId: number;
    workflowName: string;
    /** Current policy from the workflow response (absent on older payloads). */
    utilizationType?: string | null;
    privateAllowedUserIds?: number[] | null;
    creatorUserId?: number | null;
    /** Authoritative creator check from the workflow detail response. */
    isCreator: boolean;
    /** Called after a successful save so the page can refresh its state. */
    onSaved?: (value: AgentUtilization, privateAllowedUserIds: number[]) => void;
}

/**
 * Agent utilisation policy editor. Persists through the workflow update
 * endpoint (`utilization_type` + `private_allowed_user_ids`), which the backend
 * validates and authorises: only the agent creator may change either.
 *
 * Public and Internal derive access from the organization / reporting tree;
 * Private additionally carries an explicit member list.
 */
export function UtilisationSection({
    workflowId,
    workflowName,
    utilizationType,
    privateAllowedUserIds,
    isCreator,
    creatorUserId,
    onSaved,
}: UtilisationSectionProps) {
    const { getAccessToken } = useAuth();
    const savedPolicy = agentUtilizationOption(utilizationType).value;
    const savedGrantees = useMemo(
        () => [...(privateAllowedUserIds ?? [])].sort((a, b) => a - b),
        [privateAllowedUserIds],
    );

    const [selected, setSelected] = useState<AgentUtilization>(
        (utilizationType as AgentUtilization) ?? DEFAULT_AGENT_UTILIZATION,
    );
    const [grantees, setGrantees] = useState<number[]>(savedGrantees);
    const [members, setMembers] = useState<OrgMemberOption[]>([]);
    const [membersLoading, setMembersLoading] = useState(false);
    const [memberError, setMemberError] = useState<string | null>(null);
    const [memberSearch, setMemberSearch] = useState("");
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const isPrivate = selected === "private";

    const loadMembers = useCallback(async () => {
        setMembersLoading(true);
        setMemberError(null);
        try {
            const token = await getAccessToken();
            setMembers(await fetchOrgMembers(token, workflowId));
        } catch (err) {
            setMemberError(
                err instanceof Error ? err.message : "Failed to load organization members.",
            );
        } finally {
            setMembersLoading(false);
        }
    }, [getAccessToken, workflowId]);

    // Only the agent creator can request the org-wide list of grant candidates.
    useEffect(() => {
        if (isPrivate && isCreator && members.length === 0 && !membersLoading && !memberError) {
            void loadMembers();
        }
    }, [isPrivate, isCreator, members.length, membersLoading, memberError, loadMembers]);

    useEffect(() => {
        setGrantees(savedGrantees);
    }, [savedGrantees]);

    const selectableMembers = useMemo(
        () => members.filter((member) => member.userId !== creatorUserId),
        [members, creatorUserId],
    );

    const visibleMembers = useMemo(() => {
        const term = memberSearch.trim().toLowerCase();
        if (!term) return selectableMembers;
        return selectableMembers.filter(
            (member) =>
                member.name.toLowerCase().includes(term) ||
                Boolean(member.email?.toLowerCase().includes(term)) ||
                Boolean(member.teamName?.toLowerCase().includes(term)),
        );
    }, [selectableMembers, memberSearch]);

    const granteesSorted = useMemo(() => [...grantees].sort((a, b) => a - b), [grantees]);
    const granteesDirty =
        isPrivate && granteesSorted.join(",") !== savedGrantees.join(",");
    const isDirty = selected !== savedPolicy || granteesDirty;

    const toggleGrantee = (userId: number) => {
        setGrantees((previous) =>
            previous.includes(userId)
                ? previous.filter((id) => id !== userId)
                : [...previous, userId],
        );
    };

    const save = async () => {
        setIsSaving(true);
        setError(null);
        try {
            const response = await updateWorkflowApiV1WorkflowWorkflowIdPut({
                path: { workflow_id: workflowId },
                body: {
                    name: workflowName,
                    workflow_definition: null,
                    // Newer than the generated types — sent explicitly.
                    utilization_type: selected,
                    ...(isPrivate ? { private_allowed_user_ids: granteesSorted } : {}),
                } as {
                    name: string;
                    workflow_definition: null;
                    utilization_type: AgentUtilization;
                    private_allowed_user_ids?: number[];
                },
            });
            if (response.error) {
                setError(detailFromError(response.error, "Failed to update agent utilisation"));
                return;
            }
            toast.success("Agent utilisation updated");
            onSaved?.(selected, isPrivate ? granteesSorted : []);
        } catch (err) {
            setError(detailFromError(err, "Failed to update agent utilisation"));
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <Card id="utilisation">
            <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                    <Users className="h-4 w-4" />
                    Utilisation
                </CardTitle>
                <CardDescription>
                    Choose who can view and utilise this agent.
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                <div className="space-y-2">
                    <Label htmlFor="agent-utilisation" className="text-sm font-medium">
                        Access
                    </Label>
                    <Select
                        disabled={!isCreator}
                        value={selected}
                        onValueChange={(value) => setSelected(value as AgentUtilization)}
                    >
                        <SelectTrigger id="agent-utilisation" className="max-w-sm">
                            <SelectValue placeholder="Select utilisation" />
                        </SelectTrigger>
                        <SelectContent>
                            {AGENT_UTILIZATION_OPTIONS.map((option) => (
                                <SelectItem key={option.value} value={option.value}>
                                    {option.label}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                        {agentUtilizationOption(selected).description}
                    </p>
                </div>

                {isPrivate && (
                    <div className="space-y-2">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                            <Label className="text-sm font-medium">Grant access to members</Label>
                            <Badge variant="secondary" className="text-[11px]">
                                {granteesSorted.length} selected
                            </Badge>
                        </div>
                        {isCreator ? (
                            <>
                        <p className="text-xs text-muted-foreground">
                            The creator always has access. Selected members are added on top of it.
                        </p>

                        <div className="relative max-w-sm">
                            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                            <Input
                                value={memberSearch}
                                onChange={(event) => setMemberSearch(event.target.value)}
                                placeholder="Search members by name, email or team…"
                                aria-label="Search members to grant access"
                                className="h-9 pl-10 text-xs"
                            />
                        </div>

                        {membersLoading && (
                            <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                <Loader2 className="size-3.5 animate-spin" />
                                Loading organization members…
                            </div>
                        )}
                        {memberError && (
                            <div className="flex items-center gap-2 text-xs text-destructive">
                                {memberError}
                                <Button variant="outline" size="sm" onClick={() => void loadMembers()}>
                                    Retry
                                </Button>
                            </div>
                        )}

                        {!membersLoading && !memberError && (
                            <div className="max-h-64 space-y-1 overflow-y-auto rounded-xl border border-border bg-card p-2">
                                {visibleMembers.map((member) => {
                                    const checked = grantees.includes(member.userId);
                                    return (
                                        <label
                                            key={member.userId}
                                            className={cn(
                                                "flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2",
                                                checked
                                                    ? "border-primary/50 bg-primary/5"
                                                    : "border-border/60",
                                            )}
                                        >
                                            <Checkbox
                                                checked={checked}
                                                onCheckedChange={() => toggleGrantee(member.userId)}
                                                aria-label={`Grant access to ${member.name}`}
                                            />
                                            <span
                                                className={cn(
                                                    "grid size-8 shrink-0 place-items-center rounded-full border text-[11px] font-semibold",
                                                    getRoleAvatarStyle(member.role),
                                                )}
                                            >
                                                {member.name.slice(0, 2).toUpperCase()}
                                            </span>
                                            <span className="min-w-0 flex-1">
                                                <span className="flex items-center gap-2">
                                                    <span className="truncate text-xs font-semibold text-foreground">
                                                        {member.name}
                                                    </span>
                                                    <Badge variant="secondary" className="py-0 text-[10px]">
                                                        {getRoleLabel(member.role)}
                                                    </Badge>
                                                    {member.teamName && (
                                                        <Badge variant="outline" className="py-0 text-[10px]">
                                                            {member.teamName}
                                                        </Badge>
                                                    )}
                                                </span>
                                                <span className="block truncate text-[11px] text-muted-foreground">
                                                    {member.email ?? "no email"}
                                                </span>
                                            </span>
                                        </label>
                                    );
                                })}
                                {visibleMembers.length === 0 && (
                                    <p className="px-3 py-2 text-xs text-muted-foreground">
                                        No members match.
                                    </p>
                                )}
                            </div>
                        )}
                            </>
                        ) : (
                            <p className="rounded-lg border border-border/60 bg-muted/10 px-3 py-2 text-xs text-muted-foreground">
                                Only the agent creator can view or change this explicit member list.
                                Current grants: {savedGrantees.length}.
                            </p>
                        )}
                    </div>
                )}

                {error && <p className="text-xs text-red-500">{error}</p>}
            </CardContent>
            <CardFooter className="justify-end gap-3 border-t pt-6">
                {isDirty && <span className="text-xs text-muted-foreground">Unsaved changes</span>}
                <Button
                    onClick={save}
                    disabled={!isCreator || isSaving || !isDirty || (isPrivate && membersLoading)}
                >
                    {isSaving ? "Saving..." : "Save Utilisation"}
                </Button>
            </CardFooter>
        </Card>
    );
}
