from sqlalchemy import Column, String, Boolean, ForeignKey, JSON
from sqlalchemy.orm import relationship
from app.models.base import BaseModel

class Organization(BaseModel):
    __tablename__ = "organizations"

    name = Column(String(255), nullable=False, unique=True)
    slug = Column(String(100), nullable=False, unique=True, index=True)
    description = Column(String(500), nullable=True)
    is_active = Column(Boolean, default=True)
    settings = Column(JSON, default=dict)

    users = relationship("User", back_populates="organization", cascade="all, delete-orphan")
    teams = relationship("Team", back_populates="organization", cascade="all, delete-orphan")
    agents = relationship("AgentModel", back_populates="organization", cascade="all, delete-orphan")
    workflows = relationship("WorkflowModel", back_populates="organization", cascade="all, delete-orphan")

class Team(BaseModel):
    __tablename__ = "teams"

    org_id = Column(String, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False)
    name = Column(String(255), nullable=False)
    description = Column(String(500), nullable=True)
    department = Column(String(100), nullable=False)  # e.g., 'Research', 'Engineering'

    organization = relationship("Organization", back_populates="teams")
