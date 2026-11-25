"""Reasoning-effort mapping per LLM provider (no network calls are made)."""

import pytest

from api.services.configuration.registry import (
    AWSBedrockLLMConfiguration,
    GroqLLMService,
    OpenAILLMService,
    SarvamLLMConfiguration,
)
from api.services.pipecat import llm_reasoning as r
from api.services.pipecat.service_factory import create_llm_service_from_provider


class TestConfigDefaults:
    def test_default_is_recommended_auto(self):
        assert OpenAILLMService(api_key="k").reasoning_effort == "auto"
        assert GroqLLMService(api_key="k").reasoning_effort == "auto"
        assert SarvamLLMConfiguration(api_key="k").reasoning_effort == "auto"

    def test_schema_offers_dropdown_options(self):
        prop = AWSBedrockLLMConfiguration.model_json_schema()["properties"]["reasoning_effort"]
        assert prop["default"] == "auto"
        assert prop["enum"] == ["auto", "none", "minimal", "low", "medium", "high"]

    def test_saved_configs_without_field_still_load(self):
        cfg = OpenAILLMService.model_validate({"api_key": "k", "model": "gpt-4.1"})
        assert cfg.reasoning_effort == "auto"


class TestOpenAIMapping:
    @pytest.mark.parametrize(
        "model,expected",
        [
            ("gpt-4.1", {}),
            ("azure/gpt-6-luna", {"reasoning_effort": "none"}),
            ("gpt-5-mini", {"reasoning_effort": "minimal", "verbosity": "low"}),
            ("o3-mini", {"reasoning_effort": "low"}),
            ("gpt-5-chat-latest", {}),
        ],
    )
    def test_auto(self, model, expected):
        assert r.format_openai_extra(model=model, effort="auto") == expected

    def test_explicit_value_is_sent_for_custom_proxy_model(self):
        assert r.format_openai_extra(model="my-proxy-model", effort="none") == {
            "reasoning_effort": "none"
        }

    def test_o_series_never_gets_none(self):
        assert r.format_openai_extra(model="o4-mini", effort="none") == {
            "reasoning_effort": "low"
        }

    def test_unknown_value_falls_back_to_auto(self):
        assert r.format_openai_extra(model="gpt-4.1", effort="bogus") == {}


class TestOtherProviders:
    def test_groq(self):
        assert r.format_groq_extra(model="openai/gpt-oss-20b", effort="auto") == {
            "reasoning_effort": "low"
        }
        assert r.format_groq_extra(model="qwen/qwen3-32b", effort="auto") == {
            "reasoning_effort": "none"
        }
        assert r.format_groq_extra(model="qwen/qwen3-32b", effort="high") == {
            "reasoning_effort": "default",
            "reasoning_format": "hidden",
        }
        assert r.format_groq_extra(model="llama-3.1-8b-instant", effort="high") == {}

    def test_openrouter(self):
        assert r.format_openrouter_extra(model="anthropic/claude-sonnet-4", effort="auto") == {}
        assert r.format_openrouter_extra(model="x/y", effort="medium") == {
            "reasoning": {"effort": "medium", "exclude": True}
        }

    def test_ollama(self):
        assert r.format_ollama_extra(model="qwen3:0.6b", effort="auto") == {
            "reasoning_effort": "none"
        }
        assert r.format_ollama_extra(model="llama3", effort="auto") == {}
        assert r.format_ollama_extra(model="gpt-oss:20b", effort="none") == {
            "reasoning_effort": "low"
        }

    def test_sarvam(self):
        assert r.format_sarvam_effort(effort="auto") is None
        assert r.format_sarvam_effort(effort="minimal") == "low"
        assert r.format_sarvam_effort(effort="high") == "high"

    @pytest.mark.parametrize(
        "model,effort,expected",
        [
            ("gemini-2.0-flash", "high", None),
            ("gemini-2.5-flash", "auto", None),
            ("gemini-2.5-flash", "none", {"thinking_budget": 0}),
            ("gemini-2.5-pro", "none", {"thinking_budget": 128}),
            ("gemini-2.5-flash", "medium", {"thinking_budget": 4096}),
            ("gemini-3-flash", "none", {"thinking_level": "minimal"}),
            ("gemini-3-pro", "medium", {"thinking_level": "high"}),
        ],
    )
    def test_gemini(self, model, effort, expected):
        assert r.format_gemini_thinking(model=model, effort=effort) == expected

    def test_bedrock_only_nova_2(self):
        assert r.format_bedrock_fields(model="us.amazon.nova-2-lite-v1:0", effort="low") == {
            "reasoningConfig": {"type": "enabled", "maxReasoningEffort": "low"}
        }
        assert r.format_bedrock_fields(
            model="us.anthropic.claude-sonnet-4-20250514-v1:0", effort="high"
        ) == {}


class TestFactoryWiring:
    def test_openai_reasoning_drops_temperature(self):
        svc = create_llm_service_from_provider(
            "openai", "azure/gpt-6-luna", "k", reasoning_effort="auto"
        )
        assert svc._settings.extra == {"reasoning_effort": "none"}

    def test_openai_chat_model_keeps_low_temperature(self):
        svc = create_llm_service_from_provider("openai", "gpt-4.1", "k")
        assert svc._settings.extra == {}
        assert svc._settings.temperature == 0.1

    def test_groq_receives_extra(self):
        svc = create_llm_service_from_provider(
            "groq", "qwen/qwen3-32b", "k", reasoning_effort="none"
        )
        assert svc._settings.extra == {"reasoning_effort": "none"}

    def test_sarvam_receives_effort(self):
        svc = create_llm_service_from_provider(
            "sarvam", "sarvam-30b", "k", reasoning_effort="medium"
        )
        assert svc._settings.reasoning_effort == "medium"
