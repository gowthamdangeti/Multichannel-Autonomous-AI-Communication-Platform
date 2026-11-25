import logging
from typing import Dict, Any, List, Optional
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from app.models.memory import MemoryItem

logger = logging.getLogger(__name__)

class MemoryManager:
    """
    Enterprise 4-Tier Memory Subsystem:
    - Working Memory: In-flight graph state
    - Episodic Memory: Executed task & workflow records
    - Semantic Memory: Vector-embedded institutional knowledge
    - Procedural Memory: Reusable execution graph playbooks
    """

    async def store_semantic(
        self,
        db: AsyncSession,
        org_id: str,
        key: str,
        content: str,
        metadata: Optional[Dict[str, Any]] = None,
        embedding: Optional[List[float]] = None,
        agent_id: Optional[str] = None
    ) -> MemoryItem:
        """Persist knowledge entry into semantic memory."""
        item = MemoryItem(
            org_id=org_id,
            agent_id=agent_id,
            memory_type="semantic",
            key=key,
            content=content,
            metadata_json=metadata or {},
            embedding=embedding
        )
        db.add(item)
        await db.commit()
        await db.refresh(item)
        logger.info(f"Stored semantic memory item [{key}] for org [{org_id}].")
        return item

    async def search_semantic(
        self,
        db: AsyncSession,
        org_id: str,
        query: str,
        limit: int = 5
    ) -> List[Dict[str, Any]]:
        """Retrieve relevant knowledge from semantic memory."""
        # Query semantic memory items for the org
        stmt = (
            select(MemoryItem)
            .where(MemoryItem.org_id == org_id, MemoryItem.memory_type == "semantic")
            .limit(limit)
        )
        result = await db.execute(stmt)
        items = result.scalars().all()
        return [
            {
                "id": it.id,
                "key": it.key,
                "content": it.content,
                "metadata": it.metadata_json,
                "created_at": it.created_at.isoformat() if it.created_at else None
            }
            for it in items
        ]

    async def store_procedural(
        self,
        db: AsyncSession,
        org_id: str,
        workflow_name: str,
        procedure_steps: List[Dict[str, Any]],
        description: str = ""
    ) -> MemoryItem:
        """Persist a proven workflow playbook into procedural memory."""
        item = MemoryItem(
            org_id=org_id,
            memory_type="procedural",
            key=workflow_name,
            content=description or f"Procedural playbook for {workflow_name}",
            metadata_json={"steps": procedure_steps}
        )
        db.add(item)
        await db.commit()
        logger.info(f"Stored procedural memory playbook [{workflow_name}].")
        return item

    async def get_procedural(
        self,
        db: AsyncSession,
        org_id: str,
        workflow_name: str
    ) -> Optional[Dict[str, Any]]:
        stmt = (
            select(MemoryItem)
            .where(
                MemoryItem.org_id == org_id,
                MemoryItem.memory_type == "procedural",
                MemoryItem.key == workflow_name
            )
            .order_by(MemoryItem.created_at.desc())
        )
        res = await db.execute(stmt)
        item = res.scalars().first()
        if item:
            return {"name": item.key, "description": item.content, "steps": item.metadata_json.get("steps", [])}
        return None

memory_manager = MemoryManager()
