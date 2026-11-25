"""Database access for WhatsApp numbers (OpenWA sessions).

Each row is one WhatsApp number an organization has connected through the
OpenWA gateway. All lookups are org-scoped for tenant isolation.
"""

from typing import Any, List, Optional

from sqlalchemy.future import select

from api.db.base_client import BaseDBClient
from api.db.models import WhatsAppNumberModel


class WhatsAppNumberClient(BaseDBClient):
    async def list_whatsapp_numbers(
        self, organization_id: int
    ) -> List[WhatsAppNumberModel]:
        async with self.async_session() as session:
            result = await session.execute(
                select(WhatsAppNumberModel)
                .where(WhatsAppNumberModel.organization_id == organization_id)
                .order_by(WhatsAppNumberModel.created_at.desc())
            )
            return list(result.scalars().all())

    async def get_whatsapp_number(
        self, number_id: int, organization_id: int
    ) -> Optional[WhatsAppNumberModel]:
        """Org-scoped lookup — never trust a bare id from the request."""
        async with self.async_session() as session:
            result = await session.execute(
                select(WhatsAppNumberModel).where(
                    WhatsAppNumberModel.id == number_id,
                    WhatsAppNumberModel.organization_id == organization_id,
                )
            )
            return result.scalars().first()

    async def get_whatsapp_number_by_session(
        self, openwa_session_name: str
    ) -> Optional[WhatsAppNumberModel]:
        """Reverse lookup used when routing inbound webhooks to an org."""
        async with self.async_session() as session:
            result = await session.execute(
                select(WhatsAppNumberModel).where(
                    WhatsAppNumberModel.openwa_session_name == openwa_session_name
                )
            )
            return result.scalars().first()

    async def create_whatsapp_number(
        self,
        organization_id: int,
        name: str,
        openwa_session_name: str,
        openwa_session_id: Optional[str] = None,
        status: str = "created",
        extra_metadata: Optional[dict] = None,
    ) -> WhatsAppNumberModel:
        async with self.async_session() as session:
            number = WhatsAppNumberModel(
                organization_id=organization_id,
                name=name,
                openwa_session_name=openwa_session_name,
                openwa_session_id=openwa_session_id,
                status=status,
                extra_metadata=extra_metadata or {},
            )
            session.add(number)
            await session.commit()
            await session.refresh(number)
            return number

    async def update_whatsapp_number(
        self, number_id: int, organization_id: int, **fields: Any
    ) -> Optional[WhatsAppNumberModel]:
        async with self.async_session() as session:
            result = await session.execute(
                select(WhatsAppNumberModel).where(
                    WhatsAppNumberModel.id == number_id,
                    WhatsAppNumberModel.organization_id == organization_id,
                )
            )
            number = result.scalars().first()
            if number is None:
                return None
            for key, value in fields.items():
                if value is not None and hasattr(number, key):
                    setattr(number, key, value)
            await session.commit()
            await session.refresh(number)
            return number

    async def delete_whatsapp_number(
        self, number_id: int, organization_id: int
    ) -> bool:
        async with self.async_session() as session:
            result = await session.execute(
                select(WhatsAppNumberModel).where(
                    WhatsAppNumberModel.id == number_id,
                    WhatsAppNumberModel.organization_id == organization_id,
                )
            )
            number = result.scalars().first()
            if number is None:
                return False
            await session.delete(number)
            await session.commit()
            return True
