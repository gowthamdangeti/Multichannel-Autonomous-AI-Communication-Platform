"""Database client operations for Teams, Organization Memberships, and Hierarchies."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any, Dict, List, Optional, Set, Tuple

from sqlalchemy import delete, func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from api.db.base_client import BaseDBClient
from api.db.models import (
    OrganizationMemberRemovalModel,
    OrganizationMembershipModel,
    OrganizationModel,
    TeamModel,
    UserModel,
    organization_users_association,
)


async def _clear_member_removal(
    session: AsyncSession, organization_id: int, user_id: int
) -> None:
    """Drop the explicit-removal marker for (organization, user).

    Called from every path that *explicitly* creates a membership: an authorized
    Add Member (or team-leader assignment) always overrides a previous removal.
    """
    await session.execute(
        delete(OrganizationMemberRemovalModel).where(
            OrganizationMemberRemovalModel.organization_id == organization_id,
            OrganizationMemberRemovalModel.user_id == user_id,
        )
    )


def _format_user_display_name(user: UserModel | None) -> str:
    if not user:
        return "Unknown Member"
    first = (user.first_name or "").strip()
    last = (user.last_name or "").strip()
    full = f"{first} {last}".strip()
    if full:
        return full
    if user.email:
        return user.email
    return f"User #{user.id}"


class TeamClient(BaseDBClient):
    """Database client mixin for Teams and Organization Reporting Hierarchy."""

    async def get_member_team_access(
        self, organization_id: int, user_id: int
    ) -> Optional[Dict[str, Any]]:
        """Read role/team scope without syncing or modifying membership data."""
        async with self.async_session() as session:
            result = await session.execute(
                select(OrganizationMembershipModel.role, OrganizationMembershipModel.team_id)
                .where(
                    OrganizationMembershipModel.organization_id == organization_id,
                    OrganizationMembershipModel.user_id == user_id,
                )
                .limit(1)
            )
            row = result.first()
            if not row:
                return None

            role, team_id = row
            if team_id is not None:
                valid_team = await session.execute(
                    select(TeamModel.id).where(
                        TeamModel.id == team_id,
                        TeamModel.organization_id == organization_id,
                    )
                )
                if valid_team.scalar_one_or_none() is None:
                    return None
            return {"role": role or "member", "team_id": team_id}

    async def list_teams(self, organization_id: int) -> List[Dict[str, Any]]:
        """List all teams for an organization with member count and team leader."""
        async with self.async_session() as session:
            teams_res = await session.execute(
                select(TeamModel)
                .where(TeamModel.organization_id == organization_id)
                .order_by(TeamModel.name.asc())
            )
            teams = teams_res.scalars().all()

            results: List[Dict[str, Any]] = []
            for team in teams:
                # Count members
                count_res = await session.execute(
                    select(func.count(OrganizationMembershipModel.id)).where(
                        OrganizationMembershipModel.organization_id == organization_id,
                        OrganizationMembershipModel.team_id == team.id,
                    )
                )
                member_count = count_res.scalar() or 0

                # Find leader
                leader_res = await session.execute(
                    select(OrganizationMembershipModel, UserModel)
                    .join(UserModel, OrganizationMembershipModel.user_id == UserModel.id)
                    .where(
                        OrganizationMembershipModel.organization_id == organization_id,
                        OrganizationMembershipModel.team_id == team.id,
                        OrganizationMembershipModel.role == "team_leader",
                    )
                    .limit(1)
                )
                leader_row = leader_res.first()
                leader_id = leader_row[0].user_id if leader_row else None
                leader_name = _format_user_display_name(leader_row[1]) if leader_row else None

                results.append(
                    {
                        "id": team.id,
                        "organization_id": team.organization_id,
                        "name": team.name,
                        "member_count": member_count,
                        "leader_user_id": leader_id,
                        "leader_name": leader_name,
                        "created_at": team.created_at.isoformat() if team.created_at else None,
                    }
                )
            return results

    async def get_team_by_id(self, team_id: int, organization_id: int) -> Optional[TeamModel]:
        """Fetch a team by ID within an organization."""
        async with self.async_session() as session:
            res = await session.execute(
                select(TeamModel).where(
                    TeamModel.id == team_id,
                    TeamModel.organization_id == organization_id,
                )
            )
            return res.scalar_one_or_none()

    async def get_team_detail(self, team_id: int, organization_id: int) -> Optional[Dict[str, Any]]:
        """Get team detail including leader and member list."""
        async with self.async_session() as session:
            team = await self.get_team_by_id(team_id, organization_id)
            if not team:
                return None

            members_data = await self.list_organization_members(organization_id)
            team_members = [m for m in members_data if m["team_id"] == team_id]
            leader = next((m for m in team_members if m["role"] == "team_leader"), None)

            return {
                "id": team.id,
                "organization_id": team.organization_id,
                "name": team.name,
                "member_count": len(team_members),
                "leader": leader,
                "members": team_members,
                "created_at": team.created_at.isoformat() if team.created_at else None,
            }

    async def create_team(
        self,
        organization_id: int,
        name: str,
        leader_user_id: Optional[int] = None,
    ) -> TeamModel:
        """Create a new team in the organization and optionally assign a leader."""
        clean_name = name.strip()
        if not clean_name:
            raise ValueError("Team name cannot be empty.")

        async with self.async_session() as session:
            # Check unique name
            existing = await session.execute(
                select(TeamModel).where(
                    TeamModel.organization_id == organization_id,
                    func.lower(TeamModel.name) == func.lower(clean_name),
                )
            )
            if existing.scalar_one_or_none():
                raise ValueError(f"A team named '{clean_name}' already exists in this organization.")

            team = TeamModel(organization_id=organization_id, name=clean_name)
            session.add(team)
            await session.flush()
            await session.refresh(team)

            if leader_user_id:
                # Update or create membership for leader
                mem_res = await session.execute(
                    select(OrganizationMembershipModel).where(
                        OrganizationMembershipModel.organization_id == organization_id,
                        OrganizationMembershipModel.user_id == leader_user_id,
                    )
                )
                mem = mem_res.scalar_one_or_none()
                if mem:
                    mem.team_id = team.id
                    mem.role = "team_leader"
                else:
                    session.add(
                        OrganizationMembershipModel(
                            organization_id=organization_id,
                            user_id=leader_user_id,
                            team_id=team.id,
                            role="team_leader",
                        )
                    )
                    # Assigning a leader is an explicit membership — it
                    # overrides any previous removal.
                    await _clear_member_removal(session, organization_id, leader_user_id)
            await session.commit()
            await session.refresh(team)
            return team

    async def update_team(
        self,
        team_id: int,
        organization_id: int,
        name: Optional[str] = None,
        leader_user_id: Optional[int] = None,
    ) -> Optional[TeamModel]:
        """Update a team's name and/or assign a new leader."""
        async with self.async_session() as session:
            res = await session.execute(
                select(TeamModel).where(
                    TeamModel.id == team_id,
                    TeamModel.organization_id == organization_id,
                )
            )
            team = res.scalar_one_or_none()
            if not team:
                return None

            if name:
                clean_name = name.strip()
                if clean_name.lower() != team.name.lower():
                    # check unique
                    dup = await session.execute(
                        select(TeamModel).where(
                            TeamModel.organization_id == organization_id,
                            func.lower(TeamModel.name) == func.lower(clean_name),
                            TeamModel.id != team_id,
                        )
                    )
                    if dup.scalar_one_or_none():
                        raise ValueError(f"A team named '{clean_name}' already exists.")
                    team.name = clean_name

            if leader_user_id is not None:
                # Reset previous team_leader(s) in this team to "member"
                prev_leaders = await session.execute(
                    select(OrganizationMembershipModel).where(
                        OrganizationMembershipModel.organization_id == organization_id,
                        OrganizationMembershipModel.team_id == team_id,
                        OrganizationMembershipModel.role == "team_leader",
                    )
                )
                for l in prev_leaders.scalars().all():
                    if l.user_id != leader_user_id:
                        l.role = "member"

                if leader_user_id > 0:
                    # Set new leader
                    mem_res = await session.execute(
                        select(OrganizationMembershipModel).where(
                            OrganizationMembershipModel.organization_id == organization_id,
                            OrganizationMembershipModel.user_id == leader_user_id,
                        )
                    )
                    target_mem = mem_res.scalar_one_or_none()
                    if target_mem:
                        target_mem.team_id = team_id
                        target_mem.role = "team_leader"
                    else:
                        session.add(
                            OrganizationMembershipModel(
                                organization_id=organization_id,
                                user_id=leader_user_id,
                                team_id=team_id,
                                role="team_leader",
                            )
                        )
                        # Assigning a leader is an explicit membership — it
                        # overrides any previous removal.
                        await _clear_member_removal(
                            session, organization_id, leader_user_id
                        )

            await session.commit()
            await session.refresh(team)
            return team

    async def delete_team(self, team_id: int, organization_id: int) -> bool:
        """Delete a team. Members' team_id is automatically unlinked."""
        async with self.async_session() as session:
            res = await session.execute(
                select(TeamModel).where(
                    TeamModel.id == team_id,
                    TeamModel.organization_id == organization_id,
                )
            )
            team = res.scalar_one_or_none()
            if not team:
                return False

            # Reset team_leader roles for this team to member
            await session.execute(
                update(OrganizationMembershipModel)
                .where(
                    OrganizationMembershipModel.organization_id == organization_id,
                    OrganizationMembershipModel.team_id == team_id,
                    OrganizationMembershipModel.role == "team_leader",
                )
                .values(role="member", team_id=None)
            )

            await session.delete(team)
            await session.commit()
            return True

    async def sync_organization_members(self, organization_id: int) -> None:
        """Ensure all users associated with this organization have an OrganizationMembershipModel row."""
        async with self.async_session() as session:
            # Users linked via association table or selected_organization_id
            assoc_users_res = await session.execute(
                select(organization_users_association.c.user_id).where(
                    organization_users_association.c.organization_id == organization_id
                )
            )
            assoc_user_ids = {row[0] for row in assoc_users_res.all()}

            sel_users_res = await session.execute(
                select(UserModel.id).where(UserModel.selected_organization_id == organization_id)
            )
            sel_user_ids = {row[0] for row in sel_users_res.all()}

            all_org_user_ids = assoc_user_ids | sel_user_ids

            # Current membership user IDs
            current_mems_res = await session.execute(
                select(OrganizationMembershipModel.user_id).where(
                    OrganizationMembershipModel.organization_id == organization_id
                )
            )
            current_mem_user_ids = {row[0] for row in current_mems_res.all()}

            # Users an administrator explicitly removed from *this* organization.
            # They are never re-added automatically — only an explicit Add Member
            # clears the marker. Removals in other organizations are irrelevant.
            removed_res = await session.execute(
                select(OrganizationMemberRemovalModel.user_id).where(
                    OrganizationMemberRemovalModel.organization_id == organization_id
                )
            )
            removed_user_ids = {row[0] for row in removed_res.all()}

            missing_user_ids = (
                all_org_user_ids - current_mem_user_ids - removed_user_ids
            )
            for uid in missing_user_ids:
                session.add(
                    OrganizationMembershipModel(
                        organization_id=organization_id,
                        user_id=uid,
                        role="member",
                    )
                )
            if missing_user_ids:
                await session.commit()

    async def list_organization_members(self, organization_id: int) -> List[Dict[str, Any]]:
        """List all members of the organization with user details, team name, and manager name."""
        await self.sync_organization_members(organization_id)

        async with self.async_session() as session:
            mems_res = await session.execute(
                select(OrganizationMembershipModel, UserModel)
                .join(UserModel, OrganizationMembershipModel.user_id == UserModel.id)
                .where(OrganizationMembershipModel.organization_id == organization_id)
            )
            rows = mems_res.all()

            # Preload teams
            teams_res = await session.execute(
                select(TeamModel).where(TeamModel.organization_id == organization_id)
            )
            team_map = {t.id: t.name for t in teams_res.scalars().all()}

            # Preload all org users for manager name lookups
            user_map = {u.id: _format_user_display_name(u) for _, u in rows}

            results: List[Dict[str, Any]] = []
            for mem, user in rows:
                results.append(
                    {
                        "user_id": user.id,
                        "email": user.email,
                        "first_name": user.first_name,
                        "last_name": user.last_name,
                        "name": _format_user_display_name(user),
                        "role": mem.role or "member",
                        "team_id": mem.team_id,
                        "team_name": team_map.get(mem.team_id) if mem.team_id else None,
                        "parent_user_id": mem.parent_user_id,
                        "parent_user_name": user_map.get(mem.parent_user_id) if mem.parent_user_id else None,
                        "created_at": user.created_at.isoformat() if user.created_at else None,
                    }
                )

            # Sort by name
            results.sort(key=lambda m: m["name"].lower())
            return results

    async def get_descendants_for_user(self, organization_id: int, root_user_id: int) -> Set[int]:
        """Recursive CTE to get all descendant user IDs under root_user_id in organization_id."""
        async with self.async_session() as session:
            descendants = (
                select(OrganizationMembershipModel.user_id)
                .where(
                    OrganizationMembershipModel.organization_id == organization_id,
                    OrganizationMembershipModel.parent_user_id == root_user_id,
                )
                .cte("descendants", recursive=True)
            )
            descendants = descendants.union_all(
                select(OrganizationMembershipModel.user_id)
                .join(
                    descendants,
                    OrganizationMembershipModel.parent_user_id == descendants.c.user_id,
                )
                .where(OrganizationMembershipModel.organization_id == organization_id)
            )
            result = await session.execute(select(descendants.c.user_id))
            return {int(row[0]) for row in result.all()}

    async def upsert_member(
        self,
        organization_id: int,
        user_id: int,
        role: Optional[str] = None,
        team_id: Optional[int] = None,
        parent_user_id: Optional[int] = None,
        clear_team: bool = False,
        clear_parent: bool = False,
    ) -> Dict[str, Any]:
        """Update or create a member's team, reporting manager, and role."""
        if parent_user_id is not None:
            if parent_user_id == user_id:
                raise ValueError("A member cannot report to themselves.")

            # Cycle detection: target parent cannot be a descendant of user_id
            descendants = await self.get_descendants_for_user(organization_id, user_id)
            if parent_user_id in descendants:
                raise ValueError(
                    "Circular reporting detected: cannot assign a subordinate as reporting manager."
                )

        async with self.async_session() as session:
            # Validate team belongs to org if specified
            if team_id is not None and not clear_team:
                team_check = await session.execute(
                    select(TeamModel.id).where(
                        TeamModel.id == team_id,
                        TeamModel.organization_id == organization_id,
                    )
                )
                if not team_check.scalar_one_or_none():
                    raise ValueError(f"Team #{team_id} does not belong to this organization.")

            # Validate parent belongs to org if specified
            if parent_user_id is not None and not clear_parent:
                parent_check = await session.execute(
                    select(OrganizationMembershipModel.user_id).where(
                        OrganizationMembershipModel.organization_id == organization_id,
                        OrganizationMembershipModel.user_id == parent_user_id,
                    )
                )
                if not parent_check.scalar_one_or_none():
                    raise ValueError("Reporting manager must be an existing member of this organization.")

            # Fetch membership
            res = await session.execute(
                select(OrganizationMembershipModel).where(
                    OrganizationMembershipModel.organization_id == organization_id,
                    OrganizationMembershipModel.user_id == user_id,
                )
            )
            mem = res.scalar_one_or_none()
            if not mem:
                mem = OrganizationMembershipModel(
                    organization_id=organization_id,
                    user_id=user_id,
                    role=role or "member",
                )
                session.add(mem)
                # An explicit add/edit re-admits a previously removed member.
                await _clear_member_removal(session, organization_id, user_id)

            if role:
                mem.role = role
            if clear_team:
                mem.team_id = None
            elif team_id is not None:
                mem.team_id = team_id

            if clear_parent:
                mem.parent_user_id = None
            elif parent_user_id is not None:
                mem.parent_user_id = parent_user_id

            await session.commit()

        members = await self.list_organization_members(organization_id)
        match = next((m for m in members if m["user_id"] == user_id), None)
        if not match:
            raise RuntimeError("Failed to retrieve updated member record.")
        return match

    async def create_and_add_member(
        self,
        organization_id: int,
        email: str,
        first_name: Optional[str] = None,
        last_name: Optional[str] = None,
        role: str = "member",
        team_id: Optional[int] = None,
        parent_user_id: Optional[int] = None,
    ) -> Dict[str, Any]:
        """Add a user by email to the organization and assign team/manager/role."""
        clean_email = email.strip().lower()
        async with self.async_session() as session:
            # Check if user exists
            user_res = await session.execute(
                select(UserModel).where(func.lower(UserModel.email) == clean_email)
            )
            user = user_res.scalar_one_or_none()
            if not user:
                provider_id = f"user-{clean_email.replace('@', '-at-')}-{int(datetime.now(UTC).timestamp())}"
                user = UserModel(
                    provider_id=provider_id,
                    email=clean_email,
                    first_name=first_name,
                    last_name=last_name,
                    selected_organization_id=organization_id,
                )
                session.add(user)
                await session.flush()
                await session.refresh(user)

            # Link to organization_users association if not present
            assoc_check = await session.execute(
                select(organization_users_association.c.user_id).where(
                    organization_users_association.c.organization_id == organization_id,
                    organization_users_association.c.user_id == user.id,
                )
            )
            if not assoc_check.first():
                await session.execute(
                    organization_users_association.insert().values(
                        organization_id=organization_id, user_id=user.id
                    )
                )

            # Read the id while the instance is still attached to the session:
            # commit() expires attributes and closing the session detaches the
            # object, so a later `user.id` would try to refresh and fail with
            # "Instance <UserModel> is not bound to a Session".
            user_id = user.id

            await session.commit()

        # Update membership details with validation
        return await self.upsert_member(
            organization_id=organization_id,
            user_id=user_id,
            role=role,
            team_id=team_id,
            parent_user_id=parent_user_id,
        )

    async def remove_member(
        self,
        organization_id: int,
        user_id: int,
        from_team_only: bool = False,
    ) -> bool:
        """Remove a member from a team or from the entire organization."""
        async with self.async_session() as session:
            res = await session.execute(
                select(OrganizationMembershipModel).where(
                    OrganizationMembershipModel.organization_id == organization_id,
                    OrganizationMembershipModel.user_id == user_id,
                )
            )
            mem = res.scalar_one_or_none()
            if not mem:
                return False

            if from_team_only:
                mem.team_id = None
                if mem.role == "team_leader":
                    mem.role = "member"
                await session.commit()
                return True

            # If deleting membership completely, reassign their direct reports to their parent
            parent_id = mem.parent_user_id
            await session.execute(
                update(OrganizationMembershipModel)
                .where(
                    OrganizationMembershipModel.organization_id == organization_id,
                    OrganizationMembershipModel.parent_user_id == user_id,
                )
                .values(parent_user_id=parent_id)
            )

            await session.delete(mem)

            # Remove from organization_users_association
            await session.execute(
                delete(organization_users_association).where(
                    organization_users_association.c.organization_id == organization_id,
                    organization_users_association.c.user_id == user_id,
                )
            )

            # Remember the removal for this organization only. The user keeps
            # their selected_organization_id, so without this marker the next
            # sync_organization_members() would recreate the membership we just
            # deleted. The explicit Add Member workflow clears it again.
            existing_removal = await session.execute(
                select(OrganizationMemberRemovalModel.id).where(
                    OrganizationMemberRemovalModel.organization_id == organization_id,
                    OrganizationMemberRemovalModel.user_id == user_id,
                )
            )
            if not existing_removal.scalar_one_or_none():
                session.add(
                    OrganizationMemberRemovalModel(
                        organization_id=organization_id,
                        user_id=user_id,
                    )
                )

            await session.commit()
            return True

    async def get_member_reporting_chain(
        self,
        organization_id: int,
        user_id: int,
    ) -> Dict[str, Any]:
        """Get the full reporting line for a member (managers upward, direct reports downward, and total descendants)."""
        members = await self.list_organization_members(organization_id)
        member_map = {m["user_id"]: m for m in members}
        target = member_map.get(user_id)
        if not target:
            raise ValueError(f"Member #{user_id} not found in this organization.")

        # Walk upward to find manager chain
        manager_chain: List[Dict[str, Any]] = []
        curr_parent_id = target["parent_user_id"]
        seen_parents: Set[int] = {user_id}
        while curr_parent_id and curr_parent_id in member_map and curr_parent_id not in seen_parents:
            seen_parents.add(curr_parent_id)
            parent_mem = member_map[curr_parent_id]
            manager_chain.append(parent_mem)
            curr_parent_id = parent_mem["parent_user_id"]

        # Direct reports
        direct_reports = [m for m in members if m["parent_user_id"] == user_id]

        # Total descendants
        descendants = await self.get_descendants_for_user(organization_id, user_id)

        return {
            "member": target,
            "manager_chain": manager_chain,
            "direct_reports": direct_reports,
            "total_descendants_count": len(descendants),
        }

    async def get_organization_hierarchy(self, organization_id: int) -> Dict[str, Any]:
        """Construct the entire hierarchy tree: Tenant -> Organization -> Teams -> Team Leaders -> Members."""
        async with self.async_session() as session:
            org_res = await session.execute(
                select(OrganizationModel).where(OrganizationModel.id == organization_id)
            )
            org = org_res.scalar_one_or_none()

            # Fetch primary owner/user of this org to derive a friendly company/display name
            user_stmt = (
                select(UserModel)
                .join(organization_users_association, UserModel.id == organization_users_association.c.user_id)
                .where(organization_users_association.c.organization_id == organization_id)
                .order_by(UserModel.id.asc())
            )
            user_res = await session.execute(user_stmt)
            primary_user = user_res.scalars().first()

            if org:
                pid = org.provider_id or ""
                # If provider_id is technical (e.g. starts with org_ or util- or raw id)
                if pid.startswith("org_") or pid.startswith("util-") or pid.startswith("team_") or len(pid) > 24:
                    if primary_user and (primary_user.first_name or primary_user.last_name):
                        full = f"{primary_user.first_name or ''} {primary_user.last_name or ''}".strip()
                        org_name = f"{full}'s Workspace"
                    elif primary_user and primary_user.email:
                        clean_part = primary_user.email.split("@")[0].replace(".", " ").title()
                        org_name = f"{clean_part}'s Workspace"
                    else:
                        org_name = "Convozent Workspace"
                else:
                    org_name = pid.replace("-", " ").replace("_", " ").title()
            else:
                org_name = "Convozent Workspace"

        teams_data = await self.list_teams(organization_id)
        members_data = await self.list_organization_members(organization_id)

        member_map = {m["user_id"]: m for m in members_data}
        direct_reports_map: Dict[int, List[Dict[str, Any]]] = {}
        for m in members_data:
            pid = m["parent_user_id"]
            if pid:
                direct_reports_map.setdefault(pid, []).append(m)

        # Global tracker to ensure each user is rendered EXACTLY ONCE in the tree
        global_visited_users: Set[int] = set()

        def build_member_tree(member: Dict[str, Any], visited: Set[int]) -> Dict[str, Any]:
            uid = member["user_id"]
            visited.add(uid)
            global_visited_users.add(uid)
            reports = direct_reports_map.get(uid, [])
            child_nodes: List[Dict[str, Any]] = []
            for r in reports:
                if r["user_id"] not in visited and r["user_id"] not in global_visited_users:
                    child_nodes.append(build_member_tree(r, visited))

            total_descendants = len(child_nodes) + sum(c.get("total_descendants_count", 0) for c in child_nodes)
            return {
                "id": f"member-{uid}",
                "type": "team_leader" if member["role"] == "team_leader" else "member",
                "name": member["name"],
                "email": member["email"],
                "role": member["role"],
                "team_id": member["team_id"],
                "team_name": member["team_name"],
                "user_id": uid,
                "parent_user_id": member["parent_user_id"],
                "direct_reports_count": len(child_nodes),
                "total_descendants_count": total_descendants,
                "children": child_nodes,
            }

        # Build team branches
        team_nodes: List[Dict[str, Any]] = []
        members_in_teams: Set[int] = set()

        for t in teams_data:
            t_id = t["id"]
            members_of_team = [m for m in members_data if m["team_id"] == t_id]
            members_in_teams.update(m["user_id"] for m in members_of_team)

            # Leaders or root members in this team (parent is None or parent is not in org)
            root_members = [
                m
                for m in members_of_team
                if (m["parent_user_id"] is None or m["parent_user_id"] not in member_map)
                and m["user_id"] not in global_visited_users
            ]

            # If no root found and team has members not yet placed in the tree, pick team leader or first unplaced member
            unplaced = [m for m in members_of_team if m["user_id"] not in global_visited_users]
            if not root_members and unplaced:
                leader = next((m for m in unplaced if m["role"] == "team_leader"), unplaced[0])
                root_members = [leader]

            children: List[Dict[str, Any]] = []
            for root in root_members:
                if root["user_id"] not in global_visited_users:
                    children.append(build_member_tree(root, global_visited_users))

            # Catch any disconnected remaining members in the team that haven't been placed yet
            for remaining in members_of_team:
                if remaining["user_id"] not in global_visited_users:
                    children.append(build_member_tree(remaining, global_visited_users))

            team_nodes.append(
                {
                    "id": f"team-{t_id}",
                    "type": "team",
                    "name": t["name"],
                    "team_id": t_id,
                    "team_name": t["name"],
                    "direct_reports_count": len(members_of_team),
                    "total_descendants_count": len(members_of_team),
                    "children": children,
                }
            )

        # Unassigned members (not in any team)
        unassigned_members = [m for m in members_data if m["team_id"] is None and m["user_id"] not in global_visited_users]
        if unassigned_members:
            unassigned_roots = [
                m for m in unassigned_members
                if (m["parent_user_id"] is None or m["parent_user_id"] not in member_map)
                and m["user_id"] not in global_visited_users
            ]
            if not unassigned_roots and unassigned_members:
                unassigned_roots = [unassigned_members[0]]

            unassigned_children: List[Dict[str, Any]] = []
            for root in unassigned_roots:
                if root["user_id"] not in global_visited_users:
                    unassigned_children.append(build_member_tree(root, global_visited_users))

            # Catch any disconnected remaining unassigned members
            for remaining in unassigned_members:
                if remaining["user_id"] not in global_visited_users:
                    unassigned_children.append(build_member_tree(remaining, global_visited_users))

            team_nodes.append(
                {
                    "id": "team-unassigned",
                    "type": "team",
                    "name": "Unassigned Members",
                    "team_id": None,
                    "team_name": "Unassigned Members",
                    "direct_reports_count": len(unassigned_members),
                    "total_descendants_count": len(unassigned_members),
                    "children": unassigned_children,
                }
            )

        # Organization node
        org_node = {
            "id": f"org-{organization_id}",
            "type": "organization",
            "name": f"Organization: {org_name}",
            "children": team_nodes,
        }

        # Root Tenant node
        root_tree = {
            "id": "tenant-root",
            "type": "tenant",
            "name": "Tenant: Convozent Platform",
            "children": [org_node],
        }

        stats = {
            "total_teams": len(teams_data),
            "total_members": len(members_data),
            "total_leaders": len([m for m in members_data if m["role"] == "team_leader"]),
        }

        return {
            "tenant_name": "Convozent Platform",
            "organization_id": organization_id,
            "organization_name": org_name,
            "tree": root_tree,
            "stats": stats,
        }

