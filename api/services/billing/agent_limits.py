"""Free-tier agent creation guard — creation section ONLY.

Rule: org without a paid plan gets exactly 1 agent total across
voice (workflows) + chat + whatsapp. After that, must buy billing
(subscribe / top-up) to create more. Paid orgs (wallet.billing_plan_id
set) are unlimited.

Scope: called ONLY from agent CREATION handlers. Run handlers
(create_workflow_run, quota checks, wallet debit, ARQ completion)
are intentionally untouched — runs already enforce billing via
_require_sufficient_credits + wallet debit.

No schema changes, no other codebase touched.
"""
from __future__ import annotations

from fastapi import HTTPException
from sqlalchemy import func, select

from api.db.base_client import BaseDBClient
from api.db.models import (
    ChatAgentModel,
    WhatsAppAgentModel,
    WorkflowModel,
)

FREE_AGENT_LIMIT = 1


class AgentLimitGuard(BaseDBClient):
    async def get_usage(self, org_id: int) -> dict[str, int]:
        async with self.async_session() as s:
            v = await s.execute(
                select(func.count())
                .select_from(WorkflowModel)
                .where(WorkflowModel.organization_id == org_id)
            )
            c = await s.execute(
                select(func.count())
                .select_from(ChatAgentModel)
                .where(ChatAgentModel.organization_id == org_id)
            )
            w = await s.execute(
                select(func.count())
                .select_from(WhatsAppAgentModel)
                .where(WhatsAppAgentModel.organization_id == org_id)
            )
            voice, chat, whatsapp = v.scalar_one(), c.scalar_one(), w.scalar_one()
            return {
                "voice": voice,
                "chat": chat,
                "whatsapp": whatsapp,
                "total": voice + chat + whatsapp,
            }

    async def is_paid(self, org_id: int) -> bool:
        from api.services.billing.service import billing_service

        wallet = await billing_service.get_wallet(org_id)
        return bool(wallet and wallet.billing_plan_id)

    async def assert_can_create_agent(
        self, org_id: int, *, kind: str = "agent", user=None
    ) -> dict[str, int]:
        # Super-admin bypass for setup — only org users are limited.
        if user is not None and getattr(user, "is_superuser", False):
            return await self.get_usage(org_id)
        if await self.is_paid(org_id):
            return await self.get_usage(org_id)
        usage = await self.get_usage(org_id)
        if usage["total"] >= FREE_AGENT_LIMIT:
            raise HTTPException(
                status_code=402,
                detail={
                    "message": (
                        "Free tier allows 1 agent. You already have "
                        f"{usage['total']}. Please subscribe or add credits "
                        "in Billing to create more agents."
                    ),
                    "code": "agent_limit_reached",
                    "error_type": "agent_limit_reached",
                    "limit": FREE_AGENT_LIMIT,
                    "used": usage["total"],
                    "usage": usage,
                },
            )
        return usage


agent_limit_guard = AgentLimitGuard()
