from sqlalchemy import Column, String, ForeignKey, JSON
from pgvector.sqlalchemy import Vector
from app.models.base import BaseModel

class MemoryItem(BaseModel):
    __tablename__ = "memory_items"

    org_id = Column(String, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False)
    agent_id = Column(String, ForeignKey("agents.id", ondelete="SET NULL"), nullable=True)
    memory_type = Column(String(50), nullable=False)  # working, episodic, semantic, procedural
    key = Column(String(255), nullable=False, index=True)
    content = Column(String, nullable=False)
    metadata_json = Column(JSON, default=dict)
    embedding = Column(Vector(1536), nullable=True)
