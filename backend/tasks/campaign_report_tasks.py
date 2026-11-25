"""Background ARQ tasks for automated and manual Campaign Report generation."""

from datetime import UTC, datetime
from typing import Dict, Any

from loguru import logger

from api.db import db_client
from api.services.agents_llm import openai_params
from api.services.configuration.ai_model_configuration import (
    get_effective_ai_model_configuration_for_workflow,
)
from api.services.reports.campaign_report_aggregator import (
    build_large_scale_campaign_context,
    build_llm_campaign_summary_payload,
    extract_campaign_report_variables,
    finalize_campaign_variables,
)
from api.services.reports.pdf_report import render_template_html
from api.services.reports.variable_engine import (
    CAMPAIGN_BUILTIN_VARS,
    ReportVariable,
    ReportVariableType,
    missing_cached_vars,
    resolve_definitions,
)
from api.services.reports.extraction import _is_quota_error
from api.services.storage import storage_fs
from api.utils.pdf import html_to_pdf


async def generate_campaign_report(
    ctx: Dict[str, Any], campaign_id: int, force_refresh: bool = False
) -> Dict[str, Any]:
    """ARQ background task to aggregate campaign data and generate AI campaign report.

    Args:
        ctx: ARQ context dictionary.
        campaign_id: ID of the campaign to generate report for.
        force_refresh: If True, clears cached LLM variables and forces full extraction.
    """
    logger.info(f"Starting generate_campaign_report task for campaign {campaign_id}")

    try:
        campaign = await db_client.get_campaign_by_id(campaign_id)
        if not campaign:
            raise ValueError(f"Campaign {campaign_id} not found")

        metadata = dict(campaign.orchestrator_metadata or {})
        metadata["report_generation_status"] = "generating"
        metadata["report_error"] = None
        await db_client.update_campaign(campaign_id, orchestrator_metadata=metadata)

        template_html = metadata.get("report_template")

        workflow_configs = {}
        if campaign.workflow_id:
            try:
                workflow = await db_client.get_workflow(
                    campaign.workflow_id, campaign.organization_id
                )
                if workflow and workflow.workflow_configurations:
                    workflow_configs = workflow.workflow_configurations
                    if not template_html:
                        template_html = workflow_configs.get("report_template")
            except Exception as e:
                logger.warning(f"Could not load workflow {campaign.workflow_id} for campaign {campaign_id}: {e}")

        if not template_html:
            from api.constants import DEFAULT_CAMPAIGN_REPORT_TEMPLATE
            template_html = DEFAULT_CAMPAIGN_REPORT_TEMPLATE

        # Fetch runs and queued runs
        runs = await db_client.get_workflow_runs_by_campaign(campaign_id)
        queued_runs = await db_client.get_queued_runs_for_campaign(campaign_id)

        # Resolve report_variables_defs (saved, typed defs for per-run aggregation)
        raw_vars = metadata.get("report_variables") or workflow_configs.get("report_variables")
        saved_defs: list = []
        report_variables_defs = None
        if raw_vars and isinstance(raw_vars, list):
            saved_defs = [v for v in raw_vars if isinstance(v, dict) and v.get("name")]
            report_variables_defs = [
                ReportVariable(
                    name=v["name"],
                    type=ReportVariableType(v.get("type", "text")),
                    description=v.get("description", ""),
                )
                for v in saved_defs
            ]

        all_llm_variable_defs = resolve_definitions(
            template_html, saved_defs, exclude=CAMPAIGN_BUILTIN_VARS
        )

        # Determine cached vs missing variables; empty cached values count as
        # missing so regeneration self-heals without force_refresh.
        cached_llm_vars = {} if force_refresh else metadata.get("report_variables_values", {})
        missing_vars = missing_cached_vars(all_llm_variable_defs, cached_llm_vars)

        payload = None
        llm_config = None
        if missing_vars and (runs or queued_runs):
            try:
                llm_resolved = await get_effective_ai_model_configuration_for_workflow(
                    user_id=None,
                    organization_id=campaign.organization_id,
                    workflow_configurations=workflow_configs,
                )
                if llm_resolved and llm_resolved.llm:
                    base_url, model, api_key = openai_params(llm_resolved.llm)
                    llm_config = {"api_key": api_key, "model": model, "base_url": base_url}

                    # Base context for summary payload
                    base_ctx = build_large_scale_campaign_context(
                        campaign,
                        runs,
                        queued_runs,
                        report_variables_defs=report_variables_defs,
                    )
                    payload = build_llm_campaign_summary_payload(campaign, runs, base_ctx)

                    newly_extracted = await extract_campaign_report_variables(
                        payload, missing_vars, llm_config
                    )
                    if newly_extracted:
                        cached_llm_vars = {**cached_llm_vars, **newly_extracted}
            except Exception as e:
                if _is_quota_error(e):
                    raise
                logger.warning(f"Error extracting LLM variables for campaign {campaign_id}: {e}")

        # Complete every defined variable on a render copy: rollups, gap-fill,
        # placeholders. Persist completed values to cache only when the LLM
        # ran (or a prior real cache exists); force_refresh clears for a full
        # re-extraction, and missing_cached_vars self-heals legacy caches
        # containing empty strings.
        render_vars = dict(cached_llm_vars)
        finalize_meta: dict = {}
        if all_llm_variable_defs:
            finalize_meta = await finalize_campaign_variables(
                render_vars,
                all_llm_variable_defs,
                payload=payload,
                llm_config=llm_config,
            )
            if cached_llm_vars:
                cached_llm_vars = render_vars

        # Render final context & template
        context = build_large_scale_campaign_context(
            campaign,
            runs,
            queued_runs,
            report_variables_defs=report_variables_defs,
            llm_generated_variables=render_vars,
        )

        rendered_html = render_template_html(template_html, context)

        # Generate & upload PDF
        pdf_key = None
        try:
            import os
            import tempfile

            pdf_bytes = await html_to_pdf(rendered_html)
            pdf_key = f"campaigns/{campaign_id}/reports/report_{datetime.now(UTC).strftime('%Y%m%d_%H%M%S')}.pdf"
            with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
                tmp.write(pdf_bytes)
                tmp_path = tmp.name

            try:
                upload_ok = await storage_fs.aupload_file(tmp_path, pdf_key)
                if not upload_ok:
                    pdf_key = None
            finally:
                if os.path.exists(tmp_path):
                    os.unlink(tmp_path)
        except Exception as e:
            logger.warning(f"Could not generate PDF for campaign {campaign_id}: {e}")

        # Update metadata
        metadata["report_variables_values"] = cached_llm_vars
        metadata["report_variables_meta"] = finalize_meta
        metadata["report_generation_status"] = "completed"
        metadata["report_generated_at"] = datetime.now(UTC).isoformat()
        if pdf_key:
            metadata["report_s3_key"] = pdf_key

        await db_client.update_campaign(campaign_id, orchestrator_metadata=metadata)

        logger.info(f"Successfully completed generate_campaign_report task for campaign {campaign_id}")
        return {"status": "completed", "campaign_id": campaign_id, "pdf_key": pdf_key}

    except Exception as e:
        logger.error(f"Failed generate_campaign_report task for campaign {campaign_id}: {e}")
        try:
            campaign = await db_client.get_campaign_by_id(campaign_id)
            if campaign:
                metadata = dict(campaign.orchestrator_metadata or {})
                metadata["report_generation_status"] = "failed"
                metadata["report_error"] = str(e)
                await db_client.update_campaign(campaign_id, orchestrator_metadata=metadata)
        except Exception:
            pass
        raise
