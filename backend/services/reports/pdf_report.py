"""PDF report generation from HTML/Jinja templates for workflow runs."""

import io
import zipfile
from datetime import UTC, datetime
from typing import Any, Optional

try:
    from jinja2 import BaseLoader, ChainableUndefined, Environment
except ImportError:
    BaseLoader = ChainableUndefined = Environment = None

from loguru import logger

from api.db import db_client
from api.services.reports.report_context import build_campaign_report_context
from api.utils.artifacts import artifact_url
from api.utils.pdf import html_to_pdf


def _build_run_context(run: Any) -> dict[str, Any]:
    """Build a template context dictionary from a single workflow run row."""
    initial = run.initial_context or {}
    gathered = run.gathered_context or {}
    usage = run.usage_info or {}

    call_tags = gathered.get("call_tags", [])
    if isinstance(call_tags, list):
        call_tags = ", ".join(str(t) for t in call_tags)

    extracted = gathered.get("extracted_variables", {})
    if not isinstance(extracted, dict):
        extracted = {}

    report_variables = gathered.get("report_variables", {})
    if not isinstance(report_variables, dict):
        report_variables = {}

    transcript_url = artifact_url(run.public_access_token, "transcript") or ""
    recording_url = artifact_url(run.public_access_token, "recording") or ""

    return {
        "run_id": run.id,
        "campaign_id": run.campaign_id,
        "agent_id": run.workflow_id,
        "definition_id": run.definition_id or "",
        "created_at": run.created_at.isoformat() if run.created_at else "",
        "phone_number": initial.get("phone_number", ""),
        "call_disposition": gathered.get("mapped_call_disposition", ""),
        "call_duration": usage.get("call_duration_seconds", ""),
        "cost": usage.get("cost", ""),
        "extracted_variables": extracted,
        "report_variables": report_variables,
        "call_tags": call_tags,
        "transcript_url": transcript_url,
        "recording_url": recording_url,
        "initial_context": initial,
        "gathered_context": gathered,
        "usage_info": usage,
        "report": {
            "run_id": run.id,
            "campaign_id": run.campaign_id,
            "agent_id": run.workflow_id,
            "created_at": run.created_at.isoformat() if run.created_at else "",
            "phone_number": initial.get("phone_number", ""),
            "call_disposition": gathered.get("mapped_call_disposition", ""),
            "call_duration": usage.get("call_duration_seconds", ""),
            "cost": usage.get("cost", ""),
            "call_tags": call_tags,
            "extracted_variables": extracted,
            "report_variables": report_variables,
            "transcript_url": transcript_url,
            "recording_url": recording_url,
        },
    }


def render_template_html(template_html: str, context: dict[str, Any]) -> str:
    """Render an HTML template with the given context using Jinja2."""
    env = Environment(loader=BaseLoader(), undefined=ChainableUndefined)
    jinja_template = env.from_string(template_html)
    return jinja_template.render(**context)


async def _render_run_pdf(template_html: str, run: Any) -> bytes:
    context = _build_run_context(run)
    rendered_html = render_template_html(template_html, context)
    return await html_to_pdf(rendered_html)


async def generate_campaign_report_pdf(
    campaign_id: int,
    template_html: str,
    start_date: Optional[datetime] = None,
    end_date: Optional[datetime] = None,
) -> tuple[io.BytesIO, str]:
    """Generate a ZIP of PDF reports for completed campaign runs.

    Each run gets its own PDF rendered from the Jinja template.
    Returns a BytesIO containing the ZIP file.
    """
    runs = await db_client.get_completed_runs_for_report(
        campaign_id=campaign_id, start_date=start_date, end_date=end_date
    )

    zip_buffer = io.BytesIO()
    with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED) as zf:
        for run in runs:
            try:
                pdf_bytes = await _render_run_pdf(template_html, run)
                pdf_filename = f"run_{run.id}.pdf"
                zf.writestr(pdf_filename, pdf_bytes)
            except Exception as e:
                logger.error(f"Failed to generate PDF for campaign run {run.id}: {e}")
                continue

    zip_buffer.seek(0)
    timestamp = datetime.now(UTC).strftime("%Y%m%d_%H%M%S")
    return zip_buffer, f"campaign_{campaign_id}_report_{timestamp}.zip"


async def generate_workflow_report_pdf(
    workflow_id: int,
    template_html: str,
    start_date: Optional[datetime] = None,
    end_date: Optional[datetime] = None,
) -> tuple[io.BytesIO, str]:
    """Generate a ZIP of PDF reports for completed workflow runs.

    Each run gets its own PDF rendered from the Jinja template.
    Returns a BytesIO containing the ZIP file.
    """
    runs = await db_client.get_completed_runs_for_report(
        workflow_id=workflow_id, start_date=start_date, end_date=end_date
    )

    zip_buffer = io.BytesIO()
    with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED) as zf:
        for run in runs:
            try:
                pdf_bytes = await _render_run_pdf(template_html, run)
                pdf_filename = f"run_{run.id}.pdf"
                zf.writestr(pdf_filename, pdf_bytes)
            except Exception as e:
                logger.error(f"Failed to generate PDF for run {run.id}: {e}")
                continue

    zip_buffer.seek(0)
    timestamp = datetime.now(UTC).strftime("%Y%m%d_%H%M%S")
    return zip_buffer, f"workflow_{workflow_id}_report_{timestamp}.zip"


__all__ = [
    "build_campaign_report_context",
    "generate_campaign_report_pdf",
    "generate_workflow_report_pdf",
    "render_template_html",
]

