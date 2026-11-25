"""Billing metering — pure functions, no DB / no I/O.

Converts raw usage (seconds) into billable money using a plan rate.
Kept separate so pricing changes never touch the ledger or gateways.
"""
from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal, ROUND_UP


@dataclass(frozen=True)
class UsageCharge:
    duration_sec: float
    minutes_billed: Decimal
    rate: Decimal
    currency: str
    amount: Decimal
    description: str


def quantize_minutes(duration_sec: float) -> Decimal:
    """Fractional minutes rounded UP to 2 decimals (avoids penny dust)."""
    if duration_sec <= 0:
        return Decimal("0")
    minutes = Decimal(str(duration_sec)) / Decimal("60")
    # ROUND_UP so 61s -> 1.02 min, never under-bills
    return minutes.quantize(Decimal("0.01"), rounding=ROUND_UP)


def calc_usage_charge(
    *,
    duration_sec: float,
    rate: Decimal | str | float,
    currency: str,
    workflow_run_id: int,
) -> UsageCharge:
    rate_d = Decimal(str(rate))
    minutes_billed = quantize_minutes(float(duration_sec))
    amount = (minutes_billed * rate_d).quantize(Decimal("0.0001"))
    if amount <= 0 and rate_d > 0:
        # Floor so a sub-second billable call still records a visible tx
        amount = Decimal("0.0001")
    desc = (
        f"Usage: run {workflow_run_id} {float(duration_sec):.0f}s "
        f"({minutes_billed} min @ {rate_d}/{currency.upper()})"
    )
    return UsageCharge(
        duration_sec=float(duration_sec),
        minutes_billed=minutes_billed,
        rate=rate_d,
        currency=currency.upper(),
        amount=amount,
        description=desc,
    )


def subscription_credit_amount(*, included_minutes: int, rate_per_minute) -> Decimal:
    """Money value credited when a plan is activated."""
    return (Decimal(str(rate_per_minute)) * int(included_minutes)).quantize(
        Decimal("0.0001")
    )
