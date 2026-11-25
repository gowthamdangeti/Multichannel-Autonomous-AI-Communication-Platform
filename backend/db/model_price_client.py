"""DB client for model_price_versions. Rows are added or closed, never rewritten."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Iterable

from sqlalchemy import select, update

from api.db.base_client import BaseDBClient
from api.db.models import ModelPriceVersionModel
from api.services.configuration.pricing.entries import PriceEntry, ReviewStatus


def _to_row(
    *, entry: PriceEntry, review_status: ReviewStatus, verified_at: datetime
) -> ModelPriceVersionModel:
    return ModelPriceVersionModel(
        provider=entry.provider,
        capability=entry.capability,
        model_id=entry.model_id,
        component=entry.component.value,
        rate=entry.rate,
        unit_quantity=entry.unit_quantity,
        currency=entry.currency,
        tier=entry.tier,
        source=entry.source.value,
        source_url=entry.source_url,
        note=entry.note,
        review_status=review_status.value,
        verified_at=verified_at,
    )


class ModelPriceClient(BaseDBClient):
    async def list_active_prices(
        self, *, provider: str, capability: str, model_id: str
    ) -> list[ModelPriceVersionModel]:
        async with self.async_session() as session:
            result = await session.execute(
                select(ModelPriceVersionModel).where(
                    ModelPriceVersionModel.provider == provider,
                    ModelPriceVersionModel.capability == capability,
                    ModelPriceVersionModel.model_id == model_id,
                    ModelPriceVersionModel.review_status == ReviewStatus.APPROVED.value,
                    ModelPriceVersionModel.effective_to.is_(None),
                )
            )
            return list(result.scalars().all())

    async def list_source_prices(self, *, source: str) -> list[ModelPriceVersionModel]:
        """Current and pending rows of one source, for comparing with a fresh fetch."""
        async with self.async_session() as session:
            result = await session.execute(
                select(ModelPriceVersionModel).where(
                    ModelPriceVersionModel.source == source,
                    ModelPriceVersionModel.effective_to.is_(None),
                    ModelPriceVersionModel.review_status.in_(
                        [ReviewStatus.APPROVED.value, ReviewStatus.PENDING.value]
                    ),
                )
            )
            return list(result.scalars().all())

    async def apply_source_sync(
        self,
        *,
        new_entries: Iterable[PriceEntry],
        pending_entries: Iterable[PriceEntry],
        verified_ids: Iterable[int],
        superseded_pending_ids: Iterable[int],
        verified_at: datetime,
    ) -> None:
        """Store one source's sync result in a single transaction."""
        async with self.async_session() as session:
            superseded = list(superseded_pending_ids)
            if superseded:
                await session.execute(
                    update(ModelPriceVersionModel)
                    .where(ModelPriceVersionModel.id.in_(superseded))
                    .values(review_status=ReviewStatus.REJECTED.value)
                )
                await session.flush()
            session.add_all(
                _to_row(entry=e, review_status=ReviewStatus.APPROVED, verified_at=verified_at)
                for e in new_entries
            )
            session.add_all(
                _to_row(entry=e, review_status=ReviewStatus.PENDING, verified_at=verified_at)
                for e in pending_entries
            )
            ids = list(verified_ids)
            if ids:
                await session.execute(
                    update(ModelPriceVersionModel)
                    .where(ModelPriceVersionModel.id.in_(ids))
                    .values(verified_at=verified_at)
                )
            await session.commit()

    async def list_pending_prices(self) -> list[ModelPriceVersionModel]:
        async with self.async_session() as session:
            result = await session.execute(
                select(ModelPriceVersionModel)
                .where(ModelPriceVersionModel.review_status == ReviewStatus.PENDING.value)
                .order_by(
                    ModelPriceVersionModel.provider,
                    ModelPriceVersionModel.capability,
                    ModelPriceVersionModel.model_id,
                )
            )
            return list(result.scalars().all())

    async def approve_price(
        self, *, price_id: int, reviewed_by: int
    ) -> ModelPriceVersionModel | None:
        """Close the current price and make the pending one current."""
        now = datetime.now(UTC)
        async with self.async_session() as session:
            row = await session.get(ModelPriceVersionModel, price_id)
            if row is None or row.review_status != ReviewStatus.PENDING.value:
                return None
            await session.execute(
                update(ModelPriceVersionModel)
                .where(
                    ModelPriceVersionModel.provider == row.provider,
                    ModelPriceVersionModel.capability == row.capability,
                    ModelPriceVersionModel.model_id == row.model_id,
                    ModelPriceVersionModel.component == row.component,
                    ModelPriceVersionModel.source == row.source,
                    ModelPriceVersionModel.review_status == ReviewStatus.APPROVED.value,
                    ModelPriceVersionModel.effective_to.is_(None),
                )
                .values(effective_to=now)
            )
            await session.flush()
            row.review_status = ReviewStatus.APPROVED.value
            row.reviewed_by = reviewed_by
            row.effective_from = now
            await session.commit()
            await session.refresh(row)
            return row

    async def reject_price(
        self, *, price_id: int, reviewed_by: int
    ) -> ModelPriceVersionModel | None:
        async with self.async_session() as session:
            row = await session.get(ModelPriceVersionModel, price_id)
            if row is None or row.review_status != ReviewStatus.PENDING.value:
                return None
            row.review_status = ReviewStatus.REJECTED.value
            row.reviewed_by = reviewed_by
            await session.commit()
            await session.refresh(row)
            return row
