"""Video recording, track distribution, and muxing utilities for WebRTC sessions in Convozent."""

import asyncio
import os
import shutil
import subprocess
import tempfile
import time
from typing import Optional

from aiortc.mediastreams import MediaStreamError, MediaStreamTrack
from loguru import logger


def create_safe_temp_file(suffix: str = ".mp4") -> str:
    """Safely create an empty temporary file and close its descriptor."""
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tf:
        return tf.name


class DistributedVideoTrack(MediaStreamTrack):
    """A subscriber video track receiving frames from a central VideoFrameDistributor."""

    kind = "video"

    def __init__(self, distributor: "VideoFrameDistributor", queue: asyncio.Queue):
        super().__init__()
        self._distributor = distributor
        self._queue = queue
        self._is_stopped = False

    async def recv(self):
        """Receive the next frame from the subscriber queue."""
        if self._is_stopped or self.readyState == "ended":
            raise MediaStreamError("Video track ended")

        frame = await self._queue.get()
        if frame is None:
            self._is_stopped = True
            raise MediaStreamError("Video stream finished")
        return frame

    def stop(self):
        """Stop this subscriber track and unregister from distributor."""
        if not self._is_stopped:
            self._is_stopped = True
            super().stop()
            self._distributor.unsubscribe(self._queue)


class VideoFrameDistributor:
    """Reads frames once from a source WebRTC video track and distributes to multiple consumers.

    Ensures that simultaneous consumers (e.g. video recording spooler and Pipecat vision pipeline)
    never compete for frames from the underlying aiortc/SmallWebRTC track.
    Implements backpressure handling via bounded queues with oldest-frame-drop policy.
    """

    def __init__(self, source_track, max_queue_size: int = 30):
        self._source_track = source_track
        self._max_queue_size = max_queue_size
        self._subscribers: list[asyncio.Queue] = []
        self._reader_task: Optional[asyncio.Task] = None
        self._is_running: bool = False
        self._first_frame_wallclock: Optional[float] = None
        self._first_frame_monotonic: Optional[float] = None

    @property
    def first_frame_wallclock(self) -> Optional[float]:
        return self._first_frame_wallclock

    @property
    def first_frame_monotonic(self) -> Optional[float]:
        return self._first_frame_monotonic

    def create_subscriber_track(self) -> DistributedVideoTrack:
        """Create and register a new independent subscriber track."""
        queue: asyncio.Queue = asyncio.Queue(maxsize=self._max_queue_size)
        self._subscribers.append(queue)
        if not self._is_running:
            self.start()
        return DistributedVideoTrack(self, queue)

    def unsubscribe(self, queue: asyncio.Queue):
        """Unregister a subscriber queue."""
        if queue in self._subscribers:
            self._subscribers.remove(queue)
        if not self._subscribers and self._is_running:
            self.stop()

    def start(self):
        """Start the central track reader loop."""
        if self._is_running:
            return
        self._is_running = True
        self._reader_task = asyncio.create_task(self._reader_loop())

    async def _reader_loop(self):
        """Single reader loop pulling frames from the underlying source track."""
        logger.debug("Starting VideoFrameDistributor reader loop")
        try:
            while self._is_running:
                try:
                    frame = await self._source_track.recv()
                except (MediaStreamError, Exception) as e:
                    logger.debug(f"Source video track ended or raised in reader loop: {e}")
                    break

                if frame is None:
                    continue

                if self._first_frame_wallclock is None:
                    self._first_frame_wallclock = time.time()
                    self._first_frame_monotonic = time.monotonic()
                    logger.debug(
                        f"First video frame received at wallclock={self._first_frame_wallclock}, "
                        f"mono={self._first_frame_monotonic}"
                    )

                # Broadcast to all registered subscribers
                for q in list(self._subscribers):
                    if q.full():
                        try:
                            # Drop oldest frame to avoid unbounded buffering latency
                            q.get_nowait()
                        except asyncio.QueueEmpty:
                            pass
                    try:
                        q.put_nowait(frame)
                    except asyncio.QueueFull:
                        pass
        except asyncio.CancelledError:
            pass
        finally:
            self._is_running = False
            # Signal stream completion to all subscribers
            for q in list(self._subscribers):
                try:
                    q.put_nowait(None)
                except (asyncio.QueueFull, Exception):
                    pass
            logger.debug("VideoFrameDistributor reader loop terminated")

    def stop(self):
        """Stop the distributor and clean up background tasks."""
        if not self._is_running and not self._reader_task:
            return
        self._is_running = False
        if self._reader_task and not self._reader_task.done():
            self._reader_task.cancel()
        self._reader_task = None
        for q in list(self._subscribers):
            try:
                q.put_nowait(None)
            except Exception:
                pass
        self._subscribers.clear()


class VideoTrackSpooler:
    """Spools a WebRTC VideoStreamTrack directly to an MP4 container on disk.

    Avoids storing uncompressed frames in memory by leveraging aiortc's MediaRecorder
    to encode and write video packets directly to disk.
    Lifecycle operations (start, stop, cleanup) are fully idempotent.
    """

    def __init__(self, custom_temp_path: Optional[str] = None):
        self._temp_path: Optional[str] = custom_temp_path
        self._recorder = None
        self._is_recording: bool = False
        self._distributor: Optional[VideoFrameDistributor] = None
        self._subscriber_track: Optional[DistributedVideoTrack] = None
        self._first_frame_monotonic: Optional[float] = None
        self._first_frame_wallclock: Optional[float] = None

    @property
    def is_recording(self) -> bool:
        return self._is_recording

    @property
    def temp_path(self) -> Optional[str]:
        return self._temp_path

    @property
    def first_frame_monotonic(self) -> Optional[float]:
        if self._distributor and self._distributor.first_frame_monotonic is not None:
            return self._distributor.first_frame_monotonic
        return self._first_frame_monotonic

    @property
    def first_frame_wallclock(self) -> Optional[float]:
        if self._distributor and self._distributor.first_frame_wallclock is not None:
            return self._distributor.first_frame_wallclock
        return self._first_frame_wallclock

    async def start(self, track, distributor: Optional[VideoFrameDistributor] = None) -> bool:
        """Start spooling the incoming video track to a secure temp file."""
        if self._is_recording:
            logger.debug("VideoTrackSpooler is already recording (idempotent start)")
            return True

        if not track:
            logger.warning("No video track provided to VideoTrackSpooler")
            return False

        try:
            from aiortc.contrib.media import MediaRecorder

            if not self._temp_path:
                self._temp_path = create_safe_temp_file(suffix=".mp4")

            self._distributor = distributor
            record_track = track
            if self._distributor:
                self._subscriber_track = self._distributor.create_subscriber_track()
                record_track = self._subscriber_track

            logger.info(f"Starting VideoTrackSpooler output to {self._temp_path}")
            self._recorder = MediaRecorder(self._temp_path, format="mp4")
            self._recorder.addTrack(record_track)
            await self._recorder.start()
            self._is_recording = True
            self._first_frame_monotonic = time.monotonic()
            self._first_frame_wallclock = time.time()
            return True
        except Exception as e:
            logger.error(f"Failed to start VideoTrackSpooler: {e}", exc_info=True)
            self._is_recording = False
            return False

    async def stop(self) -> Optional[str]:
        """Stop recording and return the path to the spooled video file (idempotent)."""
        if not self._is_recording:
            return self._temp_path if (self._temp_path and os.path.exists(self._temp_path)) else None

        self._is_recording = False
        try:
            if self._recorder:
                logger.info(f"Stopping VideoTrackSpooler for {self._temp_path}")
                await self._recorder.stop()
        except Exception as e:
            logger.warning(f"Error stopping VideoTrackSpooler MediaRecorder: {e}")
        finally:
            self._recorder = None
            if self._subscriber_track:
                self._subscriber_track.stop()
                self._subscriber_track = None
            if self._distributor:
                self._distributor.stop()
                self._distributor = None

        if self._temp_path and os.path.exists(self._temp_path):
            file_size = os.path.getsize(self._temp_path)
            logger.info(f"VideoTrackSpooler finished: {self._temp_path} ({file_size} bytes)")
            if file_size > 0:
                return self._temp_path
            else:
                self.cleanup()
        return None

    def cleanup(self):
        """Remove temp file if it still exists (idempotent)."""
        if self._temp_path and os.path.exists(self._temp_path):
            try:
                os.remove(self._temp_path)
            except OSError:
                pass
        self._temp_path = None


def mux_video_and_audio(
    video_input_path: str,
    audio_input_path: str,
    output_path: str,
    start_offset_seconds: float = 0.0,
) -> bool:
    """Mux a video track (H.264) and audio track (WAV/PCM) into a single playable MP4 container.

    Aligns audio and video presentation timestamps based on start_offset_seconds.
    Tries system ffmpeg first (lossless remux). If ffmpeg is unavailable,
    falls back to PyAV for in-process remuxing.
    """
    if not os.path.exists(video_input_path):
        logger.warning(f"Video input file not found: {video_input_path}")
        return False

    if not os.path.exists(audio_input_path):
        logger.warning(
            f"Audio input file not found: {audio_input_path}, copying video-only"
        )
        try:
            shutil.copyfile(video_input_path, output_path)
            return True
        except Exception as e:
            logger.error(f"Failed to copy video-only file: {e}")
            return False

    # Strategy 1: System FFmpeg
    ffmpeg_bin = shutil.which("ffmpeg")
    if ffmpeg_bin:
        cmd = [ffmpeg_bin, "-y"]

        # Apply start offset alignment if significant (> 30ms)
        if start_offset_seconds > 0.03:
            # Video started after audio: delay video PTS
            cmd.extend(["-itsoffset", f"{start_offset_seconds:.3f}", "-i", video_input_path, "-i", audio_input_path])
        elif start_offset_seconds < -0.03:
            # Audio started after video: delay audio PTS
            cmd.extend(["-i", video_input_path, "-itsoffset", f"{-start_offset_seconds:.3f}", "-i", audio_input_path])
        else:
            cmd.extend(["-i", video_input_path, "-i", audio_input_path])

        cmd.extend([
            "-c:v", "copy",
            "-c:a", "aac",
            "-b:a", "128k",
            "-movflags", "+faststart",
            output_path,
        ])
        try:
            logger.debug(f"Running ffmpeg muxing (offset={start_offset_seconds:.3f}s): {' '.join(cmd)}")
            subprocess.run(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                check=True,
                timeout=120,
            )
            if os.path.exists(output_path) and os.path.getsize(output_path) > 0:
                logger.info(
                    f"FFmpeg muxing succeeded: {output_path} ({os.path.getsize(output_path)} bytes)"
                )
                return True
        except Exception as e:
            logger.warning(f"FFmpeg subprocess failed ({e}), falling back to PyAV")

    # Strategy 2: PyAV in-process fallback
    try:
        import av

        input_v = av.open(video_input_path)
        input_a = av.open(audio_input_path)
        output = av.open(output_path, mode="w", format="mp4")

        in_v = input_v.streams.video[0] if input_v.streams.video else None
        if not in_v:
            logger.error("No video stream found in video input file")
            input_v.close()
            input_a.close()
            output.close()
            return False

        out_v = output.add_stream_from_template(in_v)
        in_a = input_a.streams.audio[0] if input_a.streams.audio else None
        out_a = None
        if in_a:
            out_a = output.add_stream("aac", rate=16000, layout="mono")

        # Copy video packets with offset alignment
        v_offset_pts = (
            int(start_offset_seconds / in_v.time_base)
            if (start_offset_seconds > 0.03 and in_v.time_base)
            else 0
        )
        for packet in input_v.demux(in_v):
            if packet.dts is None:
                continue
            packet.stream = out_v
            if v_offset_pts > 0:
                if packet.pts is not None:
                    packet.pts += v_offset_pts
                if packet.dts is not None:
                    packet.dts += v_offset_pts
            output.mux(packet)

        # Transcode audio packets to AAC with offset alignment
        a_offset_sec = -start_offset_seconds if start_offset_seconds < -0.03 else 0.0
        if in_a and out_a:
            for frame in input_a.decode(in_a):
                if a_offset_sec > 0 and frame.pts is not None and frame.time_base:
                    frame.pts += int(a_offset_sec / frame.time_base)
                for packet in out_a.encode(frame):
                    output.mux(packet)
            for packet in out_a.encode(None):
                output.mux(packet)

        output.close()
        input_v.close()
        input_a.close()

        if os.path.exists(output_path) and os.path.getsize(output_path) > 0:
            logger.info(
                f"PyAV muxing succeeded: {output_path} ({os.path.getsize(output_path)} bytes)"
            )
            return True
        return False
    except Exception as e:
        logger.error(f"PyAV muxing failed: {e}", exc_info=True)
        return False
