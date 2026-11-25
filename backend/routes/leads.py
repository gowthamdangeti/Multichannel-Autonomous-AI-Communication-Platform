"""In-house lead capture (data-residency safe).

Public endpoints (no auth — identity is the email in the body, same as the
legacy external onboarding service):
  POST /leads/enterprise   strategy-call form
  POST /leads/onboarding   post-signup Welcome popup answers

Authenticated, org-scoped:
  GET  /leads/my-profile   current org's onboarding answers

Admin reads live in routes/admin.py (superuser-only).
"""

from __future__ import annotations

import time
from collections import defaultdict, deque

from fastapi import APIRouter, Depends, HTTPException, Request
from loguru import logger

from api.db import db_client
from api.db.models import UserModel
from api.schemas.leads import (
    EnterpriseLeadCreate,
    EnterpriseLeadResponse,
    OnboardingProfileCreate,
    OnboardingProfileResponse,
)
from api.services.auth.depends import get_user, get_user_with_selected_organization
from api.services.leads.service import save_onboarding_profile, submit_enterprise_lead

router = APIRouter(prefix="/leads", tags=["leads"])

# ── Tiny in-memory rate limiter for public writes (per-IP, 20/min). ──
# Prevents form spam without adding Redis/infra. Resets on worker restart,
# which is fine — it is a spam brake, not a quota.
_hits: dict[str, deque[float]] = defaultdict(deque)
_RATE_LIMIT = 20
_WINDOW_S = 60.0


def _check_rate_limit(request: Request) -> None:
    ip = request.client.host if request.client else "unknown"
    now = time.monotonic()
    q = _hits[ip]
    while q and now - q[0] > _WINDOW_S:
        q.popleft()
    if len(q) >= _RATE_LIMIT:
        raise HTTPException(status_code=429, detail="Too many requests. Please try again later.")
    q.append(now)


@router.post("/enterprise", response_model=EnterpriseLeadResponse, status_code=201)
async def create_enterprise_lead(payload: EnterpriseLeadCreate, request: Request):
    _check_rate_limit(request)
    try:
        row = await submit_enterprise_lead(payload.model_dump(by_alias=True))
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    except Exception:
        logger.exception("Failed to store enterprise lead")
        raise HTTPException(status_code=500, detail="Failed to save. Please try again.")
    return EnterpriseLeadResponse.model_validate(row)


@router.post("/onboarding", response_model=OnboardingProfileResponse, status_code=201)
async def create_onboarding_profile(
    payload: OnboardingProfileCreate,
    request: Request,
):
    # NOTE: onboarding runs right after signup while the auth interceptor may
    # not be ready yet in the UI, so accept both: Bearer token when present,
    # otherwise resolve the org via the email in the body.
    _check_rate_limit(request)
    organization_id: int | None = None
    user_id: int | None = None
    auth_header = request.headers.get("authorization")
    if auth_header:
        try:
            user = await get_user(auth_header, request.headers.get("x-api-key"))
            organization_id = user.selected_organization_id
            user_id = user.id
        except HTTPException:
            user = None
    if organization_id is None:
        if not payload.email:
            raise HTTPException(status_code=400, detail="No organization selected and no email provided")
        db_user = await db_client.get_user_by_email(payload.email)
        if not db_user or not db_user.selected_organization_id:
            raise HTTPException(
                status_code=404,
                detail="Signup account not found yet. Please sign in and retry.",
            )
        organization_id = db_user.selected_organization_id
        user_id = db_user.id
    try:
        row = await save_onboarding_profile(
            organization_id=organization_id,
            user_id=user_id,
            data=payload.model_dump(by_alias=True),
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    except Exception:
        logger.exception("Failed to store onboarding profile")
        raise HTTPException(status_code=500, detail="Failed to save. Please try again.")
    return OnboardingProfileResponse.model_validate(row)


@router.get("/my-profile", response_model=OnboardingProfileResponse | None)
async def get_my_onboarding_profile(
    user: UserModel = Depends(get_user_with_selected_organization),
):
    assert user.selected_organization_id is not None
    row = await db_client.get_onboarding_profile_by_org(user.selected_organization_id)
    return OnboardingProfileResponse.model_validate(row) if row else None
