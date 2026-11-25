"""Chat titles: LLM title when possible, voice's deterministic fallback otherwise."""

import os
import sys
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(__file__))))

import pytest  # noqa: E402

from api.services.chat import conversation_title as ct  # noqa: E402

AGENT = SimpleNamespace(id=1, organization_id=1, name="Aurubindo Pharma", model_config_ref={})
MESSAGES = [
    {"role": "assistant", "content": "Hi! Who am I speaking with?"},
    {"role": "user", "content": "Ramesh Kumar"},
    {"role": "assistant", "content": "Thanks Ramesh."},
]


def test_saved_title_wins_and_fallback_is_agent_embed_id():
    assert ct.resolve_chat_display_title("  AurubindoPharma_RameshKumar ", "X", 3) == "AurubindoPharma_RameshKumar"
    assert ct.resolve_chat_display_title(None, "Aurubindo Pharma", 3) == "Aurubindo Pharma_embed_3"
    assert ct.resolve_chat_display_title("", None, 3) == "Conversation 3"


def test_transcript_uses_voice_shape():
    assert ct.to_title_transcript(MESSAGES)[1] == {"role": "user", "message": "Ramesh Kumar"}


def _patch_db(convo, saved):
    return patch.multiple(
        ct.db_client,
        get_chat_conversation=AsyncMock(return_value=convo),
        get_chat_agent=AsyncMock(return_value=AGENT),
        set_chat_conversation_title=AsyncMock(side_effect=lambda *a: saved.append(a[2]) or True),
    )


@pytest.mark.asyncio
async def test_llm_title_is_saved():
    convo = SimpleNamespace(id=9, chat_agent_id=1, conversation_title=None, messages=MESSAGES)
    saved: list = []
    with _patch_db(convo, saved), patch.object(ct, "_llm_title", AsyncMock(return_value="AurubindoPharma_RameshKumar")):
        assert await ct.generate_chat_conversation_title(9, 1) == "AurubindoPharma_RameshKumar"
    assert saved == ["AurubindoPharma_RameshKumar"]


@pytest.mark.asyncio
async def test_falls_back_when_llm_gives_nothing():
    convo = SimpleNamespace(id=9, chat_agent_id=1, conversation_title=None, messages=MESSAGES)
    saved: list = []
    with _patch_db(convo, saved), patch.object(ct, "_llm_title", AsyncMock(return_value=None)):
        await ct.generate_chat_conversation_title(9, 1)
    assert saved == ["Aurubindo Pharma_embed_9"]


@pytest.mark.asyncio
async def test_existing_title_is_left_alone():
    convo = SimpleNamespace(id=9, chat_agent_id=1, conversation_title="Keep", messages=MESSAGES)
    saved: list = []
    with _patch_db(convo, saved):
        assert await ct.generate_chat_conversation_title(9, 1) is None
    assert saved == []
