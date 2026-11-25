"""Pydantic schemas for in-house enterprise leads + org onboarding profiles."""

from datetime import datetime

from pydantic import BaseModel, EmailStr, Field


class EnterpriseLeadCreate(BaseModel):
    name: str = Field(min_length=1, max_length=256)
    company: str = Field(min_length=1, max_length=256)
    job_title: str = Field(min_length=1, max_length=256, alias="jobTitle")
    work_email: str = Field(min_length=3, max_length=320, alias="workEmail")
    phone: str = Field(min_length=1, max_length=64)
    volume: str = Field(default="not-sure", max_length=32)
    deployment: str = Field(default="yes", max_length=32)
    agent_goal: str | None = Field(default=None, alias="agentGoal")
    source: str = Field(default="landing_contact", max_length=64)
    origin: str = Field(default="oss_app", max_length=32)
    country: str | None = Field(default=None, max_length=128)

    class Config:
        populate_by_name = True


class EnterpriseLeadResponse(BaseModel):
    id: int
    created_at: datetime | None = None
    name: str
    company: str
    job_title: str
    work_email: str
    phone: str
    volume: str
    deployment: str
    agent_goal: str | None = None
    source: str
    origin: str
    country: str | None = None
    status: str

    class Config:
        from_attributes = True


class EnterpriseLeadStatusUpdate(BaseModel):
    status: str = Field(pattern="^(new|contacted|qualified|closed)$")


class OnboardingProfileCreate(BaseModel):
    # Submitted post-signup from the Welcome popup. Email ties the row when
    # the caller is unauthenticated; org/user are stamped server-side when auth is present.
    email: str | None = Field(default=None, max_length=320)
    persona: str | None = Field(default=None, max_length=64)
    onprem_need: str | None = Field(default=None, max_length=32, alias="onPremNeed")
    migrating_from: str | None = Field(default=None, max_length=64, alias="migratingFrom")
    migrating_other_provider: str | None = Field(
        default=None, max_length=256, alias="migratingOtherProvider"
    )
    switch_reason: str | None = Field(default=None, alias="switchReason")
    how_heard: str | None = Field(default=None, max_length=64, alias="howHeard")
    volume: str | None = Field(default=None, max_length=32)
    country: str | None = Field(default=None, max_length=128)
    origin: str = Field(default="oss_app", max_length=32)

    class Config:
        populate_by_name = True


class OnboardingProfileResponse(BaseModel):
    id: int
    organization_id: int | None = None
    user_id: int | None = None
    email: str | None = None
    persona: str | None = None
    onprem_need: str | None = None
    migrating_from: str | None = None
    migrating_other_provider: str | None = None
    switch_reason: str | None = None
    how_heard: str | None = None
    volume: str | None = None
    country: str | None = None
    origin: str
    created_at: datetime | None = None
    updated_at: datetime | None = None

    class Config:
        from_attributes = True
