from sqlalchemy import Column, String, ForeignKey, JSON, Integer, Float, DateTime
from sqlalchemy.orm import relationship
from app.models.base import BaseModel

class TaskModel(BaseModel):
    __tablename__ = "tasks"

    workflow_id = Column(String, ForeignKey("workflows.id", ondelete="CASCADE"), nullable=True)
    parent_task_id = Column(String, ForeignKey("tasks.id", ondelete="SET NULL"), nullable=True)
    agent_id = Column(String, ForeignKey("agents.id", ondelete="SET NULL"), nullable=True)

    title = Column(String(255), nullable=False)
    objective = Column(String, nullable=False)
    status = Column(String(50), default="pending")  # pending, in_progress, completed, failed, waiting_approval
    priority = Column(String(50), default="medium") # low, medium, high, critical
    
    input_data = Column(JSON, default=dict)
    output_data = Column(JSON, default=dict)
    constraints = Column(JSON, default=list)
    success_criteria = Column(JSON, default=list)
    permissions = Column(JSON, default=list)
    execution_metadata = Column(JSON, default=dict)
    
    retry_count = Column(Integer, default=0)
    max_retries = Column(Integer, default=3)
    confidence = Column(Float, default=1.0)
    error_message = Column(String, nullable=True)

    workflow = relationship("WorkflowModel", back_populates="tasks")
    assigned_agent = relationship("AgentModel", back_populates="tasks")
