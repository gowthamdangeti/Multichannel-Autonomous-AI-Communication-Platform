"""OpenAI-compatible LLM params for the simple text-reply agents.

The chat + WhatsApp agents call the configured LLM through the OpenAI SDK (one
request/response, no pipeline). Providers expose OpenAI-compatible endpoints at
different base URLs, so we map the resolved provider to the right one. Anything
not listed uses whatever ``base_url`` the model config carries (or the SDK
default, which targets OpenAI).
"""

from __future__ import annotations

from typing import Optional, Tuple

# Provider value (ServiceProviders.*.value) -> OpenAI-compatible base URL.
_PROVIDER_BASE_URLS: dict[str, Optional[str]] = {
    "openai": None,  # OpenAI SDK default
    "google": "https://generativelanguage.googleapis.com/v1beta/openai/",
    "google_realtime": "https://generativelanguage.googleapis.com/v1beta/openai/",
    "groq": "https://api.groq.com/openai/v1",
    "openrouter": "https://openrouter.ai/api/v1",
    "anthropic": "https://api.anthropic.com/v1/",
    "deepseek": "https://api.deepseek.com",
    "xai": "https://api.x.ai/v1",
    "cerebras": "https://api.cerebras.ai/v1",
}


def _first(value) -> str:
    if isinstance(value, (list, tuple)):
        return str(value[0]) if value else ""
    return str(value) if value is not None else ""


def resolve_temperature(llm, *, default: float) -> float:
    """The preset's configured temperature, or `default` when it left it empty."""
    configured = getattr(llm, "temperature", None)
    return default if configured is None else float(configured)


def openai_params(llm) -> Tuple[Optional[str], str, str]:
    """Return (base_url, model, api_key) for an OpenAI-compatible call to `llm`."""
    provider = getattr(llm, "provider", None)
    provider_val = getattr(provider, "value", provider)
    api_key = _first(getattr(llm, "api_key", None))
    model = getattr(llm, "model", None) or "default"
    base_url = getattr(llm, "base_url", None)
    if not base_url and provider_val in _PROVIDER_BASE_URLS:
        base_url = _PROVIDER_BASE_URLS[provider_val]
    if provider_val == "anthropic" and not getattr(llm, "base_url", None):
        from loguru import logger
        logger.warning(
            "Anthropic provider does not expose an OpenAI-compatible /chat/completions endpoint directly. "
            "For WhatsApp/Chat agents, configure OpenRouter with an Anthropic model or use OpenAI/Google/DeepSeek/Groq."
        )
    return base_url, str(model), api_key
