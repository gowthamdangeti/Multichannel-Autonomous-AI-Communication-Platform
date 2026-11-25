import pytest
from unittest.mock import MagicMock, AsyncMock, patch

from api.services.billing.service import billing_service


@pytest.mark.asyncio
async def test_confirm_razorpay_payment_credited():
    mock_rz = MagicMock()
    mock_rz.payment.fetch.return_value = {
        "id": "pay_test123",
        "status": "captured",
        "order_id": "order_test123",
        "amount": 250,
        "currency": "INR",
        "notes": {"purpose": "topup", "minutes": "50"},
    }
    mock_rz.utility.verify_payment_signature.return_value = True

    mock_session = AsyncMock()
    mock_result = MagicMock()
    mock_result.scalar_one_or_none.return_value = None
    mock_session.execute.return_value = mock_result

    class AsyncSessionCtx:
        async def __aenter__(self):
            return mock_session
        async def __aexit__(self, *args):
            pass

    with patch("api.services.billing.service._razorpay_client", return_value=mock_rz), \
         patch.object(billing_service, "async_session", return_value=AsyncSessionCtx()), \
         patch.object(billing_service, "_complete_payment") as mock_complete:
        mock_complete.return_value = None

        res = await billing_service.confirm_razorpay_payment(
            org_id=1,
            razorpay_payment_id="pay_test123",
            razorpay_order_id="order_test123",
            razorpay_signature="sig_test123",
        )

        assert res["status"] == "credited"
        assert res["minutes"] == 50
        assert res["currency"] == "INR"
        mock_complete.assert_called_once_with(
            "order_test123", "razorpay", 1, 2.5, "INR", "topup", 50
        )
