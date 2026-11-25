"""Gateway protocol — every payment provider implements this.

Adding a new gateway = new file implementing these 4 methods + register
in factory. Core ledger never imports stripe/razorpay SDKs directly.
"""
from __future__ import annotations

from typing import Any, Protocol


class PaymentGateway(Protocol):
    name: str

    async def create_topup(
        self, *, org_id: int, amount_minor: int, currency: str,
        minutes: int, success_url: str = "", cancel_url: str = "",
    ) -> dict[str, Any]: ...

    async def create_subscription(self, *, org_id: int, plan) -> dict[str, Any]: ...

    def verify_webhook(self, *, raw: bytes, signature: str | None) -> dict[str, Any]: ...

    async def fetch_payment(self, payment_id: str) -> dict[str, Any]: ...
