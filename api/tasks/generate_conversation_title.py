import asyncio

from loguru import logger

from api.db import db_client
from api.services.agents_llm import openai_params
from api.services.configuration.ai_model_configuration import (
    get_effective_ai_model_configuration_for_workflow,
)
from api.services.reports.conversation_title import (
    build_fallback_title,
    generate_conversation_title_llm,
)
from api.services.reports.extraction import _is_quota_error
from api.services.reports.report_context import (
    _logs_to_messages as _logs_to_transcript_messages,
    _parse_transcript,
)


async def _resolve_llm_config(workflow_run_id: int, configs: dict) -> dict | None:
    try:
        org_id = await db_client.get_organization_id_by_workflow_run_id(workflow_run_id)
        llm_resolved = await get_effective_ai_model_configuration_for_workflow(
            user_id=None, organization_id=org_id, workflow_configurations=configs,
        )
        if llm_resolved and llm_resolved.llm:
            base_url, model, api_key = openai_params(llm_resolved.llm)
            if api_key:
                return {"api_key": api_key, "model": model, "base_url": base_url}
    except Exception as e:
        if _is_quota_error(e):
            raise
        logger.error(f"No LLM config for conversation title run {workflow_run_id}: {e}")
    return None


async def generate_conversation_title(_ctx, workflow_run_id: int):
    """ARQ job: LLM title from transcript, deterministic fallback on any failure.

    Idempotent (skips when already set). Never raises on empty transcripts
    or LLM errors — a fallback title is always persisted so list/detail
    APIs never return a missing key.
    """
    try:
        run = await db_client.get_workflow_run_by_id(workflow_run_id)
        if not run:
            logger.error(f"Run not found for conversation title {workflow_run_id}")
            return
        if getattr(run, "conversation_title", None):
            return

        workflow = getattr(run, "workflow", None)
        workflow_name = getattr(workflow, "name", None)
        configs = (getattr(workflow, "workflow_configurations", None) or {}) if workflow else {}

        gathered = run.gathered_context or {}
        logs = run.logs or {}
        initial = run.initial_context or {}

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

        caller_number = initial.get("caller_number")
        called_number = initial.get("called_number") or initial.get("phone_number")
        if run.call_type == "inbound" and not caller_number:
            caller_number = initial.get("phone_number")

        title: str | None = None
        llm_config: dict | None = None
        title_usage: dict = {}
        if has_real_transcript:
            try:
                llm_config = await _resolve_llm_config(workflow_run_id, configs)
            except Exception as e:
                if _is_quota_error(e):
                    logger.error(
                        f"Conversation title quota-hit for run {workflow_run_id}; using fallback"
                    )
                    llm_config = None
                else:
                    llm_config = None
            if llm_config:
                for attempt in range(2):
                    try:
                        title = await generate_conversation_title_llm(
                            transcript_messages=transcript_messages,
                            workflow_name=workflow_name,
                            llm_config=llm_config,
                            caller_number=caller_number,
                            called_number=called_number,
                            usage_out=title_usage,
                        )
                        break
                    except Exception as e:
                        if _is_quota_error(e):
                            logger.error(
                                f"Conversation title quota-hit for run {workflow_run_id}; using fallback"
                            )
                            break
                        logger.warning(
                            f"Conversation title retry {attempt + 1}/2 for run {workflow_run_id}: {e}"
                        )
                        await asyncio.sleep(2 ** attempt)

        if not title:
            title = build_fallback_title(
                workflow_name=workflow_name,
                run_id=run.id,
                run_name=getattr(run, "name", None),
                caller_number=caller_number,
            )
        if title_usage:
            await db_client.record_usage(
                workflow_run_id=workflow_run_id,
                case="conversation_title",
                service_type="llm",
                operation_id=f"conversation-title:{workflow_run_id}",
                model=(llm_config or {}).get("model"),
                usage=title_usage,
            )
            # Mirror into usage_info like Completeness / ReportGeneration. The
            # usage event's cache columns default to 0, so without this the UI
            # can't tell a real 0 cache from "never captured".
            title_model = (llm_config or {}).get("model")
            if title_model and (title_usage.get("total_tokens") or 0) > 0:
                try:
                    fresh_run = await db_client.get_workflow_run_by_id(workflow_run_id)
                    if fresh_run:
                        cur_usage = dict(fresh_run.usage_info or {})
                        cur_llm = dict(cur_usage.get("llm", {}))
                        cur_llm[f"conversation_title|||{title_model}"] = dict(title_usage)
                        cur_usage["llm"] = cur_llm
                        await db_client.update_workflow_run(
                            run_id=workflow_run_id, usage_info=cur_usage
                        )
                except Exception as err:
                    logger.warning(
                        f"Failed to mirror title usage_info for run {workflow_run_id}: {err}"
                    )

        try:
            await db_client.update_workflow_run(
                run_id=workflow_run_id, conversation_title=title
            )
            logger.info(f"Conversation title for run {workflow_run_id}: {title}")
        except Exception as e:
            logger.error(
                f"Failed to persist conversation title for run {workflow_run_id}: {e}"
            )
    except asyncio.CancelledError:
        raise
    except Exception as e:
        logger.error(f"Failed to generate conversation title for run {workflow_run_id}: {e}")
