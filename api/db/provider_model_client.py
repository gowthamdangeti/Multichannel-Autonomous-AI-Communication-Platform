"""DB client for provider_model_catalog."""

from __future__ import annotations

from datetime import datetime
from typing import Iterable

from sqlalchemy import select, update
from sqlalchemy.dialects.postgresql import insert

from api.db.base_client import BaseDBClient
from api.db.models import ProviderModelCatalogModel

STATUS_ACTIVE = "active"
STATUS_DEPRECATED = "deprecated"


class ProviderModelClient(BaseDBClient):
    async def list_provider_models(
        self, *, provider: str, capability: str
    ) -> list[ProviderModelCatalogModel]:
        async with self.async_session() as session:
            result = await session.execute(
                select(ProviderModelCatalogModel)
                .where(
                    ProviderModelCatalogModel.provider == provider,
                    ProviderModelCatalogModel.capability == capability,
                )
                .order_by(ProviderModelCatalogModel.model_id)
            )
            return list(result.scalars().all())

    async def replace_provider_models(
        self,
        *,
        provider: str,
        capability: str,
        models: Iterable[tuple[str, str | None]],
        seen_at: datetime,
    ) -> None:
        """Store a full list; anything no longer listed becomes deprecated."""
        listed = dict(models)
        async with self.async_session() as session:
            for model_id, display_name in listed.items():
                statement = insert(ProviderModelCatalogModel).values(
                    provider=provider,
                    capability=capability,
                    model_id=model_id,
                    display_name=display_name,
                    status=STATUS_ACTIVE,
                    first_seen_at=seen_at,
                    last_seen_at=seen_at,
                )
                await session.execute(
                    statement.on_conflict_do_update(
                        constraint="uq_provider_model_catalog_key",
                        set_={
                            "display_name": display_name,
                            "status": STATUS_ACTIVE,
                            "last_seen_at": seen_at,
                        },
                    )
                )
            await session.execute(
                update(ProviderModelCatalogModel)
                .where(
                    ProviderModelCatalogModel.provider == provider,
                    ProviderModelCatalogModel.capability == capability,
                    ProviderModelCatalogModel.model_id.not_in(list(listed)),
                )
                .values(status=STATUS_DEPRECATED)
            )
            await session.commit()
