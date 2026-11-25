"""Stop a WebRTC call's cleanup from freezing the whole server.

aiortc stops its decoder with an unbounded ``Thread.join()`` on the event loop.
If the decoder doesn't exit, every call and request in this process hangs for
good. We saw this happen on a real call, so the wait gets a limit here. A
leftover idle thread is a small leak; a frozen server is an outage.
"""

from threading import Thread

from aiortc.rtcrtpreceiver import RTCRtpReceiver
from loguru import logger

# Blocks the event loop, so it stays short. A healthy decoder exits at once.
DECODER_STOP_TIMEOUT_SECONDS = 0.25

_STOP_DECODER = "_RTCRtpReceiver__stop_decoder"
_DECODER_THREAD = "_RTCRtpReceiver__decoder_thread"
_DECODER_QUEUE = "_RTCRtpReceiver__decoder_queue"


def _stop_decoder_within_limit(receiver: RTCRtpReceiver) -> None:
    thread: Thread | None = getattr(receiver, _DECODER_THREAD, None)
    if thread is None:
        return
    decoder_queue = getattr(receiver, _DECODER_QUEUE)
    # A second stop signal costs nothing and covers a decoder that missed the first.
    for _ in range(2):
        decoder_queue.put(None)
        thread.join(timeout=DECODER_STOP_TIMEOUT_SECONDS)
        if not thread.is_alive():
            break
    if thread.is_alive():
        logger.error(f"WebRTC decoder thread {thread.name} did not stop; leaving it behind")
    setattr(receiver, _DECODER_THREAD, None)


def install_bounded_decoder_stop() -> None:
    """Replace aiortc's unbounded stop. Safe to call more than once."""
    if not hasattr(RTCRtpReceiver, _STOP_DECODER):
        # A new aiortc renamed the internals: warn and keep working as before.
        logger.warning("aiortc changed its decoder internals; bounded stop not installed")
        return
    setattr(RTCRtpReceiver, _STOP_DECODER, _stop_decoder_within_limit)
