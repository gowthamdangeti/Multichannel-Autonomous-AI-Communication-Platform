"""Pydantic schemas for Teams, Organization Memberships, and Reporting Hierarchies."""

from __future__ import annotations

from typing import Any, List, Optional
from pydantic import BaseModel, ConfigDict, Field


class TeamCreateRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=120)
    leader_user_id: Optional[int] = None


class TeamUpdateRequest(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=120)
    leader_user_id: Optional[int] = None


class TeamMemberInfo(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    user_id: int
    email: Optional[str] = None
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    name: str
    role: str = "member"
    team_id: Optional[int] = None
    team_name: Optional[str] = None
    parent_user_id: Optional[int] = None
    parent_user_name: Optional[str] = None
    created_at: Optional[str] = None


class TeamResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    organization_id: int
    name: str
    member_count: int = 0
    leader_user_id: Optional[int] = None
    leader_name: Optional[str] = None
    created_at: Optional[str] = None


class TeamDetailResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    organization_id: int
    name: str
    member_count: int = 0
    leader: Optional[TeamMemberInfo] = None
    members: List[TeamMemberInfo] = []
    created_at: Optional[str] = None


class MemberCreateRequest(BaseModel):
    email: str = Field(..., min_length=3)
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    role: str = "member"
    team_id: Optional[int] = None
    parent_user_id: Optional[int] = None


class MemberUpdateRequest(BaseModel):
    role: Optional[str] = None
    team_id: Optional[int] = None  # None or int
    parent_user_id: Optional[int] = None
    clear_team: bool = False
    clear_parent: bool = False


class MemberReportingResponse(BaseModel):
    member: TeamMemberInfo
    manager_chain: List[TeamMemberInfo]
    direct_reports: List[TeamMemberInfo]
    total_descendants_count: int


class HierarchyNode(BaseModel):
    id: str
    type: str  # "tenant" | "organization" | "team" | "team_leader" | "member"
    name: str
    email: Optional[str] = None
    role: Optional[str] = None
    team_id: Optional[int] = None
    team_name: Optional[str] = None
    user_id: Optional[int] = None
    parent_user_id: Optional[int] = None
    direct_reports_count: int = 0
    total_descendants_count: int = 0
    children: List[HierarchyNode] = Field(default_factory=list)


class OrganizationHierarchyResponse(BaseModel):
    tenant_name: str
    organization_id: int
    organization_name: str
    tree: HierarchyNode
    stats: dict[str, int]

