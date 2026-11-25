from typing import Dict, Any
from pydantic import BaseModel, Field
from datetime import datetime

class HealthCheckResponse(BaseModel):
    status: str = Field(default="healthy", description="Overall health status")
    environment: str = Field(..., description="Running environment")
    version: str = Field(default="1.0.0", description="Application version")
    timestamp: datetime = Field(default_factory=datetime.utcnow)
    services: Dict[str, str] = Field(default_factory=dict, description="Status of dependent services")
    details: Dict[str, Any] = Field(default_factory=dict, description="System metadata")
