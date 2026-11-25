"""run_inference_with_usage keeps real provider usage instead of estimating."""

from types import SimpleNamespace

import pytest

from api.services.gen_ai.inference_usage import run_inference_with_usage, usage_to_dict


def test_usage_to_dict_keeps_real_tokens_and_cache():
    usage = SimpleNamespace(
        prompt_tokens=377,
        completion_tokens=6,
        total_tokens=383,
        prompt_tokens_details=SimpleNamespace(cached_tokens=256),
    )
    assert usage_to_dict(usage) == {
        "prompt_tokens": 377,
        "completion_tokens": 6,
        "total_tokens": 383,
        "cache_read_input_tokens": 256,
        "cache_creation_input_tokens": 0,
    }
    assert usage_to_dict(None) is None
    assert usage_to_dict(SimpleNamespace(prompt_tokens=0, completion_tokens=0, total_tokens=0)) is None


@pytest.mark.asyncio
async def test_non_openai_service_falls_back_to_run_inference():
    class OtherLLM:
        async def run_inference(self, context, max_tokens=None, system_instruction=None):
            return "text only"

    text, usage = await run_inference_with_usage(OtherLLM(), context=object())
    assert text == "text only"
    assert usage is None  # caller marks its numbers as estimated


@pytest.mark.asyncio
async def test_qa_inference_records_real_usage_and_flags_estimates(monkeypatch):
    from api.services.workflow.qa import analysis

    async def real(llm, context, system_instruction=None):
        return "ok", {
            "prompt_tokens": 100,
            "completion_tokens": 10,
            "total_tokens": 110,
            "cache_read_input_tokens": 64,
            "cache_creation_input_tokens": 0,
        }

    monkeypatch.setattr(analysis, "run_inference_with_usage", real)
    sink: dict = {}
    await analysis._run_llm_inference(None, [{"role": "user", "content": "x"}], "sys", sink)
    await analysis._run_llm_inference(None, [{"role": "user", "content": "y"}], "sys", sink)
    assert sink == {
        "prompt_tokens": 200,
        "completion_tokens": 20,
        "total_tokens": 220,
        "cache_read_input_tokens": 128,
        "cache_creation_input_tokens": 0,
    }

    async def none(llm, context, system_instruction=None):
        return "reply text", None

    monkeypatch.setattr(analysis, "run_inference_with_usage", none)
    est: dict = {}
    await analysis._run_llm_inference(None, [{"role": "user", "content": "z" * 40}], "s" * 40, est)
    assert est["estimated"] is True and est["total_tokens"] > 0
