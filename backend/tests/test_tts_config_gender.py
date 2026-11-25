"""The Voice Gender chosen in the UI is stored with the TTS config.

Custom voice IDs (e.g. a Soniox voice typed in by hand) carry no gender of their
own, so the form needs the saved value to show the right gender after a reload.
"""

import pytest
from pydantic import ValidationError

from api.schemas.ai_model_configuration import OrganizationAIModelConfigurationV2


def _config(tts_extra: dict) -> dict:
    return {
        "version": 2,
        "mode": "byok",
        "byok": {
            "mode": "pipeline",
            "pipeline": {
                "llm": {"provider": "openai", "api_key": ["k"], "model": "gpt-4o"},
                "tts": {
                    "provider": "soniox",
                    "api_key": ["k"],
                    "model": "tts-rt-v2",
                    "voice": "divya",
                    "language": "te",
                    **tts_extra,
                },
                "stt": {"provider": "soniox", "api_key": ["k"], "model": "stt-rt-v5"},
            },
        },
    }


def test_tts_gender_survives_save_round_trip():
    cfg = OrganizationAIModelConfigurationV2.model_validate(_config({"gender": "female"}))
    dumped = cfg.model_dump(mode="json", exclude_none=True)
    assert dumped["byok"]["pipeline"]["tts"]["gender"] == "female"
    assert dumped["byok"]["pipeline"]["tts"]["voice"] == "divya"


def test_tts_gender_is_optional():
    cfg = OrganizationAIModelConfigurationV2.model_validate(_config({}))
    dumped = cfg.model_dump(mode="json", exclude_none=True)
    assert "gender" not in dumped["byok"]["pipeline"]["tts"]


def test_tts_gender_rejects_unknown_value():
    with pytest.raises(ValidationError):
        OrganizationAIModelConfigurationV2.model_validate(_config({"gender": "robot"}))
