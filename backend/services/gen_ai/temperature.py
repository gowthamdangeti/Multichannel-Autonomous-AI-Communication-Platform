"""Temperature handling for one-shot LLM calls.

Some models (OpenAI reasoning models such as o1/o3/o4 and the gpt-5/gpt-6
families, often behind an OpenAI-compatible proxy) accept only their default
temperature and reject any other value with a 400 on param ``temperature``.
``create_chat_completion`` is a drop-in for ``client.chat.completions.create``
that leaves temperature out for models known to reject it, and retries once
without it when any other model turns it down, instead of failing the call.
"""

from __future__ import annotations

from typing import Any

from loguru import logger

OPENAI_FIXED_TEMPERATURE_PREFIXES = ("o1", "o3", "o4", "gpt-5", "gpt-6")


def model_fixes_temperature(model: str | None) -> bool:
    """True for models that only accept their default temperature ("azure/gpt-6-luna" included)."""
    name = (model or "").lower().rsplit("/", 1)[-1]
    return name.startswith(OPENAI_FIXED_TEMPERATURE_PREFIXES)


def _rejects_temperature(error: Exception) -> bool:
    """The provider refused the temperature value (any client, any status shape)."""
    if getattr(error, "param", None) == "temperature":
        return True
    text = str(error).lower()
    return "temperature" in text and any(w in text for w in ("unsupported", "not support", "invalid", "only the default"))


async def create_chat_completion(client: Any, **params: Any) -> Any:
    """``client.chat.completions.create(**params)``, tolerant of fixed-temperature models."""
    if "temperature" in params and model_fixes_temperature(params.get("model")):
        params = {k: v for k, v in params.items() if k != "temperature"}
    try:
        return await client.chat.completions.create(**params)
    except Exception as e:  # providers differ in error types; the message decides
        if "temperature" not in params or not _rejects_temperature(e):
            raise
        logger.info(f"Model {params.get('model')!r} rejects temperature={params['temperature']}; retrying with its default")
        params = {k: v for k, v in params.items() if k != "temperature"}
        return await client.chat.completions.create(**params)
