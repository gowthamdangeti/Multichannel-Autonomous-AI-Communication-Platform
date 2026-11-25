"""Soniox TTS that tags each stream, so its usage can be traced to a run.

Soniox bills per stream and reads ``client_reference_id`` from each stream's
config message. Pipecat's service has no option for it.
"""

from typing import Any

from pipecat.services.soniox.tts import SonioxTTSService


class TaggedSonioxTTSService(SonioxTTSService):
    def __init__(self, *args, client_reference_id: str | None = None, **kwargs):
        super().__init__(*args, **kwargs)
        self._client_reference_id = client_reference_id

    def _build_config_msg(self, context_id: str) -> dict[str, Any]:
        config = super()._build_config_msg(context_id)
        if self._client_reference_id:
            config["client_reference_id"] = self._client_reference_id
        return config
