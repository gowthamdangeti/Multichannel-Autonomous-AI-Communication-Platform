"""DB client for in-house enterprise leads + org onboarding profiles."""

from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy import desc, func, or_, select

from api.db.base_client import BaseDBClient
from api.db.models import EnterpriseLeadModel, OrgOnboardingProfileModel


class LeadClient(BaseDBClient):
    # ── Enterprise leads (global, superuser-only reads) ── #

    async def create_enterprise_lead(self, data: dict) -> EnterpriseLeadModel:
        async with self.async_session() as session:
            row = EnterpriseLeadModel(
                name=data.get("name", ""),
                company=data.get("company", ""),
                job_title=data.get("job_title") or data.get("jobTitle", ""),
                work_email=(data.get("work_email") or data.get("workEmail") or "").lower().strip(),
                phone=data.get("phone", ""),
                volume=data.get("volume") or "not-sure",
                deployment=data.get("deployment") or "yes",
                agent_goal=data.get("agent_goal", data.get("agentGoal")),
                source=data.get("source") or "landing_contact",
                origin=data.get("origin") or "oss_app",
                country=data.get("country"),
                status="new",
            )
            session.add(row)
            await session.commit()
            await session.refresh(row)
            return row

    async def list_enterprise_leads(
        self,
        *,
        page: int = 1,
        limit: int = 50,
        status: str | None = None,
        search: str | None = None,
    ) -> tuple[list[EnterpriseLeadModel], int]:
        page = max(1, page)
        limit = min(100, max(1, limit))
        async with self.async_session() as session:
            q = select(EnterpriseLeadModel)
            count_q = select(func.count()).select_from(EnterpriseLeadModel)
            if status:
                q = q.where(EnterpriseLeadModel.status == status)
                count_q = count_q.where(EnterpriseLeadModel.status == status)
            if search:
                like = f"%{search.lower()}%"
                cond = or_(
                    func.lower(EnterpriseLeadModel.name).like(like),
                    func.lower(EnterpriseLeadModel.company).like(like),
                    func.lower(EnterpriseLeadModel.work_email).like(like),
                )
                q = q.where(cond)
                count_q = count_q.where(cond)
            total = (await session.execute(count_q)).scalar_one()
            q = q.order_by(desc(EnterpriseLeadModel.created_at)).offset((page - 1) * limit).limit(limit)
            rows = list((await session.execute(q)).scalars().all())
            return rows, total

    async def update_enterprise_lead_status(self, lead_id: int, status: str, contacted_by: int | None = None) -> EnterpriseLeadModel | None:
        async with self.async_session() as session:
            row = await session.get(EnterpriseLeadModel, lead_id)
            if not row:
                return None
            row.status = status
            if status == "contacted":
                row.contacted_by = contacted_by
                row.contacted_at = datetime.now(UTC)
            await session.commit()
            await session.refresh(row)
            return row

    # ── Org onboarding profiles (org-scoped) ── #

    async def upsert_onboarding_profile(
        self,
        *,
        organization_id: int | None,
        user_id: int | None,
        data: dict,
    ) -> OrgOnboardingProfileModel:
        async with self.async_session() as session:
            row: OrgOnboardingProfileModel | None = None
            if organization_id is not None:
                res = await session.execute(
                    select(OrgOnboardingProfileModel).where(
                        OrgOnboardingProfileModel.organization_id == organization_id
                    )
                )
                row = res.scalar_one_or_none()
            if organization_id is None:
                raise ValueError("organization_id is required to store onboarding profile")
            payload = {
                "persona": data.get("persona"),
                "onprem_need": data.get("onprem_need", data.get("onPremNeed")),
                "migrating_from": data.get("migrating_from", data.get("migratingFrom")),
                "migrating_other_provider": data.get(
                    "migrating_other_provider", data.get("migratingOtherProvider")
                ),
                "switch_reason": data.get("switch_reason", data.get("switchReason")),
                "how_heard": data.get("how_heard", data.get("howHeard")),
                "volume": data.get("volume"),
                "country": data.get("country"),
                "origin": data.get("origin") or "oss_app",
            }
            # Drop None so partial updates don't wipe existing answers.
            payload = {k: v for k, v in payload.items() if v is not None}
            if row:
                for k, v in payload.items():
                    setattr(row, k, v)
                if user_id is not None:
                    row.user_id = user_id
                if data.get("email"):
                    row.email = data["email"]
            else:
                row = OrgOnboardingProfileModel(
                    organization_id=organization_id,
                    user_id=user_id,
                    email=data.get("email"),
                    **payload,
                )
                session.add(row)
            await session.commit()
            await session.refresh(row)
            return row

    async def get_onboarding_profile_by_org(self, organization_id: int) -> OrgOnboardingProfileModel | None:
        async with self.async_session() as session:
            res = await session.execute(
                select(OrgOnboardingProfileModel).where(
                    OrgOnboardingProfileModel.organization_id == organization_id
                )
            )
            return res.scalar_one_or_none()
