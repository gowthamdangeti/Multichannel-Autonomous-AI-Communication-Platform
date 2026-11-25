import os
import tempfile
from datetime import UTC, datetime
from typing import Optional

from loguru import logger
from pipecat.utils.run_context import set_current_run_id

from api.db import db_client
from api.services.storage import get_current_storage_backend, storage_fs
from api.services.workflow_run_billing import (
    report_completed_workflow_run_platform_usage,
)
from api.tasks.function_names import FunctionNames
from api.services.pipecat.video_recorder import mux_video_and_audio
from api.tasks.run_integrations import run_integrations_post_workflow_run


def _recording_metadata(storage_key: str, storage_backend: str, track: str) -> dict:
    return {
        "storage_key": storage_key,
        "storage_backend": storage_backend,
        "format": "wav",
        "track": track,
    }


async def _upload_temp_file(
    workflow_run_id: int,
    temp_file_path: str,
    storage_key: str,
    label: str,
    *,
    delete_source: bool = True,
) -> bool:
    try:
        if not os.path.exists(temp_file_path):
            logger.warning(f"{label} temp file not found: {temp_file_path}")
            return False

        file_size = os.path.getsize(temp_file_path)
        logger.debug(f"{label} file size: {file_size} bytes")

        await storage_fs.aupload_file(temp_file_path, storage_key)
        logger.info(f"Successfully uploaded {label}: {storage_key}")
        return True
    except Exception as e:
        logger.error(f"Error uploading {label} for workflow {workflow_run_id}: {e}")
        return False
    finally:
        if delete_source and os.path.exists(temp_file_path):
            try:
                os.remove(temp_file_path)
                logger.debug(f"Cleaned up temp {label} file: {temp_file_path}")
            except Exception as e:
                logger.warning(f"Failed to clean up temp {label} file: {e}")


from api.services.pipecat.video_recorder import create_safe_temp_file


async def _resolve_artifact_to_local(
    path_or_key: Optional[str], suffix: str
) -> tuple[Optional[str], Optional[str]]:
    """Resolve an artifact reference (local path or storage staging key) to a local file.

    Returns:
        (local_path, staging_key_to_cleanup)
    """
    if not path_or_key:
        return None, None
    if os.path.exists(path_or_key):
        return path_or_key, None

    local_temp = create_safe_temp_file(suffix=suffix)
    try:
        ok = await storage_fs.adownload_file(path_or_key, local_temp)
        if ok and os.path.exists(local_temp) and os.path.getsize(local_temp) > 0:
            logger.info(f"Downloaded staged artifact {path_or_key} to worker {local_temp}")
            return local_temp, path_or_key
    except Exception as e:
        logger.warning(f"Could not download staged artifact {path_or_key}: {e}")

    if os.path.exists(local_temp):
        try:
            os.remove(local_temp)
        except OSError:
            pass
    return None, None


async def process_workflow_completion(
    _ctx,
    workflow_run_id: int,
    audio_temp_path: Optional[str] = None,
    transcript_temp_path: Optional[str] = None,
    user_audio_temp_path: Optional[str] = None,
    bot_audio_temp_path: Optional[str] = None,
    video_temp_path: Optional[str] = None,
    start_offset_seconds: float = 0.0,
):
    """Process workflow completion: upload artifacts and run integrations.

    This task combines audio upload, transcript upload, and webhook integrations
    into a single sequential task to ensure integrations run after uploads complete.

    Args:
        _ctx: ARQ context (unused)
        workflow_run_id: The workflow run ID
        audio_temp_path: Optional path to temp audio file
        transcript_temp_path: Optional path to temp transcript file
        user_audio_temp_path: Optional path to temp user-track audio file
        bot_audio_temp_path: Optional path to temp bot-track audio file
    """
    run_id = str(workflow_run_id)
    set_current_run_id(run_id)

    logger.info(f"Processing workflow completion for run {workflow_run_id}")

    storage_backend = get_current_storage_backend()

    # Resolve cross-container staged artifacts (or use local path if same container/host).
    # In Docker and Kubernetes environments, backend and arq run in separate containers
    # with independent /tmp filesystems. Artifacts staged to storage_fs bridge this boundary.
    temp_mixed_audio_path, audio_staging_key = await _resolve_artifact_to_local(
        audio_temp_path, suffix=".wav"
    )
    temp_user_audio_path, user_audio_staging_key = await _resolve_artifact_to_local(
        user_audio_temp_path, suffix=".wav"
    )
    temp_bot_audio_path, bot_audio_staging_key = await _resolve_artifact_to_local(
        bot_audio_temp_path, suffix=".wav"
    )
    temp_transcript_path, transcript_staging_key = await _resolve_artifact_to_local(
        transcript_temp_path, suffix=".txt"
    )
    temp_video_path, video_staging_key = await _resolve_artifact_to_local(
        video_temp_path, suffix=".mp4"
    )

    # Step 1: Upload audio if provided
    recordings_metadata: dict[str, dict] = {}

    if temp_mixed_audio_path:
        recording_url = f"recordings/{workflow_run_id}.wav"
        logger.info(
            f"Uploading mixed audio to {storage_backend.name} - workflow_run_id: {workflow_run_id}"
        )
        if await _upload_temp_file(
            workflow_run_id,
            temp_mixed_audio_path,
            recording_url,
            "mixed audio",
            delete_source=False,
        ):
            recordings_metadata["mixed"] = _recording_metadata(
                recording_url, storage_backend.value, "mixed"
            )
            await db_client.update_workflow_run(
                run_id=workflow_run_id,
                recording_url=recording_url,
                storage_backend=storage_backend.value,
            )

    if temp_user_audio_path:
        user_recording_url = f"recordings/{workflow_run_id}/user.wav"
        logger.info(
            f"Uploading user audio to {storage_backend.name} - workflow_run_id: {workflow_run_id}"
        )
        if await _upload_temp_file(
            workflow_run_id, temp_user_audio_path, user_recording_url, "user audio"
        ):
            recordings_metadata["user"] = _recording_metadata(
                user_recording_url, storage_backend.value, "user"
            )

    if temp_bot_audio_path:
        bot_recording_url = f"recordings/{workflow_run_id}/bot.wav"
        logger.info(
            f"Uploading bot audio to {storage_backend.name} - workflow_run_id: {workflow_run_id}"
        )
        if await _upload_temp_file(
            workflow_run_id, temp_bot_audio_path, bot_recording_url, "bot audio"
        ):
            recordings_metadata["bot"] = _recording_metadata(
                bot_recording_url, storage_backend.value, "bot"
            )

    if temp_video_path:
        try:
            muxed_video_path = create_safe_temp_file(suffix=".mp4")
            mux_ok = mux_video_and_audio(
                video_input_path=temp_video_path,
                audio_input_path=temp_mixed_audio_path or "",
                output_path=muxed_video_path,
                start_offset_seconds=start_offset_seconds,
            )
            final_video_file = (
                muxed_video_path
                if (mux_ok and os.path.exists(muxed_video_path) and os.path.getsize(muxed_video_path) > 0)
                else temp_video_path
            )
            video_recording_url = f"recordings/{workflow_run_id}/video.mp4"
            logger.info(
                f"Uploading video recording to {storage_backend.name} - workflow_run_id: {workflow_run_id}"
            )
            if await _upload_temp_file(
                workflow_run_id, final_video_file, video_recording_url, "video recording"
            ):
                recordings_metadata["video"] = {
                    "storage_key": video_recording_url,
                    "storage_backend": storage_backend.value,
                    "format": "mp4",
                    "track": "video",
                }
            if final_video_file != temp_video_path and os.path.exists(muxed_video_path):
                try:
                    os.remove(muxed_video_path)
                except OSError:
                    pass
        except Exception as e:
            logger.error(
                f"Error during video recording processing for workflow {workflow_run_id}: {e}",
                exc_info=True,
            )
        finally:
            if os.path.exists(temp_video_path):
                try:
                    os.remove(temp_video_path)
                except OSError:
                    pass
            if video_staging_key:
                try:
                    await storage_fs.adelete_file(video_staging_key)
                    logger.debug(f"Cleaned up staging video artifact: {video_staging_key}")
                except Exception as e:
                    logger.warning(f"Failed to delete staging video artifact {video_staging_key}: {e}")

    # The mixed-audio temp file is consumed by the muxer above, so
    # _upload_temp_file was told not to delete it. Clean it up now that muxing
    # (which only runs when a video artifact exists) has finished.
    if temp_mixed_audio_path and os.path.exists(temp_mixed_audio_path):
        try:
            os.remove(temp_mixed_audio_path)
        except OSError:
            pass

    # Clean up staging keys for audio artifacts if they were transferred via storage_fs
    for key in (audio_staging_key, user_audio_staging_key, bot_audio_staging_key):
        if key:
            try:
                await storage_fs.adelete_file(key)
            except Exception as e:
                logger.warning(f"Failed to clean up staging audio artifact {key}: {e}")

    if recordings_metadata:
        await db_client.update_workflow_run(
            run_id=workflow_run_id,
            storage_backend=storage_backend.value,
            extra={"recordings": recordings_metadata},
        )
        try:
            await db_client.ensure_public_access_token(workflow_run_id)
        except Exception as e:
            logger.warning(f"Could not ensure public access token for run {workflow_run_id}: {e}")

    # Step 2: Upload transcript if provided
    if temp_transcript_path:
        transcript_url = f"transcripts/{workflow_run_id}.txt"
        logger.info(
            f"Uploading transcript to {storage_backend.name} - workflow_run_id: {workflow_run_id}"
        )
        upload_ok = await _upload_temp_file(
            workflow_run_id, temp_transcript_path, transcript_url, "transcript"
        )
        if upload_ok:
            await db_client.update_workflow_run(
                run_id=workflow_run_id,
                transcript_url=transcript_url,
                storage_backend=storage_backend.value,
            )
            logger.info(
                f"Transcript upload + URL update succeeded for run {workflow_run_id}: "
                f"transcript_url={transcript_url}"
            )
        else:
            logger.error(
                f"Transcript upload FAILED for run {workflow_run_id}. "
                f"Temp file existed at: {temp_transcript_path}"
            )
        if transcript_staging_key:
            try:
                await storage_fs.adelete_file(transcript_staging_key)
            except Exception as e:
                logger.warning(f"Failed to delete staging transcript artifact {transcript_staging_key}: {e}")
    else:
        logger.warning(
            f"No transcript temp path for run {workflow_run_id}. "
            "Transcript was either not generated or skipped earlier."
        )

    # Step 3: Run integrations including QA analysis (after uploads are complete)
    try:
        await run_integrations_post_workflow_run(_ctx, workflow_run_id)
    except Exception as e:
        logger.error(f"Error running integrations for workflow {workflow_run_id}: {e}")

    # Step 4: Debit wallet via ARQ (idempotent). Fall back to inline on Redis outage.
    try:
        from api.tasks.arq import enqueue_job

        from api.tasks.function_names import FunctionNames as _FN

        job = await enqueue_job(_FN.DEBIT_WORKFLOW_RUN, workflow_run_id)
        if job is None:
            raise RuntimeError("ARQ enqueue returned no job for billing debit")
    except Exception as e:
        logger.warning(f"Billing enqueue failed, debiting inline: {e}")
        try:
            await report_completed_workflow_run_platform_usage(workflow_run_id)
        except Exception as ie:
            logger.error(
                f"Error reporting platform usage for workflow {workflow_run_id}: {ie}"
            )

    # Read the provider's billed usage once it has had time to land. The fixed
    # job ID keeps a repeated completion from starting a second sync.
    try:
        from api.tasks.arq import enqueue_job
        from api.tasks.provider_usage_sync import FIRST_RUN_DELAY_SECONDS

        await enqueue_job(
            FunctionNames.SYNC_PROVIDER_USAGE,
            workflow_run_id,
            datetime.now(UTC).isoformat(),
            _defer_by=FIRST_RUN_DELAY_SECONDS,
            _job_id=f"sync-provider-usage-{workflow_run_id}",
        )
    except Exception as e:
        logger.error(f"Could not queue provider usage sync {workflow_run_id}: {e}")

    # Step 5: Generate conversation_title (independent of report template —
    # runs without a template, pipeline_error runs and 15s calls still get
    # a deterministic fallback title so list/detail APIs never miss the key).
    try:
        from api.tasks.arq import enqueue_job

        title_job = await enqueue_job(
            FunctionNames.GENERATE_CONVERSATION_TITLE, workflow_run_id
        )
        if title_job is None:
            logger.error(
                f"ARQ enqueue returned no job for conversation title {workflow_run_id}"
            )
    except Exception as e:
        logger.error(
            f"Error enqueuing conversation title for workflow {workflow_run_id}: {e}"
        )

    # Step 6: Generate PDF report if enabled
    report_enabled = True
    try:
        run = await db_client.get_workflow_run_by_id(workflow_run_id)
        if run and run.workflow:
            configs = run.workflow.workflow_configurations or {}
            report_enabled = configs.get("report_generation_enabled", False)
    except Exception as e:
        logger.warning(f"Could not check report_generation_enabled for run {workflow_run_id}: {e}")

    if not report_enabled:
        logger.info(f"Report generation disabled for run {workflow_run_id}, skipping")
        try:
            await db_client.update_workflow_run(
                run_id=workflow_run_id,
                report_generation_status="skipped",
            )
        except Exception as e:
            logger.error(f"Error setting report_generation_status to skipped: {e}")
    else:
        try:
            await db_client.update_workflow_run(
                run_id=workflow_run_id,
                report_generation_status="pending",
            )
        except Exception as e:
            logger.error(f"Error setting report_generation_status for workflow {workflow_run_id}: {e}")

        try:
            from api.tasks.arq import enqueue_job

            job = await enqueue_job(FunctionNames.GENERATE_RUN_REPORT, workflow_run_id)
            if job is None:
                raise RuntimeError("ARQ enqueue returned no job")
        except Exception as e:
            logger.error(
                f"Error enqueuing report generation for workflow {workflow_run_id}: {e}"
            )
            try:
                await db_client.update_workflow_run(
                    run_id=workflow_run_id,
                    report_generation_status="failed",
                )
            except Exception as status_err:
                logger.error(
                    f"Error marking report generation failed for workflow {workflow_run_id}: {status_err}"
                )

    logger.info(f"Completed workflow completion processing for run {workflow_run_id}")
