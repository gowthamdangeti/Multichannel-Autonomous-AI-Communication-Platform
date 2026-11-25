/**
 * Agent access model — the single place the frontend mirrors the backend
 * utilisation policy. Kept pure so it can be unit-tested and so no component
 * invents its own access rules.
 *
 * Rules (identical to `api/services/workflow/agent_utilization.py`):
 *   Public   — every member of the agent's organization.
 *   Private  — the creator plus members explicitly listed in
 *              ``private_allowed_user_ids``.
 *   Internal — the creator plus every recursive reporting descendant
 *              (parent_user_id chain). Ancestors and sibling branches are
 *              never granted access.
 *
 * Access here is derived from the policy, explicit member list and org
 * hierarchy. The backend remains authoritative and enforces every request.
 */

// Type-only import: erased at runtime, so this module stays loadable by the
// plain-Node test script (which has no "@/…" alias resolver).
import type { AgentUtilization } from "../../../constants/agentUtilization";
import type { HierarchyNode } from "./types";

/**
 * Policy values accepted by the backend (`WorkflowUtilization` /
 * `AgentUtilisationService.UTILIZATION_TYPES`). Runtime companion to the
 * `AgentUtilization` type, which disappears when types are stripped.
 */
export const POLICY_VALUES = ["public", "private", "closed"] as const;

export interface OrgMember {
  userId: number;
  name: string;
  email: string | null;
  role: string;
  teamName: string | null;
  parentUserId: number | null;
}

/** Narrow the creator-only grantable-members API response. */
export function parseOrgMembers(value: unknown): OrgMember[] {
  if (!Array.isArray(value)) return [];
  const members: OrgMember[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object" || !("user_id" in item) || typeof item.user_id !== "number") {
      continue;
    }
    members.push({
      userId: item.user_id,
      name: "name" in item && typeof item.name === "string" ? item.name : `Member #${item.user_id}`,
      email: "email" in item && typeof item.email === "string" ? item.email : null,
      role: "role" in item && typeof item.role === "string" ? item.role : "member",
      teamName: "team_name" in item && typeof item.team_name === "string" ? item.team_name : null,
      parentUserId:
        "parent_user_id" in item && typeof item.parent_user_id === "number"
          ? item.parent_user_id
          : null,
    });
  }
  return members;
}

export type AccessSource = "organization" | "creator" | "reporting-line" | "explicit";

export interface AccessDecision {
  granted: boolean;
  /** Why access is granted; null when it is not. */
  source: AccessSource | null;
  /** Human-readable explanation, granted or restricted. */
  reason: string;
}

/** Label + description for each policy live in `@/constants/agentUtilization`. */
const SOURCE_LABELS: Record<AccessSource, string> = {
  organization: "Public — every member of this organization",
  creator: "Agent creator",
  "reporting-line": "Reports to the creator (directly or indirectly)",
  explicit: "Explicitly granted by the agent creator",
};

export function isAgentUtilization(value: string | null | undefined): value is AgentUtilization {
  return POLICY_VALUES.some((policy) => policy === value);
}

export function normalizePolicy(value: string | null | undefined): AgentUtilization {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  return isAgentUtilization(normalized) ? normalized : "public";
}

export function sourceLabel(source: AccessSource): string {
  return SOURCE_LABELS[source];
}

/**
 * Flat, de-duplicated member list from the organization hierarchy payload.
 * Team context is carried down so a member nested under a team node keeps it.
 */
export function collectOrgMembers(tree: HierarchyNode | null): OrgMember[] {
  if (!tree) return [];
  const byUser = new Map<number, OrgMember>();

  const visit = (node: HierarchyNode, inheritedTeam: string | null) => {
    const team = node.type === "team" ? (node.team_name ?? node.name) : inheritedTeam;
    const isPerson = node.type === "team_leader" || node.type === "member";
    if (isPerson && node.user_id && !byUser.has(node.user_id)) {
      byUser.set(node.user_id, {
        userId: node.user_id,
        name: node.name,
        email: node.email ?? null,
        role: node.role ?? "member",
        teamName: node.team_name ?? team,
        parentUserId: node.parent_user_id ?? null,
      });
    }
    for (const child of node.children ?? []) visit(child, team);
  };

  visit(tree, null);
  return [...byUser.values()];
}

/** Direct reports per member, keyed by manager user id (0 = no manager). */
export function indexByManager(members: OrgMember[]): Map<number, OrgMember[]> {
  const byManager = new Map<number, OrgMember[]>();
  for (const member of members) {
    const key = member.parentUserId ?? 0;
    const list = byManager.get(key);
    if (list) list.push(member);
    else byManager.set(key, [member]);
  }
  return byManager;
}

/**
 * Recursive reporting descendants of `rootUserId`. Cycle-safe: a member that
 * reports (directly or transitively) to itself is visited once.
 */
export function collectDescendantIds(members: OrgMember[], rootUserId: number): Set<number> {
  const byManager = indexByManager(members);
  const descendants = new Set<number>();
  const queue = [rootUserId];

  while (queue.length > 0) {
    const managerId = queue.shift()!;
    for (const report of byManager.get(managerId) ?? []) {
      if (report.userId === rootUserId || descendants.has(report.userId)) continue;
      descendants.add(report.userId);
      queue.push(report.userId);
    }
  }
  return descendants;
}

/**
 * Access decision for every member, under `policy` and `creatorUserId`.
 * Mirrors the backend predicate exactly — including the case where an agent
 * has no recorded creator (Private/Internal then grant nobody).
 */
export function computeAccessMatrix(
  policy: string | null | undefined,
  creatorUserId: number | null | undefined,
  members: OrgMember[],
  allowedUserIds: number[] = [],
): Map<number, AccessDecision> {
  const resolved = normalizePolicy(policy);
  const hasCreator = typeof creatorUserId === "number" && creatorUserId > 0;
  const knownMembers = new Set(members.map((member) => member.userId));
  // Only current members of this organization can hold a grant; anything else
  // in the stored list is ignored (the backend rejects it on write).
  const explicitGrants = new Set(allowedUserIds.filter((id) => knownMembers.has(id)));
  const descendants =
    resolved === "closed" && hasCreator
      ? collectDescendantIds(members, creatorUserId as number)
      : new Set<number>();

  const matrix = new Map<number, AccessDecision>();
  for (const member of members) {
    if (resolved === "public") {
      matrix.set(member.userId, {
        granted: true,
        source: "organization",
        reason: SOURCE_LABELS.organization,
      });
      continue;
    }

    if (member.userId === creatorUserId) {
      matrix.set(member.userId, {
        granted: true,
        source: "creator",
        reason: SOURCE_LABELS.creator,
      });
      continue;
    }

    if (resolved === "private") {
      if (explicitGrants.has(member.userId)) {
        matrix.set(member.userId, {
          granted: true,
          source: "explicit",
          reason: SOURCE_LABELS.explicit,
        });
      } else {
        matrix.set(member.userId, {
          granted: false,
          source: null,
          reason:
            "Private — only the creator and the members explicitly granted access can view or utilise this agent.",
        });
      }
      continue;
    }

    if (!hasCreator) {
      matrix.set(member.userId, {
        granted: false,
        source: null,
        reason:
          "This agent has no recorded creator, so its Internal policy grants nobody.",
      });
      continue;
    }

    if (descendants.has(member.userId)) {
      matrix.set(member.userId, {
        granted: true,
        source: "reporting-line",
        reason: SOURCE_LABELS["reporting-line"],
      });
      continue;
    }

    matrix.set(member.userId, {
      granted: false,
      source: null,
      reason:
        "Outside the creator's reporting line (ancestors and sibling branches are excluded).",
    });
  }
  return matrix;
}

export function countAccessible(matrix: Map<number, AccessDecision>): number {
  let granted = 0;
  for (const decision of matrix.values()) if (decision.granted) granted += 1;
  return granted;
}

/**
 * Access sources for the details panel: one entry per policy rule that is
 * actually in play for this agent.
 */
export function accessSources(
  policy: string | null | undefined,
  creatorUserId: number | null | undefined,
  policyLabel: string,
  explicitGrantCount = 0,
): { key: AccessSource | "explicit"; label: string; active: boolean; detail: string }[] {
  const resolved = normalizePolicy(policy);
  const hasCreator = typeof creatorUserId === "number" && creatorUserId > 0;
  const privateWithGrants = resolved === "private" && explicitGrantCount > 0;

  return [
    {
      key: "organization",
      label: "Public organization access",
      active: resolved === "public",
      detail: "Every member of the organization can view and utilise this agent.",
    },
    {
      key: "creator",
      label: "Creator access",
      active: hasCreator,
      detail: hasCreator
        ? "The agent creator always retains view and utilisation access."
        : "No creator is recorded for this agent.",
    },
    {
      key: "reporting-line",
      label: "Internal reporting tree",
      active: resolved === "closed",
      detail:
        resolved === "closed"
          ? "The creator and every recursive reporting descendant can view and utilise this agent."
          : `Only applies to Internal agents. This agent is ${policyLabel}.`,
    },
    {
      key: "explicit",
      label: "Explicit member grants",
      active: privateWithGrants,
      detail:
        resolved === "private"
          ? "Grants apply to Private agents. The creator can add or remove members on this agent's access panel."
          : `Only applies to Private agents. This agent is ${policyLabel}.`,
    },
  ];
}

/**
 * Label for the "Accessible users" cell: Private agents split the count into
 * the implicit creator plus the explicitly granted members.
 */
export function accessibleUsersLabel(
  policy: string | null | undefined,
  matrix: Map<number, AccessDecision>,
): { total: number; label: string } {
  const total = countAccessible(matrix);
  if (normalizePolicy(policy) !== "private") {
    return { total, label: String(total) };
  }
  let explicit = 0;
  for (const decision of matrix.values()) {
    if (decision.granted && decision.source === "explicit") explicit += 1;
  }
  const creatorPart = total - explicit > 0 ? "1 Creator" : "No creator";
  return { total, label: `${creatorPart} + ${explicit} ${explicit === 1 ? "Member" : "Members"}` };
}

/** The explicit grant list a private agent should store for `userIds`. */
export function grantsForSelection(
  creatorUserId: number | null | undefined,
  members: OrgMember[],
  selectedUserIds: number[],
): number[] {
  const known = new Set(members.map((member) => member.userId));
  return [...new Set(selectedUserIds)]
    .filter((id) => known.has(id) && id !== creatorUserId)
    .sort((a, b) => a - b);
}

/**
 * The narrowest utilisation policy that grants access to all of `targetUserIds`.
 * Used by the grant panel to translate a user selection into the one
 * supported mutation. Returns null when the selection cannot be expressed by
 * any policy (an empty selection, or users the caller cannot see).
 */
export function recommendPolicyForTargets(
  members: OrgMember[],
  creatorUserId: number | null | undefined,
  targetUserIds: number[],
): AgentUtilization | null {
  if (targetUserIds.length === 0) return null;
  const hasCreator = typeof creatorUserId === "number" && creatorUserId > 0;
  const targets = new Set(targetUserIds);
  const known = new Set(members.map((member) => member.userId));
  for (const id of targets) if (!known.has(id)) return null;

  if (hasCreator && targets.size === 1 && targets.has(creatorUserId as number)) {
    return "private";
  }

  if (hasCreator) {
    const descendants = collectDescendantIds(members, creatorUserId as number);
    let coveredByInternal = true;
    for (const id of targets) {
      if (id !== creatorUserId && !descendants.has(id)) {
        coveredByInternal = false;
        break;
      }
    }
    if (coveredByInternal) return "closed";
  }

  return "public";
}

/** Derived access state used by the table's "Access Status" column. */
export function accessStatusOf(policy: string | null | undefined): "granted" | "restricted" {
  return normalizePolicy(policy) === "public" ? "granted" : "restricted";
}
