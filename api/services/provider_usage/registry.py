"""Which providers can report billed usage back to us.

Add a provider here only when its API returns a per-request record we can tie
to a run, and a real call has been compared against its console. Everything
else stays labelled as estimated on the run page.
"""

from __future__ import annotations

from api.services.provider_usage.soniox import SonioxUsageFetcher
from api.services.provider_usage.types import ProviderUsageFetcher, RunUsageContext

_FETCHERS: dict[str, ProviderUsageFetcher] = {"soniox": SonioxUsageFetcher()}


def get_usage_fetcher(provider: str | None) -> ProviderUsageFetcher | None:
    return _FETCHERS.get(provider or "")


def list_usage_providers() -> list[str]:
    return list(_FETCHERS)


def has_usage_fetcher(provider: str | None) -> bool:
    return get_usage_fetcher(provider) is not None


def list_tracked_providers(*, context: RunUsageContext) -> list[str]:
    """Providers on this run that will report billed usage, without repeats."""
    if not context.reference:
        return []
    providers = (context.stt_provider, context.tts_provider)
    return [p for p in dict.fromkeys(providers) if p and has_usage_fetcher(p)]
