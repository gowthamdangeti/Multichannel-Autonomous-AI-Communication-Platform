"""Voice catalog gender is stored as male / female / neutral so filters match it."""

import pytest
from pydantic import ValidationError

from api.routes.admin import VoiceCreate, VoiceUpdate


@pytest.mark.parametrize(
    "raw, expected",
    [("Male", "male"), ("f", "female"), (" NEUTRAL ", "neutral"), ("", None), (None, None)],
)
def test_gender_is_normalized(raw, expected):
    assert VoiceCreate(name="a", provider="p", voice_id="v", gender=raw).gender == expected
    assert VoiceUpdate(gender=raw).gender == expected


def test_invalid_gender_is_rejected():
    with pytest.raises(ValidationError):
        VoiceCreate(name="a", provider="p", voice_id="v", gender="robot")
