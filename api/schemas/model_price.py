from __future__ import annotations

from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict


class ModelPriceLineSchema(BaseModel):
    component: str
    label: str
    display: str


class ModelPriceResponse(BaseModel):
    provider: str
    capability: str
    model: str | None = None
    status: str  # "priced" | "unavailable" | "self_hosted" | "hidden"
    lines: list[ModelPriceLineSchema]
    source: str | None = None
    source_url: str | None = None
    tier: str | None = None
    note: str | None = None
    verified_at: datetime | None = None


class PendingModelPriceResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    provider: str
    capability: str
    model_id: str
    component: str
    rate: Decimal
    unit_quantity: int
    currency: str
    source: str
    source_url: str | None = None
    review_status: str


class ModelPriceSyncQueuedResponse(BaseModel):
    job_id: str | None = None
