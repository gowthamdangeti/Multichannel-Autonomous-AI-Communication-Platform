"""DB client for model_pricing_rules table."""

from __future__ import annotations

from sqlalchemy import select

from api.db.base_client import BaseDBClient
from api.db.models import ModelPricingRuleModel


class ModelPricingClient(BaseDBClient):

    async def list_pricing_rules(
        self, *, active_only: bool = True, service_type: str | None = None
    ) -> list[ModelPricingRuleModel]:
        async with self.async_session() as session:
            q = select(ModelPricingRuleModel)
            if active_only:
                q = q.where(ModelPricingRuleModel.is_active.is_(True))
            if service_type:
                q = q.where(ModelPricingRuleModel.service_type == service_type)
            q = q.order_by(
                ModelPricingRuleModel.service_type,
                ModelPricingRuleModel.sort_order,
            )
            result = await session.execute(q)
            return list(result.scalars().all())

    async def get_pricing_rule(self, rule_id: int) -> ModelPricingRuleModel | None:
        async with self.async_session() as session:
            result = await session.execute(
                select(ModelPricingRuleModel).where(
                    ModelPricingRuleModel.id == rule_id
                )
            )
            return result.scalar_one_or_none()

    async def create_pricing_rule(self, data: dict) -> ModelPricingRuleModel:
        async with self.async_session() as session:
            row = ModelPricingRuleModel(**data)
            session.add(row)
            await session.commit()
            await session.refresh(row)
            return row

    async def update_pricing_rule(
        self, rule_id: int, data: dict
    ) -> ModelPricingRuleModel | None:
        async with self.async_session() as session:
            result = await session.execute(
                select(ModelPricingRuleModel).where(
                    ModelPricingRuleModel.id == rule_id
                )
            )
            row = result.scalar_one_or_none()
            if not row:
                return None
            for k, v in data.items():
                setattr(row, k, v)
            await session.commit()
            await session.refresh(row)
            return row

    async def delete_pricing_rule(self, rule_id: int) -> bool:
        async with self.async_session() as session:
            result = await session.execute(
                select(ModelPricingRuleModel).where(
                    ModelPricingRuleModel.id == rule_id
                )
            )
            row = result.scalar_one_or_none()
            if not row:
                return False
            await session.delete(row)
            await session.commit()
            return True
