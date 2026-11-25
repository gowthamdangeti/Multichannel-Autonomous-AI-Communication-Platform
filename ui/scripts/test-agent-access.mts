// Run via `npm run test:agent-access` from ui/ (Node 22/24+ strips TS types).
//
// Mirrors `api/services/workflow/agent_utilization.py`: the frontend must not
// grant anything the backend would refuse, and must not lose an inherited grant.

import assert from "node:assert/strict";

import {
  accessSources,
  accessStatusOf,
  accessibleUsersLabel,
  collectDescendantIds,
  collectOrgMembers,
  computeAccessMatrix,
  countAccessible,
  grantsForSelection,
  indexByManager,
  normalizePolicy,
  recommendPolicyForTargets,
  type OrgMember,
} from "../src/app/teams/components/agentAccess.ts";
import type { HierarchyNode } from "../src/app/teams/components/types.ts";

function member(
  userId: number,
  parentUserId: number | null,
  overrides: Partial<OrgMember> = {},
): OrgMember {
  return {
    userId,
    name: `User ${userId}`,
    email: `u${userId}@example.com`,
    role: "member",
    teamName: "Alpha",
    parentUserId,
    ...overrides,
  };
}

// Org shape: 1 (creator) → 2 → 3 ; 4 is a sibling of 1 ; 5 is a separate branch.
const ORG: OrgMember[] = [
  member(1, null, { role: "team_leader" }),
  member(2, 1),
  member(3, 2),
  member(4, null),
  member(5, null),
];

const grantedIds = (matrix: Map<number, { granted: boolean }>) =>
  [...matrix.entries()].filter(([, d]) => d.granted).map(([id]) => id).sort((a, b) => a - b);

// ── Public: whole organization ────────────────────────────────────────────────
{
  const matrix = computeAccessMatrix("public", 1, ORG);
  assert.deepEqual(grantedIds(matrix), [1, 2, 3, 4, 5]);
  assert.equal(countAccessible(matrix), 5);
  assert.equal(matrix.get(4)!.source, "organization");
}

// ── Private: creator only ─────────────────────────────────────────────────────
{
  const matrix = computeAccessMatrix("private", 1, ORG);
  assert.deepEqual(grantedIds(matrix), [1]);
  assert.equal(matrix.get(1)!.source, "creator");
  assert.equal(matrix.get(2)!.granted, false);
  assert.equal(matrix.get(4)!.granted, false);
}

// ── Internal (backend value "closed"): creator + recursive descendants ────────
{
  const matrix = computeAccessMatrix("closed", 1, ORG);
  assert.deepEqual(grantedIds(matrix), [1, 2, 3]);
  assert.equal(matrix.get(3)!.source, "reporting-line", "a grandchild is covered");
  assert.equal(matrix.get(4)!.granted, false, "a sibling branch must not gain access");
  assert.equal(matrix.get(5)!.granted, false, "an unrelated branch must not gain access");

  // The creator's own manager (an ancestor) must not gain access either.
  const withAncestor = [member(0, null), ...ORG.map((m) => ({ ...m, parentUserId: m.userId === 1 ? 0 : m.parentUserId }))];
  const ancestorMatrix = computeAccessMatrix("closed", 1, withAncestor);
  assert.equal(ancestorMatrix.get(0)!.granted, false, "an ancestor must not inherit access");
  assert.deepEqual(grantedIds(ancestorMatrix), [1, 2, 3]);
}

// ── Descendant traversal is cycle-safe ────────────────────────────────────────
{
  const cyclic = [member(1, 2), member(2, 1)];
  assert.deepEqual([...collectDescendantIds(cyclic, 1)], [2]);
  const matrix = computeAccessMatrix("closed", 1, cyclic);
  assert.equal(countAccessible(matrix), 2, "a cycle must terminate");
}

// ── Agent without a recorded creator ──────────────────────────────────────────
{
  assert.equal(countAccessible(computeAccessMatrix("private", null, ORG)), 0);
  assert.equal(countAccessible(computeAccessMatrix("closed", null, ORG)), 0);
  assert.equal(countAccessible(computeAccessMatrix("public", null, ORG)), 5);
}

// ── Unknown / missing policy falls back to public (backend default) ───────────
{
  assert.equal(normalizePolicy(null), "public");
  assert.equal(normalizePolicy(undefined), "public");
  assert.equal(normalizePolicy("nonsense"), "public");
  assert.equal(normalizePolicy("CLOSED"), "closed", "policy values are case-insensitive");
}

// ── Grant panel: selection → narrowest supported policy ───────────────────────
{
  assert.equal(recommendPolicyForTargets(ORG, 1, []), null, "empty selection has no policy");
  assert.equal(recommendPolicyForTargets(ORG, 1, [1]), "private");
  assert.equal(recommendPolicyForTargets(ORG, 1, [1, 3]), "closed");
  assert.equal(recommendPolicyForTargets(ORG, 1, [3]), "closed", "a descendant alone fits Internal");
  assert.equal(recommendPolicyForTargets(ORG, 1, [4]), "public", "a sibling needs Public");
  assert.equal(recommendPolicyForTargets(ORG, 1, [999]), null, "unknown user cannot be granted");
  assert.equal(recommendPolicyForTargets(ORG, null, [1]), "public", "no creator → only Public covers anyone");
}

// ── Hierarchy → flat members ──────────────────────────────────────────────────
{
  const person = (
    userId: number,
    parent: number | null,
    children: HierarchyNode[] = [],
    role = "member",
  ): HierarchyNode => ({
    id: `member-${userId}`,
    type: role === "team_leader" ? "team_leader" : "member",
    name: `User ${userId}`,
    email: `u${userId}@example.com`,
    role,
    team_id: null,
    team_name: null,
    user_id: userId,
    parent_user_id: parent,
    direct_reports_count: children.length,
    total_descendants_count: 0,
    children,
  });

  const tree: HierarchyNode = {
    id: "tenant-root",
    type: "tenant",
    name: "Tenant",
    direct_reports_count: 0,
    total_descendants_count: 0,
    children: [
      {
        id: "org-1",
        type: "organization",
        name: "Org",
        direct_reports_count: 1,
        total_descendants_count: 1,
        children: [
          {
            id: "team-9",
            type: "team",
            name: "Support",
            team_id: 9,
            team_name: "Support",
            direct_reports_count: 1,
            total_descendants_count: 1,
            children: [person(1, null, [person(2, 1)], "team_leader")],
          },
        ],
      },
    ],
  };

  const members = collectOrgMembers(tree);
  assert.equal(members.length, 2, "each person appears exactly once");
  assert.deepEqual(members.map((m) => m.userId).sort(), [1, 2]);
  assert.equal(members[0]!.teamName, "Support", "team context is inherited from the team node");
  assert.equal(members[1]!.parentUserId, 1);

  assert.equal(collectOrgMembers(null).length, 0);

  const byManager = indexByManager(members);
  assert.deepEqual(byManager.get(1)!.map((m) => m.userId), [2]);
}

// ── Table status + access sources ─────────────────────────────────────────────
{
  assert.equal(accessStatusOf("public"), "granted");
  assert.equal(accessStatusOf("private"), "restricted");
  assert.equal(accessStatusOf("closed"), "restricted");

  const sources = accessSources("closed", 1, "Internal");
  assert.equal(sources.find((s) => s.key === "reporting-line")!.active, true);
  assert.equal(sources.find((s) => s.key === "organization")!.active, false);
  assert.equal(
    sources.find((s) => s.key === "explicit")!.active,
    false,
    "explicit grants are not supported and must never render as active",
  );
}

// ── Private with explicit grants ─────────────────────────────────────────────
{
  const noGrants = computeAccessMatrix("private", 1, ORG, []);
  assert.deepEqual(grantedIds(noGrants), [1], "no grants → creator only");

  const matrix = computeAccessMatrix("private", 1, ORG, [4]);
  assert.deepEqual(grantedIds(matrix), [1, 4]);
  assert.equal(matrix.get(4)!.source, "explicit");
  assert.equal(matrix.get(2)!.granted, false, "an ungranted report stays restricted");
  assert.equal(matrix.get(5)!.granted, false);

  // A grant naming an outsider (not a member of this organization) is ignored.
  const withOutsider = computeAccessMatrix("private", 1, ORG, [4, 999]);
  assert.deepEqual(grantedIds(withOutsider), [1, 4]);

  // The creator is never double-counted as an explicit grant.
  const withCreator = computeAccessMatrix("private", 1, ORG, [1, 4]);
  assert.equal(withCreator.get(1)!.source, "creator");
  assert.equal(countAccessible(withCreator), 2);

  const label = accessibleUsersLabel("private", matrix);
  assert.equal(label.total, 2);
  assert.equal(label.label, "1 Creator + 1 Member");
  assert.equal(accessibleUsersLabel("private", computeAccessMatrix("private", 1, ORG, [2, 3])).label, "1 Creator + 2 Members");
  assert.equal(accessibleUsersLabel("public", computeAccessMatrix("public", 1, ORG)).label, "5");
  assert.equal(accessibleUsersLabel("closed", computeAccessMatrix("closed", 1, ORG)).label, "3");

  // Selective grant list: creator + current members only, deduped and sorted.
  assert.deepEqual(grantsForSelection(1, ORG, [4, 4, 1, 999, 2]), [2, 4]);
  assert.deepEqual(grantsForSelection(1, ORG, []), []);

  // The explicit source reports as active once grants exist.
  assert.equal(accessSources("private", 1, "Private", 2).find((s) => s.key === "explicit")!.active, true);
  assert.equal(accessSources("private", 1, "Private", 0).find((s) => s.key === "explicit")!.active, false);
  assert.equal(accessSources("closed", 1, "Internal", 3).find((s) => s.key === "explicit")!.active, false);

  // Grants never widen another policy.
  assert.deepEqual(grantedIds(computeAccessMatrix("closed", 1, ORG, [4])), [1, 2, 3]);
  assert.equal(countAccessible(computeAccessMatrix("public", 1, ORG, [4])), 5);
}

console.log("agent access tests passed");