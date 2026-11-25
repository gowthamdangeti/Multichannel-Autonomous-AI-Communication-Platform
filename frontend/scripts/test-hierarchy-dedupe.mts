// Run via `npm run test:hierarchy-dedupe` from ui/ (Node 22/24+ strips TS types).
//
// Regression tests for the reporting chart layout: a person must render as a
// single card no matter how the backend tree is shaped.

import assert from "node:assert/strict";

import {
  buildHierarchyLayout,
  collectRenderedUserIds,
} from "../src/app/teams/components/hierarchyLayout.ts";
import type {
  HierarchyNode,
  MemberItem,
} from "../src/app/teams/components/types.ts";
import {
  getRoleAvatarStyle,
  getRoleLabel,
} from "../src/app/teams/components/roleStyles.ts";

function member(
  user_id: number,
  overrides: Partial<MemberItem> = {},
): MemberItem {
  return {
    user_id,
    name: `User ${user_id}`,
    email: `u${user_id}@example.com`,
    first_name: null,
    last_name: null,
    role: "member",
    team_id: null,
    team_name: null,
    parent_user_id: null,
    parent_user_name: null,
    created_at: null,
    ...overrides,
  };
}

function person(
  user_id: number,
  overrides: Partial<HierarchyNode> = {},
  children: HierarchyNode[] = [],
): HierarchyNode {
  return {
    id: `member-${user_id}`,
    type: "member",
    name: `User ${user_id}`,
    email: null,
    role: null,
    team_id: null,
    team_name: null,
    user_id,
    parent_user_id: null,
    direct_reports_count: children.length,
    total_descendants_count: 0,
    children,
    ...overrides,
  };
}

function teamNode(
  team_id: number,
  name: string,
  children: HierarchyNode[],
): HierarchyNode {
  return {
    id: `team-${team_id}`,
    type: "team",
    name,
    team_id,
    team_name: name,
    direct_reports_count: children.length,
    total_descendants_count: children.length,
    children,
  };
}

function tenantOf(children: HierarchyNode[]): HierarchyNode {
  return {
    id: "tenant-root",
    type: "tenant",
    name: "Tenant: Convozent Platform",
    direct_reports_count: 0,
    total_descendants_count: 0,
    children: [
      {
        id: "org-1",
        type: "organization",
        name: "Organization: Workspace",
        direct_reports_count: children.length,
        total_descendants_count: children.length,
        children,
      },
    ],
  };
}

/** Asserts the invariant under test: nobody is drawn twice. */
function assertNoDuplicateCards(roots: HierarchyNode[], label: string) {
  const rendered = collectRenderedUserIds(roots);
  assert.equal(
    new Set(rendered).size,
    rendered.length,
    `${label}: a user was rendered twice (rendered user_ids: ${rendered.join(", ")})`,
  );
  return rendered;
}

// ── 1. The reported bug: a leader with a reportee was drawn twice ─────────────
{
  const members = new Map<number, MemberItem>([
    [1, member(1, { name: "Gowtham", role: "team_leader", team_id: 305, team_name: "testing" })],
    [1664, member(1664, { name: "Durga", role: "admin", team_id: 305, team_name: "testing", parent_user_id: 1 })],
  ]);
  const tree = tenantOf([
    teamNode(305, "testing", [
      person(1, { type: "team_leader", role: "team_leader", name: "Gowtham", team_name: "testing" }, [
        person(1664, { role: "admin", name: "Durga", parent_user_id: 1, team_name: "testing" }),
      ]),
    ]),
  ]);

  const { roots, multiTeamMap } = buildHierarchyLayout(tree, members);
  assert.equal(roots.length, 1, "only the manager should be a top-level root");
  assert.equal(roots[0]!.user_id, 1, "Gowtham must be the single root");
  assert.deepEqual(
    roots[0]!.children.map((c) => c.user_id),
    [1664],
    "Durga must be a single child of Gowtham",
  );
  const rendered = assertNoDuplicateCards(roots, "reported bug");
  assert.deepEqual(rendered, [1, 1664]);
  assert.equal(multiTeamMap.size, 0, "no multi-team annotation is expected");
}

// ── 2. The same user repeated across two teams in the payload ────────────────
{
  const members = new Map<number, MemberItem>([
    [1, member(1, { name: "Lead", role: "team_leader", team_id: 10, team_name: "Alpha" })],
    [7, member(7, { name: "Shared", role: "member", team_id: 10, team_name: "Alpha", parent_user_id: 1 })],
  ]);
  const tree = tenantOf([
    teamNode(10, "Alpha", [
      person(1, { type: "team_leader", role: "team_leader", name: "Lead", team_name: "Alpha" }, [
        person(7, { name: "Shared", team_name: "Alpha", parent_user_id: 1 }),
      ]),
    ]),
    // Same person (user_id 7) repeated as a root of another team branch.
    teamNode(11, "Beta", [person(7, { name: "Shared", team_name: "Beta" })]),
  ]);

  const { roots, multiTeamMap } = buildHierarchyLayout(tree, members);
  const rendered = assertNoDuplicateCards(roots, "multi-team");
  assert.deepEqual(rendered, [1, 7], "user 7 must appear exactly once");
  assert.deepEqual(multiTeamMap.get(7), ["Beta"], "the second team is reported as a badge");
}

// ── 3. Cyclic reporting must terminate and still render once ─────────────────
{
  const members = new Map<number, MemberItem>([
    [1, member(1, { name: "A", parent_user_id: 2 })],
    [2, member(2, { name: "B", parent_user_id: 1 })],
  ]);
  const tree = tenantOf([
    teamNode(1, "Loop", [person(1, { parent_user_id: 2 }), person(2, { parent_user_id: 1 })]),
  ]);

  const { roots } = buildHierarchyLayout(tree, members);
  // Both cyclic links are rejected, so both members surface as top-level cards —
  // nobody is dropped, and nobody is drawn twice.
  assert.equal(roots.length, 2, "cyclic members each become an entry point");
  assert.deepEqual(assertNoDuplicateCards(roots, "cycle"), [1, 2]);
}

// ── 4. Self-referencing parent is treated as a root ──────────────────────────
{
  const members = new Map<number, MemberItem>([
    [5, member(5, { name: "Self", parent_user_id: 5 })],
  ]);
  const tree = tenantOf([teamNode(1, "Solo", [person(5, { parent_user_id: 5 })])]);

  const { roots } = buildHierarchyLayout(tree, members);
  assert.equal(roots.length, 1);
  assert.equal(roots[0]!.user_id, 5);
  assert.deepEqual(assertNoDuplicateCards(roots, "self-parent"), [5]);
}

// ── 5. Members that only exist in the tree are still picked up once ──────────
{
  const members = new Map<number, MemberItem>(); // membership list empty
  const tree = tenantOf([
    teamNode(1, "Alpha", [
      person(1, { type: "team_leader", role: "team_leader" }, [person(2, { parent_user_id: 1 })]),
    ]),
  ]);

  const { roots } = buildHierarchyLayout(tree, members);
  assert.deepEqual(assertNoDuplicateCards(roots, "tree-only members"), [1, 2]);
}

// ── 6. Avatar colour follows the role, never the chart position ──────────────
{
  assert.match(getRoleAvatarStyle("team_leader"), /amber/, "Team Leader must be amber");
  assert.match(getRoleAvatarStyle("admin"), /violet/, "Admin must be violet");
  assert.match(getRoleAvatarStyle("owner"), /violet/, "Owner must be violet");
  assert.match(getRoleAvatarStyle("member"), /blue/, "Member must be blue");
  // A missing role falls back to Member rather than an arbitrary name-hash colour.
  assert.match(getRoleAvatarStyle(null, "member"), /blue/);
  assert.equal(getRoleAvatarStyle(null, "team_leader"), getRoleAvatarStyle("team_leader"));

  assert.equal(getRoleLabel("team_leader"), "Team Leader");
  assert.equal(getRoleLabel(null, "member"), "Member");

  // The same person in two branches must share one colour: the style depends on
  // the role alone, so it cannot differ by position.
  const shared = member(42, { role: "admin" });
  assert.equal(
    getRoleAvatarStyle(shared.role, "member"),
    getRoleAvatarStyle(shared.role, "team_leader"),
  );
}

console.log("hierarchy dedupe tests passed");