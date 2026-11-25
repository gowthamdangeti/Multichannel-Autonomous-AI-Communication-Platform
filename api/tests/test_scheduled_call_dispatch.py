from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from api.db.scheduled_call_client import _calculate_retry_delay_seconds
from api.tasks.scheduled_calls import dispatch_due_scheduled_calls


def test_retry_delay_supports_linear_and_exponential_strategies():
    assert _calculate_retry_delay_seconds("linear", 3600, 1) == 3600
    assert _calculate_retry_delay_seconds("linear", 3600, 3) == 3600
    assert _calculate_retry_delay_seconds("exponential", 3600, 1) == 7200
    assert _calculate_retry_delay_seconds("exponential", 3600, 2) == 14400


async def test_dispatch_due_scheduled_call_marks_created_run_dispatched():
    scheduled_call = SimpleNamespace(
        id=81,
        trigger_path="follow-up",
        organization_id=11,
        phone_number="+15551234567",
        initial_context={"customer_id": 42},
        telephony_configuration_id=7,
    )
    target = SimpleNamespace()

    with (
        patch("api.tasks.scheduled_calls.db_client") as mock_db,
        patch(
            "api.routes.public_agent._resolve_trigger_target",
            new=AsyncMock(return_value=target),
        ) as resolve_mock,
        patch(
            "api.routes.public_agent._execute_resolved_target",
            new=AsyncMock(return_value=SimpleNamespace(workflow_run_id=501)),
        ) as execute_mock,
    ):
        mock_db.claim_due_scheduled_calls = AsyncMock(return_value=[scheduled_call])
        mock_db.mark_scheduled_call_dispatched = AsyncMock()

        await dispatch_due_scheduled_calls({})

    resolve_mock.assert_awaited_once_with("follow-up", 11, use_draft=False)
    request = execute_mock.await_args.args[1]
    assert request.phone_number == "+15551234567"
    assert request.initial_context == {"customer_id": 42}
    mock_db.mark_scheduled_call_dispatched.assert_awaited_once_with(81, 501)


async def test_dispatch_failure_is_recorded_for_retry():
    scheduled_call = SimpleNamespace(
        id=82,
        trigger_path="follow-up",
        organization_id=11,
        phone_number="+15551234567",
        initial_context={},
        telephony_configuration_id=None,
    )

    with (
        patch("api.tasks.scheduled_calls.db_client") as mock_db,
        patch(
            "api.routes.public_agent._resolve_trigger_target",
            new=AsyncMock(side_effect=RuntimeError("provider unavailable")),
        ),
    ):
        mock_db.claim_due_scheduled_calls = AsyncMock(return_value=[scheduled_call])
        mock_db.mark_scheduled_call_failed = AsyncMock()

        await dispatch_due_scheduled_calls({})

    mock_db.mark_scheduled_call_failed.assert_awaited_once_with(
        82, "provider unavailable"
    )
