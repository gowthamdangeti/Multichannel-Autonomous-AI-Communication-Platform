"""A stuck call must not freeze the server, and its run must still finish."""

import inspect
import queue
import threading
import time
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from aiortc import rtcrtpreceiver
from aiortc.rtcrtpreceiver import RTCRtpReceiver

from api.enums import WorkflowRunState
from api.services.pipecat import webrtc_cleanup
from api.services.pipecat.webrtc_cleanup import (
    install_bounded_decoder_stop,
)
from api.tasks import stuck_run_sweep
from api.tasks.function_names import FunctionNames
from api.tasks.stuck_run_sweep import (
    INTERRUPTED_DISPOSITION,
    MAX_RECOVERY_AGE,
    STALE_MARGIN,
    get_call_limit,
    is_past_call_limit,
    sweep_stuck_runs,
)

NOW = datetime(2026, 11, 5, 12, 0, tzinfo=UTC)


def _receiver(thread, decoder_queue):
    receiver = RTCRtpReceiver.__new__(RTCRtpReceiver)
    receiver._RTCRtpReceiver__decoder_thread = thread
    receiver._RTCRtpReceiver__decoder_queue = decoder_queue
    return receiver


def _stop(receiver):
    webrtc_cleanup._stop_decoder_within_limit(receiver)


def test_healthy_decoder_stops_normally():
    decoder_queue = queue.Queue()
    thread = threading.Thread(target=decoder_queue.get, daemon=True)
    thread.start()

    _stop(_receiver(thread, decoder_queue))

    assert not thread.is_alive()


def test_stuck_decoder_cannot_freeze_cleanup():
    release = threading.Event()
    thread = threading.Thread(target=release.wait, daemon=True)
    thread.start()
    receiver = _receiver(thread, queue.Queue())

    started = time.monotonic()
    _stop(receiver)
    elapsed = time.monotonic() - started
    release.set()

    assert elapsed < 2
    assert receiver._RTCRtpReceiver__decoder_thread is None


def test_decoder_that_missed_the_first_signal_gets_a_second():
    decoder_queue = MagicMock()
    thread = MagicMock()
    thread.is_alive.side_effect = [True, False, False]

    _stop(_receiver(thread, decoder_queue))

    assert decoder_queue.put.call_count == 2


def test_receiver_without_a_decoder_is_a_no_op():
    decoder_queue = MagicMock()

    _stop(_receiver(None, decoder_queue))

    decoder_queue.put.assert_not_called()


def test_aiortc_still_has_the_method_we_replace():
    source = inspect.getsource(rtcrtpreceiver)

    assert "__decoder_thread" in source
    assert "__decoder_queue" in source
    assert "def __stop_decoder" in source


def test_install_replaces_the_aiortc_stop():
    install_bounded_decoder_stop()

    assert (
        RTCRtpReceiver._RTCRtpReceiver__stop_decoder
        is webrtc_cleanup._stop_decoder_within_limit
    )


def _stuck_run(age, max_call_duration=None, run_id=238):
    configurations = {}
    if max_call_duration:
        configurations["max_call_duration"] = max_call_duration
    return SimpleNamespace(
        id=run_id,
        created_at=NOW - age,
        definition=SimpleNamespace(workflow_configurations=configurations),
    )


def test_default_call_limit_applies_without_configuration():
    run = SimpleNamespace(definition=None)

    assert get_call_limit(run=run) == timedelta(seconds=300)


def test_live_call_inside_its_limit_is_left_alone():
    run = _stuck_run(timedelta(minutes=20))

    assert is_past_call_limit(run=run, now=NOW) is False


def test_long_configured_call_is_left_alone():
    run = _stuck_run(timedelta(minutes=50), max_call_duration=3600)

    assert is_past_call_limit(run=run, now=NOW) is False


def test_run_past_its_limit_counts_as_stuck():
    run = _stuck_run(timedelta(minutes=40))

    assert is_past_call_limit(run=run, now=NOW) is True


async def _sweep(runs):
    db = MagicMock()
    db.list_stuck_runs = AsyncMock(return_value=runs)
    db.update_workflow_run = AsyncMock()
    enqueue = AsyncMock()
    frozen = MagicMock(wraps=datetime)
    frozen.now.return_value = NOW
    with (
        patch.object(stuck_run_sweep, "db_client", db),
        patch("api.tasks.arq.enqueue_job", enqueue),
        patch.object(stuck_run_sweep, "datetime", frozen),
    ):
        return await sweep_stuck_runs({}), db, enqueue


@pytest.mark.asyncio
async def test_sweep_closes_a_stuck_run_and_fetches_its_usage():
    result, db, enqueue = await _sweep([_stuck_run(timedelta(hours=1))])

    assert result == {"swept": 1}
    update = db.update_workflow_run.await_args.kwargs
    assert update["is_completed"] is True
    assert update["state"] == WorkflowRunState.COMPLETED.value
    assert update["gathered_context"] == {"call_disposition": INTERRUPTED_DISPOSITION}
    assert enqueue.await_args.args[0] == FunctionNames.SYNC_PROVIDER_USAGE
    assert enqueue.await_args.args[1] == 238


@pytest.mark.asyncio
async def test_sweep_never_touches_a_call_inside_its_limit():
    result, db, enqueue = await _sweep([_stuck_run(timedelta(minutes=35), max_call_duration=3600)])

    assert result == {"swept": 0}
    db.update_workflow_run.assert_not_awaited()
    enqueue.assert_not_awaited()


@pytest.mark.asyncio
async def test_sweep_never_starts_a_wallet_debit():
    _, _, enqueue = await _sweep([_stuck_run(timedelta(hours=1))])

    functions = [call.args[0] for call in enqueue.await_args_list]
    assert FunctionNames.DEBIT_WORKFLOW_RUN not in functions


@pytest.mark.asyncio
async def test_sweep_searches_only_recent_runs_past_the_margin():
    _, db, _ = await _sweep([])

    window = db.list_stuck_runs.await_args.kwargs
    assert window == {
        "started_before": NOW - STALE_MARGIN,
        "started_after": NOW - MAX_RECOVERY_AGE,
    }


@pytest.mark.asyncio
async def test_one_failed_run_does_not_stop_the_rest():
    runs = [_stuck_run(timedelta(hours=1), run_id=1), _stuck_run(timedelta(hours=1), run_id=2)]
    db = MagicMock()
    db.list_stuck_runs = AsyncMock(return_value=runs)
    db.update_workflow_run = AsyncMock(side_effect=[RuntimeError("db"), None])
    frozen = MagicMock(wraps=datetime)
    frozen.now.return_value = NOW
    with (
        patch.object(stuck_run_sweep, "db_client", db),
        patch("api.tasks.arq.enqueue_job", AsyncMock()),
        patch.object(stuck_run_sweep, "datetime", frozen),
    ):
        result = await sweep_stuck_runs({})

    assert result == {"swept": 1}
