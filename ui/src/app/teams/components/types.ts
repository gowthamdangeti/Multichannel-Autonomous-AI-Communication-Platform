export interface TeamItem {
  id: number;
  organization_id: number;
  name: string;
  member_count: number;
  leader_user_id: number | null;
  leader_name: string | null;
  created_at: string | null;
}

export interface MemberItem {
  user_id: number;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  name: string;
  role: string;
  team_id: number | null;
  team_name: string | null;
  parent_user_id: number | null;
  parent_user_name: string | null;
  created_at: string | null;
}

export interface HierarchyNode {
  id: string;
  type: "tenant" | "organization" | "team" | "team_leader" | "member";
  name: string;
  email?: string | null;
  role?: string | null;
  team_id?: number | null;
  team_name?: string | null;
  user_id?: number | null;
  parent_user_id?: number | null;
  direct_reports_count: number;
  total_descendants_count: number;
  children: HierarchyNode[];
}

export interface HierarchyResponse {
  tenant_name: string;
  organization_id: number;
  organization_name: string;
  tree: HierarchyNode;
  stats: {
    total_teams: number;
    total_members: number;
    total_leaders: number;
  };
}

export interface MemberReportingData {
  member: MemberItem;
  manager_chain: MemberItem[];
  direct_reports: MemberItem[];
  total_descendants_count: number;
}

export interface AgentItem {
  id: number;
  name: string;
  status?: string | null;
  created_at?: string | null;
  utilization_type?: string | null;
  created_by_user_id?: number | null;
  created_by_name?: string | null;
}

