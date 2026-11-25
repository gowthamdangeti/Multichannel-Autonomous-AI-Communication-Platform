"""Pre-call billing guards — decide whether a call may start."""
from __future__ import annotations

from decimal import Decimal

from sqlalchemy import select

from api.db.base_client import BaseDBClient
from api.db.models import BillingPlanModel, OrgWalletModel


class BillingGuards(BaseDBClient):
    async def can_start_call(
        self, org_id: int, *, estimated_minutes: float = 1.0
    ) -> tuple[bool, str]:
        """Returns (allowed, reason).

        - No wallet -> allow (free trial / legacy org), reason trial.
        - Balance covers estimate at plan rate -> allow.
        - Else if exhaustion_policy == auto_bill -> allow (will go negative-safe).
        - Else deny with 402-style reason.
        """
        async with self.async_session() as s:
            w = (
                await s.execute(
                    select(OrgWalletModel).where(
                        OrgWalletModel.organization_id == org_id
                    )
                )
            ).scalar_one_or_none()
            if not w:
                return True, "no-wallet-trial"
            rate = Decimal("0.05")
            if w.billing_plan_id:
                p = (
                    await s.execute(
                        select(BillingPlanModel).where(
                            BillingPlanModel.id == w.billing_plan_id
                        )
                    )
                ).scalar_one_or_none()
                if p:
                    rate = Decimal(str(p.price_per_extra_minute))
            need = rate * Decimal(str(estimated_minutes))
            balance = Decimal(str(w.balance))
            if balance >= need:
                return True, "sufficient"
            if (w.exhaustion_policy or "pause") == "auto_bill":
                return True, "auto-bill-overdraft"
            return (
                False,
                f"Insufficient balance ({balance} {w.currency}, need ~{need}). "
                "Please top up.",
            )


billing_guards = BillingGuards()
