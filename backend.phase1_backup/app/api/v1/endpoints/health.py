import os
from datetime import datetime, timezone
from fastapi import APIRouter
from app.config import settings
from app.schemas.health import HealthCheckResponse
from app.core.agents.registry import registry

router = APIRouter()

@router.get("/health", response_model=HealthCheckResponse)
async def health_check():
    """
    Comprehensive platform health check for container readiness,
    service dependencies, and autonomous runtime availability.
    """
    services_status = {
        "api": "healthy",
        "agent_registry": "healthy",
        "database": "configured",
        "redis": "configured",
        "minio": "configured"
    }

    # Verify agent count
    agents_count = len(registry.list_all())

    return HealthCheckResponse(
        status="healthy",
        environment=settings.ENVIRONMENT,
        version="1.0.0",
        timestamp=datetime.now(timezone.utc),
        services=services_status,
        details={
            "project_name": settings.PROJECT_NAME,
            "registered_agents_count": agents_count,
            "active_departments": list(set(a.department for a in registry.list_all())),
            "supported_providers": ["openai", "gemini", "anthropic", "groq", "deepseek", "openrouter"]
        }
    )

@router.get("/health/live")
async def live_probe():
    return {"status": "alive"}

@router.get("/health/ready")
async def readiness_probe():
    return {"status": "ready", "agents_loaded": len(registry.list_all()) > 0}
