from sqlalchemy import Column, String, Boolean, ForeignKey, JSON, Float
from sqlalchemy.orm import relationship
from app.models.base import BaseModel

class AgentModel(BaseModel):
    __tablename__ = "agents"

    org_id = Column(String, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False)
    name = Column(String(255), nullable=False)
    slug = Column(String(100), nullable=False, index=True)
    department = Column(String(100), nullable=False)  # e.g. 'Software Engineering', 'Research'
    role = Column(String(255), nullable=False)
    description = Column(String(1000), nullable=True)
    system_prompt = Column(String, nullable=False)
    model_provider = Column(String(100), default="openai")  # openai, gemini, anthropic, groq
    model_name = Column(String(100), default="gpt-4o")
    status = Column(String(50), default="idle")  # idle, busy, paused, error
    autonomy_level = Column(String(50), default="semi-autonomous") # supervised, semi-autonomous, autonomous
    capabilities = Column(JSON, default=list)
    tools = Column(JSON, default=list)
    temperature = Column(Float, default=0.2)
    max_tokens = Column(Float, default=4096)
    is_active = Column(Boolean, default=True)

    # Metrics
    success_rate = Column(Float, default=100.0)
    total_tasks_completed = Column(Float, default=0.0)
    average_duration_ms = Column(Float, default=0.0)

    organization = relationship("Organization", back_populates="agents")
    tasks = relationship("TaskModel", back_populates="assigned_agent")
