from types import SimpleNamespace

import pytest

from api.services.workflow_run_billing import (
    report_completed_workflow_run_platform_usage,
    report_workflow_run_platform_usage,
)


@pytest.mark.asyncio
async def test_report_workflow_run_platform_usage_is_a_noop():
    # No MPS backend exists anymore; this must never raise or make any call.
    await report_workflow_run_platform_usage(
        SimpleNamespace(id=123, is_completed=True)
    )


@pytest.mark.asyncio
async def test_report_completed_workflow_run_platform_usage_is_a_noop():
    await report_completed_workflow_run_platform_usage(123)
