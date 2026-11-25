"""Tests for report-generation resilience: terminal-status guarantee,
stale-run sweep, per-function ARQ budget, and report artifact access.
"""

import asyncio
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

# ---------------------------------------------------------------------------
# Item 2: CancelledError must leave a terminal status
# ---------------------------------------------------------------------------


class TestGenerateRunReportCancellation:
    async def test_cancelled_error_marks_run_failed_and_reraises(self):
        from api.tasks.generate_run_report import generate_run_report

        run = SimpleNamespace(
            id=42,
            workflow=SimpleNamespace(
                id=7,
                # No {{variables}} -> skips the LLM path and reaches PDF render.
                workflow_configurations={"report_template": "<p>Report</p>"},
            ),
            gathered_context={},
            logs={},
        )

        async def _cancel(*_args, **_kwargs):
            raise asyncio.CancelledError

        with (
            patch(
                "api.tasks.generate_run_report.db_client.update_workflow_run",
                new=AsyncMock(),
            ) as update_run,
            patch(
                "api.tasks.generate_run_report.db_client.get_workflow_run_by_id",
                new=AsyncMock(return_value=run),
            ),
            patch(
                "api.tasks.generate_run_report.build_report_context",
                return_value={},
            ),
            patch(
                "api.tasks.generate_run_report.render_template_html",
                return_value="<p>Report</p>",
            ),
            patch(
                "api.tasks.generate_run_report.html_to_pdf",
                new=AsyncMock(side_effect=_cancel),
            ),
            pytest.raises(asyncio.CancelledError),
        ):
            await generate_run_report(None, 42)

        status_calls = [
            c
            for c in update_run.await_args_list
            if c.kwargs.get("report_generation_status") == "failed"
        ]
        assert status_calls, "CancelledError must mark the run failed"

    async def test_generic_error_marks_run_failed(self):
        from api.tasks.generate_run_report import generate_run_report

        run = SimpleNamespace(
            id=43,
            workflow=SimpleNamespace(
                id=7,
                workflow_configurations={"report_template": "<p>Report</p>"},
            ),
            gathered_context={},
            logs={},
        )

        with (
            patch(
                "api.tasks.generate_run_report.db_client.update_workflow_run",
                new=AsyncMock(),
            ) as update_run,
            patch(
                "api.tasks.generate_run_report.db_client.get_workflow_run_by_id",
                new=AsyncMock(return_value=run),
            ),
            # Errors outside the PDF inner try (which deliberately swallows
            # render failures) must reach the outer handler and mark failed.
            patch(
                "api.tasks.generate_run_report.resolve_definitions",
                side_effect=RuntimeError("boom"),
            ),
        ):
            await generate_run_report(None, 43)

        status_calls = [
            c
            for c in update_run.await_args_list
            if c.kwargs.get("report_generation_status") == "failed"
        ]
        assert status_calls, "Unexpected errors must mark the run failed"


# ---------------------------------------------------------------------------
# Item 3: per-function ARQ budget
# ---------------------------------------------------------------------------


class TestArqReportFunctionBudget:
    def test_report_functions_have_extended_timeout_and_single_retry(self):
        from arq.worker import Function

        from api.tasks.arq import WorkerSettings

        by_name = {}
        for fn in WorkerSettings.functions:
            if isinstance(fn, Function):
                by_name[fn.name] = fn

        for name in ("generate_run_report", "generate_campaign_report"):
            fn = by_name.get(name)
            assert fn is not None, f"{name} must be registered as a Function"
            assert fn.timeout_s == 900
            assert fn.max_tries == 2

    def test_stale_sweep_is_registered_as_cron(self):
        from api.tasks.arq import WorkerSettings

        cron_names = [c.name for c in WorkerSettings.cron_jobs]
        assert any("sweep_stale_report_generations" in n for n in cron_names)


# ---------------------------------------------------------------------------
# Item 6: sweep marks stale non-terminal runs failed
# ---------------------------------------------------------------------------


class TestReportSweep:
    async def test_sweep_marks_stale_runs_failed(self):
        from api.tasks.report_sweep import sweep_stale_report_generations

        stale_run = SimpleNamespace(
            id=101,
            report_generation_status="processing",
            report_status_updated_at=datetime.now(UTC) - timedelta(hours=1),
            created_at=datetime.now(UTC) - timedelta(hours=2),
        )
        with (
            patch(
                "api.tasks.report_sweep.db_client.get_stale_report_runs",
                new=AsyncMock(return_value=[stale_run]),
            ),
            patch(
                "api.tasks.report_sweep.db_client.update_workflow_run",
                new=AsyncMock(),
            ) as update_run,
        ):
            result = await sweep_stale_report_generations(None)

        assert result == {"swept": 1}
        update_run.assert_awaited_once_with(
            run_id=101, report_generation_status="failed"
        )

    async def test_sweep_noop_when_no_stale_runs(self):
        from api.tasks.report_sweep import sweep_stale_report_generations

        with (
            patch(
                "api.tasks.report_sweep.db_client.get_stale_report_runs",
                new=AsyncMock(return_value=[]),
            ),
            patch(
                "api.tasks.report_sweep.db_client.update_workflow_run",
                new=AsyncMock(),
            ) as update_run,
        ):
            result = await sweep_stale_report_generations(None)

        assert result == {"swept": 0}
        update_run.assert_not_awaited()

    async def test_stale_threshold_exceeds_job_budget(self):
        # Sweep must never fail a job still inside its 900s ARQ budget.
        from api.tasks.report_sweep import STALE_MINUTES

        assert STALE_MINUTES * 60 > 900


# ---------------------------------------------------------------------------
# Item 5: enqueue failure leaves a terminal status, never 'pending' forever
# ---------------------------------------------------------------------------


class TestWorkflowCompletionEnqueueHonesty:
    async def test_none_enqueue_result_marks_report_failed(self):
        from api.tasks import workflow_completion

        run_id = 555

        with (
            patch.object(
                workflow_completion,
                "run_integrations_post_workflow_run",
                new=AsyncMock(),
            ),
            patch.object(
                workflow_completion,
                "report_completed_workflow_run_platform_usage",
                new=AsyncMock(),
            ),
            patch.object(
                workflow_completion.db_client,
                "update_workflow_run",
                new=AsyncMock(),
            ) as update_run,
            patch(
                "api.tasks.arq.enqueue_job",
                new=AsyncMock(return_value=None),
            ),
        ):
            await workflow_completion.process_workflow_completion(None, run_id)

        status_calls = [
            c
            for c in update_run.await_args_list
            if c.kwargs.get("report_generation_status") == "failed"
        ]
        assert status_calls, (
            "A None enqueue result must mark the report failed, "
            "not leave the run at 'pending' forever"
        )


# ---------------------------------------------------------------------------
# Item 8: report artifact access
# ---------------------------------------------------------------------------


class TestReportSignedUrlKeys:
    def test_reports_pdf_keys_extract_workflow_run_id(self):
        from api.routes.s3_signed_url import (
            _extract_legacy_workflow_run_id,
            _extract_org_id_from_key,
        )

        assert _extract_legacy_workflow_run_id("reports/pdfs/162.pdf") == 162
        # Not an org-scoped prefix -> must fall through to run-org auth.
        assert _extract_org_id_from_key("reports/pdfs/162.pdf") is None

    def test_invalid_report_keys_do_not_extract(self):
        from api.routes.s3_signed_url import _extract_legacy_workflow_run_id

        assert _extract_legacy_workflow_run_id("reports/pdfs/abc.pdf") is None
        assert _extract_legacy_workflow_run_id("reports/pdfs/162.html") is None


class TestPublicReportDownload:
    def _make_app(self):
        from api.routes.public_download import router

        app = FastAPI()
        app.include_router(router)
        return app

    async def test_report_artifact_redirects_to_signed_url(self):
        from api.routes import public_download

        run = SimpleNamespace(
            id=9,
            recording_url=None,
            transcript_url=None,
            report_s3_key="reports/pdfs/9.pdf",
            storage_backend="minio",
            extra={},
        )
        client = TestClient(self._make_app())

        storage = SimpleNamespace(
            aget_signed_url=AsyncMock(return_value="https://signed.example/report.pdf")
        )
        with (
            patch.object(
                public_download.db_client,
                "get_workflow_run_by_public_token",
                new=AsyncMock(return_value=run),
            ),
            patch.object(
                public_download,
                "get_storage_for_backend",
                new=lambda *_a, **_k: storage,
            ),
        ):
            response = client.get(
                "/public/download/workflow/some-token/report", follow_redirects=False
            )

        assert response.status_code == 302
        assert response.headers["location"] == "https://signed.example/report.pdf"

    async def test_report_artifact_404_when_no_pdf(self):
        from api.routes import public_download

        run = SimpleNamespace(
            id=10,
            recording_url=None,
            transcript_url=None,
            report_s3_key=None,
            storage_backend="minio",
            extra={},
        )
        client = TestClient(self._make_app())

        with patch.object(
            public_download.db_client,
            "get_workflow_run_by_public_token",
            new=AsyncMock(return_value=run),
        ):
            response = client.get(
                "/public/download/workflow/some-token/report", follow_redirects=False
            )

        assert response.status_code == 404
