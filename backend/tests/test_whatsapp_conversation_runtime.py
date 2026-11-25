from types import SimpleNamespace
from unittest.mock import AsyncMock

import httpx
import pytest

from api.routes.whatsapp import _extract_inbound_message
from api.services.whatsapp import conversation
from api.services.whatsapp.openwa_client import OpenWAClient


class FakeSendClient:
    def __init__(self):
        self.sent = []

    async def send_text(self, session_id, contact, text):
        self.sent.append((session_id, contact, text))


class FakeMessage:
    def __init__(self, content=None, tool_calls=None):
        self.content = content
        self.tool_calls = tool_calls or []

    def model_dump(self, exclude_none=True):
        result = {"role": "assistant", "content": self.content}
        if self.tool_calls:
            result["tool_calls"] = [call.model_dump() for call in self.tool_calls]
        return result


class FakeCall:
    def __init__(self, name, arguments, call_id="call-1"):
        self.id = call_id
        self.function = SimpleNamespace(name=name, arguments=arguments)

    def model_dump(self):
        return {
            "id": self.id,
            "type": "function",
            "function": {
                "name": self.function.name,
                "arguments": self.function.arguments,
            },
        }


class FakeClient:
    def __init__(self, responses):
        self.responses = iter(responses)
        self.requests = []

    async def create(self, **request):
        self.requests.append(request)
        return SimpleNamespace(choices=[SimpleNamespace(message=next(self.responses))])


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
    document = SimpleNamespace(document_uuid="doc-1")
    return SimpleNamespace(
        id=1,
        organization_id=7,
        system_prompt="Answer customers clearly.",
        guardrails="Never disclose private data.",
        model_config_ref={},
        embeddings=None,
        tools=[tool],
        documents=[document],
    )


@pytest.mark.asyncio
async def test_tool_call_is_executed_and_final_response_returned(monkeypatch, agent):
    client = FakeClient(
        [
            FakeMessage(tool_calls=[FakeCall("lookup_order", '{"order_id":"42"}')]),
            FakeMessage(content="Your order is ready."),
        ]
    )
    monkeypatch.setattr(conversation, "AsyncOpenAI", lambda **_: SimpleNamespace(chat=SimpleNamespace(completions=client)))
    monkeypatch.setattr(
        conversation,
        "get_effective_ai_model_configuration_for_workflow",
        AsyncMock(llm=SimpleNamespace(provider="openai", model="test", api_key="key"), embeddings=None),
    )
    monkeypatch.setattr(
        conversation,
        "execute_http_tool",
        AsyncMock(return_value={"status": "success", "data": {"state": "ready"}}),
    )
    monkeypatch.setattr(conversation, "_retrieve_agent_context", AsyncMock(return_value=""))

    result = await conversation._generate_reply(agent, [], "Where is order 42?")

    assert result == "Your order is ready."
    assert len(client.requests) == 2
    assert client.requests[0]["tools"]
    assert client.requests[0]["tool_choice"] == "auto"
    assert client.requests[1]["messages"][-1]["role"] == "tool"


@pytest.mark.asyncio
async def test_tool_call_from_unassociated_tool_is_not_executed(monkeypatch, agent):
    client = FakeClient(
        [
            FakeMessage(tool_calls=[FakeCall("not_available", "{}")]),
            FakeMessage(content="I cannot access that tool."),
        ]
    )
    monkeypatch.setattr(conversation, "AsyncOpenAI", lambda **_: SimpleNamespace(chat=SimpleNamespace(completions=client)))
    monkeypatch.setattr(
        conversation,
        "get_effective_ai_model_configuration_for_workflow",
        AsyncMock(llm=SimpleNamespace(provider="openai", model="test", api_key="key"), embeddings=None),
    )
    execute = AsyncMock()
    monkeypatch.setattr(conversation, "execute_http_tool", execute)
    monkeypatch.setattr(conversation, "_retrieve_agent_context", AsyncMock(return_value=""))

    result = await conversation._generate_reply(agent, [], "Do it")

    assert result == "I cannot access that tool."
    execute.assert_not_awaited()
    assert "not available" in client.requests[1]["messages"][-1]["content"]


@pytest.mark.asyncio
async def test_selected_documents_are_used_for_scoped_context(monkeypatch, agent):
    client = FakeClient([FakeMessage(content="Based on the document: yes.")])
    monkeypatch.setattr(conversation, "AsyncOpenAI", lambda **_: SimpleNamespace(chat=SimpleNamespace(completions=client)))
    monkeypatch.setattr(
        conversation,
        "get_effective_ai_model_configuration_for_workflow",
        AsyncMock(llm=SimpleNamespace(provider="openai", model="test", api_key="key"), embeddings=None),
    )
    retrieval = AsyncMock(return_value="[policy.pdf]\nThe answer is yes.")
    monkeypatch.setattr(conversation, "_retrieve_agent_context", retrieval)

    result = await conversation._generate_reply(agent, [], "What is the answer?")

    assert result == "Based on the document: yes."
    retrieval.assert_awaited_once()
    assert retrieval.await_args.args[:2] == (agent, "What is the answer?")
    assert "Knowledge Base Context" in client.requests[0]["messages"][0]["content"]


@pytest.mark.asyncio
async def test_retrieval_is_scoped_to_agent_documents_and_organization(monkeypatch, agent):
    retrieval = AsyncMock(return_value={"chunks": [{"filename": "a.pdf", "text": "answer"}]})
    monkeypatch.setattr(conversation, "retrieve_from_knowledge_base", retrieval)
    embeddings = SimpleNamespace(
        provider="openai", api_key="embedding-key", model="embed", base_url=None,
        endpoint=None, api_version=None,
    )

    result = await conversation._retrieve_agent_context(agent, "question", embeddings)

    assert "a.pdf" in result
    retrieval.assert_awaited_once()
    kwargs = retrieval.await_args.kwargs
    assert kwargs["organization_id"] == agent.organization_id
    assert kwargs["document_uuids"] == ["doc-1"]


@pytest.mark.asyncio
async def test_retrieval_failure_falls_back_without_context(monkeypatch, agent):
    monkeypatch.setattr(
        conversation,
        "retrieve_from_knowledge_base",
        AsyncMock(side_effect=RuntimeError("embedding service unavailable")),
    )
    assert await conversation._retrieve_agent_context(agent, "question", None) == ""


@pytest.mark.asyncio
async def test_tool_iteration_limit_returns_controlled_response(monkeypatch, agent):
    client = FakeClient(
        [FakeMessage(tool_calls=[FakeCall("lookup_order", '{"order_id":"42"}')])]
        * (conversation.MAX_TOOL_ITERATIONS + 1)
    )
    monkeypatch.setattr(conversation, "AsyncOpenAI", lambda **_: SimpleNamespace(chat=SimpleNamespace(completions=client)))
    monkeypatch.setattr(
        conversation,
        "get_effective_ai_model_configuration_for_workflow",
        AsyncMock(llm=SimpleNamespace(provider="openai", model="test", api_key="key"), embeddings=None),
    )
    monkeypatch.setattr(conversation, "_retrieve_agent_context", AsyncMock(return_value=""))
    monkeypatch.setattr(
        conversation,
        "execute_http_tool",
        AsyncMock(return_value={"status": "success"}),
    )

    result = await conversation._generate_reply(agent, [], "Do it")

    assert result is None
    assert len(client.requests) == conversation.MAX_TOOL_ITERATIONS + 1


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("provider", "model", "api_key", "base_url"),
    [
        ("openai", "gpt-4.1-mini", "openai-key", None),
        ("google", "gemini-2.5-flash", "google-key", None),
        ("openrouter", "openai/gpt-4.1", "router-key", "https://openrouter.ai/api/v1"),
    ],
)
async def test_uses_effective_provider_model_credentials_and_base_url(
    monkeypatch, agent, provider, model, api_key, base_url
):
    client = FakeClient([FakeMessage(content="Configured response")])
    client_kwargs = {}
    monkeypatch.setattr(
        conversation,
        "AsyncOpenAI",
        lambda **kwargs: (
            client_kwargs.update(kwargs)
            or SimpleNamespace(chat=SimpleNamespace(completions=client))
        ),
    )
    monkeypatch.setattr(
        conversation,
        "get_effective_ai_model_configuration_for_workflow",
        AsyncMock(
            return_value=SimpleNamespace(
                llm=SimpleNamespace(
                    provider=provider,
                    model=model,
                    api_key=api_key,
                    base_url=base_url,
                ),
                embeddings=None,
            )
        ),
    )
    monkeypatch.setattr(conversation, "_retrieve_agent_context", AsyncMock(return_value=""))

    assert await conversation._generate_reply(agent, [], "Hello") == "Configured response"
    assert client.requests[0]["model"] == model
    assert client_kwargs["api_key"] == api_key
    if base_url:
        assert client_kwargs["base_url"] == base_url
    elif provider == "google":
        assert client_kwargs["base_url"] == "https://generativelanguage.googleapis.com/v1beta/openai/"
    else:
        assert "base_url" not in client_kwargs


@pytest.mark.asyncio
async def test_no_effective_llm_configuration_does_not_use_hardcoded_fallback(
    monkeypatch, agent
):
    create_client = AsyncMock()
    monkeypatch.setattr(conversation, "AsyncOpenAI", create_client)
    monkeypatch.setattr(
        conversation,
        "get_effective_ai_model_configuration_for_workflow",
        AsyncMock(return_value=SimpleNamespace(llm=None, embeddings=None)),
    )
    monkeypatch.setattr(conversation, "_retrieve_agent_context", AsyncMock(return_value=""))

    assert await conversation._generate_reply(agent, [], "Hello") is None
    create_client.assert_not_awaited()


@pytest.mark.asyncio
async def test_no_selected_tools_omits_tools_request(monkeypatch, agent):
    agent.tools = []
    agent.documents = []
    client = FakeClient([FakeMessage(content="Hi")])
    monkeypatch.setattr(conversation, "AsyncOpenAI", lambda **_: SimpleNamespace(chat=SimpleNamespace(completions=client)))
    monkeypatch.setattr(
        conversation,
        "get_effective_ai_model_configuration_for_workflow",
        AsyncMock(llm=SimpleNamespace(provider="openai", model="test", api_key="key"), embeddings=None),
    )

    assert await conversation._generate_reply(agent, [], "Hello") == "Hi"
    assert "tools" not in client.requests[0]
    assert "tool_choice" not in client.requests[0]


@pytest.mark.asyncio
async def test_openwa_media_download_uses_session_chat_and_message_route(monkeypatch):
    request = {}

    class FakeAsyncClient:
        def __init__(self, **kwargs):
            request["timeout"] = kwargs["timeout"]

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return None

        async def get(self, url, headers):
            request.update(url=url, headers=headers)
            return httpx.Response(
                200,
                headers={"content-type": "text/csv"},
                content=b"id,name\n1,Ada\n",
            )

    monkeypatch.setattr("api.services.whatsapp.openwa_client.httpx.AsyncClient", FakeAsyncClient)
    result = await OpenWAClient(
        base_url="http://openwa:2785", api_key="redacted", timeout=12
    ).download_media("session-1", "chat-1@c.us", "message-1")

    assert result == (b"id,name\n1,Ada\n", "text/csv")
    assert request["url"] == (
        "http://openwa:2785/api/sessions/session-1/messages/"
        "chat-1@c.us/message-1/media"
    )
    assert request["headers"] == {"X-API-Key": "redacted"}
    assert request["timeout"] == 12


@pytest.mark.parametrize(
    ("media_type", "media", "filename", "mime"),
    [
        ("document", {"mimetype": "application/pdf", "filename": "resume.pdf", "data": {}}, "resume.pdf", "application/pdf"),
        ("image", {"mimetype": "image/jpeg", "filename": "photo.jpg", "data": {}}, "photo.jpg", "image/jpeg"),
        ("audio", {"mimetype": "audio/ogg", "filename": "voice.ogg", "data": {}}, "voice.ogg", "audio/ogg"),
    ],
)
def test_extracts_simplified_openwa_media(media_type, media, filename, mime):
    from_me, contact, text, extracted = _extract_inbound_message(
        {
            "id": "message-1",
            "chatId": "chat-1@c.us",
            "fromMe": False,
            "body": "",
            "type": media_type,
            "kind": "individual",
            "media": media,
        }
    )
    assert from_me is False
    assert contact == "chat-1@c.us"
    assert text is None
    assert extracted["type"] == media_type
    assert extracted["filename"] == filename
    assert extracted["mime_type"] == mime
    assert extracted["chat_id"] == "chat-1@c.us"
    assert extracted["message_id"] == "message-1"


def test_extracts_nested_raw_media_without_top_level_media():
    _, _, _, extracted = _extract_inbound_message(
        {
            "id": "message-2",
            "from": "chat-2@c.us",
            "fromMe": False,
            "type": "document",
            "message": {
                "documentMessage": {
                    "mimetype": "application/pdf",
                    "fileName": "resume.pdf",
                }
            },
        }
    )
    assert extracted["filename"] == "resume.pdf"
    assert extracted["mime_type"] == "application/pdf"


@pytest.mark.asyncio
async def test_openwa_media_download_failure_returns_none(monkeypatch):
    class FakeAsyncClient:
        def __init__(self, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return None

        async def get(self, url, headers):
            return httpx.Response(500, content=b"failure")

    monkeypatch.setattr("api.services.whatsapp.openwa_client.httpx.AsyncClient", FakeAsyncClient)
    result = await OpenWAClient(api_key="redacted").download_media(
        "session-1", "chat-1@c.us", "message-1"
    )
    assert result is None


# ── Voice note type normalization ───────────────────────────────────────────


@pytest.mark.parametrize(
    "raw_type, expected_type",
    [
        ("voice", "audio"),
        ("ptt", "audio"),
        ("audio", "audio"),
    ],
)
def test_voice_type_ptt_normalized_to_audio(raw_type, expected_type):
    """OpenWA type=voice and type=ptt must normalize to audio."""
    from_me, contact, text, extracted = _extract_inbound_message(
        {
            "id": "message-voice-1",
            "chatId": "chat-1@c.us",
            "fromMe": False,
            "body": "",
            "type": raw_type,
            "kind": "individual",
            "media": {"mimetype": "audio/ogg; codecs=opus", "data": {}},
        }
    )
    assert extracted is not None, f"type={raw_type} should produce media info"
    assert extracted["type"] == "audio", f"type={raw_type} -> expected audio, got {extracted['type']}"
    assert extracted["chat_id"] == "chat-1@c.us"
    assert extracted["message_id"] == "message-voice-1"


def test_extracts_inline_base64_media():
    """When OpenWA sends media inline with base64 data, raw_media is extracted."""
    from_me, contact, text, extracted = _extract_inbound_message(
        {
            "id": "message-inline-1",
            "chatId": "chat-inline@c.us",
            "fromMe": False,
            "body": "",
            "type": "audio",
            "kind": "individual",
            "media": {
                "mimetype": "audio/ogg; codecs=opus",
                "filename": "voice.ogg",
                "data": "T2dnUwACAAAAAAAAA...",
            },
        }
    )
    assert extracted is not None
    assert extracted["raw_media"] == "T2dnUwACAAAAAAAAA..."
    assert extracted["type"] == "audio"
    assert extracted["filename"] == "voice.ogg"
