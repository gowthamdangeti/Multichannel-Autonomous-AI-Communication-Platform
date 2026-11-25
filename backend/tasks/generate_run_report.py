import asyncio
import tempfile

from loguru import logger

from api.db import db_client
from api.services.agents_llm import openai_params
from api.services.configuration.ai_model_configuration import (
    get_effective_ai_model_configuration_for_workflow,
)
from api.services.reports.report_context import (
    _logs_to_messages as _logs_to_transcript_messages,
    _parse_transcript,
    build_report_context,
)
from api.services.reports.variable_engine import (
    resolve_definitions,
)
from api.services.reports.extraction import _is_quota_error
from api.services.reports.run_variable_pipeline import (
    build_run_metadata,
    build_run_report_variables,
)
from api.services.reports.pdf_report import render_template_html
from api.services.storage import storage_fs
from api.utils.pdf import html_to_pdf


async def _call_with_retry(async_func, *args, max_retries=3, **kwargs):
    for attempt in range(max_retries):
        try:
            return await async_func(*args, **kwargs)
        except Exception as e:
            if _is_quota_error(e):
                logger.error(
                    f"Not retrying {async_func.__name__}: LLM quota/rate-limit hit: {e}"
                )
                raise
            if attempt == max_retries - 1:
                raise
            logger.warning(f"Retry {attempt + 1}/{max_retries} for {async_func.__name__}: {e}")
            await asyncio.sleep(2 ** attempt)


async def _mark_failed_safe(workflow_run_id: int, reason: str) -> None:
    """Best-effort terminal status write.

    Used from cancellation paths where the coroutine may be cancelled again
    mid-await: asyncio.shield keeps the DB write alive even if this task is
    re-cancelled, so the run never freezes at 'processing'.
    """
    try:
        await asyncio.shield(
            db_client.update_workflow_run(
                run_id=workflow_run_id, report_generation_status="failed"
            )
        )
        logger.error(
            f"Report generation for run {workflow_run_id} marked failed: {reason}"
        )
    except BaseException as e:  # noqa: BLE001 - last-resort status write
        logger.error(
            f"Failed to set failed status for run {workflow_run_id}: {e}"
        )


async def generate_run_report(_ctx, workflow_run_id: int):
    try:
        await db_client.update_workflow_run(run_id=workflow_run_id, report_generation_status="processing")
    except Exception as e:
        logger.error(f"Failed to set processing status for run {workflow_run_id}: {e}")

    run = await db_client.get_workflow_run_by_id(workflow_run_id)
    if not run or not run.workflow:
        logger.error(f"Run or workflow not found for {workflow_run_id}")
        await db_client.update_workflow_run(run_id=workflow_run_id, report_generation_status="failed")
        return

    configs = run.workflow.workflow_configurations or {}
    template_html = configs.get("report_template")
    if not template_html:
        try:
            draft = await db_client.get_draft_version(run.workflow.id)
            if draft:
                template_html = (draft.workflow_configurations or {}).get("report_template")
        except Exception as e:
            logger.error(f"Error checking draft: {e}")

    if not template_html:
        logger.info(f"No template for workflow {run.workflow.id}")
        await db_client.update_workflow_run(run_id=workflow_run_id, report_generation_status="failed")
        return

    try:
        raw_vars = configs.get("report_variables", [])
        saved_defs: list = []
        if raw_vars and isinstance(raw_vars, list):
            saved_defs = [v for v in raw_vars if isinstance(v, dict) and v.get("name")]

        all_variable_defs = resolve_definitions(template_html, saved_defs)

        gathered = run.gathered_context or {}
        logs = run.logs or {}

        transcript_messages = _parse_transcript(gathered)
        has_real_transcript = not (
            len(transcript_messages) == 1
            and transcript_messages[0].get("message") == "No transcript available."
        )
        if not has_real_transcript:
            logs_transcript = _logs_to_transcript_messages(logs)
            if logs_transcript:
                transcript_messages = logs_transcript
                has_real_transcript = True

        llm_config = None
        if all_variable_defs and has_real_transcript:
            org_id = await db_client.get_organization_id_by_workflow_run_id(workflow_run_id)

            llm_resolved = await _call_with_retry(
                get_effective_ai_model_configuration_for_workflow,
                user_id=None, organization_id=org_id, workflow_configurations=configs,
            )

            if llm_resolved and llm_resolved.llm:
                base_url, model, api_key = openai_params(llm_resolved.llm)
                llm_config = {"api_key": api_key, "model": model, "base_url": base_url}

            if not llm_config or not llm_config.get("api_key"):
                logger.error(f"No LLM config for run {workflow_run_id}; marking report failed")
                await db_client.update_workflow_run(run_id=workflow_run_id, report_generation_status="failed")
                return

        if all_variable_defs:
            logger.info(
                f"Building {len(all_variable_defs)} report variables for run {workflow_run_id}"
            )
            try:
                # Pipeline: truncate → LLM extract → deterministic rollups →
                # gap-fill → "Not discussed" placeholders. Never raises on
                # empty content; quota errors still propagate.
                result = await _call_with_retry(
                    build_run_report_variables,
                    transcript_messages=transcript_messages if has_real_transcript else [],
                    report_variables=all_variable_defs,
                    llm_config=llm_config,
                    run_metadata=build_run_metadata(
                        run, transcript_messages if has_real_transcript else []
                    ),
                )
            except Exception as e:
                if _is_quota_error(e):
                    logger.error(f"Report extraction quota-hit for run {workflow_run_id}; marking failed")
                else:
                    logger.error(f"Report extraction error for run {workflow_run_id}: {e}")
                await db_client.update_workflow_run(run_id=workflow_run_id, report_generation_status="failed")
                return

            gathered["report_variables"] = result.values
            gathered["report_variables_meta"] = result.meta
            await db_client.update_workflow_run(run_id=workflow_run_id, gathered_context=gathered)

            # Persist every report attempt; usage_info remains a legacy mirror.
            token_usage = result.meta.get("token_usage")
            if token_usage and token_usage.get("total_tokens", 0) > 0:
                rep_model = (llm_config or {}).get("model", "unknown")
                try:
                    attempt = await db_client.next_attempt(
                        workflow_run_id, f"report:{workflow_run_id}"
                    )
                    await db_client.record_usage(
                        workflow_run_id=workflow_run_id,
                        case="report_generation",
                        service_type="llm",
                        operation_id=f"report:{workflow_run_id}",
                        attempt=attempt,
                        model=rep_model,
                        usage=token_usage,
                    )
                except Exception as err:
                    logger.warning(f"Failed to record canonical report usage: {err}")
                try:
                    fresh_run = await db_client.get_workflow_run_by_id(workflow_run_id)
                    if fresh_run:
                        cur_usage = dict(fresh_run.usage_info or {})
                        cur_llm = dict(cur_usage.get("llm", {}))
                        # Count existing ReportGeneration keys so regenerations on
                        # old runs (where canonical table was empty) still get
                        # unique keys instead of overwriting.
                        existing_report_keys = sum(
                            1 for k in cur_llm
                            if k.lower().startswith("reportgeneration")
                        )
                        if existing_report_keys == 0:
                            suffix = ""
                        else:
                            regen_num = existing_report_keys
                            suffix = f"_Regen{'' if regen_num == 1 else regen_num}"
                        cur_llm[f"ReportGeneration{suffix}|||{rep_model}"] = token_usage
                        cur_usage["llm"] = cur_llm
                        await db_client.update_workflow_run(run_id=workflow_run_id, usage_info=cur_usage)
                except Exception as err:
                    logger.warning(f"Failed to mirror report usage_info: {err}")
            logger.info(
                f"Report variables for run {workflow_run_id}: "
                f"total={result.meta.get('total')} "
                f"empty={result.meta.get('empty')} "
                f"derived={result.meta.get('derived')} "
                f"gap_filled={result.meta.get('gap_filled')} "
                f"batch_missing={result.meta.get('extraction_missing')} "
                f"truncated={result.meta.get('truncated')}"
            )
        else:
            logger.info(f"No report variables for run {workflow_run_id}")


        # Render template to PDF and upload to S3. A PDF failure never fails
        # the report (the HTML preview renders from template + variables);
        # it is recorded in report_variables_meta so the UI can distinguish
        # "PDF available" from "preview only".
        pdf_uploaded = False
        pdf_error = None
        try:
            # Re-fetch the run so gathered_context includes the newly saved report_variables
            run = await db_client.get_workflow_run_by_id(workflow_run_id)
            context = build_report_context(run, report_variables_defs=all_variable_defs)
            rendered_html = render_template_html(template_html, context)
            pdf_bytes = await html_to_pdf(rendered_html)

            s3_key = f"reports/pdfs/{workflow_run_id}.pdf"
            with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
                tmp.write(pdf_bytes)
                tmp_path = tmp.name

            try:
                upload_ok = await storage_fs.aupload_file(tmp_path, s3_key)
                if upload_ok:
                    await db_client.update_workflow_run(
                        run_id=workflow_run_id,
                        report_s3_key=s3_key,
                    )
                    pdf_uploaded = True
                    logger.info(f"Report PDF uploaded to S3 for run {workflow_run_id}: {s3_key}")
                else:
                    pdf_error = "storage upload returned false"
                    logger.error(f"Failed to upload report PDF to S3 for run {workflow_run_id}")
            finally:
                import os
                os.unlink(tmp_path)
        except Exception as e:
            pdf_error = str(e)
            logger.error(f"Failed to render/upload report PDF for run {workflow_run_id}: {e}")

        if all_variable_defs or pdf_uploaded or pdf_error:
            try:
                current_run = await db_client.get_workflow_run_by_id(workflow_run_id)
                gathered = dict(current_run.gathered_context or {})
                meta = dict(gathered.get("report_variables_meta") or {})
                meta["pdf_uploaded"] = pdf_uploaded
                if pdf_error:
                    meta["pdf_error"] = pdf_error
                gathered["report_variables_meta"] = meta
                await db_client.update_workflow_run(
                    run_id=workflow_run_id, gathered_context=gathered
                )
            except Exception as e:
                logger.error(
                    f"Failed to record pdf status for run {workflow_run_id}: {e}"
                )

        await db_client.update_workflow_run(run_id=workflow_run_id, report_generation_status="completed")
        logger.info(f"Report extraction completed for run {workflow_run_id}")
    except asyncio.CancelledError:
        # ARQ job timeout / worker shutdown cancels with BaseException, which
        # the old `except Exception` missed — that is how runs froze at
        # 'processing'. Write a terminal status, then let cancellation proceed.
        await _mark_failed_safe(
            workflow_run_id, "job cancelled (ARQ timeout or worker shutdown)"
        )
        raise
    except Exception as e:
        logger.error(f"Failed to generate report for run {workflow_run_id}: {e}")
        await _mark_failed_safe(workflow_run_id, str(e))
