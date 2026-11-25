from fastapi import APIRouter
from app.api.v1.endpoints import health, auth, agents, workflows, tasks, models, monitoring, hitl, user

api_router = APIRouter()

api_router.include_router(health.router, tags=["Health"])
api_router.include_router(auth.router, prefix="/auth", tags=["Authentication"])
api_router.include_router(user.router, prefix="/user", tags=["User & Onboarding"])
api_router.include_router(agents.router, prefix="/agents", tags=["Agent Registry & Runtime"])
api_router.include_router(workflows.router, prefix="/workflows", tags=["Workflows & Orchestration"])
api_router.include_router(tasks.router, prefix="/tasks", tags=["Task Management"])
api_router.include_router(models.router, prefix="/models", tags=["Model Providers"])
api_router.include_router(monitoring.router, prefix="/monitoring", tags=["Monitoring & Analytics"])
api_router.include_router(hitl.router, prefix="/hitl", tags=["Human-in-the-Loop (HITL)"])
