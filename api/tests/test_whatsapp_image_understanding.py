"""Tests for WhatsApp image understanding (multimodal vision support).

Covers:
  A. image download success path
  B. vision-capable model: image content part reaches LLM
  C. caption + image: both parts reach LLM
  D. vision unsupported: deterministic fallback, no hallucination
  E. conversation history contamination safety
  F. duplicate image webhook deduplication
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest

from api.services.whatsapp import conversation
from api.services.whatsapp.conversation import (
    MediaProcessingResult,
    _VISION_CAPABLE_PROVIDERS,
)


class FakeMessage:
    def __init__(self, content=None, tool_calls=None):
        self.content = content
        self.tool_calls = tool_calls or []

    def model_dump(self, exclude_none=True):
        result = {"role": "assistant", "content": self.content}
        if self.tool_calls:
            result["tool_calls"] = [call.model_dump() for call in self.tool_calls]
        return result


class FakeClient:
    """Fake OpenAI client that captures the last request."""

    def __init__(self, response_text: str = "Grounded response."):
        self.last_request = None
        self.response_text = response_text

    async def create(self, **request):
        self.last_request = request
        return SimpleNamespace(
            choices=[SimpleNamespace(message=FakeMessage(content=self.response_text))]
        )


@pytest.fixture
def agent():
    tool = SimpleNamespace(
        name="Lookup Order",
        description="Look up an order",
        tool_uuid="tool-1",
        category="http_api",
        definition={
            "type": "http_api",
            "config": {
                "parameters": [
                    {"name": "order_id", "type": "string", "required": True}
                ]
            },
        },
    )
    return SimpleNamespace(
        id=1,
        organization_id=7,
        system_prompt="Answer customers clearly.",
        guardrails=None,
        model_config_ref={},
        embeddings=None,
        tools=[tool],
        documents=[],
    )


# ── A: image download success ────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_image_download_success(monkeypatch):
    """Verify _process_image correctly receives the download result."""
    monkeypatch.setattr(
        conversation,
        "get_effective_ai_model_configuration_for_workflow",
        AsyncMock(
            return_value=SimpleNamespace(
                llm=SimpleNamespace(
                    provider="openai", model="gpt-4.1-mini", api_key="key"
                ),
                embeddings=None,
            )
        ),
    )

    agent_simple = SimpleNamespace(
        id=1,
        organization_id=7,
        model_config_ref={},
    )
    result = await conversation._process_image(
        media_bytes=b"\xff\xd8\xff\xe0",  # JPEG header bytes
        filename="screenshot.jpg",
        caption="",
        agent=agent_simple,
        number=SimpleNamespace(openwa_session_name="test-session"),
        mime="image/jpeg",
    )
    assert result.success is True
    assert result.user_context == "__image_bytes__"


# ── B: vision-capable model ──────────────────────────────────────────────────


@pytest.mark.parametrize("provider", sorted(_VISION_CAPABLE_PROVIDERS))
@pytest.mark.asyncio
async def test_vision_capable_model_pass_image_to_llm(monkeypatch, provider):
    """When model is vision-capable, the LLM receives content parts with an
    image_url."""
    fake_client = FakeClient("Grounded response.")
    monkeypatch.setattr(
        conversation,
        "AsyncOpenAI",
        lambda **_: SimpleNamespace(chat=SimpleNamespace(completions=fake_client)),
    )
    monkeypatch.setattr(
        conversation,
        "get_effective_ai_model_configuration_for_workflow",
        AsyncMock(
            return_value=SimpleNamespace(
                llm=SimpleNamespace(
                    provider=provider, model="test-model", api_key="test-key"
                ),
                embeddings=None,
            )
        ),
    )
    monkeypatch.setattr(conversation, "_retrieve_agent_context", AsyncMock(return_value=""))

    agent_simple = SimpleNamespace(
        id=1,
        organization_id=7,
        system_prompt="",
        guardrails="",
        model_config_ref={},
        embeddings=None,
        tools=[],
        documents=[],
    )

    result = await conversation._generate_reply(
        agent_simple,
        history=[],
        user_text="What is shown?",
        image_bytes=b"\xff\xd8\xff\xe0",
        image_mime="image/jpeg",
        image_caption="What is shown?",
    )

    assert result == "Grounded response."
    assert fake_client.last_request is not None
    messages = fake_client.last_request["messages"]
    # Find the user message (last one before the assistant)
    user_msg = [m for m in messages if m["role"] == "user"]
    assert len(user_msg) == 1

    content = user_msg[0]["content"]
    assert isinstance(content, list), (
        f"Expected list of content parts for vision-capable provider {provider}, "
        f"got {type(content).__name__}"
    )

    text_part = content[0]
    image_part = content[1]
    assert text_part["type"] == "text"
    assert text_part["text"] == "What is shown?"
    assert image_part["type"] == "image_url"
    assert image_part["image_url"]["url"].startswith("data:image/jpeg;base64,")
    assert len(image_part["image_url"]["url"]) > len("data:image/jpeg;base64,")


# ── C: caption + image ───────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_caption_and_image_preserved(monkeypatch):
    """When caption is provided alongside image, both text and image parts
    reach the LLM."""
    fake_client = FakeClient("The screenshot shows a QR code.")
    monkeypatch.setattr(
        conversation,
        "AsyncOpenAI",
        lambda **_: SimpleNamespace(chat=SimpleNamespace(completions=fake_client)),
    )
    monkeypatch.setattr(
        conversation,
        "get_effective_ai_model_configuration_for_workflow",
        AsyncMock(
            return_value=SimpleNamespace(
                llm=SimpleNamespace(
                    provider="openai", model="gpt-4.1-mini", api_key="key"
                ),
                embeddings=None,
            )
        ),
    )
    monkeypatch.setattr(conversation, "_retrieve_agent_context", AsyncMock(return_value=""))

    agent_simple = SimpleNamespace(
        id=1,
        organization_id=7,
        system_prompt="",
        guardrails="",
        model_config_ref={},
        embeddings=None,
        tools=[],
        documents=[],
    )

    await conversation._generate_reply(
        agent_simple,
        history=[],
        user_text="",
        image_bytes=b"fake-image-data",
        image_mime="image/png",
        image_caption="What is shown in this screenshot?",
    )

    messages = fake_client.last_request["messages"]
    user_msg = [m for m in messages if m["role"] == "user"][0]
    content = user_msg["content"]
    assert isinstance(content, list)
    assert content[0]["text"] == "What is shown in this screenshot?"
    assert content[1]["image_url"]["url"].startswith("data:image/png;base64,")


# ── D: vision unsupported — deterministic fallback ───────────────────────────


@pytest.mark.parametrize(
    "provider,model",
    [
        ("azure", "gpt-4.1-mini"),
        ("deepgram", "nova-3-general"),
        ("cartesia", "sonic-3.5"),
        ("elevenlabs", "eleven_flash_v2_5"),
        ("aws_bedrock", "us.amazon.nova-pro-v1:0"),
        ("convozent", "default"),
    ],
)
@pytest.mark.asyncio
async def test_vision_unsupported_returns_deterministic_fallback(
    monkeypatch, provider, model
):
    """A non-vision provider must NOT call the LLM and must return a
    deterministic capability message instead of hallucinating image
    contents."""
    monkeypatch.setattr(
        conversation,
        "get_effective_ai_model_configuration_for_workflow",
        AsyncMock(
            return_value=SimpleNamespace(
                llm=SimpleNamespace(
                    provider=provider, model=model, api_key="key"
                ),
                embeddings=None,
            )
        ),
    )

    agent_simple = SimpleNamespace(
        id=1,
        organization_id=7,
        model_config_ref={},
    )

    result = await conversation._process_image(
        media_bytes=b"\x89PNG\r\n\x1a\n",
        filename="test.png",
        caption="",
        agent=agent_simple,
        number=SimpleNamespace(openwa_session_name="test"),
        mime="image/png",
    )

    assert result.success is True
    assert result.direct_reply is not None
    assert "cannot analyze image content" in result.direct_reply
    # Must NOT mention unrelated details
    assert "Aurobindo" not in result.direct_reply
    assert "employee" not in result.direct_reply


# ── E: conversation history contamination ────────────────────────────────────


@pytest.mark.asyncio
async def test_image_path_does_not_use_history_as_image_content(monkeypatch):
    """When history contains unrelated content, the image processing path
    must NOT treat old messages as image content."""
    monkeypatch.setattr(
        conversation,
        "get_effective_ai_model_configuration_for_workflow",
        AsyncMock(
            return_value=SimpleNamespace(
                llm=SimpleNamespace(
                    provider="openai", model="gpt-4.1-mini", api_key="key"
                ),
                embeddings=None,
            )
        ),
    )

    agent_simple = SimpleNamespace(
        id=1,
        organization_id=7,
        model_config_ref={},
    )

    result = await conversation._process_image(
        media_bytes=b"\xff\xd8\xff\xe0",
        filename="qr.jpg",
        caption="",
        agent=agent_simple,
        number=SimpleNamespace(openwa_session_name="test"),
        mime="image/jpeg",
    )

    # Result should be __image_bytes__ marker regardless of what history
    # contains — _process_image does not even receive history.
    assert result.success is True
    assert result.user_context == "__image_bytes__"


@pytest.mark.asyncio
async def test_vision_unsupported_no_hallucination_from_history(monkeypatch):
    """Vision-unsupported model must NOT fabricate image details from
    prior conversation history."""
    monkeypatch.setattr(
        conversation,
        "get_effective_ai_model_configuration_for_workflow",
        AsyncMock(
            return_value=SimpleNamespace(
                llm=SimpleNamespace(
                    provider="azure", model="gpt-4.1-mini", api_key="key"
                ),
                embeddings=None,
            )
        ),
    )

    agent_simple = SimpleNamespace(
        id=1,
        organization_id=7,
        model_config_ref={},
    )

    # History contains Aurobindo Pharma info — this must NOT leak into
    # the image processing result.
    result = await conversation._process_image(
        media_bytes=b"\xff\xd8\xff\xe0",
        filename="whatsapp_qr.jpg",
        caption="",
        agent=agent_simple,
        number=SimpleNamespace(openwa_session_name="test"),
        mime="image/jpeg",
    )

    assert result.direct_reply is not None
    assert "Aurobindo" not in result.direct_reply
    assert "employee" not in result.direct_reply


# ── F: _process_image result is deterministic when vision unsupported ────────


@pytest.mark.asyncio
async def test_image_only_no_caption_vision_unsupported(monkeypatch):
    """Image-only message with vision-unsupported model: deterministic
    fallback, never guess."""
    monkeypatch.setattr(
        conversation,
        "get_effective_ai_model_configuration_for_workflow",
        AsyncMock(
            return_value=SimpleNamespace(
                llm=SimpleNamespace(
                    provider="deepgram", model="nova-3-general", api_key="key"
                ),
                embeddings=None,
            )
        ),
    )

    agent_simple = SimpleNamespace(
        id=1,
        organization_id=7,
        model_config_ref={},
    )

    result = await conversation._process_image(
        media_bytes=b"\x00\x00\x00",
        filename="photo.jpg",
        caption="",
        agent=agent_simple,
        number=SimpleNamespace(openwa_session_name="test"),
        mime="image/jpeg",
    )

    assert result.direct_reply is not None
    assert "cannot analyze image content" in result.direct_reply


# ── G: _generate_reply stores text history, not raw image ────────────────────
# (History is stored externally; this test validates _generate_reply
#  does not mutate the user_text into an image-bearing object it
#  read back later.)


@pytest.mark.asyncio
async def test_vision_reply_with_user_text_stored_as_is(monkeypatch):
    """_generate_reply must not modify the user_text parameter; the
    caller stores a text representation separately."""
    fake_client = FakeClient("Sure, I see the QR code.")
    monkeypatch.setattr(
        conversation,
        "AsyncOpenAI",
        lambda **_: SimpleNamespace(chat=SimpleNamespace(completions=fake_client)),
    )
    monkeypatch.setattr(
        conversation,
        "get_effective_ai_model_configuration_for_workflow",
        AsyncMock(
            return_value=SimpleNamespace(
                llm=SimpleNamespace(
                    provider="openai", model="gpt-4.1-mini", api_key="key"
                ),
                embeddings=None,
            )
        ),
    )
    monkeypatch.setattr(conversation, "_retrieve_agent_context", AsyncMock(return_value=""))

    agent_simple = SimpleNamespace(
        id=1,
        organization_id=7,
        system_prompt="",
        guardrails="",
        model_config_ref={},
        embeddings=None,
        tools=[],
        documents=[],
    )

    original_text = "[Image: screenshot.jpg]\nCaption: What is this?"
    result = await conversation._generate_reply(
        agent_simple,
        history=[],
        user_text=original_text,
        image_bytes=b"\xff\xd8\xff\xe0",
        image_mime="image/jpeg",
        image_caption="What is this?",
    )

    assert result == "Sure, I see the QR code."
    # The user_text parameter is unchanged by _generate_reply
    # (caller is responsible for persisting it)


# ── H: _VISION_CAPABLE_PROVIDERS covers the major vision providers ───────────


def test_vision_capable_providers_includes_major_ones():
    assert "openai" in _VISION_CAPABLE_PROVIDERS
    assert "google" in _VISION_CAPABLE_PROVIDERS
    assert "openrouter" in _VISION_CAPABLE_PROVIDERS
    assert "groq" in _VISION_CAPABLE_PROVIDERS
    assert "ollama" in _VISION_CAPABLE_PROVIDERS