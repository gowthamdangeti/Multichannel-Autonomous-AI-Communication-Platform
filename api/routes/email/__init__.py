"""Email Automation & Inbox Zero FastAPI Router."""

from fastapi import APIRouter

from api.routes.email.accounts import router as accounts_router
from api.routes.email.agents import router as agents_router
from api.routes.email.analytics import router as analytics_router
from api.routes.email.attachments import router as attachments_router
from api.routes.email.followups import router as followups_router
from api.routes.email.messages import router as messages_router
from api.routes.email.rules import router as rules_router

router = APIRouter(prefix="/email")

router.include_router(accounts_router)
router.include_router(agents_router)
router.include_router(messages_router)
router.include_router(followups_router)
router.include_router(rules_router)
router.include_router(attachments_router)
router.include_router(analytics_router)

__all__ = ["router"]

