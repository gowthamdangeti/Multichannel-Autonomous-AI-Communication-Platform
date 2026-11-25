"""DB client for Convozent platform tables (voice_catalog, org_platform_config, org_subscriptions)."""
from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import Date, Float, cast, desc, func, select, text

from api.db.base_client import BaseDBClient
from api.db.models import (
    OrgPlatformConfigModel,
    OrgSubscriptionModel,
    OrganizationModel,
    PlatformConfigModel,
    PlatformModelConfigurationModel,
    ProviderLanguageCatalogModel,
    UserModel,
    VoiceCatalogModel,
    WorkflowModel,
    WorkflowRunModel,
)


class PlatformClient(BaseDBClient):
    # ------------------------------------------------------------------ #
    # Organizations (admin helpers)
    # ------------------------------------------------------------------ #

    async def get_all_organizations(self) -> list[OrganizationModel]:
        async with self.async_session() as session:
            result = await session.execute(
                select(OrganizationModel).order_by(OrganizationModel.created_at.desc())
            )
            return list(result.scalars().all())

    async def get_organization_by_id(self, org_id: int) -> OrganizationModel | None:
        async with self.async_session() as session:
            result = await session.execute(
                select(OrganizationModel).where(OrganizationModel.id == org_id)
            )
            return result.scalar_one_or_none()

    async def get_org_primary_email(self, org_id: int) -> str | None:
        async with self.async_session() as session:
            from api.db.models import UserModel, organization_users_association
            stmt = (
                select(func.coalesce(UserModel.email, UserModel.provider_id))
                .join(organization_users_association, UserModel.id == organization_users_association.c.user_id)
                .where(organization_users_association.c.organization_id == org_id)
            )
            res = await session.execute(stmt)
            return res.scalars().first()

    async def get_org_primary_user(self, org_id: int):
        async with self.async_session() as session:
            from api.db.models import UserModel, organization_users_association
            stmt = (
                select(UserModel)
                .join(organization_users_association, UserModel.id == organization_users_association.c.user_id)
                .where(organization_users_association.c.organization_id == org_id)
            )
            res = await session.execute(stmt)
            return res.scalars().first()


    # ------------------------------------------------------------------ #
    # Voice Catalog
    # ------------------------------------------------------------------ #

    async def list_voices(self, *, active_only: bool = True) -> list[VoiceCatalogModel]:
        async with self.async_session() as session:
            q = select(VoiceCatalogModel)
            if active_only:
                q = q.where(VoiceCatalogModel.is_active.is_(True))
            q = q.order_by(VoiceCatalogModel.name)
            result = await session.execute(q)
            return list(result.scalars().all())

    async def list_voices_for_org(self, *, org_id: int) -> list[VoiceCatalogModel]:
        """Return only the voices the org is allowed to use."""
        async with self.async_session() as session:
            cfg_result = await session.execute(
                select(OrgPlatformConfigModel).where(
                    OrgPlatformConfigModel.organization_id == org_id
                )
            )
            cfg = cfg_result.scalar_one_or_none()
            if not cfg or not cfg.allowed_voice_ids:
                return []
            q = (
                select(VoiceCatalogModel)
                .where(VoiceCatalogModel.id.in_(cfg.allowed_voice_ids))
                .where(VoiceCatalogModel.is_active.is_(True))
                .order_by(VoiceCatalogModel.name)
            )
            result = await session.execute(q)
            return list(result.scalars().all())

    async def get_voice(self, voice_id: int) -> VoiceCatalogModel | None:
        async with self.async_session() as session:
            result = await session.execute(
                select(VoiceCatalogModel).where(VoiceCatalogModel.id == voice_id)
            )
            return result.scalar_one_or_none()

    async def create_voice(self, data: dict[str, Any]) -> VoiceCatalogModel:
        async with self.async_session() as session:
            voice = VoiceCatalogModel(**data)
            session.add(voice)
            await session.commit()
            await session.refresh(voice)
            return voice

    async def update_voice(self, voice_id: int, data: dict[str, Any]) -> VoiceCatalogModel | None:
        async with self.async_session() as session:
            result = await session.execute(
                select(VoiceCatalogModel).where(VoiceCatalogModel.id == voice_id)
            )
            voice = result.scalar_one_or_none()
            if not voice:
                return None
            for k, v in data.items():
                setattr(voice, k, v)
            voice.updated_at = datetime.now(UTC)
            await session.commit()
            await session.refresh(voice)
            return voice

    async def delete_voice(self, voice_id: int) -> bool:
        async with self.async_session() as session:
            result = await session.execute(
                select(VoiceCatalogModel).where(VoiceCatalogModel.id == voice_id)
            )
            voice = result.scalar_one_or_none()
            if not voice:
                return False
            await session.delete(voice)
            await session.commit()
            return True

    # ------------------------------------------------------------------ #
    # Org Platform Config
    # ------------------------------------------------------------------ #

    async def get_org_platform_config(self, org_id: int) -> OrgPlatformConfigModel | None:
        async with self.async_session() as session:
            result = await session.execute(
                select(OrgPlatformConfigModel).where(
                    OrgPlatformConfigModel.organization_id == org_id
                )
            )
            return result.scalar_one_or_none()

    async def upsert_org_platform_config(
        self, org_id: int, data: dict[str, Any]
    ) -> OrgPlatformConfigModel:
        async with self.async_session() as session:
            result = await session.execute(
                select(OrgPlatformConfigModel).where(
                    OrgPlatformConfigModel.organization_id == org_id
                )
            )
            cfg = result.scalar_one_or_none()
            if cfg:
                for k, v in data.items():
                    setattr(cfg, k, v)
                cfg.updated_at = datetime.now(UTC)
            else:
                cfg = OrgPlatformConfigModel(organization_id=org_id, **data)
                session.add(cfg)
            await session.commit()
            await session.refresh(cfg)
            return cfg

    async def get_org_model_configuration_v2(self, org_id: int) -> dict | None:
        """Typed super-admin per-org model configuration override, if set."""
        cfg = await self.get_org_platform_config(org_id)
        if cfg is None:
            return None
        return cfg.model_configuration_v2 or None

    async def upsert_org_model_configuration_v2(
        self, org_id: int, value: dict
    ) -> OrgPlatformConfigModel:
        return await self.upsert_org_platform_config(
            org_id, {"model_configuration_v2": value}
        )

    # ------------------------------------------------------------------ #
    # Provider Language Catalog (live language lists)
    # ------------------------------------------------------------------ #

    async def list_language_catalog(
        self, *, provider: str | None = None, capability: str | None = None
    ) -> list[ProviderLanguageCatalogModel]:
        async with self.async_session() as session:
            q = select(ProviderLanguageCatalogModel)
            if provider:
                q = q.where(ProviderLanguageCatalogModel.provider == provider)
            if capability:
                q = q.where(ProviderLanguageCatalogModel.capability == capability)
            q = q.order_by(
                ProviderLanguageCatalogModel.provider,
                ProviderLanguageCatalogModel.capability,
                ProviderLanguageCatalogModel.model,
            )
            result = await session.execute(q)
            return list(result.scalars().all())

    async def get_language_catalog_entry(self, entry_id: int) -> ProviderLanguageCatalogModel | None:
        async with self.async_session() as session:
            return await session.get(ProviderLanguageCatalogModel, entry_id)

    async def save_language_catalog_entry(
        self,
        *,
        provider: str,
        capability: str,
        model: str,
        codes: list[str] | None,
        voice_counts: dict | None,
        pending_codes: list[str] | None,
        pending_reason: str | None,
    ) -> ProviderLanguageCatalogModel:
        """Insert or update one row.

        ``codes=None`` keeps the current active list (used when a refresh is
        parked as pending instead of applied).
        """
        async with self.async_session() as session:
            result = await session.execute(
                select(ProviderLanguageCatalogModel).where(
                    ProviderLanguageCatalogModel.provider == provider,
                    ProviderLanguageCatalogModel.capability == capability,
                    ProviderLanguageCatalogModel.model == model,
                )
            )
            row = result.scalar_one_or_none()
            now = datetime.now(UTC)
            if row is None:
                row = ProviderLanguageCatalogModel(
                    provider=provider, capability=capability, model=model, codes=codes or []
                )
                session.add(row)
            elif codes is not None:
                row.codes = codes
            if codes is not None:
                row.voice_counts = voice_counts
                row.fetched_at = now
            row.pending_codes = pending_codes
            row.pending_reason = pending_reason
            row.updated_at = now
            await session.commit()
            await session.refresh(row)
            return row

    async def resolve_language_catalog_pending(
        self, entry_id: int, *, approve: bool
    ) -> ProviderLanguageCatalogModel | None:
        """Apply (approve) or drop (reject) a parked refresh."""
        async with self.async_session() as session:
            row = await session.get(ProviderLanguageCatalogModel, entry_id)
            if row is None:
                return None
            if approve and row.pending_codes is not None:
                row.codes = row.pending_codes
                row.fetched_at = datetime.now(UTC)
            row.pending_codes = None
            row.pending_reason = None
            row.updated_at = datetime.now(UTC)
            await session.commit()
            await session.refresh(row)
            return row

    async def delete_language_catalog(self, *, provider: str, capability: str) -> int:
        """Remove a provider's live rows so the static list in code is used again."""
        async with self.async_session() as session:
            rows = (
                await session.execute(
                    select(ProviderLanguageCatalogModel).where(
                        ProviderLanguageCatalogModel.provider == provider,
                        ProviderLanguageCatalogModel.capability == capability,
                    )
                )
            ).scalars().all()
            for row in rows:
                await session.delete(row)
            await session.commit()
            return len(rows)

    # ------------------------------------------------------------------ #
    # Platform Config (global, singleton key/value)
    # ------------------------------------------------------------------ #

    async def get_platform_config(self, key: str) -> PlatformConfigModel | None:
        async with self.async_session() as session:
            result = await session.execute(
                select(PlatformConfigModel).where(PlatformConfigModel.key == key)
            )
            return result.scalar_one_or_none()

    async def get_platform_config_value(self, key: str) -> dict | None:
        row = await self.get_platform_config(key)
        if row is None or not row.value:
            return None
        return row.value

    async def upsert_platform_config(
        self, key: str, value: dict
    ) -> PlatformConfigModel:
        async with self.async_session() as session:
            result = await session.execute(
                select(PlatformConfigModel).where(PlatformConfigModel.key == key)
            )
            row = result.scalar_one_or_none()
            if row:
                row.value = value
                row.updated_at = datetime.now(UTC)
            else:
                row = PlatformConfigModel(key=key, value=value)
                session.add(row)
            await session.commit()
            await session.refresh(row)
            return row

    # ------------------------------------------------------------------ #
    # Platform Model Configuration Presets
    # ------------------------------------------------------------------ #

    async def list_model_configurations(
        self, *, active_only: bool = False
    ) -> list[PlatformModelConfigurationModel]:
        async with self.async_session() as session:
            q = select(PlatformModelConfigurationModel)
            if active_only:
                q = q.where(PlatformModelConfigurationModel.is_active.is_(True))
            q = q.order_by(
                PlatformModelConfigurationModel.is_default.desc(),
                PlatformModelConfigurationModel.sort_order,
                PlatformModelConfigurationModel.name,
            )
            result = await session.execute(q)
            return list(result.scalars().all())

    async def list_active_model_configurations(
        self,
    ) -> list[PlatformModelConfigurationModel]:
        return await self.list_model_configurations(active_only=True)

    async def get_model_configuration(
        self, config_id: int
    ) -> PlatformModelConfigurationModel | None:
        async with self.async_session() as session:
            result = await session.execute(
                select(PlatformModelConfigurationModel).where(
                    PlatformModelConfigurationModel.id == config_id
                )
            )
            return result.scalar_one_or_none()

    async def get_default_model_configuration(
        self,
    ) -> PlatformModelConfigurationModel | None:
        async with self.async_session() as session:
            result = await session.execute(
                select(PlatformModelConfigurationModel)
                .where(PlatformModelConfigurationModel.is_active.is_(True))
                .where(PlatformModelConfigurationModel.is_default.is_(True))
                .order_by(PlatformModelConfigurationModel.sort_order)
            )
            return result.scalars().first()

    async def create_model_configuration(
        self, data: dict[str, Any]
    ) -> PlatformModelConfigurationModel:
        async with self.async_session() as session:
            if data.get("is_default"):
                await self._clear_default_model_configuration(session)
            row = PlatformModelConfigurationModel(**data)
            session.add(row)
            await session.commit()
            await session.refresh(row)
            return row

    async def update_model_configuration(
        self, config_id: int, data: dict[str, Any]
    ) -> PlatformModelConfigurationModel | None:
        async with self.async_session() as session:
            result = await session.execute(
                select(PlatformModelConfigurationModel).where(
                    PlatformModelConfigurationModel.id == config_id
                )
            )
            row = result.scalar_one_or_none()
            if not row:
                return None
            if data.get("is_default"):
                await self._clear_default_model_configuration(
                    session, exclude_id=config_id
                )
            for k, v in data.items():
                setattr(row, k, v)
            row.updated_at = datetime.now(UTC)
            await session.commit()
            await session.refresh(row)
            return row

    async def delete_model_configuration(self, config_id: int) -> bool:
        async with self.async_session() as session:
            result = await session.execute(
                select(PlatformModelConfigurationModel).where(
                    PlatformModelConfigurationModel.id == config_id
                )
            )
            row = result.scalar_one_or_none()
            if not row:
                return False
            await session.delete(row)
            await session.commit()
            return True

    @staticmethod
    async def _clear_default_model_configuration(session, exclude_id: int | None = None):
        """Ensure at most one preset is marked default."""
        result = await session.execute(
            select(PlatformModelConfigurationModel).where(
                PlatformModelConfigurationModel.is_default.is_(True)
            )
        )
        for row in result.scalars().all():
            if exclude_id is not None and row.id == exclude_id:
                continue
            row.is_default = False

    # ------------------------------------------------------------------ #
    # Org Subscriptions
    # ------------------------------------------------------------------ #

    async def get_org_subscription(self, org_id: int) -> OrgSubscriptionModel | None:
        async with self.async_session() as session:
            result = await session.execute(
                select(OrgSubscriptionModel).where(
                    OrgSubscriptionModel.organization_id == org_id
                )
            )
            return result.scalar_one_or_none()

    async def upsert_org_subscription(
        self, org_id: int, data: dict[str, Any]
    ) -> OrgSubscriptionModel:
        async with self.async_session() as session:
            result = await session.execute(
                select(OrgSubscriptionModel).where(
                    OrgSubscriptionModel.organization_id == org_id
                )
            )
            sub = result.scalar_one_or_none()
            if sub:
                for k, v in data.items():
                    setattr(sub, k, v)
                sub.updated_at = datetime.now(UTC)
            else:
                sub = OrgSubscriptionModel(organization_id=org_id, **data)
                session.add(sub)
            await session.commit()
            await session.refresh(sub)
            return sub


    async def get_platform_stats(self, days: int = 7) -> dict[str, Any]:
        """Platform-wide stats for the super-admin dashboard."""
        now = datetime.now(UTC)
        period_start = now - timedelta(days=days)
        prev_start = period_start - timedelta(days=days)

        async with self.async_session() as session:
            # ── Totals ────────────────────────────────────────────────
            total_orgs = (
                await session.execute(select(func.count(OrganizationModel.id)))
            ).scalar_one()

            total_users = (
                await session.execute(select(func.count(UserModel.id)))
            ).scalar_one()

            total_workflows = (
                await session.execute(select(func.count(WorkflowModel.id)))
            ).scalar_one()

            total_active_voices = (
                await session.execute(
                    select(func.count(VoiceCatalogModel.id))
                    .where(VoiceCatalogModel.is_active.is_(True))
                )
            ).scalar_one()

            # ── New signups (orgs) per day ────────────────────────────
            def _daily_orgs(start, end):
                return (
                    select(
                        cast(OrganizationModel.created_at, Date).label("day"),
                        func.count().label("count"),
                    )
                    .where(
                        OrganizationModel.created_at >= start,
                        OrganizationModel.created_at < end,
                    )
                    .group_by("day")
                    .order_by("day")
                )

            org_rows = (await session.execute(_daily_orgs(period_start, now))).fetchall()
            prev_org_rows = (await session.execute(_daily_orgs(prev_start, period_start))).fetchall()
            current_signups = sum(r.count for r in org_rows)
            prev_signups = sum(r.count for r in prev_org_rows)

            # ── New agents (workflows) created per day ────────────────
            def _daily_workflows(start, end):
                return (
                    select(
                        cast(WorkflowModel.created_at, Date).label("day"),
                        func.count().label("count"),
                    )
                    .where(
                        WorkflowModel.created_at >= start,
                        WorkflowModel.created_at < end,
                    )
                    .group_by("day")
                    .order_by("day")
                )

            wf_rows = (await session.execute(_daily_workflows(period_start, now))).fetchall()
            prev_wf_rows = (await session.execute(_daily_workflows(prev_start, period_start))).fetchall()
            current_agents = sum(r.count for r in wf_rows)
            prev_agents = sum(r.count for r in prev_wf_rows)

            # ── Fill 7-day arrays ─────────────────────────────────────
            daily_signups: dict[str, dict] = {}
            daily_agents: dict[str, dict] = {}
            for i in range(days):
                d = (period_start + timedelta(days=i)).strftime("%Y-%m-%d")
                daily_signups[d] = {"date": d, "calls": 0}
                daily_agents[d] = {"date": d, "calls": 0}
            for r in org_rows:
                d = str(r.day)
                if d in daily_signups:
                    daily_signups[d]["calls"] = r.count
            for r in wf_rows:
                d = str(r.day)
                if d in daily_agents:
                    daily_agents[d]["calls"] = r.count

            # ── Top orgs by agent count ───────────────────────────────
            top_orgs_rows = (
                await session.execute(
                    select(
                        OrganizationModel.name,
                        func.count(WorkflowModel.id).label("calls"),
                    )
                    .join(WorkflowModel, WorkflowModel.organization_id == OrganizationModel.id)
                    .group_by(OrganizationModel.id, OrganizationModel.name)
                    .order_by(desc("calls"))
                    .limit(5)
                )
            ).fetchall()

            return {
                "total_orgs": total_orgs,
                "total_users": total_users,
                "total_workflows": total_workflows,
                "total_active_voices": total_active_voices,
                "current_signups": current_signups,
                "prev_signups": prev_signups,
                "current_agents": current_agents,
                "prev_agents": prev_agents,
                "daily_signups": list(daily_signups.values()),
                "daily_agents": list(daily_agents.values()),
                "top_orgs_by_agents": [{"name": r.name, "calls": r.calls} for r in top_orgs_rows],
            }


platform_client = PlatformClient()
