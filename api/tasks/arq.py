"""ARQ worker configuration - setup logging before importing tasks"""

import asyncio
import ssl
from urllib.parse import urlparse

# Setup logging - this is now idempotent and safe to call multiple times
from loguru import logger

from api.constants import REDIS_URL
from api.logging_config import setup_logging
from api.tasks.function_names import FunctionNames

setup_logging()

# Now import ARQ and task dependencies
from arq import create_pool, cron
from arq.connections import ArqRedis, RedisSettings
from arq.worker import Function

parsed_url = urlparse(REDIS_URL)

# Check if we're using TLS (rediss://)
use_ssl = parsed_url.scheme == "rediss"

# Create SSL context if using rediss://
ssl_context = None
if use_ssl:
    ssl_context = ssl.create_default_context(ssl.Purpose.SERVER_AUTH)
    ssl_context.check_hostname = False
    ssl_context.verify_mode = ssl.CERT_NONE

REDIS_SETTINGS = RedisSettings(
    host=parsed_url.hostname or "localhost",
    port=parsed_url.port or 6379,
    password=parsed_url.password,
    conn_timeout=10,
    ssl=use_ssl,
    ssl_ca_certs=None if not use_ssl else None,
    ssl_certfile=None,
    ssl_keyfile=None,
    ssl_check_hostname=False if use_ssl else None,
)

from api.tasks.billing_tasks import debit_workflow_run, reconcile_billing
from api.tasks.campaign_report_tasks import generate_campaign_report
from api.tasks.campaign_tasks import (
    process_campaign_batch,
    sync_campaign_source,
)
from api.services.chat.auto_evaluation import sweep_finished_chats
from api.tasks.evaluate_chat_conversation import evaluate_chat_conversation_job
from api.tasks.generate_chat_conversation_title import (
    generate_chat_conversation_title_job,
)
from api.tasks.generate_conversation_title import generate_conversation_title
from api.tasks.generate_run_report import generate_run_report
from api.tasks.knowledge_base_processing import process_knowledge_base_document
from api.tasks.language_sync import sync_provider_languages
from api.tasks.model_price_sync import sync_model_prices
from api.tasks.provider_model_sync import sync_provider_models
from api.tasks.provider_usage_sync import MAX_TRIES as PROVIDER_USAGE_MAX_TRIES
from api.tasks.provider_usage_sync import sync_provider_usage
from api.tasks.report_sweep import sweep_stale_report_generations
from api.tasks.run_integrations import run_integrations_post_workflow_run
from api.tasks.s3_upload import upload_voicemail_audio_to_s3
from api.tasks.scheduled_calls import dispatch_due_scheduled_calls
from api.tasks.stuck_run_sweep import sweep_stuck_runs
from api.tasks.voice_preview_tasks import render_saved_configuration_voice_previews
from api.tasks.workflow_completion import process_workflow_completion
from api.tasks.email_tasks import (
    analyze_email,
    cleanup_email_processing_records,
    evaluate_email_rules,
    generate_email_digest,
    process_new_email,
    sync_all_email_accounts,
    sync_gmail_account_task,
    sync_outlook_account_task,
    update_followup_status,
)


class WorkerSettings:
    functions = [
        # Report jobs get a bigger budget than the 300s worker default:
        # extraction + gap-fill + Chromium PDF can exceed 5 minutes. With only
        # 2 tries a failure surfaces fast instead of silently burning 5 LLM
        # passes while the run sits at 'processing'.
        Function(
            name="generate_run_report",
            coroutine=generate_run_report,
            timeout_s=900,
            keep_result_s=None,
            keep_result_forever=None,
            max_tries=2,
        ),
        Function(
            name="generate_campaign_report",
            coroutine=generate_campaign_report,
            timeout_s=900,
            keep_result_s=None,
            keep_result_forever=None,
            max_tries=2,
        ),
        Function(
            name="generate_conversation_title",
            coroutine=generate_conversation_title,
            timeout_s=300,
            keep_result_s=None,
            keep_result_forever=None,
            max_tries=2,
        ),
        Function(
            name="evaluate_chat_conversation",
            coroutine=evaluate_chat_conversation_job,
            timeout_s=300,
            keep_result_s=None,
            keep_result_forever=None,
            max_tries=2,
        ),
        Function(
            name="generate_chat_conversation_title",
            coroutine=generate_chat_conversation_title_job,
            timeout_s=300,
            keep_result_s=None,
            keep_result_forever=None,
            max_tries=2,
        ),
        run_integrations_post_workflow_run,
        upload_voicemail_audio_to_s3,
        process_workflow_completion,
        debit_workflow_run,
        reconcile_billing,
        sync_campaign_source,
        process_campaign_batch,
        process_knowledge_base_document,
        dispatch_due_scheduled_calls,
        # A save renders at most two voices (TTS + speech-to-speech); cache
        # hits make retries free.
        Function(
            name="render_saved_configuration_voice_previews",
            coroutine=render_saved_configuration_voice_previews,
            timeout_s=120,
            keep_result_s=None,
            keep_result_forever=None,
            max_tries=2,
        ),
        Function(
            name="sync_provider_languages",
            coroutine=sync_provider_languages,
            timeout_s=300,
            keep_result_s=None,
            keep_result_forever=None,
            max_tries=1,
        ),
        Function(
            name="sync_model_prices",
            coroutine=sync_model_prices,
            timeout_s=300,
            keep_result_s=None,
            keep_result_forever=None,
            max_tries=1,
        ),
        Function(
            name="sync_provider_models",
            coroutine=sync_provider_models,
            timeout_s=300,
            keep_result_s=None,
            keep_result_forever=None,
            max_tries=1,
        ),
        Function(
            name="sync_provider_usage",
            coroutine=sync_provider_usage,
            timeout_s=120,
            keep_result_s=None,
            keep_result_forever=None,
            max_tries=PROVIDER_USAGE_MAX_TRIES,
        ),
        Function(
            name="sync_gmail_account",
            coroutine=sync_gmail_account_task,
            timeout_s=300,
            keep_result_s=None,
            keep_result_forever=None,
            max_tries=2,
        ),
        Function(
            name="sync_outlook_account",
            coroutine=sync_outlook_account_task,
            timeout_s=300,
            keep_result_s=None,
            keep_result_forever=None,
            max_tries=2,
        ),
        Function(
            name="process_new_email",
            coroutine=process_new_email,
            timeout_s=180,
            keep_result_s=None,
            keep_result_forever=None,
            max_tries=2,
        ),
        analyze_email,
        evaluate_email_rules,
        generate_email_digest,
    ]
    # Deferred jobs provide precise dispatch; this minute-level sweep recovers
    # schedules if Redis was unavailable or lost a deferred job.
    # report_sweep self-heals runs frozen at pending/processing (worker crash
    # before a terminal status write) by marking them failed after 15 minutes.
    cron_jobs = [
        cron(dispatch_due_scheduled_calls),
        cron(sweep_stale_report_generations, minute=set(range(0, 60, 10))),
        # Closes runs a crash left open, so their usage is still fetched.
        cron(sweep_stuck_runs, minute=set(range(5, 60, 10))),
        cron(reconcile_billing, minute=set(range(0, 60, 5))),
        # Titles and evaluates website chats that finished without reporting an end.
        cron(sweep_finished_chats, minute=set(range(7, 60, 10))),
        # Daily language-list refresh from provider APIs (03:17 UTC, off-peak).
        cron(sync_provider_languages, hour={3}, minute={17}, run_at_startup=False),
        # Daily model price refresh. Runs at startup too, so a fresh deploy has prices.
        cron(sync_model_prices, hour={3}, minute={47}, run_at_startup=True),
        # Daily model list refresh. Runs at startup too, so a fresh deploy has lists.
        cron(sync_provider_models, hour={3}, minute={32}, run_at_startup=True),
        # Periodic email sync every 5 minutes
        cron(sync_all_email_accounts, minute=set(range(0, 60, 5))),
        # Check and update email follow-up status every 15 minutes
        cron(update_followup_status, minute=set(range(0, 60, 15))),
        # Nightly cleanup of old email processing records at 02:00 UTC
        cron(cleanup_email_processing_records, hour={2}, minute={0}),
    ]
    redis_settings = REDIS_SETTINGS
    max_jobs = 10


LOG_CONFIG = {
    "version": 1,
    "disable_existing_loggers": False,
    # --- Handlers ---
    "handlers": {
        "console": {  # everything goes to stdout
            "class": "logging.StreamHandler",
            "stream": "ext://sys.stdout",
            "level": "WARNING",  # only WARNING and above
            "formatter": "simple",
        },
    },
    # --- Formatters (optional) ---
    "formatters": {
        "simple": {
            "format": "%(asctime)s | %(levelname)s | %(name)s | %(message)s",
        },
    },
    # --- Root logger ---
    "root": {
        "handlers": ["console"],
        "level": "WARNING",
    },
    # --- Optionally silence Arq itself explicitly ---
    "loggers": {
        "arq": {  # arq.* loggers
            "level": "WARNING",
            "handlers": ["console"],
            "propagate": False,
        },
    },
}


_redis_pool: ArqRedis | None = None


async def get_arq_redis(*, force: bool = False) -> ArqRedis:
    """Get or create the shared ARQ Redis connection pool.

    Args:
        force: If True, create a new pool even if one already exists
               (used after a connection error to force reconnection).

    Retries with exponential backoff (1s, 2s, 4s) on transient failures.
    """
    global _redis_pool
    if _redis_pool is not None and not force:
        return _redis_pool

    last_exc: Exception | None = None
    for attempt in range(3):
        try:
            pool = await create_pool(REDIS_SETTINGS)
            _redis_pool = pool
            return pool
        except (ConnectionError, OSError) as e:
            last_exc = e
            if attempt < 2:
                delay = 2 ** attempt
                logger.warning(
                    f"Redis connection attempt {attempt + 1}/3 failed: {e}. "
                    f"Retrying in {delay}s..."
                )
                await asyncio.sleep(delay)

    logger.error(
        f"Redis connection failed after 3 attempts: {last_exc}",
        exc_info=last_exc,
    )
    raise last_exc or RuntimeError("Redis connection failed")


async def enqueue_job(function_name: str | FunctionNames, *args, **kwargs):
    try:
        redis = await get_arq_redis()
        return await redis.enqueue_job(function_name, *args, **kwargs)
    except Exception as e:
        logger.error(
            f"Failed to enqueue job {function_name}: {e}",
            exc_info=True,
        )
