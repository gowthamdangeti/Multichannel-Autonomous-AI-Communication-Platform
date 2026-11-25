"""Organization member removal: explicit removals must survive synchronization.

``sync_organization_members`` backfills a membership row for every user still
linked to an organization (the ``organization_users`` association or
``users.selected_organization_id``). Removing a member deletes the membership
but deliberately keeps ``selected_organization_id``, so without an explicit
removal marker the very next member list call recreated the membership and the
removal looked like a no-op.

These tests exercise the client directly (no FastAPI app) so they cover the
storage contract behind ``DELETE /api/v1/teams/members/{user_id}``.
"""

import pytest
from sqlalchemy import func, select

from api.db.models import (
    OrganizationMemberRemovalModel,
    OrganizationMembershipModel,
    OrganizationModel,
    UserModel,
    organization_users_association,
)

GRAPH = {
    "nodes": [
        {"id": "1", "type": "startCall", "data": {"name": "Start", "prompt": "Hi"}},
        {"id": "2", "type": "endCall", "data": {"name": "End", "prompt": "Bye"}},
    ],
    "edges": [{"id": "e1", "source": "1", "target": "2", "data": {"label": "End"}}],
}


async def _org(session, suffix: str) -> OrganizationModel:
    org = OrganizationModel(provider_id=f"removal-org-{suffix}")
    session.add(org)
    await session.flush()
    return org


async def _user(session, suffix: str, org_id: int | None) -> UserModel:
    user = UserModel(
        provider_id=f"removal-user-{suffix}",
        email=f"{suffix}@removal.test",
        selected_organization_id=org_id,
    )
    session.add(user)
    await session.flush()
    return user


async def _membership_count(session, org_id: int, user_id: int) -> int:
    result = await session.execute(
        select(func.count(OrganizationMembershipModel.id)).where(
            OrganizationMembershipModel.organization_id == org_id,
            OrganizationMembershipModel.user_id == user_id,
        )
    )
    return int(result.scalar() or 0)


async def _removal_count(session, org_id: int, user_id: int) -> int:
    result = await session.execute(
        select(func.count(OrganizationMemberRemovalModel.id)).where(
            OrganizationMemberRemovalModel.organization_id == org_id,
            OrganizationMemberRemovalModel.user_id == user_id,
        )
    )
    return int(result.scalar() or 0)


async def _user_in_list(client, org_id: int, user_id: int) -> bool:
    members = await client.list_organization_members(org_id)
    return any(member["user_id"] == user_id for member in members)


@pytest.fixture
async def setup_orgs(async_session, db_session):
    """Org A with a removable member, an untouched member, plus a second org B."""
    org_a = await _org(async_session, "a")
    org_b = await _org(async_session, "b")
    leaver = await _user(async_session, "leaver", org_a.id)
    keeper = await _user(async_session, "keeper", org_a.id)
    report = await _user(async_session, "report", org_a.id)
    await db_session.sync_organization_members(org_a.id)

    # `report` sits under `leaver`, so removal must re-parent them.
    await db_session.upsert_member(
        organization_id=org_a.id, user_id=leaver.id, role="team_leader"
    )
    await db_session.upsert_member(
        organization_id=org_a.id,
        user_id=report.id,
        parent_user_id=leaver.id,
    )

    return {
        "org_a": org_a,
        "org_b": org_b,
        "leaver": leaver,
        "keeper": keeper,
        "report": report,
    }


# ── Test 1 — Remove member ───────────────────────────────────────────────────
async def test_remove_member_deletes_membership_and_records_removal(
    async_session, db_session, setup_orgs
):
    org_a, leaver = setup_orgs["org_a"], setup_orgs["leaver"]
    assert await _membership_count(async_session, org_a.id, leaver.id) == 1

    removed = await db_session.remove_member(org_a.id, leaver.id, from_team_only=False)
    assert removed is True

    assert await _membership_count(async_session, org_a.id, leaver.id) == 0
    assert await _removal_count(async_session, org_a.id, leaver.id) == 1

    # The user account survives and keeps their selected organization.
    refreshed = (
        await async_session.execute(select(UserModel).where(UserModel.id == leaver.id))
    ).scalar_one()
    assert refreshed.selected_organization_id == org_a.id

    # Association row is gone too, so nothing re-links them.
    assoc = await async_session.execute(
        select(organization_users_association.c.user_id).where(
            organization_users_association.c.organization_id == org_a.id,
            organization_users_association.c.user_id == leaver.id,
        )
    )
    assert assoc.first() is None


async def test_team_only_removal_does_not_block_membership(
    async_session, db_session, setup_orgs
):
    """Detaching from a team keeps them in the org — no removal marker."""
    org_a, keeper = setup_orgs["org_a"], setup_orgs["keeper"]

    assert await db_session.remove_member(org_a.id, keeper.id, from_team_only=True)
    assert await _removal_count(async_session, org_a.id, keeper.id) == 0

    await db_session.sync_organization_members(org_a.id)
    assert await _membership_count(async_session, org_a.id, keeper.id) == 1
    assert await _user_in_list(db_session, org_a.id, keeper.id)


async def test_removal_reparents_direct_reports(async_session, db_session, setup_orgs):
    org_a, leaver, report = (
        setup_orgs["org_a"],
        setup_orgs["leaver"],
        setup_orgs["report"],
    )
    assert await db_session.remove_member(org_a.id, leaver.id, from_team_only=False)

    remaining = (
        await async_session.execute(
            select(OrganizationMembershipModel).where(
                OrganizationMembershipModel.organization_id == org_a.id,
                OrganizationMembershipModel.user_id == report.id,
            )
        )
    ).scalar_one()
    assert remaining.parent_user_id is None, "reports move up to the removed manager's parent"


# ── Test 2 — Synchronization is idempotent ───────────────────────────────────
async def test_sync_does_not_recreate_removed_membership(
    async_session, db_session, setup_orgs
):
    org_a, leaver = setup_orgs["org_a"], setup_orgs["leaver"]
    await db_session.remove_member(org_a.id, leaver.id, from_team_only=False)

    for _ in range(3):
        await db_session.sync_organization_members(org_a.id)
        assert await _membership_count(async_session, org_a.id, leaver.id) == 0
        assert await _removal_count(async_session, org_a.id, leaver.id) == 1


# ── Test 3 — Repeated member listing keeps them absent ───────────────────────
async def test_repeated_listing_keeps_removed_member_absent(
    async_session, db_session, setup_orgs
):
    org_a, leaver = setup_orgs["org_a"], setup_orgs["leaver"]
    await db_session.remove_member(org_a.id, leaver.id, from_team_only=False)

    for _ in range(3):
        assert not await _user_in_list(db_session, org_a.id, leaver.id)
    assert await _membership_count(async_session, org_a.id, leaver.id) == 0


# ── Test 4 — Explicit re-add overrides the removal ───────────────────────────
async def test_explicit_add_restores_membership(async_session, db_session, setup_orgs):
    org_a, leaver = setup_orgs["org_a"], setup_orgs["leaver"]
    await db_session.remove_member(org_a.id, leaver.id, from_team_only=False)

    restored = await db_session.create_and_add_member(
        organization_id=org_a.id,
        email=leaver.email,
        first_name="Re",
        last_name="Added",
        role="member",
    )
    assert restored["user_id"] == leaver.id
    assert restored["role"] == "member"

    assert await _membership_count(async_session, org_a.id, leaver.id) == 1
    assert await _removal_count(async_session, org_a.id, leaver.id) == 0, (
        "the explicit add must clear the removal marker"
    )
    assert await _user_in_list(db_session, org_a.id, leaver.id)

    # And the restored membership survives synchronization.
    await db_session.sync_organization_members(org_a.id)
    assert await _user_in_list(db_session, org_a.id, leaver.id)


# ── Test 5 — Removals are scoped to one organization ─────────────────────────
async def test_removal_in_one_organization_leaves_other_membership(
    async_session, db_session, setup_orgs
):
    org_a, org_b, leaver = (
        setup_orgs["org_a"],
        setup_orgs["org_b"],
        setup_orgs["leaver"],
    )
    # Same user is also a member of organization B.
    await async_session.execute(
        organization_users_association.insert().values(
            organization_id=org_b.id, user_id=leaver.id
        )
    )
    await db_session.sync_organization_members(org_b.id)
    assert await _membership_count(async_session, org_b.id, leaver.id) == 1

    await db_session.remove_member(org_a.id, leaver.id, from_team_only=False)

    # A is cleared, B is untouched — including after B's own sync.
    assert await _membership_count(async_session, org_a.id, leaver.id) == 0
    assert await _removal_count(async_session, org_a.id, leaver.id) == 1
    assert await _removal_count(async_session, org_b.id, leaver.id) == 0
    await db_session.sync_organization_members(org_b.id)
    assert await _membership_count(async_session, org_b.id, leaver.id) == 1
    assert await _user_in_list(db_session, org_b.id, leaver.id)


# ── Test 6 — Ordinary members keep syncing exactly as before ─────────────────
async def test_sync_still_backfills_untouched_members(async_session, db_session, setup_orgs):
    org_a, keeper = setup_orgs["org_a"], setup_orgs["keeper"]

    # Simulate a user linked to the org but not yet backfilled.
    late = await _user(async_session, "late", org_a.id)
    await async_session.execute(
        organization_users_association.insert().values(
            organization_id=org_a.id, user_id=late.id
        )
    )
    assert await _membership_count(async_session, org_a.id, late.id) == 0

    await db_session.sync_organization_members(org_a.id)

    assert await _membership_count(async_session, org_a.id, late.id) == 1
    assert await _membership_count(async_session, org_a.id, keeper.id) == 1
    assert await _user_in_list(db_session, org_a.id, late.id)
    assert await _user_in_list(db_session, org_a.id, keeper.id)


# ── Test 7 — No duplicate memberships or removal records ─────────────────────
async def test_no_duplicates_after_repeated_add_and_sync(
    async_session, db_session, setup_orgs
):
    org_a, leaver = setup_orgs["org_a"], setup_orgs["leaver"]

    for _ in range(3):
        await db_session.create_and_add_member(
            organization_id=org_a.id, email=leaver.email, role="member"
        )
        await db_session.sync_organization_members(org_a.id)
    assert await _membership_count(async_session, org_a.id, leaver.id) == 1

    # Repeated removals also stay at a single marker.
    for _ in range(3):
        await db_session.remove_member(org_a.id, leaver.id, from_team_only=False)
    assert await _removal_count(async_session, org_a.id, leaver.id) == 1
    assert await _membership_count(async_session, org_a.id, leaver.id) == 0


# ── Test 8 — Agent access data is untouched ──────────────────────────────────
async def test_removal_does_not_touch_agent_grants(async_session, db_session, setup_orgs):
    org_a, leaver, keeper = (
        setup_orgs["org_a"],
        setup_orgs["leaver"],
        setup_orgs["keeper"],
    )
    agent = await db_session.create_workflow(
        name="removal-regression-agent",
        workflow_definition=GRAPH,
        user_id=keeper.id,
        organization_id=org_a.id,
        utilization_type="private",
        private_allowed_user_ids=[leaver.id],
    )

    await db_session.remove_member(org_a.id, leaver.id, from_team_only=False)

    refreshed = (
        await async_session.execute(
            select(UserModel).where(UserModel.id == keeper.id)
        )
    ).scalar_one()
    assert refreshed is not None, "removal must never delete user accounts"

    stored = await db_session.get_workflow(agent.id, organization_id=org_a.id)
    assert stored is not None
    assert stored.utilization_type == "private"
    assert stored.private_allowed_user_ids == [leaver.id], (
        "explicit private-agent grants are not membership state and must survive removal"
    )