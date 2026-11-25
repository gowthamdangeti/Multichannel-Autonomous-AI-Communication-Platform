"""Normalize synthesized preview audio to MP3.

Providers return different containers (OpenAI/Deepgram/Google/Soniox: Ogg Opus,
Cartesia: MP3, Sarvam: base64 WAV). MP3 is the one container every browser —
including Safari — plays, so previews are transcoded before they are stored.
When ffmpeg is unavailable the original bytes are kept.
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass

from loguru import logger

MP3_CONTENT_TYPE = "audio/mpeg"
MP3_EXTENSION = "mp3"
_MP3_MAGIC_SYNC = (b"ID3", b"\xff\xfb", b"\xff\xf3", b"\xff\xf2")


@dataclass(frozen=True)
class PreviewAudio:
    """Audio bytes plus the container metadata needed to store them."""

    data: bytes
    content_type: str
    extension: str


def _looks_like_mp3(data: bytes) -> bool:
    return data[:3] in _MP3_MAGIC_SYNC[:1] or data[:2] in _MP3_MAGIC_SYNC[1:]


async def _run_ffmpeg_mp3(audio_bytes: bytes) -> bytes | None:
    proc = await asyncio.create_subprocess_exec(
        "ffmpeg",
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        "pipe:0",
        "-c:a",
        "libmp3lame",
        "-b:a",
        "128k",
        "-ac",
        "1",
        "-f",
        "mp3",
        "pipe:1",
        stdin=asyncio.subprocess.PIPE,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    stdout, stderr = await proc.communicate(input=audio_bytes)
    if proc.returncode == 0 and stdout:
        return stdout
    logger.warning(
        f"Voice preview ffmpeg transcode failed (code {proc.returncode}): "
        f"{stderr.decode(errors='replace').strip()[:200]}"
    )
    return None


async def normalize_preview_audio(audio_bytes: bytes) -> PreviewAudio:
    """Return MP3 bytes when possible, otherwise the provider's raw output."""
    if not audio_bytes:
        return PreviewAudio(b"", MP3_CONTENT_TYPE, MP3_EXTENSION)
    if _looks_like_mp3(audio_bytes):
        return PreviewAudio(audio_bytes, MP3_CONTENT_TYPE, MP3_EXTENSION)

    try:
        converted = await _run_ffmpeg_mp3(audio_bytes)
    except FileNotFoundError:
        logger.warning(
            "ffmpeg not found; storing the provider's raw preview audio instead"
        )
        return PreviewAudio(audio_bytes, "audio/ogg", "ogg")
    except Exception as exc:  # pragma: no cover - defensive: ffmpeg blew up
        logger.warning(f"Voice preview ffmpeg error: {exc}")
        return PreviewAudio(audio_bytes, "audio/ogg", "ogg")

    if not converted:
        return PreviewAudio(audio_bytes, "audio/ogg", "ogg")
    return PreviewAudio(converted, MP3_CONTENT_TYPE, MP3_EXTENSION)
