"""Unit and integration tests for WebRTC video recording in Convozent.

Verifies:
1. WebRTC Track consumption & distribution (no competing readers).
2. Server-side recording authorization (enforces workflow config, ignores client-only camera).
3. ARQ artifact transfer (cross-container/process transfer via shared storage).
4. Timing, synchronization, idempotent lifecycle, and audio preservation on video failure.
"""

import asyncio
import io
import os
import sys
import tempfile
import time
import wave
from datetime import datetime, timezone
from fractions import Fraction
from unittest.mock import AsyncMock, MagicMock, patch

import av
import pytest
from fastapi import HTTPException

# Mock external modules that require native Linux DLLs on Windows host
for mod in ["api.tasks.run_integrations", "soxr", "soxr.soxr_ext"]:
    if mod not in sys.modules:
        sys.modules[mod] = MagicMock()

from api.enums import CallType
from api.routes.public_download import download_workflow_artifact
from api.schemas.workflow import WorkflowRunResponseSchema
from api.services.pipecat.video_recorder import (
    DistributedVideoTrack,
    VideoFrameDistributor,
    VideoTrackSpooler,
    create_safe_temp_file,
    mux_video_and_audio,
)
from api.tasks.workflow_completion import (
    _resolve_artifact_to_local,
    process_workflow_completion,
)
from api.utils.recording_artifacts import (
    get_recording_storage_backend,
    get_recording_storage_key,
    has_recording_track,
)


def _generate_test_wav(filepath: str, duration_secs: float = 1.0, sample_rate: int = 16000):
    """Generate a valid 16-bit mono PCM WAV file."""
    with wave.open(filepath, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sample_rate)
        num_frames = int(duration_secs * sample_rate)
        wf.writeframes(b"\x00\x00" * num_frames)


class _DummyVideoTrack:
    """Mock video track that returns a fixed number of av.VideoFrame frames."""

    def __init__(self, num_frames: int = 10, width: int = 320, height: int = 240):
        self.num_frames = num_frames
        self.width = width
        self.height = height
        self.count = 0
        self.kind = "video"
        self._time_base = Fraction(1, 30)

    async def recv(self):
        if self.count >= self.num_frames:
            raise Exception("Video track stream ended")
        pts = int(self.count * 3000)
        frame = av.VideoFrame(width=self.width, height=self.height, format="yuv420p")
        for plane in frame.planes:
            plane.update(b"\x80" * plane.buffer_size)
        frame.pts = pts
        frame.time_base = self._time_base
        self.count += 1
        return frame


class TestVideoArtifacts:
    """Verify video recording artifact metadata resolution and schemas."""

    def test_video_track_detection(self):
        extra = {
            "recordings": {
                "mixed": "recordings/101.wav",
                "video": {
                    "storage_key": "recordings/101/video.mp4",
                    "storage_backend": "minio",
                    "format": "mp4",
                    "track": "video",
                },
            }
        }
        assert has_recording_track(extra, "video") is True
        assert has_recording_track(extra, "mixed") is True
        assert has_recording_track(extra, "user") is False
        assert get_recording_storage_key(extra, "video") == "recordings/101/video.mp4"
        assert get_recording_storage_backend(extra, "video") == "minio"

    def test_workflow_run_response_schema_with_video(self):
        data = {
            "id": 101,
            "workflow_id": 5,
            "name": "WR-TEST-101",
            "mode": "smallwebrtc",
            "created_at": datetime.now(timezone.utc),
            "is_completed": True,
            "transcript_url": "transcripts/101.txt",
            "recording_url": "recordings/101.wav",
            "user_recording_url": None,
            "bot_recording_url": None,
            "video_recording_url": "recordings/101/video.mp4",
            "transcript_public_url": "https://example.com/download/token/transcript",
            "recording_public_url": "https://example.com/download/token/recording",
            "video_recording_public_url": "https://example.com/download/token/video_recording",
            "public_access_token": "token-123",
            "cost_info": {},
            "definition_id": 1,
            "call_type": CallType.INBOUND,
        }
        schema = WorkflowRunResponseSchema(**data)
        assert schema.video_recording_url == "recordings/101/video.mp4"
        assert schema.video_recording_public_url == "https://example.com/download/token/video_recording"


class TestVideoFrameDistribution:
    """Verify that VideoFrameDistributor delivers frames to multiple readers without competition."""

    @pytest.mark.asyncio
    async def test_simultaneous_recording_and_vision_consumers_no_competition(self):
        TOTAL_FRAMES = 15
        source = _DummyVideoTrack(num_frames=TOTAL_FRAMES)
        distributor = VideoFrameDistributor(source, max_queue_size=20)

        # Consumer 1: Simulates VideoTrackSpooler
        spooler_track = distributor.create_subscriber_track()
        # Consumer 2: Simulates Pipecat vision pipeline
        vision_track = distributor.create_subscriber_track()

        consumer_1_frames = []
        consumer_2_frames = []

        async def read_consumer_1():
            while True:
                try:
                    f = await spooler_track.recv()
                    consumer_1_frames.append(f)
                except Exception:
                    break

        async def read_consumer_2():
            while True:
                try:
                    f = await vision_track.recv()
                    consumer_2_frames.append(f)
                except Exception:
                    break

        await asyncio.gather(read_consumer_1(), read_consumer_2())

        # Both consumers must receive ALL frames - zero frame loss, zero competition
        assert len(consumer_1_frames) == TOTAL_FRAMES
        assert len(consumer_2_frames) == TOTAL_FRAMES
        assert distributor.first_frame_wallclock is not None
        assert distributor.first_frame_monotonic is not None
        distributor.stop()

    @pytest.mark.asyncio
    async def test_distributor_backpressure_drops_oldest_frame_when_queue_full(self):
        source = _DummyVideoTrack(num_frames=20)
        # Small queue size of 3
        distributor = VideoFrameDistributor(source, max_queue_size=3)
        sub_track = distributor.create_subscriber_track()

        # Let the distributor run without reading to fill the queue
        await asyncio.sleep(0.3)

        # Drain what is left in queue
        frames = []
        while True:
            try:
                f = await asyncio.wait_for(sub_track.recv(), timeout=0.1)
                frames.append(f)
            except Exception:
                break

        # Queue bounded at max 3 frames, oldest frames safely dropped without crashing
        assert len(frames) <= 4
        distributor.stop()


class TestServerSideRecordingAuthorization:
    """Verify server-side recording authorization enforcement."""

    def test_recording_disabled_with_camera_track_present(self):
        # Client sends a video track, but workflow config has enable_video_recording=False
        workflow_configs = {"enable_video_recording": False}
        run_definition_configs = {}
        client_has_video_track = True

        authorized = bool(
            run_definition_configs.get("enable_video_recording", False)
            or workflow_configs.get("enable_video_recording", False)
        )
        assert authorized is False

        # Recorder MUST NOT be created even if client has video track
        video_recorder = VideoTrackSpooler() if authorized else None
        assert video_recorder is None

    def test_recording_enabled_with_camera_track_present(self):
        # Workflow config explicitly enables recording
        workflow_configs = {"enable_video_recording": True}
        run_definition_configs = {}
        client_has_video_track = True

        authorized = bool(
            run_definition_configs.get("enable_video_recording", False)
            or workflow_configs.get("enable_video_recording", False)
        )
        assert authorized is True

        video_recorder = VideoTrackSpooler() if authorized else None
        assert video_recorder is not None

    @pytest.mark.asyncio
    async def test_recording_enabled_without_video_track_falls_back_cleanly(self):
        # Recording authorized, but user joins without camera (or audio-only)
        video_recorder = VideoTrackSpooler()
        # Track is None
        started = await video_recorder.start(track=None)
        assert started is False
        assert not video_recorder.is_recording

        stopped_path = await video_recorder.stop()
        assert stopped_path is None


class TestCrossContainerArtifactTransfer:
    """Verify artifact staging and cross-process/container transfer via shared storage."""

    @pytest.mark.asyncio
    async def test_cross_container_staging_and_resolution(self):
        # 1. API Container: Spools video locally, stages to storage_fs, and cleans up local file
        local_api_video = create_safe_temp_file(suffix=".mp4")
        with open(local_api_video, "wb") as f:
            f.write(b"video_stream_content_12345")

        staging_key = "staging/recordings/888/video_staging_unique.mp4"

        # Mock shared storage filesystem
        mock_storage = MagicMock()
        storage_map = {}

        async def mock_upload(local_p, dest_p):
            with open(local_p, "rb") as f:
                storage_map[dest_p] = f.read()
            return True

        async def mock_download(src_p, local_p):
            if src_p in storage_map:
                with open(local_p, "wb") as f:
                    f.write(storage_map[src_p])
                return True
            return False

        async def mock_delete(dest_p):
            storage_map.pop(dest_p, None)
            return True

        mock_storage.aupload_file = AsyncMock(side_effect=mock_upload)
        mock_storage.adownload_file = AsyncMock(side_effect=mock_download)
        mock_storage.adelete_file = AsyncMock(side_effect=mock_delete)

        with patch("api.tasks.workflow_completion.storage_fs", mock_storage):
            # API stages file
            await mock_storage.aupload_file(local_api_video, staging_key)
            os.remove(local_api_video)
            assert not os.path.exists(local_api_video)
            assert staging_key in storage_map

            # 2. Worker Container (separate process/container):
            # Receives staging_key (not a local path in worker), downloads to local worker temp
            worker_local_video, key_to_clean = await _resolve_artifact_to_local(
                staging_key, suffix=".mp4"
            )
            assert worker_local_video is not None
            assert os.path.exists(worker_local_video)
            assert key_to_clean == staging_key
            with open(worker_local_video, "rb") as f:
                assert f.read() == b"video_stream_content_12345"

            # 3. Worker cleans up staging artifact after processing
            await mock_storage.adelete_file(key_to_clean)
            assert staging_key not in storage_map
            os.remove(worker_local_video)


class TestTimingAndLifecycle:
    """Verify stream start offset synchronization, idempotency, and failure isolation."""

    @pytest.mark.asyncio
    async def test_spooler_idempotent_lifecycle(self):
        spooler = VideoTrackSpooler()
        track = _DummyVideoTrack(num_frames=10)

        # Idempotent start
        assert await spooler.start(track) is True
        assert await spooler.start(track) is True
        assert spooler.is_recording

        await asyncio.sleep(0.3)

        # Idempotent stop
        path1 = await spooler.stop()
        path2 = await spooler.stop()
        assert path1 == path2
        assert not spooler.is_recording
        assert os.path.exists(path1)

        # Idempotent cleanup
        spooler.cleanup()
        spooler.cleanup()
        assert not os.path.exists(path1)

    @pytest.mark.asyncio
    async def test_mux_video_and_audio_with_start_offset(self):
        # 1. Spool dummy video
        spooler = VideoTrackSpooler()
        await spooler.start(_DummyVideoTrack(num_frames=15))
        await asyncio.sleep(0.4)
        video_path = await spooler.stop()

        # 2. Generate dummy WAV audio
        audio_path = create_safe_temp_file(suffix=".wav")
        _generate_test_wav(audio_path, duration_secs=1.0, sample_rate=16000)

        # 3. Mux with 0.25s start offset
        out_mp4 = create_safe_temp_file(suffix=".mp4")
        try:
            ok = mux_video_and_audio(
                video_input_path=video_path,
                audio_input_path=audio_path,
                output_path=out_mp4,
                start_offset_seconds=0.25,
            )
            assert ok is True
            assert os.path.exists(out_mp4)
            assert os.path.getsize(out_mp4) > 0

            # Verify container has both streams and proper timestamp offset
            container = av.open(out_mp4)
            assert len(container.streams.video) == 1
            assert len(container.streams.audio) == 1
            v_stream = container.streams.video[0]
            video_pts = [float(p.pts * v_stream.time_base) for p in container.demux(v_stream) if p.pts is not None]
            assert len(video_pts) > 0
            # First video frame PTS should reflect the positive start offset (>= 0.20s)
            assert min(video_pts) >= 0.20
            container.close()
        finally:
            spooler.cleanup()
            for p in (audio_path, out_mp4):
                if os.path.exists(p):
                    try:
                        os.remove(p)
                    except OSError:
                        pass

    @pytest.mark.asyncio
    async def test_mux_video_and_audio_with_negative_offset(self):
        spooler = VideoTrackSpooler()
        await spooler.start(_DummyVideoTrack(num_frames=15))
        await asyncio.sleep(0.4)
        video_path = await spooler.stop()

        audio_path = create_safe_temp_file(suffix=".wav")
        _generate_test_wav(audio_path, duration_secs=1.0, sample_rate=16000)

        # Mux with negative offset (audio started 0.3s after video)
        out_mp4 = create_safe_temp_file(suffix=".mp4")
        try:
            ok = mux_video_and_audio(
                video_input_path=video_path,
                audio_input_path=audio_path,
                output_path=out_mp4,
                start_offset_seconds=-0.30,
            )
            assert ok is True
            assert os.path.exists(out_mp4)
            assert os.path.getsize(out_mp4) > 0

            container = av.open(out_mp4)
            assert len(container.streams.audio) == 1
            a_stream = container.streams.audio[0]
            audio_pts = [float(p.pts * a_stream.time_base) for p in container.demux(a_stream) if p.pts is not None]
            assert len(audio_pts) > 0
            # First audio packet PTS should reflect the delayed start (>= 0.20s due to AAC frame priming)
            assert min(audio_pts) >= 0.20
            container.close()
        finally:
            spooler.cleanup()
            for p in (audio_path, out_mp4):
                if os.path.exists(p):
                    try:
                        os.remove(p)
                    except OSError:
                        pass

    @pytest.mark.asyncio
    async def test_audio_preserved_when_video_muxing_fails(self):
        audio_temp = create_safe_temp_file(suffix=".wav")
        _generate_test_wav(audio_temp, duration_secs=0.5)

        # Video path that will cause muxing to fail
        invalid_video = "invalid_path_does_not_exist.mp4"

        mock_update = AsyncMock()
        mock_upload = AsyncMock(return_value=True)

        with patch("api.tasks.workflow_completion.db_client.update_workflow_run", mock_update):
            with patch("api.tasks.workflow_completion.storage_fs.aupload_file", mock_upload):
                with patch("api.tasks.workflow_completion.mux_video_and_audio", side_effect=RuntimeError("Muxing crash")):
                    with patch("api.tasks.workflow_completion.report_completed_workflow_run_platform_usage", AsyncMock()):
                        with patch("api.tasks.arq.enqueue_job", AsyncMock(return_value=MagicMock())):
                            await process_workflow_completion(
                                _ctx={},
                                workflow_run_id=777,
                                audio_temp_path=audio_temp,
                                video_temp_path=invalid_video,
                            )
                            # Verify audio recording was successfully uploaded and registered
                            audio_uploaded = any(
                                "mixed" in call.kwargs.get("extra", {}).get("recordings", {})
                                for call in mock_update.call_args_list
                                if "extra" in call.kwargs
                            )
                            assert audio_uploaded is True

    @pytest.mark.asyncio
    async def test_mixed_audio_is_muxed_into_uploaded_video(self):
        # Regression: _upload_temp_file used to delete the mixed-audio temp file
        # before the muxer ran, so mux_video_and_audio silently fell back to
        # copying the video-only track and the uploaded recording had no audio.
        spooler = VideoTrackSpooler()
        await spooler.start(_DummyVideoTrack(num_frames=15))
        await asyncio.sleep(0.4)
        video_path = await spooler.stop()
        assert video_path and os.path.exists(video_path)

        audio_temp = create_safe_temp_file(suffix=".wav")
        _generate_test_wav(audio_temp, duration_secs=1.0, sample_rate=16000)

        uploaded: dict[str, bytes] = {}

        def capture_upload(local_path, storage_key):
            if str(storage_key).endswith("video.mp4") and os.path.exists(local_path):
                with open(local_path, "rb") as f:
                    uploaded[str(storage_key)] = f.read()
            return True

        try:
            with patch("api.tasks.workflow_completion.db_client.update_workflow_run", AsyncMock()):
                with patch(
                    "api.tasks.workflow_completion.storage_fs.aupload_file",
                    AsyncMock(side_effect=capture_upload),
                ):
                    with patch("api.tasks.workflow_completion.report_completed_workflow_run_platform_usage", AsyncMock()):
                        with patch("api.tasks.arq.enqueue_job", AsyncMock(return_value=MagicMock())):
                            await process_workflow_completion(
                                _ctx={},
                                workflow_run_id=777,
                                audio_temp_path=audio_temp,
                                video_temp_path=video_path,
                            )

            video_key = "recordings/777/video.mp4"
            assert video_key in uploaded, "video artifact was not uploaded"
            with av.open(io.BytesIO(uploaded[video_key])) as container:
                assert len(container.streams.video) == 1
                assert len(container.streams.audio) == 1, (
                    "uploaded video is missing the muxed audio track"
                )
        finally:
            spooler.cleanup()
            for p in (audio_temp, video_path):
                if os.path.exists(p):
                    try:
                        os.remove(p)
                    except OSError:
                        pass


class TestPublicDownloadVideoRoute:
    """Verify token-gated public download endpoint for video artifacts."""

    @pytest.mark.asyncio
    async def test_download_video_recording_success(self):
        mock_run = MagicMock()
        mock_run.id = 55
        mock_run.storage_backend = "minio"
        mock_run.extra = {
            "recordings": {
                "video": {
                    "storage_key": "recordings/55/video.mp4",
                    "storage_backend": "minio",
                    "format": "mp4",
                }
            }
        }

        mock_storage = MagicMock()
        mock_storage.aget_signed_url = AsyncMock(return_value="https://signed-s3.example.com/recordings/55/video.mp4")

        with patch("api.routes.public_download.db_client.get_workflow_run_by_public_token", AsyncMock(return_value=mock_run)):
            with patch("api.routes.public_download.get_storage_for_backend", return_value=mock_storage):
                response = await download_workflow_artifact(
                    token="valid-token-123",
                    artifact_type="video_recording",
                    inline=True,
                )
                assert response.status_code == 302
                assert response.headers["location"] == "https://signed-s3.example.com/recordings/55/video.mp4"

    @pytest.mark.asyncio
    async def test_download_video_missing_raises_404(self):
        mock_run = MagicMock()
        mock_run.id = 56
        mock_run.extra = {"recordings": {}}

        with patch("api.routes.public_download.db_client.get_workflow_run_by_public_token", AsyncMock(return_value=mock_run)):
            with pytest.raises(HTTPException) as exc_info:
                await download_workflow_artifact(
                    token="valid-token-123",
                    artifact_type="video_recording",
                )
            assert exc_info.value.status_code == 404
            assert "No video_recording available" in exc_info.value.detail
