"""Finding a call from a provider's request ID."""

from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from api.services.provider_usage import lookup
from api.services.provider_usage.exceptions import ProviderRequestNotFoundError
from api.services.provider_usage.lookup import get_provider_request
from api.services.provider_usage.summary import (
    to_provider_request,
    to_provider_usage_summary,
)
from api.services.provider_usage.types import RunUsageContext
from api.services.workflow.usage_contract import UsageSource, UsageStatus

REQUEST_ID = "2a301285-b37b-4043-b78b-5998fc69c92d"


def _event(status=UsageStatus.RECORDED.value):
    return SimpleNamespace(
        operation_id=f"soniox:{REQUEST_ID}",
        provider="soniox",
        service_type="stt",
        model="stt-rt-v5",
        input_tokens=1229,
        output_tokens=109,
        input_units=Decimal("145.898"),
        output_units=Decimal(0),
        provider_cost_usd=Decimal("0.0029100000"),
        usage_source=UsageSource.PROVIDER_BILLED.value,
        status=status,
        usage_detail={
            "uuid": REQUEST_ID,
            "start_time": "2026-11-05T12:49:58.490Z",
            "end_time": "2026-11-05T12:52:18.933Z",
        },
    )


async def _lookup(found, organization_id=2):
    db = MagicMock()
    db.find_provider_request_event = AsyncMock(return_value=found)
    with patch.object(lookup, "db_client", db):
        result = await get_provider_request(
            request_id=REQUEST_ID, organization_id=organization_id
        )
    return result, db


def test_request_keeps_the_provider_values_exactly():
    request = to_provider_request(_event())

    assert request.request_id == REQUEST_ID
    assert request.cost_usd == "0.0029100000"
    assert request.input_seconds == 145.898
    assert request.started_at == "2026-11-05T12:49:58.490Z"


def test_request_id_containing_a_colon_stays_whole():
    event = _event()
    event.operation_id = "soniox:part:two"

    assert to_provider_request(event).request_id == "part:two"


@pytest.mark.asyncio
async def test_lookup_returns_the_run_to_open():
    run = SimpleNamespace(id=240, workflow_id=23, name="WR-5813")

    result, _ = await _lookup((_event(), run))

    assert (result.workflow_id, result.run_id, result.run_name) == (23, 240, "WR-5813")
    assert result.request.request_id == REQUEST_ID


@pytest.mark.asyncio
async def test_lookup_searches_each_provider_inside_the_callers_organization():
    run = SimpleNamespace(id=240, workflow_id=23, name="WR-5813")

    _, db = await _lookup((_event(), run), organization_id=7)

    search = db.find_provider_request_event.await_args.kwargs
    assert search["organization_id"] == 7
    assert search["operation_ids"] == [f"soniox:{REQUEST_ID}"]


@pytest.mark.asyncio
async def test_request_from_another_organization_looks_like_not_found():
    with pytest.raises(ProviderRequestNotFoundError):
        await _lookup(None)


def test_summary_lists_every_billed_request():
    context = RunUsageContext("convozent-local-run-240", "soniox", "soniox")

    summary = to_provider_usage_summary(rows=[_event()], context=context)

    assert [request.request_id for request in summary.requests] == [REQUEST_ID]


def test_summary_leaves_out_the_unavailable_marker():
    context = RunUsageContext("convozent-local-run-240", "soniox", "soniox")
    marker = _event(status=UsageStatus.UNAVAILABLE.value)
    marker.operation_id = "soniox:unavailable"

    summary = to_provider_usage_summary(rows=[marker], context=context)

    assert summary.requests == []


def test_summary_carries_the_runs_client_reference_id():
    context = RunUsageContext("convozent-local-run-240", "soniox", "soniox")

    summary = to_provider_usage_summary(rows=[_event()], context=context)

    assert summary.client_reference_id == "convozent-local-run-240"


def test_old_run_without_a_tag_has_no_client_reference_id():
    context = RunUsageContext(None, "soniox", "soniox")

    summary = to_provider_usage_summary(rows=[], context=context)

    assert summary.client_reference_id is None
