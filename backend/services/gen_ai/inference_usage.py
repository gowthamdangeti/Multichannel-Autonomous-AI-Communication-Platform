"""One-shot LLM inference that keeps the provider's real token usage.

pipecat's ``LLMService.run_inference()`` returns only the reply text, so
callers (completeness, QA) had to estimate tokens as ``len(text) // 4`` and
could never report cache hits. For OpenAI-compatible services (OpenAI,
DeepSeek and other base_url providers, Groq, OpenRouter, Ollama, Azure...)
this builds the exact same request as ``run_inference()`` and returns the
response's ``usage`` alongside the text.

Other providers (Google, Anthropic, AWS...) fall back to ``run_inference()``
with usage ``None`` so the caller can mark its numbers as estimated.
"""

from __future__ import annotations

from typing import Any, Optional

from loguru import logger
from pipecat.processors.aggregators.llm_context import LLMContext

from api.services.workflow.usage_contract import cached_prompt_tokens


def usage_to_dict(usage: Any) -> Optional[dict]:
    """Provider usage object -> the usage_info dict shape used everywhere."""
    if usage is None:
        return None
    prompt = int(getattr(usage, "prompt_tokens", 0) or 0)
    completion = int(getattr(usage, "completion_tokens", 0) or 0)
    total = int(getattr(usage, "total_tokens", 0) or 0) or (prompt + completion)
    if prompt + completion + total <= 0:
        return None
    return {
        "prompt_tokens": prompt,
        "completion_tokens": completion,
        "total_tokens": total,
        "cache_read_input_tokens": cached_prompt_tokens(usage),
        "cache_creation_input_tokens": int(
            getattr(usage, "cache_creation_input_tokens", 0) or 0
        ),
    }


async def run_inference_with_usage(
    llm: Any,
    context: LLMContext,
    system_instruction: Optional[str] = None,
    max_tokens: Optional[int] = None,
) -> tuple[Optional[str], Optional[dict]]:
    """Return ``(text, usage_dict)``; ``usage_dict`` is None when unavailable."""
    try:
        from pipecat.services.openai.base_llm import BaseOpenAILLMService
    except Exception:  # pragma: no cover - pipecat always ships this
        BaseOpenAILLMService = None  # type: ignore[assignment]

    client = getattr(llm, "_client", None)
    if BaseOpenAILLMService is None or not isinstance(llm, BaseOpenAILLMService) or client is None:
        text = await llm.run_inference(
            context, max_tokens=max_tokens, system_instruction=system_instruction
        )
        return text, None

    # Mirror BaseOpenAILLMService.run_inference() exactly, keeping response.usage.
    effective_instruction = system_instruction or llm._settings.system_instruction
    adapter = llm.get_llm_adapter()
    invocation_params = adapter.get_llm_invocation_params(
        context,
        system_instruction=effective_instruction,
        convert_developer_to_user=not llm.supports_developer_role,
    )
    params = llm.build_chat_completion_params(invocation_params)
    params["stream"] = False
    params.pop("stream_options", None)
    if max_tokens is not None:
        if "max_completion_tokens" in params:
            params["max_completion_tokens"] = max_tokens
        else:
            params["max_tokens"] = max_tokens

    response = await client.chat.completions.create(**params)
    text = response.choices[0].message.content if response.choices else None
    usage = usage_to_dict(getattr(response, "usage", None))
    if usage is None:
        logger.debug("LLM response carried no usage; caller will estimate tokens")
    return text, usage
