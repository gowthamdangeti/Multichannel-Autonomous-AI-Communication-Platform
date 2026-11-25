"""The agent builder must generate with the LLM of the preset the user picked.

Unit tests only — the effective-config lookup and the OpenAI client are
patched, so no database or network is needed.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock

import httpx
import pytest

import api.services.workflow.template_generation as mod

_BUILDER_ARGS = dict(
    call_type="inbound",
    use_case="Support",
    activity_description="Answer questions",
    organization_id=2,
    user_id=1,
)


class _FakeCompletions:
    def __init__(self, sink: dict):
        self._sink = sink

    async def create(self, **kwargs):
        self._sink["model"] = kwargs["model"]
        # An empty reply makes the builder retry, then give up — enough to
        # observe which client/model it used without a real workflow graph.
        message = SimpleNamespace(content="")
        return SimpleNamespace(choices=[SimpleNamespace(message=message)])


def _fake_openai(sink: dict):
    def factory(**kwargs):
        sink["api_key"] = kwargs.get("api_key")
        sink["base_url"] = kwargs.get("base_url")
        return SimpleNamespace(chat=SimpleNamespace(completions=_FakeCompletions(sink)))

    return factory


@pytest.mark.asyncio
async def test_selected_preset_id_is_passed_to_config_resolution(monkeypatch):
    resolve = AsyncMock(return_value=SimpleNamespace(llm=None))
    monkeypatch.setattr(mod, "get_effective_ai_model_configuration_for_workflow", resolve)

    with pytest.raises(mod.WorkflowGenerationError):
        await mod.generate_workflow_from_description(
            **_BUILDER_ARGS, platform_model_configuration_id=6
        )

    assert resolve.await_args.kwargs["workflow_configurations"] == {
        "platform_model_configuration_id": 6
    }


@pytest.mark.asyncio
async def test_no_selection_keeps_the_default_fallback(monkeypatch):
    resolve = AsyncMock(return_value=SimpleNamespace(llm=None))
    monkeypatch.setattr(mod, "get_effective_ai_model_configuration_for_workflow", resolve)

    with pytest.raises(mod.WorkflowGenerationError):
        await mod.generate_workflow_from_description(**_BUILDER_ARGS)

    assert resolve.await_args.kwargs["workflow_configurations"] == {}


@pytest.mark.asyncio
async def test_builder_calls_the_selected_presets_llm(monkeypatch):
    llm = SimpleNamespace(
        provider="openai",
        api_key="sk-preset-6",
        model="azure/gpt-6-luna",
        base_url="https://proxy.example/v1",
    )
    monkeypatch.setattr(
        mod,
        "get_effective_ai_model_configuration_for_workflow",
        AsyncMock(return_value=SimpleNamespace(llm=llm)),
    )
    sink: dict = {}
    monkeypatch.setattr(mod, "AsyncOpenAI", _fake_openai(sink))

    with pytest.raises(mod.WorkflowGenerationError):
        await mod.generate_workflow_from_description(
            **_BUILDER_ARGS, platform_model_configuration_id=6
        )

    assert sink["api_key"] == "sk-preset-6"
    assert sink["base_url"] == "https://proxy.example/v1"
    assert sink["model"] == "azure/gpt-6-luna"


def _temperature_rejected() -> mod.BadRequestError:
    request = httpx.Request("POST", "https://proxy.example/v1/chat/completions")
    response = httpx.Response(400, request=request)
    return mod.BadRequestError(
        "Unsupported value: 'temperature' does not support 0.4 with this model.",
        response=response,
        body={"param": "temperature", "code": "unsupported_value"},
    )


@pytest.mark.asyncio
async def test_model_that_rejects_temperature_is_retried_with_its_default():
    calls: list[dict] = []

    async def create(**kwargs):
        calls.append(kwargs)
        if "temperature" in kwargs:
            raise _temperature_rejected()
        return "ok"

    client = SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=create)))

    result = await mod._create_completion(
        client, model="m", messages=[], temperature=0.4
    )

    assert result == "ok"
    assert [("temperature" in c) for c in calls] == [True, False]


@pytest.mark.asyncio
async def test_other_bad_requests_are_not_swallowed():
    request = httpx.Request("POST", "https://proxy.example/v1/chat/completions")
    error = mod.BadRequestError(
        "bad model", response=httpx.Response(400, request=request), body={"param": "model"}
    )

    async def create(**kwargs):
        raise error

    client = SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=create)))

    with pytest.raises(mod.BadRequestError):
        await mod._create_completion(client, model="m", messages=[], temperature=0.4)


def test_resolve_temperature_prefers_the_presets_value():
    from api.services.agents_llm import resolve_temperature

    assert resolve_temperature(SimpleNamespace(temperature=0.9), default=0.4) == 0.9
    assert resolve_temperature(SimpleNamespace(temperature=0), default=0.4) == 0.0
    assert resolve_temperature(SimpleNamespace(temperature=None), default=0.4) == 0.4
    assert resolve_temperature(SimpleNamespace(), default=0.4) == 0.4


def test_pipeline_openai_temperature_honours_explicit_value():
    from api.services.pipecat.service_factory import _format_openai_temperature

    # Explicit wins — even on a model name the factory would otherwise treat as fixed.
    assert _format_openai_temperature(model="o3", extra={}, temperature=0.7) == {
        "temperature": 0.7
    }
    # Unset keeps the previous behaviour: 0.1 for chat models, none for reasoning.
    assert _format_openai_temperature(model="gpt-4.1", extra={}) == {"temperature": 0.1}
    assert _format_openai_temperature(model="o3", extra={}) == {}


def test_every_llm_provider_config_exposes_an_optional_temperature():
    from api.services.configuration.registry import OpenAILLMService

    field = OpenAILLMService.model_fields["temperature"]
    assert field.default is None
    assert OpenAILLMService(api_key="k").temperature is None
    assert OpenAILLMService(api_key="k", temperature=0.5).temperature == 0.5
