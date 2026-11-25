"""Tests for WhatsApp media configuration enforcement and processing.

Covers:
  - media settings helpers (_get_media_settings, _validate_media_extension, etc.)
  - enable/disable enforcement
  - allowed/rejected file types
  - file size enforcement
  - max file count (Redis-based)
  - XLSX, PPTX extraction
  - DOC unsupported fallback
  - audio STT resolution and failure modes
  - model-aware vision capability
"""
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest

from api.services.whatsapp import conversation


# ── Fixtures ─────────────────────────────────────────────────────────────────


@pytest.fixture
def agent_with_media_settings():
    return SimpleNamespace(
        id=1,
        organization_id=7,
        model_config_ref={},
        image_settings={
            "enabled": True,
            "max_files": 5,
            "max_file_size_mb": 10,
            "allowed_extensions": [".jpg", ".jpeg", ".png"],
        },
        document_settings={
            "enabled": True,
            "max_files": 3,
            "max_file_size_mb": 20,
            "allowed_extensions": [".pdf", ".txt", ".csv", ".xlsx", ".docx", ".pptx"],
        },
        audio_settings={
            "enabled": True,
            "max_files": 10,
            "max_file_size_mb": 15,
            "allowed_extensions": [".mp3", ".wav", ".ogg", ".m4a"],
        },
    )


@pytest.fixture
def agent_disabled():
    return SimpleNamespace(
        id=2,
        organization_id=7,
        model_config_ref={},
        image_settings={
            "enabled": False,
            "max_files": 5,
            "max_file_size_mb": 10,
            "allowed_extensions": [".jpg", ".jpeg", ".png"],
        },
        document_settings={
            "enabled": False,
            "max_files": 3,
            "max_file_size_mb": 20,
            "allowed_extensions": [".pdf", ".txt"],
        },
        audio_settings={
            "enabled": False,
            "max_files": 10,
            "max_file_size_mb": 15,
            "allowed_extensions": [".mp3", ".wav"],
        },
    )


# ── _get_media_settings ─────────────────────────────────────────────────────


def test_get_media_settings_returns_configured(agent_with_media_settings):
    s = conversation._get_media_settings(agent_with_media_settings, "image")
    assert s["enabled"] is True
    assert s["max_files"] == 5
    assert s["max_file_size_mb"] == 10


def test_get_media_settings_returns_default_for_legacy_agent():
    agent = SimpleNamespace()
    s = conversation._get_media_settings(agent, "image")
    assert s["enabled"] is True
    assert s["max_files"] == 20
    assert ".jpg" in s["allowed_extensions"]


def test_get_media_settings_extracts_from_model_config_ref():
    agent = SimpleNamespace(
        model_config_ref={
            "media_config": {
                "audio": {
                    "enabled": True,
                    "maxFiles": 15,
                    "maxSizeMB": 80,
                    "allowedTypes": ["mp3", "wav"],
                    "replyWithVoice": True,
                }
            }
        }
    )
    s = conversation._get_media_settings(agent, "audio")
    assert s["enabled"] is True
    assert s["max_files"] == 15
    assert s["max_file_size_mb"] == 80
    assert s["allowed_extensions"] == [".mp3", ".wav"]
    assert s["reply_with_voice"] is True


@pytest.mark.asyncio
async def test_openwa_send_voice_payload(monkeypatch):
    from api.services.whatsapp.openwa_client import OpenWAClient

    client = OpenWAClient("http://mock:2785")
    captured = {}

    async def mock_request(method, path, **kwargs):
        captured["method"] = method
        captured["path"] = path
        captured["json"] = kwargs.get("json")
        mock_resp = AsyncMock()
        mock_resp.json = lambda: {"success": True}
        return mock_resp

    monkeypatch.setattr(client, "_request", mock_request)
    res = await client.send_voice("session-1", "12345@c.us", b"test_opus_bytes")
    assert res == {"success": True}
    assert captured["path"] == "/api/sessions/session-1/messages/send-audio"
    assert captured["json"]["ptt"] is True
    assert captured["json"]["mimetype"] == "audio/ogg; codecs=opus"
    assert "base64" in captured["json"]


# ── _validate_media_extension ───────────────────────────────────────────────


def test_allowed_extension_passes(agent_with_media_settings):
    s = agent_with_media_settings.image_settings
    assert conversation._validate_media_extension("photo.jpg", "image/jpeg", s, "image") is None


def test_rejected_extension_fails(agent_with_media_settings):
    s = agent_with_media_settings.image_settings
    err = conversation._validate_media_extension("photo.gif", "image/gif", s, "image")
    assert err == "This file type is not enabled for this agent."


def test_extension_validated_via_mime_when_filename_lacks_ext(agent_with_media_settings):
    s = agent_with_media_settings.image_settings
    assert conversation._validate_media_extension("photo", "image/jpeg", s, "image") is None


# ── _validate_media_size ─────────────────────────────────────────────────────


def test_undersized_passes(agent_with_media_settings):
    s = agent_with_media_settings.image_settings
    assert conversation._validate_media_size(5 * 1024 * 1024, s) is None


def test_oversized_fails(agent_with_media_settings):
    s = agent_with_media_settings.image_settings
    err = conversation._validate_media_size(15 * 1024 * 1024, s)
    assert err == "The file is larger than the allowed limit for this agent."


def test_platform_safety_ceiling_overrides_agent():
    s = {"enabled": True, "max_files": 5, "max_file_size_mb": 999, "allowed_extensions": []}
    err = conversation._validate_media_size(300 * 1024 * 1024, s)
    assert err is not None  # Would exceed the 200MB platform ceiling


# ── _get_allowed_extensions ──────────────────────────────────────────────────


def test_get_allowed_extensions_from_settings(agent_with_media_settings):
    exts = conversation._get_allowed_extensions(agent_with_media_settings.image_settings, "image")
    assert ".jpg" in exts
    assert ".png" in exts
    assert ".gif" not in exts


def test_get_allowed_extensions_fallback_to_default():
    s = {"enabled": True, "max_files": 5, "max_file_size_mb": 10}
    exts = conversation._get_allowed_extensions(s, "audio")
    assert ".mp3" in exts


# ── enable/disable enforcement ──────────────────────────────────────────────


@pytest.mark.parametrize("media_type", ["image", "document", "audio"])
@pytest.mark.asyncio
async def test_disabled_returns_direct_reply_in_handle_inbound_media(media_type, monkeypatch):
    """When a media type is disabled, handle_inbound_media must return a
    deterministic direct reply without downloading."""
    from api.services.whatsapp.conversation import handle_inbound_media

    appended = []
    monkeypatch.setattr(conversation.db_client, "append_messages", AsyncMock(side_effect=lambda *args: appended.append(args[-1])))

    number = SimpleNamespace(
        assigned_agent_id=1,
        organization_id=7,
        id=10,
        openwa_session_name="test-session",
        openwa_session_id=None,
    )
    agent = SimpleNamespace(
        id=1,
        organization_id=7,
        name="test-agent",
        is_active=True,
        active_contacts=[],
        deactive_contacts=[],
        model_config_ref={},
        tools=[],
        documents=[],
        system_prompt="",
        guardrails="",
        image_settings={"enabled": media_type != "image", "max_files": 5, "max_file_size_mb": 10, "allowed_extensions": []},
        document_settings={"enabled": media_type != "document", "max_files": 3, "max_file_size_mb": 20, "allowed_extensions": []},
        audio_settings={"enabled": media_type != "audio", "max_files": 10, "max_file_size_mb": 15, "allowed_extensions": []},
    )

    # Instead of loading from DB, monkeypatch the sesssion execute
    from sqlalchemy import select as _select
    from sqlalchemy.orm import selectinload as _selectinload

    real_execute = None

    class FakeResult:
        def scalars(self):
            return self
        def first(self):
            return agent

    class FakeSession:
        async def __aenter__(self):
            return self
        async def __aexit__(self, *args):
            return None
        async def execute(self, *args, **kwargs):
            return FakeResult()

    monkeypatch.setattr(conversation.db_client, "async_session", lambda: FakeSession())

    # Run handler
    await handle_inbound_media(
        number,
        "chat-1@c.us",
        "",
        {"type": media_type, "filename": f"file.{media_type}", "mime_type": f"{media_type}/test", "chat_id": "chat-1@c.us", "message_id": "msg-1"},
        {},
    )

    # Must have persisted a user + assistant message with the deterministic reply
    assert len(appended) >= 1
    last_batch = appended[-1]
    assert any("disabled for this agent" in str(m) for m in last_batch)


# ── document extractors ─────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_xlsx_extraction():
    """Test that XLSX is extracted without errors."""
    import io
    import openpyxl
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "TestSheet"
    ws["A1"] = "Name"
    ws["B1"] = "Value"
    ws["A2"] = "Alice"
    ws["B2"] = "100"
    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    data = buf.read()
    wb.close()

    result = conversation._extract_xlsx_preview(data)
    assert "TestSheet" in result
    assert "Name" in result
    assert "Alice" in result


@pytest.mark.asyncio
async def test_pptx_extraction():
    """Test that PPTX is extracted without errors."""
    import io
    from pptx import Presentation
    from pptx.util import Inches
    prs = Presentation()
    slide = prs.slides.add_slide(prs.slide_layouts[6])  # blank
    txBox = slide.shapes.add_textbox(Inches(1), Inches(1), Inches(8), Inches(1))
    tf = txBox.text_frame
    tf.text = "Test Slide"
    buf = io.BytesIO()
    prs.save(buf)
    buf.seek(0)
    data = buf.read()

    result = conversation._extract_pptx_preview(data)
    assert "Test Slide" in result


def test_legacy_doc_unsupported():
    """Legacy .doc format should return empty string (unsupported)."""
    result = conversation._extract_legacy_doc(b"\x00" * 100)
    assert result == ""


# ── _is_vision_capable ──────────────────────────────────────────────────────


@pytest.mark.parametrize(
    ("provider", "model", "expected"),
    [
        ("openai", "gpt-4.1", True),
        ("openai", "gpt-4o", True),
        ("openai", "gpt-4o-mini", False),
        ("openai", "gpt-3.5-turbo", False),
        ("openai", "gpt-4.1-mini", True),
        ("openai", "o1", True),
        ("openai", "o3-mini", True),
        ("google", "gemini-2.5-flash", True),
        ("google", "text-embedding-004", False),
        ("groq", "llama-3.3-70b-versatile", True),
        ("azure", "gpt-4.1-mini", False),
        ("deepgram", "nova-3-general", False),
        (None, "", False),
    ],
)
def test_is_vision_capable(provider, model, expected):
    assert conversation._is_vision_capable(provider, model) == expected


# ── Redis media counter ──────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_check_media_count_below_limit(monkeypatch):
    monkeypatch.setattr(
        conversation,
        "_get_media_counter_redis",
        lambda: SimpleNamespace(get=AsyncMock(return_value="2")),
    )
    result = await conversation._check_media_count(1, 2, 3, "contact", {"max_files": 5})
    assert result is None


@pytest.mark.asyncio
async def test_check_media_count_at_limit(monkeypatch):
    monkeypatch.setattr(
        conversation,
        "_get_media_counter_redis",
        lambda: SimpleNamespace(get=AsyncMock(return_value="5")),
    )
    result = await conversation._check_media_count(1, 2, 3, "contact", {"max_files": 5})
    assert result == "The media upload limit for this conversation has been reached."


@pytest.mark.asyncio
async def test_check_media_count_no_key(monkeypatch):
    monkeypatch.setattr(
        conversation,
        "_get_media_counter_redis",
        lambda: SimpleNamespace(get=AsyncMock(return_value=None)),
    )
    result = await conversation._check_media_count(1, 2, 3, "contact", {"max_files": 5})
    assert result is None


# ── _build_media_user_text ───────────────────────────────────────────────────


def test_media_user_text_image():
    assert "[Image: photo.jpg]" in conversation._build_media_user_text("image", "photo.jpg", "")


def test_media_user_text_document():
    assert "[Document: report.pdf]" in conversation._build_media_user_text("document", "report.pdf", "")


def test_media_user_text_audio():
    assert "[Audio: voice.ogg]" in conversation._build_media_user_text("audio", "voice.ogg", "")


def test_media_user_text_with_caption():
    t = conversation._build_media_user_text("image", "photo.jpg", "Hello")
    assert "Caption: Hello" in t


# ── _get_mime_category ──────────────────────────────────────────────────────


def test_mime_category_image():
    assert conversation._get_mime_category("image/jpeg") == "image"
    assert conversation._get_mime_category("image/png") == "image"


def test_mime_category_audio():
    assert conversation._get_mime_category("audio/mpeg") == "audio"
    assert conversation._get_mime_category("audio/ogg") == "audio"


def test_mime_category_document():
    assert conversation._get_mime_category("application/pdf") == "document"


def test_mime_category_unknown():
    assert conversation._get_mime_category("video/mp4") is None


# ── Audio STT resolution ─────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_transcribe_no_stt_config_falls_back_to_speaches(monkeypatch):
    """When no STT is configured, _transcribe_audio_bytes returns clear message."""
    agent = SimpleNamespace(organization_id=7, model_config_ref={})
    monkeypatch.setattr(
        conversation,
        "get_effective_ai_model_configuration_for_workflow",
        AsyncMock(return_value=SimpleNamespace(stt=None, llm=None)),
    )
    result, error_msg = await conversation._transcribe_audio_bytes(b"audio", "test.ogg", "audio/ogg", agent)
    assert result is None
    assert "STT is not configured" in error_msg


@pytest.mark.asyncio
async def test_transcribe_openai_stt(monkeypatch):
    """When OpenAI STT is configured, use OpenAI provider."""
    agent = SimpleNamespace(organization_id=7, model_config_ref={})
    stt = SimpleNamespace(provider=SimpleNamespace(value="openai"), api_key="sk-test", model="whisper-1", base_url=None)
    monkeypatch.setattr(
        conversation,
        "get_effective_ai_model_configuration_for_workflow",
        AsyncMock(return_value=SimpleNamespace(stt=stt, llm=None)),
    )
    from api.services.audio_providers.registry import get_stt_provider
    oa_provider = get_stt_provider("openai")
    monkeypatch.setattr(
        oa_provider,
        "transcribe",
        AsyncMock(return_value="test transcription"),
    )
    result, error_msg = await conversation._transcribe_audio_bytes(b"audio", "test.mp3", "audio/mpeg", agent)
    assert result == "test transcription"
    assert error_msg is None


@pytest.mark.asyncio
async def test_transcribe_stt_missing_api_key(monkeypatch):
    """When STT is configured but has no API key, return error message."""
    agent = SimpleNamespace(organization_id=7, model_config_ref={})
    stt = SimpleNamespace(provider=SimpleNamespace(value="deepgram"), api_key=None, model="nova-3-general", base_url=None)
    monkeypatch.setattr(
        conversation,
        "get_effective_ai_model_configuration_for_workflow",
        AsyncMock(return_value=SimpleNamespace(stt=stt, llm=None)),
    )
    result, error_msg = await conversation._transcribe_audio_bytes(b"audio", "test.mp3", "audio/mpeg", agent)
    assert result is None
    assert "misconfigured" in error_msg


@pytest.mark.asyncio
async def test_transcribe_speaches_configured(monkeypatch):
    """When an unsupported provider is configured in Chunk 1, return unsupported error."""
    agent = SimpleNamespace(organization_id=7, model_config_ref={})
    stt = SimpleNamespace(
        provider=SimpleNamespace(value="unsupported_provider"),
        api_key="none",
        model="some-model",
        base_url="http://test:8790/v1",
    )
    monkeypatch.setattr(
        conversation,
        "get_effective_ai_model_configuration_for_workflow",
        AsyncMock(return_value=SimpleNamespace(stt=stt, llm=None)),
    )
    result, error_msg = await conversation._transcribe_audio_bytes(b"audio", "test.ogg", "audio/ogg", agent)
    assert result is None
    assert "not supported" in error_msg


@pytest.mark.asyncio
async def test_audio_process_success(monkeypatch):
    """Successful STT should return a MediaProcessingResult with user_context."""
    agent = SimpleNamespace(organization_id=7, model_config_ref={})
    monkeypatch.setattr(
        conversation,
        "_transcribe_audio_bytes",
        AsyncMock(return_value=("the quick brown fox", None)),
    )
    result = await conversation._process_audio(b"audio", "test.ogg", "what did I say?", agent)
    assert result.success is True
    assert result.user_context is not None
    assert "the quick brown fox" in result.user_context
    assert result.direct_reply is None


@pytest.mark.asyncio
async def test_audio_process_empty_transcript(monkeypatch):
    """Empty transcript should return deterministic direct reply."""
    agent = SimpleNamespace(organization_id=7, model_config_ref={})
    monkeypatch.setattr(
        conversation,
        "_transcribe_audio_bytes",
        AsyncMock(return_value=(None, None)),
    )
    result = await conversation._process_audio(b"audio", "test.ogg", "", agent)
    assert result.success is False
    assert result.direct_reply is not None
    assert "couldn't extract any speech" in result.direct_reply


# ── media processing result integration ─────────────────────────────────────


def test_media_processing_result_contract():
    """Document success/failure contract must match."""
    success = conversation.MediaProcessingResult(success=True, user_context="extracted text")
    assert success.user_context == "extracted text"
    assert success.direct_reply is None

    failure = conversation.MediaProcessingResult(
        success=False, direct_reply="not supported", reason="unsupported"
    )
    assert failure.direct_reply == "not supported"
    assert failure.user_context is None


# ── MIME normalization for voice notes ───────────────────────────────────


def _make_audio_settings(allowed: list[str] = None) -> dict:
    return {"enabled": True, "max_files": 20, "max_file_size_mb": 100,
            "allowed_extensions": allowed or [".ogg", ".m4a", ".mp3", ".wav", ".aac", ".flac"]}


@pytest.mark.parametrize(
    "mime, expected_pass",
    [
        ("audio/ogg; codecs=opus", True),
        ("audio/ogg", True),
        ("audio/mp4", True),
        ("audio/mpeg", True),
        ("audio/x-wav", True),
        ("audio/wav", True),
        ("audio/aac", True),
        ("audio/flac", True),
        ("audio/x-flac", True),
        ("audio/webm", False),  # .webm not in agent default allowed list
        ("video/mp4", False),
        ("image/jpeg", False),
    ],
)
def test_voice_note_mime_normalization(mime, expected_pass):
    """Voice note MIMEs with parameters must normalize correctly."""
    settings = _make_audio_settings()
    result = conversation._validate_media_extension("", mime, settings, "audio")
    if expected_pass:
        assert result is None, f"MIME {mime} should pass, got: {result}"
    else:
        assert result is not None, f"MIME {mime} should fail"


@pytest.mark.parametrize(
    "filename, mime, expected_pass",
    [
        ("", "audio/ogg; codecs=opus", True),   # voice note, no filename
        ("voice.ogg", "audio/ogg", True),          # with filename
        ("voice", "audio/ogg; codecs=opus", True),  # no extension, MIME resolves
        ("", "", False),                             # nothing to validate
        ("", "audio/opus", True),                   # opus -> .ogg
    ],
)
def test_voice_note_no_filename(filename, mime, expected_pass):
    settings = _make_audio_settings()
    result = conversation._validate_media_extension(filename, mime, settings, "audio")
    if expected_pass:
        assert result is None
    else:
        assert result is not None