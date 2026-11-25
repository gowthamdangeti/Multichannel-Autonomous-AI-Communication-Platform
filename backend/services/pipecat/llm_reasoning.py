"""Translate the LLM config's ``reasoning_effort`` into each provider's request shape.

Every LLM config exposes one provider-neutral setting (``auto``, ``none``,
``minimal``, ``low``, ``medium``, ``high``). Providers spell reasoning
differently, so this module maps that single value onto what each API accepts.

``auto`` is the recommended default for voice agents: it keeps reasoning off or
at its lowest level (low latency) and only sends a parameter when the model is
known to accept it. An explicit choice is sent as-is for OpenAI-compatible
APIs, so a custom or proxied model can be fixed by picking ``none``.
"""

from typing import Any

from loguru import logger

AUTO = "auto"
NONE = "none"
EFFORT_LEVELS = ("none", "minimal", "low", "medium", "high")

# Gemini 2.5 thinking budgets (tokens) per effort level.
_GEMINI_BUDGETS = {"minimal": 512, "low": 1024, "medium": 4096, "high": 8192}
# Gemini 2.5 Pro cannot disable thinking; 128 is its smallest budget.
_GEMINI_PRO_MIN_BUDGET = 128

_OPENAI_REASONING_PREFIXES = ("o1", "o3", "o4", "gpt-5", "gpt-6", "gpt-oss")
_THINKING_TOGGLE_FAMILIES = ("qwen3", "deepseek-r1", "magistral", "cogito")


def format_model_name(model: str | None) -> str:
    """Lower-case model id without any ``vendor/`` or proxy prefix."""
    return (model or "").lower().rsplit("/", 1)[-1]


def format_effort(effort: str | None) -> str:
    """Normalise a stored effort value; unknown or empty values mean ``auto``."""
    value = (effort or AUTO).strip().lower()
    return value if value in EFFORT_LEVELS else AUTO


def is_openai_reasoning_model(model: str | None) -> bool:
    """True for OpenAI-family reasoning models (o-series, gpt-5/6, gpt-oss)."""
    name = format_model_name(model)
    if name.startswith("gpt-5") and "chat" in name:
        return False  # gpt-5-chat-latest is a non-reasoning chat model.
    return name.startswith(_OPENAI_REASONING_PREFIXES)


def _is_gpt_oss(model: str | None) -> bool:
    return format_model_name(model).startswith("gpt-oss")


def _has_thinking_toggle(model: str | None) -> bool:
    name = format_model_name(model)
    return any(name.startswith(family) for family in _THINKING_TOGGLE_FAMILIES)


def _auto_openai_effort(model: str | None) -> str | None:
    """Recommended low-latency effort for an OpenAI-family model, or None."""
    name = format_model_name(model)
    if not is_openai_reasoning_model(model):
        return None
    if name.startswith("gpt-6"):
        # gpt-6 rejects function tools on chat completions unless effort is none.
        return NONE
    if name.startswith("gpt-5") or name.startswith("gpt-oss"):
        return "minimal" if name.startswith("gpt-5") else "low"
    return "low"  # o1/o3/o4 do not accept "none" or "minimal".


def format_openai_extra(*, model: str, effort: str | None) -> dict[str, Any]:
    """``extra`` request params for OpenAI and Azure chat completions."""
    value = format_effort(effort)
    if value == AUTO:
        value = _auto_openai_effort(model)
        if value is None:
            return {}
    if format_model_name(model).startswith(("o1", "o3", "o4")) and value in (NONE, "minimal"):
        value = "low"  # o-series rejects none/minimal.
    extra: dict[str, Any] = {"reasoning_effort": value}
    if format_model_name(model).startswith("gpt-5"):
        extra["verbosity"] = "low"  # Shorter spoken answers.
    return extra


def format_groq_extra(*, model: str, effort: str | None) -> dict[str, Any]:
    """Groq: gpt-oss takes low/medium/high; qwen3 only takes none/default."""
    value = format_effort(effort)
    if _is_gpt_oss(model):
        level = "low" if value in (AUTO, NONE, "minimal") else value
        return {"reasoning_effort": level}
    if _has_thinking_toggle(model):
        if value in (AUTO, NONE):
            return {"reasoning_effort": NONE}
        # Keep the <think> text out of the reply so TTS never speaks it.
        return {"reasoning_effort": "default", "reasoning_format": "hidden"}
    _log_ignored(provider="groq", model=model, effort=value)
    return {}


def format_openrouter_extra(*, model: str, effort: str | None) -> dict[str, Any]:
    """OpenRouter's unified ``reasoning`` object; reasoning text is excluded."""
    value = format_effort(effort)
    if value == AUTO:
        value = _auto_openai_effort(model)
        if value is None:
            return {}  # Let OpenRouter apply the model's own default.
    return {"reasoning": {"effort": value, "exclude": True}}


def format_ollama_extra(*, model: str, effort: str | None) -> dict[str, Any]:
    """Ollama OpenAI-compatible API: maps to its ``think`` switch."""
    value = format_effort(effort)
    if _is_gpt_oss(model):
        # gpt-oss cannot turn thinking off; low is the fastest level.
        level = "low" if value in (AUTO, NONE, "minimal") else value
        return {"reasoning_effort": level}
    if value == AUTO:
        return {"reasoning_effort": NONE} if _has_thinking_toggle(model) else {}
    if value == "minimal":
        value = "low"
    return {"reasoning_effort": value}


def format_generic_openai_extra(*, model: str, effort: str | None) -> dict[str, Any]:
    """Other OpenAI-compatible servers (Hugging Face, Speaches)."""
    value = format_effort(effort)
    if value == AUTO:
        value = _auto_openai_effort(model)
        if value is None:
            return {}
    if _is_gpt_oss(model) and value in (NONE, "minimal"):
        value = "low"
    return {"reasoning_effort": value}


def format_sarvam_effort(*, effort: str | None) -> str | None:
    """Sarvam accepts low/medium/high; None keeps thinking off (fastest)."""
    value = format_effort(effort)
    if value in (AUTO, NONE):
        return None
    return "low" if value == "minimal" else value


def format_gemini_thinking(*, model: str, effort: str | None) -> dict[str, Any] | None:
    """Gemini ``thinking`` config, or None to keep pipecat's low-latency default."""
    value = format_effort(effort)
    if value == AUTO:
        return None
    name = format_model_name(model)
    is_pro = "pro" in name
    if name.startswith("gemini-3"):
        if is_pro:  # Gemini 3 Pro only offers low and high.
            return {"thinking_level": "high" if value in ("medium", "high") else "low"}
        return {"thinking_level": "minimal" if value == NONE else value}
    if name.startswith("gemini-2.5"):
        if value == NONE:
            return {"thinking_budget": _GEMINI_PRO_MIN_BUDGET if is_pro else 0}
        return {"thinking_budget": _GEMINI_BUDGETS[value]}
    _log_ignored(provider="google", model=model, effort=value)
    return None


def format_bedrock_fields(*, model: str, effort: str | None) -> dict[str, Any]:
    """Bedrock ``additionalModelRequestFields``; only Nova 2 reasoning is wired.

    Claude extended thinking is not enabled here: the Bedrock adapter does not
    replay thinking blocks, which Claude requires on tool-use turns.
    """
    value = format_effort(effort)
    if value in (AUTO, NONE):
        return {}
    if "nova-2" not in (model or "").lower():
        _log_ignored(provider="aws_bedrock", model=model, effort=value)
        return {}
    level = "low" if value == "minimal" else value
    return {"reasoningConfig": {"type": "enabled", "maxReasoningEffort": level}}


def _log_ignored(*, provider: str, model: str | None, effort: str) -> None:
    if effort in (AUTO, NONE):
        return
    logger.warning(
        f"reasoning_effort={effort} ignored: {provider} model {model!r} "
        "has no supported reasoning control"
    )
