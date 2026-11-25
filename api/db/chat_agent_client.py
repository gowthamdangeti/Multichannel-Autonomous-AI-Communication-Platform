"""Database access for chat agents (org-scoped) + public-key lookup."""

import secrets
from typing import Any, List, Optional

from sqlalchemy import func
from sqlalchemy.future import select

from api.db.base_client import BaseDBClient
from api.db.models import ChatAgentModel, ChatConversationModel


def _generate_public_key() -> str:
    return f"chat_{secrets.token_urlsafe(24)}"


class ChatAgentClient(BaseDBClient):
    async def list_chat_agents(self, organization_id: int) -> List[ChatAgentModel]:
        async with self.async_session() as session:
            result = await session.execute(
                select(ChatAgentModel)
                .where(ChatAgentModel.organization_id == organization_id)
                .order_by(ChatAgentModel.created_at.desc())
            )
            return list(result.scalars().all())

    async def get_chat_agent(
        self, agent_id: int, organization_id: int
    ) -> Optional[ChatAgentModel]:
        async with self.async_session() as session:
            result = await session.execute(
                select(ChatAgentModel).where(
                    ChatAgentModel.id == agent_id,
                    ChatAgentModel.organization_id == organization_id,
                )
            )
            return result.scalars().first()

    async def get_chat_agent_run_counts(
        self, agent_ids: List[int], organization_id: int
    ) -> dict[int, int]:
        """Get total conversation run counts for multiple chat agents in a single query.

        Args:
            agent_ids: List of agent IDs to get run counts for
            organization_id: Organization ID for tenant isolation

        Returns:
            Dict mapping agent_id to total run count
        """
        if not agent_ids:
            return {}

        async with self.async_session() as session:
            result = await session.execute(
                select(
                    ChatConversationModel.chat_agent_id,
                    func.count(ChatConversationModel.id).label("run_count"),
                )
                .where(
                    ChatConversationModel.organization_id == organization_id,
                    ChatConversationModel.chat_agent_id.in_(agent_ids),
                )
                .group_by(ChatConversationModel.chat_agent_id)
            )
            return {row.chat_agent_id: row.run_count for row in result.all()}

    async def get_chat_agent_by_public_key(
        self, public_key: str
    ) -> Optional[ChatAgentModel]:
        """Unauthenticated lookup for the public embed endpoints."""
        async with self.async_session() as session:
            result = await session.execute(
                select(ChatAgentModel).where(ChatAgentModel.public_key == public_key)
            )
            return result.scalars().first()

    async def create_chat_agent(
        self,
        organization_id: int,
        name: str,
        system_prompt: str = "",
        description: Optional[str] = None,
        character: Optional[str] = None,
        greeting: Optional[str] = None,
        model_config_ref: Optional[dict] = None,
        allowed_domains: Optional[list] = None,
        appearance: Optional[dict] = None,
    ) -> ChatAgentModel:
        async with self.async_session() as session:
            agent = ChatAgentModel(
                organization_id=organization_id,
                name=name,
                description=description,
                character=character,
                system_prompt=system_prompt or "",
                greeting=greeting,
                model_config_ref=model_config_ref or {},
                public_key=_generate_public_key(),
                allowed_domains=allowed_domains or None,
                appearance=appearance or {},
            )
            session.add(agent)
            await session.commit()
            await session.refresh(agent)
            return agent

    async def update_chat_agent(
        self, agent_id: int, organization_id: int, **fields: Any
    ) -> Optional[ChatAgentModel]:
        async with self.async_session() as session:
            result = await session.execute(
                select(ChatAgentModel).where(
                    ChatAgentModel.id == agent_id,
                    ChatAgentModel.organization_id == organization_id,
                )
            )
            agent = result.scalars().first()
            if agent is None:
                return None
            for key, value in fields.items():
                if hasattr(agent, key):
                    setattr(agent, key, value)
            await session.commit()
            await session.refresh(agent)
            return agent

    async def delete_chat_agent(self, agent_id: int, organization_id: int) -> bool:
        async with self.async_session() as session:
            result = await session.execute(
                select(ChatAgentModel).where(
                    ChatAgentModel.id == agent_id,
                    ChatAgentModel.organization_id == organization_id,
                )
            )
            agent = result.scalars().first()
            if agent is None:
                return False
            await session.delete(agent)
            await session.commit()
            return True
