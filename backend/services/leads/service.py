"""Domain logic for in-house enterprise leads + org onboarding profiles.

Routes stay thin: they validate auth/org scope, then delegate here.
DB access goes through db_client (LeadClient).
"""

from __future__ import annotations

from api.db import db_client

ALLOWED_VOLUMES = {"0-5k", "5k-100k", "100k+", "not-sure", "exploring"}
ALLOWED_DEPLOYMENT = {"yes", "no", "maybe", "not_sure"}
ALLOWED_ORIGIN = {"cloud_app", "oss_app"}
ALLOWED_STATUS = {"new", "contacted", "qualified", "closed"}


def _normalize_lead(data: dict) -> dict:
    out = dict(data)
    if out.get("work_email"):
        out["work_email"] = out["work_email"].lower().strip()
    if out.get("volume") not in ALLOWED_VOLUMES:
        out["volume"] = "not-sure"
    if out.get("deployment") not in ALLOWED_DEPLOYMENT:
        out["deployment"] = "yes"
    if out.get("origin") not in ALLOWED_ORIGIN:
        out["origin"] = "oss_app"
    return out


async def submit_enterprise_lead(data: dict):
    """Persist a public strategy-call submission. No auth by design."""
    # Accept camelCase from the UI payload first (schemas dump by_alias=True).
    if not data.get("job_title") and data.get("jobTitle"):
        data["job_title"] = data["jobTitle"]
    if not data.get("work_email") and data.get("workEmail"):
        data["work_email"] = data["workEmail"]
    if not data.get("agent_goal") and data.get("agentGoal"):
        data["agent_goal"] = data["agentGoal"]
    cleaned = _normalize_lead(data)
    for field in ("name", "company", "job_title", "work_email", "phone"):
        if not str(cleaned.get(field) or "").strip():
            raise ValueError(f"{field} is required")
    return await db_client.create_enterprise_lead(cleaned)


async def list_leads(page: int = 1, limit: int = 50, status: str | None = None, search: str | None = None):
    if status is not None and status not in ALLOWED_STATUS:
        raise ValueError("invalid status")
    return await db_client.list_enterprise_leads(page=page, limit=limit, status=status, search=search)


async def set_lead_status(lead_id: int, status: str, contacted_by: int | None = None):
    if status not in ALLOWED_STATUS:
        raise ValueError("invalid status")
    return await db_client.update_enterprise_lead_status(lead_id, status, contacted_by)


async def save_onboarding_profile(*, organization_id: int, user_id: int | None, data: dict):
    if not organization_id:
        raise ValueError("organization_id is required")
    return await db_client.upsert_onboarding_profile(
        organization_id=organization_id, user_id=user_id, data=data
    )


async def get_org_onboarding_profile(organization_id: int):
    return await db_client.get_onboarding_profile_by_org(organization_id)
