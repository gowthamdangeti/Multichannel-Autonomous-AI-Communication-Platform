from sqlalchemy import Column, String, Boolean, ForeignKey, JSON, Integer
from sqlalchemy.orm import relationship
from app.models.base import BaseModel

class WorkflowModel(BaseModel):
    __tablename__ = "workflows"

    org_id = Column(String, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False)
    name = Column(String(255), nullable=False)
    description = Column(String(1000), nullable=True)
    status = Column(String(50), default="pending")  # pending, running, completed, failed, paused
    version = Column(Integer, default=1)
    graph = Column(JSON, default=dict)  # nodes, edges, state schema
    checkpoints = Column(JSON, default=list)
    execution_context = Column(JSON, default=dict)

    organization = relationship("Organization", back_populates="workflows")
    tasks = relationship("TaskModel", back_populates="workflow", cascade="all, delete-orphan")
