"""Every provider x every model x STT / TTS / STS (realtime).

For each combination:
1. the language list loads and the default language is offered;
2. every offered language passes the save-time check;
3. every offered language survives loading into the real config class
   (the normalizers don't turn it into something that isn't offered);
4. the pipecat service builds with the default language, auto-detect (when
   offered) and the last language in the list.

No network: services are only constructed, never connected.
"""

from __future__ import annotations

import json
from types import SimpleNamespace

import pytest

from api.services.configuration.provider_catalog import (
    _property,
    language_catalog,
    unsupported_language_message,
)
from api.services.configuration.registry import REGISTRY, ServiceType
from api.services.pipecat.audio_config import AudioConfig
from api.services.pipecat.service_factory import (
    create_realtime_llm_service,
    create_stt_service,
    create_tts_service,
)

AUDIO = AudioConfig(transport_in_sample_rate=16000, transport_out_sample_rate=16000)
CAPABILITIES = {ServiceType.STT: "stt", ServiceType.TTS: "tts", ServiceType.REALTIME: "realtime"}
AUTO = {"auto", "multi", "unknown", "mul"}

# Registered but not runnable: the factory branch was removed with the managed
# (MPS) services in bb00e1c. Selecting them fails at call start.
NOT_RUNNABLE = {("stt", "convozent"), ("tts", "convozent")}
# Constructing these contacts Google for a token, so they need real credentials.
NEEDS_NETWORK_TO_BUILD = {("realtime", "google_vertex_realtime")}


def _google_credentials() -> str:
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric import rsa

    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    pem = key.private_bytes(
        serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()
    ).decode()
    return json.dumps({
        "type": "service_account", "project_id": "test-project", "private_key_id": "k1",
        "private_key": pem, "client_email": "svc@test-project.iam.gserviceaccount.com",
        "client_id": "1", "token_uri": "https://oauth2.googleapis.com/token",
    })


GOOGLE_CREDENTIALS = _google_credentials()
REQUIRED_DUMMIES = {
    "api_key": "test-key", "group_id": "group", "endpoint": "https://example.openai.azure.com",
    "region": "eastus", "base_url": "https://example.com/v1", "url": "wss://example.com/ws",
    "credentials": GOOGLE_CREDENTIALS, "project_id": "test-project", "location": "us-central1",
}


def _models(schema) -> list[str | None]:
    prop = _property(schema, "model")
    if not prop or prop.get("readOnly"):
        return [None]
    models = list(dict.fromkeys((prop.get("examples") or []) + (prop.get("enum") or [])))
    return models or [prop.get("default")]


def _combinations():
    for service_type, capability in CAPABILITIES.items():
        for provider, config_cls in REGISTRY[service_type].items():
            provider = getattr(provider, "value", provider)
            for model in _models(config_cls.model_json_schema()):
                yield pytest.param(capability, provider, model, id=f"{capability}-{provider}-{model or 'default'}")


def _config(capability, provider, model, language):
    service_type = next(t for t, c in CAPABILITIES.items() if c == capability)
    config_cls = REGISTRY[service_type][provider]
    schema = config_cls.model_json_schema()
    props = schema.get("properties", {})
    data = {k: v for k, v in REQUIRED_DUMMIES.items() if k in schema.get("required", [])}
    if "api_key" in props:
        data["api_key"] = "test-key"
    if "credentials" in props and provider.startswith("google"):
        data["credentials"] = GOOGLE_CREDENTIALS
    if model and "model" in props and not props["model"].get("readOnly"):
        data["model"] = model
    if language is not None and "language" in props:
        data["language"] = language
    return config_cls(**data)


def _codes(catalog):
    return [l.code for g in catalog.groups for l in g.locales]


@pytest.mark.parametrize("capability,provider,model", list(_combinations()))
def test_language_list_and_save_check(capability, provider, model):
    catalog = language_catalog(provider, capability, model)
    codes = _codes(catalog)
    if not codes:
        pytest.skip("provider has no language setting")
    assert catalog.default in codes
    rejected = [c for c in codes if unsupported_language_message(provider, capability, model, c)]
    assert rejected == [], f"offered but rejected on save: {rejected}"


@pytest.mark.parametrize("capability,provider,model", list(_combinations()))
def test_every_offered_language_loads_unchanged(capability, provider, model):
    codes = _codes(language_catalog(provider, capability, model))
    if not codes:
        pytest.skip("provider has no language setting")
    changed = {}
    for code in codes:
        loaded = _config(capability, provider, model, code).language
        if loaded not in codes:
            changed[code] = loaded
    assert changed == {}, f"normalizer turned offered codes into unoffered ones: {changed}"


@pytest.mark.parametrize("capability,provider,model", list(_combinations()))
async def test_service_builds_for_each_kind_of_language(capability, provider, model):
    if (capability, provider) in NOT_RUNNABLE:
        pytest.skip("registered but has no service factory branch (removed in bb00e1c)")
    if (capability, provider) in NEEDS_NETWORK_TO_BUILD:
        pytest.skip("service construction needs real Google credentials")
    catalog = language_catalog(provider, capability, model)
    codes = _codes(catalog)
    picks = [catalog.default, next((c for c in codes if c.lower() in AUTO), None), codes[-1] if codes else None]
    for language in dict.fromkeys(p for p in picks if p) or [None]:
        config = _config(capability, provider, model, language)
        holder = SimpleNamespace(**{capability: config})
        if capability == "stt":
            service = create_stt_service(holder, AUDIO)
        elif capability == "tts":
            service = create_tts_service(holder, AUDIO)
        else:
            service = create_realtime_llm_service(holder, AUDIO)
        assert service is not None, language
        session = getattr(service, "_session", None)
        if session is not None and hasattr(session, "close"):
            await session.close()


@pytest.mark.parametrize(
    "provider",
    ["openai_realtime", "azure_realtime", "grok_realtime", "ultravox_realtime", "google_realtime", "google_vertex_realtime"],
)
def test_every_sts_provider_offers_multilingual(provider):
    catalog = language_catalog(provider, "realtime")
    auto = [l for g in catalog.groups for l in g.locales if l.is_auto_detect]
    assert [l.code for l in auto] == ["multi"]
    assert auto[0].label == "Multilingual (auto-detect)"
    assert unsupported_language_message(provider, "realtime", None, "multi") is None


@pytest.mark.parametrize("saved", ["multi", "auto", "unknown"])
def test_sts_auto_detect_sends_no_language(saved):
    from unittest.mock import patch

    config = _config("realtime", "google_realtime", None, saved)
    assert config.language in ("multi", "auto", "unknown")
    with patch("api.services.pipecat.service_factory.logger") as log:
        create_realtime_llm_service(SimpleNamespace(realtime=config), AUDIO)
    created = " ".join(str(c) for c in log.info.call_args_list)
    assert "language=auto-detect" in created
