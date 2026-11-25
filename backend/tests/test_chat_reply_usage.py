"""A chat reply keeps what the provider reported, and never replays it back to the provider."""

from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

import api.services.chat.reply as mod


def _fake_openai(sink: dict, *, usage):
    class _Completions:
        async def create(self, **kwargs):
            sink["messages"] = kwargs["messages"]
            message = SimpleNamespace(content=" Hello there ")
            return SimpleNamespace(choices=[SimpleNamespace(message=message)], usage=usage)

    return lambda **_: SimpleNamespace(chat=SimpleNamespace(completions=_Completions()))


def _patch(monkeypatch, sink, usage):
    llm = SimpleNamespace(provider="openai", temperature=None)
    monkeypatch.setattr(
        mod,
        "get_effective_ai_model_configuration_for_workflow",
        AsyncMock(return_value=SimpleNamespace(llm=llm)),
    )
    monkeypatch.setattr(mod, "_openai_params", lambda _llm: (None, "gpt-x", "key"))
    monkeypatch.setattr(mod, "AsyncOpenAI", _fake_openai(sink, usage=usage))


AGENT = SimpleNamespace(id=1, organization_id=2, system_prompt="Be nice", model_config_ref={})


@pytest.mark.asyncio
async def test_reply_carries_provider_usage_and_history_is_stripped(monkeypatch):
    sink: dict = {}
    _patch(monkeypatch, sink, SimpleNamespace(prompt_tokens=12, completion_tokens=3))
    history = [{"role": "assistant", "content": "Hi", "prompt_tokens": 9, "latency_ms": 5}]

    reply = await mod.generate_chat_reply(AGENT, history, "Hello")

    assert sink["messages"][1] == {"role": "assistant", "content": "Hi"}
    message = reply.as_message()
    assert (message["content"], message["prompt_tokens"], message["completion_tokens"]) == ("Hello there", 12, 3)
    assert message["model"] == "gpt-x" and "latency_ms" in message


@pytest.mark.asyncio
async def test_missing_provider_usage_is_not_invented(monkeypatch):
    _patch(monkeypatch, {}, None)

    reply = await mod.generate_chat_reply(AGENT, [], "Hello")

    assert "prompt_tokens" not in reply.as_message()


@pytest.mark.asyncio
async def test_rejected_temperature_is_retried_without_it(monkeypatch):
    calls: list[dict] = []

    class _Completions:
        async def create(self, **kwargs):
            calls.append(kwargs)
            if "temperature" in kwargs:
                raise RuntimeError("Unsupported value: 'temperature' does not support 0.7 with this model")
            message = SimpleNamespace(content="Hi!")
            return SimpleNamespace(choices=[SimpleNamespace(message=message)], usage=None)

    llm = SimpleNamespace(provider="openai", temperature=0.7)
    monkeypatch.setattr(
        mod, "get_effective_ai_model_configuration_for_workflow",
        AsyncMock(return_value=SimpleNamespace(llm=llm)),
    )
    monkeypatch.setattr(mod, "_openai_params", lambda _llm: (None, "gpt-x", "key"))
    monkeypatch.setattr(mod, "AsyncOpenAI", lambda **_: SimpleNamespace(chat=SimpleNamespace(completions=_Completions())))

    reply = await mod.generate_chat_reply(AGENT, [], "Hello")

    assert reply.text == "Hi!"
    assert "temperature" in calls[0] and "temperature" not in calls[1]


@pytest.mark.asyncio
async def test_no_temperature_is_sent_when_the_preset_sets_none(monkeypatch):
    sink: dict = {}
    seen: list[dict] = []

    class _Completions:
        async def create(self, **kwargs):
            seen.append(kwargs)
            return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content="ok"))], usage=None)

    _patch(monkeypatch, sink, None)
    monkeypatch.setattr(mod, "AsyncOpenAI", lambda **_: SimpleNamespace(chat=SimpleNamespace(completions=_Completions())))

    await mod.generate_chat_reply(AGENT, [], "Hello")

    assert "temperature" not in seen[0]


@pytest.mark.asyncio
async def test_model_failure_comes_back_as_a_recordable_failure(monkeypatch):
    class _Completions:
        async def create(self, **kwargs):
            raise RuntimeError("upstream exploded")

    llm = SimpleNamespace(provider="openai", temperature=None)
    monkeypatch.setattr(
        mod, "get_effective_ai_model_configuration_for_workflow",
        AsyncMock(return_value=SimpleNamespace(llm=llm)),
    )
    monkeypatch.setattr(mod, "_openai_params", lambda _llm: (None, "gpt-x", "key"))
    monkeypatch.setattr(mod, "AsyncOpenAI", lambda **_: SimpleNamespace(chat=SimpleNamespace(completions=_Completions())))

    failure = await mod.generate_chat_reply(AGENT, [], "Hello")

    assert isinstance(failure, mod.ChatReplyFailure)
    error = failure.as_error()
    assert (error["reason"], error["model"]) == ("model_error", "gpt-x")
    assert "upstream exploded" in error["message"] and error["at"]
