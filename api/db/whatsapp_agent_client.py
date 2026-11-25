"""Database access for WhatsApp agents (org-scoped)."""

from typing import Any, List, Optional

from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.future import select
from sqlalchemy.orm import selectinload

from api.db.base_client import BaseDBClient
from api.db.models import (
    WhatsAppAgentModel,
    WhatsAppConversationModel,
    WhatsAppNumberModel,
)


class WhatsAppAgentNameConflictError(Exception):
    """Raised when a WhatsApp agent name already exists within the organization."""


class WhatsAppAgentAssociationValidationError(ValueError):
    """Raised when requested tools or documents are not accessible to the org."""


class WhatsAppAgentClient(BaseDBClient):
    async def list_whatsapp_agents(
        self, organization_id: int
    ) -> List[WhatsAppAgentModel]:
        async with self.async_session() as session:
            result = await session.execute(
                select(WhatsAppAgentModel)
                .options(
                    selectinload(WhatsAppAgentModel.tools),
                    selectinload(WhatsAppAgentModel.documents),
                )
                .where(WhatsAppAgentModel.organization_id == organization_id)
                .order_by(WhatsAppAgentModel.created_at.desc())
            )
            return list(result.scalars().all())

    async def get_whatsapp_agent(
        self, agent_id: int, organization_id: int
    ) -> Optional[WhatsAppAgentModel]:
        async with self.async_session() as session:
            result = await session.execute(
                select(WhatsAppAgentModel)
                .options(
                    selectinload(WhatsAppAgentModel.tools),
                    selectinload(WhatsAppAgentModel.documents),
                )
                .where(
                    WhatsAppAgentModel.id == agent_id,
                    WhatsAppAgentModel.organization_id == organization_id,
                )
            )
            return result.scalars().first()

    async def create_whatsapp_agent(
        self,
        organization_id: int,
        name: str,
        system_prompt: str = "",
        description: Optional[str] = None,
        character: Optional[str] = None,
        greeting: Optional[str] = None,
        guardrails: Optional[str] = None,
        model_config_ref: Optional[dict] = None,
        active_contacts: Optional[list] = None,
        deactive_contacts: Optional[list] = None,
        tool_ids: Optional[List[int]] = None,
        document_ids: Optional[List[int]] = None,
        image_settings: Optional[dict] = None,
        document_settings: Optional[dict] = None,
        audio_settings: Optional[dict] = None,
    ) -> WhatsAppAgentModel:
        from api.db.models import ToolModel, KnowledgeBaseDocumentModel

        async with self.async_session() as session:
            agent = WhatsAppAgentModel(
                organization_id=organization_id,
                name=name,
                description=description,
                character=character,
                system_prompt=system_prompt or "",
                greeting=greeting,
                guardrails=guardrails,
                model_config_ref=model_config_ref or {},
                active_contacts=active_contacts or [],
                deactive_contacts=deactive_contacts or [],
                image_settings=image_settings or {},
                document_settings=document_settings or {},
                audio_settings=audio_settings or {},
            )
            session.add(agent)
            await session.flush()
            agent_id = agent.id

            # Associate tools if provided
            if tool_ids:
                result = await session.execute(
                    select(ToolModel).where(
                        ToolModel.id.in_(tool_ids),
                        ToolModel.organization_id == organization_id,
                    )
                )
                tools = list(result.scalars().all())
                if len(tools) != len(set(tool_ids)):
                    raise WhatsAppAgentAssociationValidationError(
                        "One or more requested tools are invalid or inaccessible."
                    )
                agent.tools.extend(tools)

            # Associate documents if provided
            if document_ids:
                result = await session.execute(
                    select(KnowledgeBaseDocumentModel).where(
                        KnowledgeBaseDocumentModel.id.in_(document_ids),
                        KnowledgeBaseDocumentModel.organization_id == organization_id,
                    )
                )
                documents = list(result.scalars().all())
                if len(documents) != len(set(document_ids)):
                    raise WhatsAppAgentAssociationValidationError(
                        "One or more requested documents are invalid or inaccessible."
                    )
                agent.documents.extend(documents)

            try:
                await session.commit()
            except IntegrityError:
                await session.rollback()
                raise WhatsAppAgentNameConflictError(
                    f"An agent named '{name}' already exists."
                )
            result = await session.execute(
                select(WhatsAppAgentModel)
                .options(
                    selectinload(WhatsAppAgentModel.tools),
                    selectinload(WhatsAppAgentModel.documents),
                )
                .where(WhatsAppAgentModel.id == agent_id)
            )
            return result.scalars().one()

    async def update_whatsapp_agent(
        self, agent_id: int, organization_id: int, **fields: Any
    ) -> Optional[WhatsAppAgentModel]:
        from api.db.models import ToolModel, KnowledgeBaseDocumentModel

        async with self.async_session() as session:
            result = await session.execute(
                select(WhatsAppAgentModel)
                .options(
                    selectinload(WhatsAppAgentModel.tools),
                    selectinload(WhatsAppAgentModel.documents),
                )
                .where(
                    WhatsAppAgentModel.id == agent_id,
                    WhatsAppAgentModel.organization_id == organization_id,
                )
            )
            agent = result.scalars().first()
            if agent is None:
                return None
            agent_id = agent.id

            # Validate all replacement associations before clearing anything.
            # This keeps invalid PATCH requests atomic.
            tool_ids = fields.pop("tool_ids", None)
            validated_tools = None
            if tool_ids is not None:
                result = await session.execute(
                    select(ToolModel).where(
                        ToolModel.id.in_(tool_ids),
                        ToolModel.organization_id == organization_id,
                    )
                ) if tool_ids else None
                validated_tools = list(result.scalars().all()) if result else []
                if len(validated_tools) != len(set(tool_ids)):
                    raise WhatsAppAgentAssociationValidationError(
                        "One or more requested tools are invalid or inaccessible."
                    )

            document_ids = fields.pop("document_ids", None)
            validated_documents = None
            if document_ids is not None:
                result = await session.execute(
                    select(KnowledgeBaseDocumentModel).where(
                        KnowledgeBaseDocumentModel.id.in_(document_ids),
                        KnowledgeBaseDocumentModel.organization_id == organization_id,
                    )
                ) if document_ids else None
                validated_documents = (
                    list(result.scalars().all()) if result else []
                )
                if len(validated_documents) != len(set(document_ids)):
                    raise WhatsAppAgentAssociationValidationError(
                        "One or more requested documents are invalid or inaccessible."
                    )

            if validated_tools is not None:
                agent.tools.clear()
                agent.tools.extend(validated_tools)
            if validated_documents is not None:
                agent.documents.clear()
                agent.documents.extend(validated_documents)

            # Update other fields
            for key, value in fields.items():
                # Allow clearing nullable text fields explicitly; skip only when
                # the caller didn't provide the field at all (handled upstream).
                if hasattr(agent, key):
                    setattr(agent, key, value)
            try:
                await session.commit()
            except IntegrityError:
                await session.rollback()
                raise WhatsAppAgentNameConflictError(
                    f"An agent named '{fields.get('name')}' already exists."
                )
            result = await session.execute(
                select(WhatsAppAgentModel)
                .options(
                    selectinload(WhatsAppAgentModel.tools),
                    selectinload(WhatsAppAgentModel.documents),
                )
                .where(WhatsAppAgentModel.id == agent_id)
            )
            return result.scalars().one()

    async def delete_whatsapp_agent(
        self, agent_id: int, organization_id: int
    ) -> bool:
        async with self.async_session() as session:
            result = await session.execute(
                select(WhatsAppAgentModel).where(
                    WhatsAppAgentModel.id == agent_id,
                    WhatsAppAgentModel.organization_id == organization_id,
                )
            )
            agent = result.scalars().first()
            if agent is None:
                return False
            await session.delete(agent)
            await session.commit()
            return True

    async def get_whatsapp_agent_run_counts(
        self, agent_ids: List[int], organization_id: int
    ) -> dict[int, int]:
        """Get total conversation run counts for multiple WhatsApp agents in a single query.

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
                    WhatsAppNumberModel.assigned_agent_id,
                    func.count(WhatsAppConversationModel.id).label("run_count"),
                )
                .join(
                    WhatsAppConversationModel,
                    WhatsAppConversationModel.number_id == WhatsAppNumberModel.id,
                )
                .where(
                    WhatsAppNumberModel.organization_id == organization_id,
                    WhatsAppNumberModel.assigned_agent_id.in_(agent_ids),
                    WhatsAppConversationModel.organization_id == organization_id,
                )
                .group_by(WhatsAppNumberModel.assigned_agent_id)
            )
            rows = result.all()
            counts = {agent_id: 0 for agent_id in agent_ids}
            for agent_id, count in rows:
                if agent_id is not None:
                    counts[agent_id] = count
            return counts
