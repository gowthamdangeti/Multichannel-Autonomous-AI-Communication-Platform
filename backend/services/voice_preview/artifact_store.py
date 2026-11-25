"""Store rendered preview audio through the configured storage backend.

The storage interface uploads from a local path (MinIO/S3 both do), so bytes
are spooled to a temp file that is always removed afterwards.
"""

from __future__ import annotations

import os
import tempfile

from api.services.storage import storage_fs
from api.services.voice_preview.exceptions import VoicePreviewRenderError


async def store_preview_audio(*, audio_key: str, data: bytes) -> None:
    """Upload ``data`` to ``audio_key``, raising if the backend rejects it."""
    handle, temp_path = tempfile.mkstemp(suffix=os.path.splitext(audio_key)[1])
    try:
        with os.fdopen(handle, "wb") as temp_file:
            temp_file.write(data)
        uploaded = await storage_fs.aupload_file(temp_path, audio_key)
    finally:
        try:
            os.unlink(temp_path)
        except OSError:  # pragma: no cover - best effort temp cleanup
            pass
    if not uploaded:
        raise VoicePreviewRenderError(
            "storage", f"Failed to store preview audio at {audio_key}"
        )
