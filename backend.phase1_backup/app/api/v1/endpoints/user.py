from typing import Optional, List
from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

router = APIRouter()

class OnboardingState(BaseModel):
    completed_at: Optional[str] = None
    skipped: bool = False
    seen_tooltips: List[str] = Field(default_factory=list)
    completed_actions: List[str] = Field(default_factory=list)

class OnboardingStateUpdate(BaseModel):
    completed_at: Optional[str] = None
    skipped: Optional[bool] = None
    seen_tooltips: Optional[List[str]] = None
    completed_actions: Optional[List[str]] = None

# In-memory/persisted store for current user onboarding state
_current_onboarding_state: OnboardingState = OnboardingState(
    completed_at="2026-11-25T00:00:00Z",
    skipped=False,
    seen_tooltips=[],
    completed_actions=[]
)

@router.get("/onboarding-state", response_model=OnboardingState)
async def get_user_onboarding_state():
    return _current_onboarding_state

@router.put("/onboarding-state", response_model=OnboardingState)
async def update_user_onboarding_state(update: OnboardingStateUpdate):
    global _current_onboarding_state
    if update.completed_at is not None:
        _current_onboarding_state.completed_at = update.completed_at
    if update.skipped is not None:
        _current_onboarding_state.skipped = update.skipped
    if update.seen_tooltips:
        existing = set(_current_onboarding_state.seen_tooltips)
        for t in update.seen_tooltips:
            existing.add(t)
        _current_onboarding_state.seen_tooltips = list(existing)
    if update.completed_actions:
        existing = set(_current_onboarding_state.completed_actions)
        for a in update.completed_actions:
            existing.add(a)
        _current_onboarding_state.completed_actions = list(existing)
    return _current_onboarding_state
