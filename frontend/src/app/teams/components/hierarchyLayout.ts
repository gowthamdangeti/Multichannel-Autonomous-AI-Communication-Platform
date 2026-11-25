/**
 * Pure layout maths for the organization reporting chart.
 *
 * Kept free of React so it can be unit-tested without a DOM: the chart must
 * render exactly one card per person, no matter how the backend tree is shaped
 * (duplicate nodes, a leader appearing inside their own team branch, cycles,
 * members that only exist in the tree and not in the membership list).
 */

import type { HierarchyNode, MemberItem } from "./types";

export interface HierarchyLayout {
  /** Top-level cards to render — one per person with no manager in the org. */
  roots: HierarchyNode[];
  /** Every node id present in the source tree (used to seed "expand all"). */
  allNodeIds: Set<string>;
  /** user_id → other teams the same person is assigned to. */
  multiTeamMap: Map<number, string[]>;
}

const isPerson = (node: HierarchyNode): boolean =>
  node.type === "team_leader" || node.type === "member";

function personNode(source: Partial<HierarchyNode> & { user_id: number }): HierarchyNode {
  return {
    id: `member-${source.user_id}`,
    type: source.type === "team_leader" || source.role === "team_leader" ? "team_leader" : "member",
    name: source.name ?? `Member #${source.user_id}`,
    email: source.email ?? null,
    role: source.role ?? "member",
    team_id: source.team_id ?? null,
    team_name: source.team_name ?? null,
    user_id: source.user_id,
    parent_user_id: source.parent_user_id ?? null,
    direct_reports_count: 0,
    total_descendants_count: 0,
    children: [],
  };
}

export function buildHierarchyLayout(
  tree: HierarchyNode,
  membersMap: Map<number, MemberItem>,
): HierarchyLayout {
  const allNodeIds = new Set<string>();
  const multiTeamMap = new Map<number, string[]>();

  // 1. Canonical node per user, seeded from the organization membership list —
  //    this is what makes "one user = one card" structural rather than a
  //    filtering step, so no `user_id` can ever be rendered twice.
  const nodeByUser = new Map<number, HierarchyNode>();
  membersMap.forEach((member) => {
    nodeByUser.set(member.user_id, personNode({ ...member, user_id: member.user_id }));
    allNodeIds.add(`member-${member.user_id}`);
  });

  // 2. Walk the backend tree to pick up members the membership list missed and
  //    to record multi-team assignments (same person under different teams).
  function scanTree(node: HierarchyNode, currentTeamName: string | null) {
    allNodeIds.add(node.id);
    const team = node.type === "team" ? (node.team_name ?? node.name) : currentTeamName;

    if (isPerson(node) && node.user_id) {
      if (!nodeByUser.has(node.user_id)) {
        nodeByUser.set(node.user_id, personNode({ ...node, user_id: node.user_id }));
      }
      const existing = nodeByUser.get(node.user_id)!;
      if (team && existing.team_name && team !== existing.team_name) {
        const teams = multiTeamMap.get(node.user_id) ?? [];
        if (!teams.includes(team)) {
          teams.push(team);
          multiTeamMap.set(node.user_id, teams);
        }
      }
    }

    for (const child of node.children ?? []) scanTree(child, team);
  }
  scanTree(tree, null);

  // 3. Link each person to their manager, rejecting self-references and cycles.
  function causesCycle(childId: number, parentId: number): boolean {
    let currentId: number | null | undefined = parentId;
    const visited = new Set<number>();
    while (currentId) {
      if (currentId === childId) return true;
      if (visited.has(currentId)) return true;
      visited.add(currentId);
      currentId = nodeByUser.get(currentId)?.parent_user_id;
    }
    return false;
  }

  const hasManagerInOrg = new Set<number>();
  nodeByUser.forEach((node, userId) => {
    const parentId = node.parent_user_id;
    if (!parentId || parentId === userId || !nodeByUser.has(parentId)) return;
    if (causesCycle(userId, parentId)) return;

    const parent = nodeByUser.get(parentId)!;
    parent.children ??= [];
    if (!parent.children.some((child) => child.user_id === userId)) {
      parent.children.push(node);
    }
    hasManagerInOrg.add(userId);
  });

  // 4. Roots are only people without a manager inside the organization.
  const roots: HierarchyNode[] = [];
  nodeByUser.forEach((node, userId) => {
    if (!hasManagerInOrg.has(userId)) roots.push(node);
  });

  // Everyone managed each other (cycle): keep one entry point so the chart is
  // not empty. Prefer the highest-ranking member.
  if (roots.length === 0 && nodeByUser.size > 0) {
    const all = Array.from(nodeByUser.values());
    const entryPoint = all.find((n) => n.role === "team_leader" || n.role === "admin") ?? all[0];
    if (entryPoint) roots.push(entryPoint);
  }

  // 5. Report counts.
  function computeCounts(node: HierarchyNode) {
    const children = node.children ?? [];
    node.direct_reports_count = children.length;
    let descendants = children.length;
    for (const child of children) {
      computeCounts(child);
      descendants += child.total_descendants_count ?? 0;
    }
    node.total_descendants_count = descendants;
  }
  roots.forEach(computeCounts);

  return { roots, allNodeIds, multiTeamMap };
}

/**
 * Flatten the rendered chart to the list of user_ids a viewer would see, in
 * render order. Deliberately does NOT de-duplicate: tests assert that the list
 * contains each user at most once, so hiding a repeat here would defeat them.
 */
export function collectRenderedUserIds(roots: HierarchyNode[]): number[] {
  const rendered: number[] = [];
  const visitedNodes = new Set<HierarchyNode>();

  function visit(node: HierarchyNode) {
    if (visitedNodes.has(node)) return; // malformed graph guard (shared node object)
    visitedNodes.add(node);
    if (node.user_id) rendered.push(node.user_id);
    for (const child of node.children ?? []) visit(child);
  }

  roots.forEach(visit);
  return rendered;
}
