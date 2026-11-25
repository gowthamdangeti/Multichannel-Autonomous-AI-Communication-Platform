"""Billed usage from providers. Sample records are real ones from run 237."""

import json
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest
from arq import Retry
from pipecat.frames.frames import MetricsFrame
from pipecat.metrics.metrics import (
    LLMTokenUsage,
    LLMUsageMetricsData,
    TTFBMetricsData,
)
from pipecat.processors.frame_processor import FrameDirection, FrameProcessor
from pipecat.services.soniox.stt import SonioxSTTService

from api.services.configuration.registry import ServiceProviders
from api.services.pipecat.audio_config import AudioConfig
from api.services.pipecat.pipeline_metrics_aggregator import PipelineMetricsAggregator
from api.services.pipecat.service_factory import create_stt_service, create_tts_service
from api.services.pipecat.soniox_tts import TaggedSonioxTTSService
from api.services.provider_usage import soniox, sync, unreported
from api.services.provider_usage.exceptions import ProviderUsageAccessError
from api.services.provider_usage.reference import (
    format_run_reference,
    to_run_usage_context,
)
from api.services.provider_usage.soniox import (
    SonioxUsageFetcher,
    to_iso_utc,
    to_usage_record,
)
from api.services.provider_usage.summary import (
    to_billed_services,
    to_provider_usage_summary,
)
from api.services.provider_usage.sync import (
    MAX_WINDOW,
    WINDOW_MARGIN,
    list_provider_keys,
    sync_provider_usage_for_run,
    to_usage_window,
)
from api.services.provider_usage.types import RunUsageContext, SyncOutcome
from api.services.provider_usage.unreported import record_unreported_llm_requests
from api.services.workflow.usage_contract import (
    UsageServiceType,
    UsageSource,
    UsageStatus,
)
from api.tasks import provider_usage_sync

REFERENCE = "convozent-local-run-237"
START = datetime(2026, 11, 5, 7, 10, tzinfo=UTC)
END = datetime(2026, 11, 5, 8, 10, tzinfo=UTC)
COMPLETED = datetime(2026, 11, 5, 7, 13, tzinfo=UTC)

STT_ENTRY = {
    "uuid": "a354d2f4-5840-48d5-8430-b274bd74b1a6",
    "request_scope": "api",
    "client_reference_id": REFERENCE,
    "model": "stt-rt-v5",
    "input_text_tokens": 8,
    "input_audio_tokens": 866,
    "input_audio_duration_ms": 102678,
    "output_text_tokens": 141,
    "output_audio_tokens": 0,
    "output_audio_duration_ms": 0,
    "cost_usd": "0.0023280000",
    "input_text_cost_usd": "0.0000320000",
    "input_audio_cost_usd": "0.0017320000",
    "output_text_cost_usd": "0.0005640000",
    "output_audio_cost_usd": "0.0000000000",
}
TTS_ENTRY = {
    "uuid": "e8dd0d61-b10f-4632-8b3f-118587330fdc",
    "request_scope": "api",
    "client_reference_id": REFERENCE,
    "model": "tts-rt-v2",
    "input_text_tokens": 24,
    "input_audio_tokens": 0,
    "input_audio_duration_ms": 0,
    "output_text_tokens": 0,
    "output_audio_tokens": 50,
    "output_audio_duration_ms": 5888,
    "cost_usd": "0.0011710000",
    "input_text_cost_usd": "0.0000960000",
    "input_audio_cost_usd": "0.0000000000",
    "output_text_cost_usd": "0.0000000000",
    "output_audio_cost_usd": "0.0010750000",
}
OTHER_RUN_ENTRY = {**STT_ENTRY, "uuid": "other", "client_reference_id": ""}


def _mock_soniox(handler):
    original = httpx.AsyncClient

    def build(**kwargs):
        return original(transport=httpx.MockTransport(handler), **kwargs)

    return patch.object(soniox.httpx, "AsyncClient", build)


async def _list_records(handler):
    with _mock_soniox(handler):
        return await SonioxUsageFetcher().list_usage_records(
            api_key="key",
            client_reference_id=REFERENCE,
            start_time=START,
            end_time=END,
        )


def test_stt_record_keeps_billed_values_exactly():
    record = to_usage_record(STT_ENTRY)

    assert record.service_type == UsageServiceType.STT
    assert record.input_tokens == 874
    assert record.output_tokens == 141
    assert record.input_seconds == 102.678
    assert record.cost_usd == Decimal("0.002328")


def test_tts_record_keeps_billed_values_exactly():
    record = to_usage_record(TTS_ENTRY)

    assert record.service_type == UsageServiceType.TTS
    assert record.input_tokens == 24
    assert record.output_tokens == 50
    assert record.output_seconds == 5.888
    assert record.cost_usd == Decimal("0.001171")


def test_record_without_speech_model_is_skipped():
    assert to_usage_record({**STT_ENTRY, "model": "something-else"}) is None
    assert to_usage_record({**STT_ENTRY, "uuid": ""}) is None


def test_iso_time_is_utc_with_z_suffix():
    assert to_iso_utc(START) == "2026-11-05T07:10:00Z"


@pytest.mark.asyncio
async def test_fetcher_keeps_only_this_runs_records():
    def handler(request):
        return httpx.Response(
            200,
            json={"usage_logs": [STT_ENTRY, OTHER_RUN_ENTRY, TTS_ENTRY], "next_page_cursor": None},
        )

    records = await _list_records(handler)

    assert [r.request_id for r in records] == [STT_ENTRY["uuid"], TTS_ENTRY["uuid"]]


@pytest.mark.asyncio
async def test_fetcher_sends_the_window_and_bearer_key():
    seen = {}

    def handler(request):
        seen["auth"] = request.headers["authorization"]
        seen["start"] = request.url.params["start_time"]
        seen["end"] = request.url.params["end_time"]
        return httpx.Response(200, json={"usage_logs": []})

    await _list_records(handler)

    assert seen == {
        "auth": "Bearer key",
        "start": "2026-11-05T07:10:00Z",
        "end": "2026-11-05T08:10:00Z",
    }


@pytest.mark.asyncio
async def test_fetcher_follows_pages():
    cursors = []

    def handler(request):
        cursors.append(request.url.params.get("cursor"))
        if len(cursors) == 1:
            return httpx.Response(
                200, json={"usage_logs": [STT_ENTRY], "next_page_cursor": "page-2"}
            )
        return httpx.Response(200, json={"usage_logs": [TTS_ENTRY], "next_page_cursor": None})

    records = await _list_records(handler)

    assert cursors == [None, "page-2"]
    assert len(records) == 2


@pytest.mark.asyncio
async def test_fetcher_raises_on_rejected_key():
    with pytest.raises(ProviderUsageAccessError):
        await _list_records(lambda request: httpx.Response(401, json={}))


@pytest.mark.asyncio
async def test_fetcher_treats_a_server_error_as_temporary():
    with pytest.raises(httpx.HTTPStatusError):
        await _list_records(lambda request: httpx.Response(503, json={}))


def test_reference_names_environment_and_run():
    reference = format_run_reference(workflow_run_id=237)

    assert reference.startswith("convozent-")
    assert reference.endswith("-run-237")


def test_stt_config_carries_the_reference():
    user_config = MagicMock()
    user_config.stt.provider = ServiceProviders.SONIOX.value
    user_config.stt.model = "stt-rt-v5"
    user_config.stt.api_key = "key"
    audio_config = AudioConfig(transport_in_sample_rate=16000, transport_out_sample_rate=16000)

    service = create_stt_service(user_config, audio_config, client_reference_id=REFERENCE)

    assert service._settings.client_reference_id == REFERENCE


def test_tts_stream_config_carries_the_reference():
    user_config = MagicMock()
    user_config.tts.provider = ServiceProviders.SONIOX.value
    user_config.tts.model = "tts-rt-v2"
    user_config.tts.voice = "Bryce"
    user_config.tts.api_key = "key"
    user_config.tts.url = "wss://tts-rt.soniox.com/tts-websocket"
    user_config.tts.speed = 1.0
    audio_config = AudioConfig(transport_in_sample_rate=16000, transport_out_sample_rate=16000)

    service = create_tts_service(user_config, audio_config, client_reference_id=REFERENCE)

    config = json.loads(json.dumps(service._build_config_msg("stream-1")))
    assert config["client_reference_id"] == REFERENCE


def _context(reference=REFERENCE, stt="soniox", tts="soniox"):
    return RunUsageContext(reference=reference, stt_provider=stt, tts_provider=tts)


def _service_config(stt_key="key", tts_key="key"):
    return SimpleNamespace(
        stt=SimpleNamespace(api_key=stt_key), tts=SimpleNamespace(api_key=tts_key)
    )


def test_keys_are_listed_per_provider_without_repeats():
    keys = list_provider_keys(context=_context(), config=_service_config("same", "same"))

    assert keys == {"soniox": {"same"}}


def test_separate_stt_and_tts_keys_are_both_kept():
    keys = list_provider_keys(context=_context(), config=_service_config("one", "two"))

    assert keys == {"soniox": {"one", "two"}}


def test_provider_without_fetcher_is_ignored():
    context = _context(stt="deepgram", tts="cartesia")

    assert list_provider_keys(context=context, config=_service_config()) == {}


def test_context_reads_the_runtime_configuration():
    context = to_run_usage_context(
        initial_context={
            "runtime_configuration": {
                "provider_usage_reference": REFERENCE,
                "stt_provider": "soniox",
                "tts_provider": "sarvam",
            }
        }
    )

    assert context == RunUsageContext(REFERENCE, "soniox", "sarvam")


def test_context_survives_a_run_with_no_configuration():
    assert to_run_usage_context(initial_context=None) == RunUsageContext(None, None, None)


def test_window_stops_shortly_after_the_call_ended():
    start, end = to_usage_window(
        created_at=START, completed_at=COMPLETED, now=COMPLETED + timedelta(hours=1)
    )

    assert start == START
    assert end == COMPLETED + WINDOW_MARGIN


def test_window_never_reaches_past_now():
    now = COMPLETED + timedelta(seconds=30)

    assert to_usage_window(created_at=START, completed_at=COMPLETED, now=now)[1] == now


def test_window_stays_inside_the_provider_limit():
    late = START + timedelta(days=90)

    _, end = to_usage_window(created_at=START, completed_at=late, now=late)

    assert end == START + MAX_WINDOW


def _run(reference=REFERENCE):
    runtime = {"stt_provider": "soniox", "tts_provider": "soniox"}
    if reference:
        runtime["provider_usage_reference"] = reference
    return SimpleNamespace(
        created_at=START,
        initial_context={"runtime_configuration": runtime},
        workflow=SimpleNamespace(user_id=1, organization_id=1),
        definition=SimpleNamespace(workflow_configurations={}),
    )


def _patch_sync(run, fetched):
    db = MagicMock()
    db.get_workflow_run = AsyncMock(return_value=run)
    db.record_usage = AsyncMock()
    fetcher = MagicMock()
    fetcher.list_usage_records = fetched
    return db, _service_config(), fetcher


async def _sync(db, config, fetcher, *, is_last_attempt=False):
    with (
        patch.object(sync, "db_client", db),
        patch.object(sync, "get_usage_fetcher", return_value=fetcher),
        patch.object(
            sync,
            "get_effective_ai_model_configuration_for_workflow",
            AsyncMock(return_value=config),
        ),
    ):
        return await sync_provider_usage_for_run(
            workflow_run_id=237,
            completed_at=COMPLETED,
            is_last_attempt=is_last_attempt,
        )


@pytest.mark.asyncio
async def test_sync_saves_each_record_with_its_billed_cost():
    records = [to_usage_record(STT_ENTRY), to_usage_record(TTS_ENTRY)]
    db, config, fetcher = _patch_sync(_run(), AsyncMock(return_value=records))

    outcome = await _sync(db, config, fetcher)

    assert outcome == SyncOutcome(found=2, should_retry=True)
    saved = db.record_usage.await_args_list[0].kwargs
    assert saved["operation_id"] == f"soniox:{STT_ENTRY['uuid']}"
    assert saved["usage_source"] == UsageSource.PROVIDER_BILLED
    assert saved["provider_cost_usd"] == Decimal("0.002328")
    assert saved["usage_detail"] == STT_ENTRY


@pytest.mark.asyncio
async def test_sync_skips_runs_without_a_reference():
    db, config, fetcher = _patch_sync(_run(reference=None), AsyncMock())

    outcome = await _sync(db, config, fetcher)

    assert outcome == SyncOutcome(found=0, should_retry=False)
    fetcher.list_usage_records.assert_not_awaited()


@pytest.mark.asyncio
async def test_no_records_yet_keeps_retrying_and_writes_nothing():
    db, config, fetcher = _patch_sync(_run(), AsyncMock(return_value=[]))

    outcome = await _sync(db, config, fetcher)

    assert outcome.should_retry is True
    db.record_usage.assert_not_awaited()


@pytest.mark.asyncio
async def test_no_records_on_last_attempt_marks_unavailable():
    db, config, fetcher = _patch_sync(_run(), AsyncMock(return_value=[]))

    await _sync(db, config, fetcher, is_last_attempt=True)

    assert db.record_usage.await_args.kwargs["status"] == UsageStatus.UNAVAILABLE


@pytest.mark.asyncio
async def test_refused_key_stops_at_once_without_retrying():
    refused = ProviderUsageAccessError(provider="soniox", status_code=401)
    db, config, fetcher = _patch_sync(_run(), AsyncMock(side_effect=refused))

    outcome = await _sync(db, config, fetcher)

    assert outcome == SyncOutcome(found=0, should_retry=False)
    assert db.record_usage.await_args.kwargs["status"] == UsageStatus.UNAVAILABLE


@pytest.mark.asyncio
async def test_temporary_failure_retries_and_marks_nothing():
    failure = httpx.ConnectTimeout("slow")
    db, config, fetcher = _patch_sync(_run(), AsyncMock(side_effect=failure))

    outcome = await _sync(db, config, fetcher)

    assert outcome == SyncOutcome(found=0, should_retry=True)
    db.record_usage.assert_not_awaited()


@pytest.mark.asyncio
async def test_one_refused_key_does_not_lose_the_other_keys_records():
    refused = ProviderUsageAccessError(provider="soniox", status_code=403)
    record = to_usage_record(STT_ENTRY)
    fetched = AsyncMock(side_effect=[refused, [record]])
    db, _, fetcher = _patch_sync(_run(), fetched)

    outcome = await _sync(db, _service_config("one", "two"), fetcher)

    assert outcome.found == 1


@pytest.mark.asyncio
async def test_task_retries_until_the_last_pass():
    run_sync = AsyncMock(return_value=SyncOutcome(found=1, should_retry=True))
    with patch.object(provider_usage_sync, "sync_provider_usage_for_run", run_sync):
        with pytest.raises(Retry):
            await provider_usage_sync.sync_provider_usage(
                {"job_try": 1}, 237, COMPLETED.isoformat()
            )

        found = await provider_usage_sync.sync_provider_usage(
            {"job_try": provider_usage_sync.MAX_TRIES}, 237, COMPLETED.isoformat()
        )

    assert found == 1
    assert run_sync.await_args_list[0].kwargs["is_last_attempt"] is False
    assert run_sync.await_args_list[1].kwargs["is_last_attempt"] is True


@pytest.mark.asyncio
async def test_task_stops_when_a_retry_cannot_help():
    run_sync = AsyncMock(return_value=SyncOutcome(found=0, should_retry=False))
    with patch.object(provider_usage_sync, "sync_provider_usage_for_run", run_sync):
        found = await provider_usage_sync.sync_provider_usage(
            {"job_try": 1}, 237, COMPLETED.isoformat()
        )

    assert found == 0
    run_sync.assert_awaited_once()


def _billed_row(entry, status=UsageStatus.RECORDED.value):
    return SimpleNamespace(
        status=status,
        service_type=to_usage_record(entry).service_type.value,
        provider="soniox",
        model=entry["model"],
        input_units=entry["input_audio_duration_ms"] / 1000,
        output_units=entry["output_audio_duration_ms"] / 1000,
        provider_cost_usd=Decimal(entry["cost_usd"]),
        usage_detail=entry,
        usage_source=UsageSource.PROVIDER_BILLED.value,
        operation_id=f"soniox:{entry['uuid']}",
        input_tokens=to_usage_record(entry).input_tokens,
        output_tokens=to_usage_record(entry).output_tokens,
    )


def _unavailable_row():
    return SimpleNamespace(
        status=UsageStatus.UNAVAILABLE.value,
        provider="soniox",
        usage_detail=None,
        usage_source=UsageSource.PROVIDER_BILLED.value,
    )


def _unreported_row(requests):
    return SimpleNamespace(
        status=UsageStatus.UNAVAILABLE.value,
        provider=None,
        usage_detail={"requests": requests},
        usage_source=UsageSource.PROVIDER_UNREPORTED.value,
    )


def test_summary_adds_streams_of_one_model_exactly():
    second_stream = {**TTS_ENTRY, "uuid": "second"}

    services = to_billed_services([_billed_row(TTS_ENTRY), _billed_row(second_stream)])

    assert len(services) == 1
    assert services[0].request_count == 2
    assert services[0].input_text_tokens == 48
    assert services[0].output_audio_tokens == 100
    assert Decimal(services[0].cost_usd) == Decimal("0.002342")


def test_summary_matches_run_237_per_service():
    services = to_billed_services([_billed_row(STT_ENTRY), _billed_row(TTS_ENTRY)])

    assert sum(Decimal(s.cost_usd) for s in services) == Decimal("0.003499")


def test_summary_ignores_the_unavailable_marker():
    assert to_billed_services([_unavailable_row()]) == []


def test_status_is_pending_until_a_tracked_provider_reports():
    summary = to_provider_usage_summary(rows=[], context=_context())

    assert summary.status == "pending"
    assert summary.awaiting_providers == ["soniox"]


def test_status_is_billed_once_records_arrive():
    summary = to_provider_usage_summary(rows=[_billed_row(STT_ENTRY)], context=_context())

    assert summary.status == "billed"
    assert summary.awaiting_providers == []


def test_status_is_unavailable_after_the_provider_gives_up():
    summary = to_provider_usage_summary(rows=[_unavailable_row()], context=_context())

    assert summary.status == "unavailable"
    assert summary.awaiting_providers == []


def test_untracked_provider_never_shows_as_waiting():
    summary = to_provider_usage_summary(rows=[], context=_context(stt="sarvam", tts="sarvam"))

    assert summary.status == "none"
    assert summary.awaiting_providers == []


def test_old_run_without_a_reference_never_shows_as_waiting():
    summary = to_provider_usage_summary(rows=[], context=_context(reference=None))

    assert summary.status == "none"


def test_unreported_llm_requests_do_not_change_the_billing_status():
    summary = to_provider_usage_summary(rows=[_unreported_row(11)], context=_context())

    assert summary.status == "pending"
    assert summary.unreported_llm_requests == 11


def _ttfb(processor):
    return TTFBMetricsData(processor=processor, value=0.5)


def _llm_usage():
    tokens = LLMTokenUsage(prompt_tokens=1, completion_tokens=1, total_tokens=2)
    return LLMUsageMetricsData(processor="OpenAILLMService#1", model="m", value=tokens)


async def _process_metrics(*data):
    aggregator = PipelineMetricsAggregator()
    aggregator.push_frame = AsyncMock()
    with patch.object(FrameProcessor, "process_frame", AsyncMock()):
        await aggregator.process_frame(MetricsFrame(data=list(data)), FrameDirection.DOWNSTREAM)
    return aggregator


@pytest.mark.asyncio
async def test_cancelled_llm_replies_are_counted():
    aggregator = await _process_metrics(_ttfb("OpenAILLMService#1"), _ttfb("OpenAILLMService#1"))

    assert aggregator.get_unreported_llm_requests() == 2


@pytest.mark.asyncio
async def test_finished_llm_reply_is_not_counted():
    aggregator = await _process_metrics(_ttfb("OpenAILLMService#1"), _llm_usage())

    assert aggregator.get_unreported_llm_requests() == 0


@pytest.mark.asyncio
async def test_other_services_timing_is_not_counted_as_llm():
    aggregator = await _process_metrics(_ttfb("SonioxSTTService#1"), _ttfb("SonioxTTSService#1"))

    assert aggregator.get_unreported_llm_requests() == 0


@pytest.mark.asyncio
async def test_zero_unreported_requests_writes_nothing():
    db = MagicMock()
    db.record_usage = AsyncMock()
    with patch.object(unreported, "db_client", db):
        await record_unreported_llm_requests(workflow_run_id=237, requests=0)

    db.record_usage.assert_not_awaited()


@pytest.mark.asyncio
async def test_unreported_write_failure_never_breaks_the_call():
    db = MagicMock()
    db.record_usage = AsyncMock(side_effect=RuntimeError("db down"))
    with patch.object(unreported, "db_client", db):
        await record_unreported_llm_requests(workflow_run_id=237, requests=3)

    db.record_usage.assert_awaited_once()


@pytest.mark.asyncio
async def test_soniox_stt_sends_its_key_on_the_connection_only():
    service = SonioxSTTService(api_key="secret")
    websocket = AsyncMock()
    websocket.state = None
    service._websocket = None
    connect = AsyncMock(return_value=websocket)
    with patch("pipecat.services.soniox.stt.websocket_connect", connect):
        await service._connect_websocket()

    assert connect.await_args.kwargs["additional_headers"] == {"Authorization": "Bearer secret"}
    assert "api_key" not in json.loads(websocket.send.await_args.args[0])


def test_soniox_tts_stream_config_leaves_the_key_out():
    service = TaggedSonioxTTSService(api_key="secret")

    assert "api_key" not in service._build_config_msg("stream-1")


@pytest.mark.asyncio
async def test_soniox_tts_sends_its_key_on_the_connection():
    service = TaggedSonioxTTSService(api_key="secret")
    connect = AsyncMock(return_value=AsyncMock())
    with patch("pipecat.services.soniox.tts.websocket_connect", connect):
        await service._connect_websocket()

    assert connect.await_args.kwargs["additional_headers"] == {"Authorization": "Bearer secret"}
