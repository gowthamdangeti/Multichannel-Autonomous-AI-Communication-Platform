from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from api.services.whatsapp import conversation


class FakeSendClient:
    def __init__(self):
        self.sent = []

    async def send_text(self, session_id, contact, text):
        self.sent.append((session_id, contact, text))


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("reason", "message"),
    [
        ("timeout", "too long to process"),
        ("size_limit", "too large to process"),
        ("zero_text", "scanned or image-based"),
        ("exception", "processing it failed"),
    ],
)
async def test_pdf_failure_outcomes_are_direct_and_persist_distinct_roles(
    monkeypatch, reason, message
):
    appended = []
    monkeypatch.setattr(
        conversation.db_client,
        "append_messages",
        AsyncMock(side_effect=lambda *args: appended.append(args[-1])),
    )
    client = FakeSendClient()
    user = "[Document: file.pdf]"
    reply = f"I received the PDF, but it was {message}."

    await conversation._persist_and_send_media_reply(
        SimpleNamespace(organization_id=7, id=1),
        "chat-1@c.us",
        user,
        reply,
        client,
        "session-1",
    )

    assert appended == [[
        {"role": "user", "content": user},
        {"role": "assistant", "content": reply},
    ]]
    assert client.sent == [("session-1", "chat-1@c.us", reply)]
    assert reply != user


@pytest.mark.asyncio
async def test_successful_pdf_context_reaches_llm_once(monkeypatch):
    calls = []

    async def fake_reply(agent, history, user_text):
        calls.append(user_text)
        return "The document contains frontend experience."

    monkeypatch.setattr(conversation, "_generate_reply", fake_reply)
    context = "User uploaded a document.\nFilename: resume.pdf\nDocument preview:\nFrontend experience"
    result = conversation.MediaProcessingResult(success=True, user_context=context)

    reply = await conversation._generate_reply(SimpleNamespace(), [], result.user_context)
    assert reply.startswith("The document")
    assert calls == [context]


@pytest.mark.asyncio
async def test_pdf_timeout_does_not_call_llm(monkeypatch):
    llm = AsyncMock()
    monkeypatch.setattr(conversation, "_generate_reply", llm)
    result = conversation.MediaProcessingResult(
        success=False,
        direct_reply="I received the PDF, but it took too long to process.",
        reason="timeout",
    )
    assert result.success is False
    assert "too long" in result.direct_reply
    llm.assert_not_awaited()


@pytest.mark.asyncio
async def test_timeout_extractor_returns_controlled_result(monkeypatch):
    async def fail(*args, **kwargs):
        raise conversation.PDFExtractionTimeout

    monkeypatch.setattr(conversation, "_extract_pdf_bytes", fail)
    result = await conversation._process_document(
        b"pdf", "file.pdf", "application/pdf", "", SimpleNamespace()
    )
    assert result.reason == "timeout"
    assert result.success is False
    assert "too long" in result.direct_reply


@pytest.mark.asyncio
async def test_exception_extractor_returns_controlled_result(monkeypatch):
    async def fail(*args, **kwargs):
        raise conversation.PDFExtractionError

    monkeypatch.setattr(conversation, "_extract_pdf_bytes", fail)
    result = await conversation._process_document(
        b"pdf", "file.pdf", "application/pdf", "", SimpleNamespace()
    )
    assert result.reason == "exception"
    assert result.success is False
    assert "processing it failed" in result.direct_reply


def test_media_user_representation_is_neutral():
    assert conversation._build_media_user_text("document", "file.pdf", "") == "[Document: file.pdf]"
    assert conversation._build_media_user_text("document", "file.pdf", "Explain") == "[Document: file.pdf]\nCaption: Explain"
