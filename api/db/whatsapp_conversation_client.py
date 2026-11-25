"""Database access for WhatsApp conversations (rolling transcripts)."""

from typing import List, Optional

from sqlalchemy.future import select

from api.db.base_client import BaseDBClient
from api.db.models import WhatsAppConversationModel

# Keep transcripts bounded so prompts stay small and cheap.
MAX_TRANSCRIPT_MESSAGES = 40


class WhatsAppConversationClient(BaseDBClient):
    async def list_whatsapp_conversations(
        self, organization_id: int
    ) -> List[WhatsAppConversationModel]:
        async with self.async_session() as session:
            result = await session.execute(
                select(WhatsAppConversationModel)
                .where(WhatsAppConversationModel.organization_id == organization_id)
                .order_by(WhatsAppConversationModel.updated_at.desc().nullslast())
            )
            return list(result.scalars().all())

    async def get_whatsapp_conversation(
        self, conversation_id: int, organization_id: int
    ) -> Optional[WhatsAppConversationModel]:
        async with self.async_session() as session:
            result = await session.execute(
                select(WhatsAppConversationModel).where(
                    WhatsAppConversationModel.id == conversation_id,
                    WhatsAppConversationModel.organization_id == organization_id,
                )
            )
            return result.scalars().first()

    async def get_conversation(
        self, number_id: int, contact: str
    ) -> Optional[WhatsAppConversationModel]:
        async with self.async_session() as session:
            result = await session.execute(
                select(WhatsAppConversationModel).where(
                    WhatsAppConversationModel.number_id == number_id,
                    WhatsAppConversationModel.contact == contact,
                )
            )
            return result.scalars().first()

    async def append_messages(
        self,
        organization_id: int,
        number_id: int,
        contact: str,
        new_messages: List[dict],
    ) -> WhatsAppConversationModel:
        """Append messages to a conversation (creating it if needed) and trim."""
        async with self.async_session() as session:
            result = await session.execute(
                select(WhatsAppConversationModel).where(
                    WhatsAppConversationModel.number_id == number_id,
                    WhatsAppConversationModel.contact == contact,
                )
            )
            convo = result.scalars().first()
            if convo is None:
                convo = WhatsAppConversationModel(
                    organization_id=organization_id,
                    number_id=number_id,
                    contact=contact,
                    messages=[],
                )
                session.add(convo)

            # Reassign a new list so SQLAlchemy detects the JSON mutation.
            history = list(convo.messages or [])
            history.extend(new_messages)
            convo.messages = history[-MAX_TRANSCRIPT_MESSAGES:]

            await session.commit()
            await session.refresh(convo)
            return convo
