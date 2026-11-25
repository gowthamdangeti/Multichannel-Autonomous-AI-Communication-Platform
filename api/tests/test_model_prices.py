from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import httpx
import pytest

from api.services.configuration.pricing import resolver, sync
from api.services.configuration.pricing.entries import (
    PriceComponent,
    PriceEntry,
    PriceSource,
    ReviewStatus,
)
from api.services.configuration.pricing.feeds import (
    PriceFetchError,
    fetch_litellm_prices,
    parse_litellm_prices,
    parse_openrouter_prices,
)
from api.services.configuration.pricing.official_prices import list_official_prices


def _entry(rate: str = "2", unit: int = 1_000_000, **kw) -> PriceEntry:
    values = dict(
        provider="openai",
        capability="llm",
        model_id="gpt-x",
        component=PriceComponent.INPUT_TOKEN,
        rate=Decimal(rate),
        unit_quantity=unit,
        source=PriceSource.FEED,
    )
    return PriceEntry(**{**values, **kw})


def _row(rate: str = "2", unit: int = 1_000_000, status=ReviewStatus.APPROVED, row_id=1, **kw):
    values = dict(
        id=row_id,
        provider="openai",
        capability="llm",
        model_id="gpt-x",
        component="input_token",
        rate=Decimal(rate),
        unit_quantity=unit,
        currency="USD",
        source="feed",
        source_url=None,
        tier=None,
        note=None,
        verified_at=None,
        review_status=status.value,
    )
    return SimpleNamespace(**{**values, **kw})


def test_litellm_token_second_and_character_prices():
    entries = parse_litellm_prices(
        {
            "gpt-x": {
                "litellm_provider": "openai",
                "mode": "chat",
                "input_cost_per_token": 2e-06,
                "output_cost_per_token": 8e-06,
                "cache_read_input_token_cost": 5e-07,
            },
            "whisper-x": {
                "litellm_provider": "openai",
                "mode": "audio_transcription",
                "input_cost_per_second": 0.0001,
                "output_cost_per_second": 0.0001,
            },
            "elevenlabs/turbo": {
                "litellm_provider": "elevenlabs",
                "mode": "audio_speech",
                "input_cost_per_character": 8e-05,
            },
        }
    )
    by_key = {(e.model_id, e.component): e for e in entries}
    assert by_key[("gpt-x", PriceComponent.INPUT_TOKEN)].rate == Decimal("2")
    assert by_key[("gpt-x", PriceComponent.CACHED_INPUT_TOKEN)].rate == Decimal("0.5")
    assert by_key[("whisper-x", PriceComponent.AUDIO_SECOND)].rate == Decimal("0.006")
    assert ("whisper-x", PriceComponent.OUTPUT_AUDIO_SECOND) not in by_key
    assert by_key[("turbo", PriceComponent.CHARACTER)].rate == Decimal("80")


def test_litellm_skips_bad_values_and_other_modes():
    entries = parse_litellm_prices(
        {
            "sample_spec": "not a model",
            "a": {"litellm_provider": "openai", "mode": "chat", "input_cost_per_token": "NaN"},
            "b": {"litellm_provider": "openai", "mode": "chat", "input_cost_per_token": -1},
            "c": {"litellm_provider": "openai", "mode": "image_generation", "input_cost_per_token": 1e-6},
            "d": {"litellm_provider": "unknown", "mode": "chat", "input_cost_per_token": 1e-6},
        }
    )
    assert entries == []


def test_litellm_rejects_a_non_object():
    with pytest.raises(PriceFetchError):
        parse_litellm_prices(["not", "an", "object"])


def test_openrouter_keeps_free_models_and_skips_router_sentinels():
    entries = parse_openrouter_prices(
        {
            "data": [
                {"id": "a/free", "pricing": {"prompt": "0", "completion": "0"}},
                {"id": "a/paid", "pricing": {"prompt": "0.000002", "completion": "0.000008"}},
                {"id": "openrouter/auto", "pricing": {"prompt": "-1", "completion": "-1"}},
            ]
        }
    )
    assert {e.model_id for e in entries} == {"a/free", "a/paid"}
    paid = next(e for e in entries if e.model_id == "a/paid" and e.component is PriceComponent.INPUT_TOKEN)
    assert paid.rate == Decimal("2")


@pytest.mark.asyncio
async def test_fetch_failure_raises_price_fetch_error():
    transport = httpx.MockTransport(lambda request: httpx.Response(503))
    async with httpx.AsyncClient(transport=transport) as client:
        with pytest.raises(PriceFetchError):
            await fetch_litellm_prices(client)


def test_compare_new_model_is_added():
    diff = sync.compare_prices(rows=[], entries=[_entry()])
    assert diff.new_entries == [_entry()]
    assert diff.pending_entries == []


def test_compare_unchanged_price_only_refreshes_verified_date():
    diff = sync.compare_prices(rows=[_row(row_id=7)], entries=[_entry()])
    assert diff.verified_ids == [7]
    assert diff.new_entries == diff.pending_entries == []


def test_compare_same_price_in_another_unit_is_unchanged():
    row = _row(rate="3.6", unit=3600, component="audio_second")
    entry = _entry(rate="0.06", unit=60, component=PriceComponent.AUDIO_SECOND)
    assert sync.compare_prices(rows=[row], entries=[entry]).pending_entries == []


def test_compare_changed_price_waits_for_review():
    diff = sync.compare_prices(rows=[_row()], entries=[_entry(rate="3")])
    assert diff.pending_entries == [_entry(rate="3")]
    assert diff.new_entries == []


def test_compare_same_pending_price_is_not_added_twice():
    rows = [_row(), _row(rate="3", status=ReviewStatus.PENDING, row_id=2)]
    diff = sync.compare_prices(rows=rows, entries=[_entry(rate="3")])
    assert diff.pending_entries == [] and diff.superseded_pending_ids == []


def test_compare_newer_change_replaces_older_pending():
    rows = [_row(), _row(rate="3", status=ReviewStatus.PENDING, row_id=2)]
    diff = sync.compare_prices(rows=rows, entries=[_entry(rate="4")])
    assert diff.pending_entries == [_entry(rate="4")]
    assert diff.superseded_pending_ids == [2]


def test_compare_price_back_to_current_clears_pending():
    rows = [_row(row_id=1), _row(rate="3", status=ReviewStatus.PENDING, row_id=2)]
    diff = sync.compare_prices(rows=rows, entries=[_entry()])
    assert diff.superseded_pending_ids == [2]


@pytest.mark.parametrize(
    ("component", "rate", "unit", "currency", "expected"),
    [
        ("audio_second", "0.0077", 60, "USD", "$0.0077/min"),
        ("audio_second", "0.80", 3600, "USD", "$0.0133/min"),
        ("session_second", "0.05", 60, "USD", "$0.05/min"),
        ("input_token", "2", 1_000_000, "USD", "$2.00/1M tokens"),
        ("character", "0.030", 1_000, "USD", "$0.03/1K chars"),
        ("character", "3", 1_000, "INR", "₹3.00/1K chars"),
        ("audio_second", "0.68", 3600, "EUR", "€0.0113/min"),
    ],
)
def test_format_price_line(component, rate, unit, currency, expected):
    assert (
        resolver.format_price_line(
            component=component, rate=Decimal(rate), unit_quantity=unit, currency=currency
        )
        == expected
    )


@pytest.mark.parametrize(
    ("voice", "expected"),
    [("aura-2-thalia-en", "aura-2"), ("aura-helena-en", "aura"), ("custom", "")],
)
def test_deepgram_tts_model_comes_from_the_voice(voice, expected):
    assert (
        resolver.to_price_model_id(provider="deepgram", capability="tts", model="", voice=voice)
        == expected
    )


def test_official_price_outranks_the_feed():
    rows = [_row(source="feed", rate="0.0043"), _row(source="official", rate="0.0077")]
    assert [r.source for r in resolver.select_best_source(rows)] == ["official"]


def _patch_rows(rows):
    client = SimpleNamespace(list_active_prices=AsyncMock(return_value=rows))
    return patch.object(resolver, "ModelPriceClient", return_value=client)


@pytest.mark.asyncio
async def test_unknown_model_is_unavailable_never_a_default():
    with _patch_rows([]):
        price = await resolver.get_model_price(
            provider="openai", capability="llm", model="new-model", voice=None
        )
    assert price.status is resolver.PriceStatus.UNAVAILABLE
    assert price.lines == []


@pytest.mark.asyncio
async def test_self_hosted_provider_has_no_provider_price():
    price = await resolver.get_model_price(
        provider="ollama", capability="llm", model="llama3", voice=None
    )
    assert price.status is resolver.PriceStatus.SELF_HOSTED


@pytest.mark.asyncio
async def test_price_lines_are_in_a_stable_order():
    rows = [_row(component="output_token", rate="8"), _row(component="input_token", rate="2")]
    with _patch_rows(rows):
        price = await resolver.get_model_price(
            provider="openai", capability="llm", model="gpt-x", voice=None
        )
    assert [line.label for line in price.lines] == ["Input", "Output"]


def test_official_prices_are_unique_and_positive():
    entries = list_official_prices()
    assert len({e.key for e in entries}) == len(entries)
    assert all(e.rate > 0 and e.source_url for e in entries)


@pytest.mark.asyncio
async def test_one_failed_source_does_not_stop_the_others():
    price_client = SimpleNamespace(
        list_source_prices=AsyncMock(return_value=[]), apply_source_sync=AsyncMock()
    )
    transport = httpx.MockTransport(lambda request: httpx.Response(500))
    with patch.object(sync, "ModelPriceClient", return_value=price_client):
        async with httpx.AsyncClient(transport=transport) as client:
            results = await sync.execute_price_sync(client=client)
    assert [(r.source, r.status) for r in results] == [
        ("official", "updated"),
        ("provider_api", "failed"),
        ("feed", "failed"),
    ]
