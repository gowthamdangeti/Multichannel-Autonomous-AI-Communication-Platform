"""Tests for the super-admin platform model-config resolution tiers.

Covers get_resolved_ai_model_configuration's new fallback chain:
  per-org override (platform_org) → global default (platform_global) →
  org self-serve (organization_v2) → legacy → empty.

These are pure unit tests — platform_client and the org/legacy lookups are
patched, so no database is required.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

import api.services.configuration.ai_model_configuration as mod
from api.schemas.ai_model_configuration import (
    EffectiveAIModelConfiguration,
    OrganizationAIModelConfigurationV2,
)


def _convozent_blob(api_key: str, voice: str) -> dict:
    return {
        "version": 2,
        "mode": "convozent",
        "convozent": {
            "api_key": api_key,
            "voice": voice,
            "speed": 1.0,
            "language": "multi",
        },
    }


def _patch(
    monkeypatch,
    *,
    org_override=None,
    global_default=None,
    org_self_serve=None,
    legacy=None,
):
    monkeypatch.setattr(
        mod.platform_client,
        "get_org_model_configuration_v2",
        AsyncMock(return_value=org_override),
    )
    monkeypatch.setattr(
        mod.platform_client,
        "get_platform_config_value",
        AsyncMock(return_value=global_default),
    )
    monkeypatch.setattr(
        mod,
        "get_organization_ai_model_configuration_v2",
        AsyncMock(return_value=org_self_serve),
    )
    monkeypatch.setattr(
        mod.db_client,
        "get_user_configurations",
        AsyncMock(return_value=legacy or EffectiveAIModelConfiguration()),
    )
    # No presets by default — keep preset lookups off the DB for these tiers.
    monkeypatch.setattr(
        mod.platform_client,
        "get_model_configuration",
        AsyncMock(return_value=None),
    )
    monkeypatch.setattr(
        mod.platform_client,
        "get_default_model_configuration",
        AsyncMock(return_value=None),
    )


@pytest.mark.asyncio
async def test_global_default_inherited_when_org_has_nothing(monkeypatch):
    _patch(monkeypatch, global_default=_convozent_blob("sk-global", "global-voice"))

    resolved = await mod.get_resolved_ai_model_configuration(
        user_id=5, organization_id=99
    )

    assert resolved.source == "platform_global"
    assert resolved.managed is True
    assert resolved.effective.tts.voice == "global-voice"
    # Keys come from the platform layer, not surfaced via organization_configuration
    assert resolved.organization_configuration is None


@pytest.mark.asyncio
async def test_per_org_override_beats_global_default(monkeypatch):
    _patch(
        monkeypatch,
        org_override=_convozent_blob("sk-org", "org-voice"),
        global_default=_convozent_blob("sk-global", "global-voice"),
    )

    resolved = await mod.get_resolved_ai_model_configuration(
        user_id=5, organization_id=99
    )

    assert resolved.source == "platform_org"
    assert resolved.managed is True
    assert resolved.effective.tts.voice == "org-voice"


@pytest.mark.asyncio
async def test_global_default_overrides_org_self_serve(monkeypatch):
    org_self_serve = OrganizationAIModelConfigurationV2.model_validate(
        _convozent_blob("sk-self", "self-voice")
    )
    _patch(
        monkeypatch,
        global_default=_convozent_blob("sk-global", "global-voice"),
        org_self_serve=org_self_serve,
    )

    resolved = await mod.get_resolved_ai_model_configuration(
        user_id=5, organization_id=99
    )

    assert resolved.source == "platform_global"
    assert resolved.managed is True
    assert resolved.effective.tts.voice == "global-voice"


@pytest.mark.asyncio
async def test_org_self_serve_used_when_no_platform_config(monkeypatch):
    org_self_serve = OrganizationAIModelConfigurationV2.model_validate(
        _convozent_blob("sk-self", "self-voice")
    )
    _patch(monkeypatch, org_self_serve=org_self_serve)

    resolved = await mod.get_resolved_ai_model_configuration(
        user_id=5, organization_id=99
    )

    assert resolved.source == "organization_v2"
    assert resolved.managed is False
    assert resolved.effective.tts.voice == "self-voice"


@pytest.mark.asyncio
async def test_empty_when_nothing_configured(monkeypatch):
    _patch(monkeypatch)

    resolved = await mod.get_resolved_ai_model_configuration(
        user_id=None, organization_id=99
    )

    assert resolved.source == "empty"
    assert resolved.managed is False


@pytest.mark.asyncio
async def test_invalid_global_blob_is_skipped(monkeypatch):
    org_self_serve = OrganizationAIModelConfigurationV2.model_validate(
        _convozent_blob("sk-self", "self-voice")
    )
    # Missing required convozent.api_key → invalid; resolver should fall through.
    _patch(
        monkeypatch,
        global_default={"version": 2, "mode": "convozent", "convozent": {}},
        org_self_serve=org_self_serve,
    )

    resolved = await mod.get_resolved_ai_model_configuration(
        user_id=5, organization_id=99
    )

    assert resolved.source == "organization_v2"
    assert resolved.managed is False


@pytest.mark.asyncio
async def test_workflow_overrides_merge_on_platform_config(monkeypatch):
    _patch(monkeypatch, global_default=_convozent_blob("sk-global", "global-voice"))

    effective = await mod.get_effective_ai_model_configuration_for_workflow(
        user_id=5,
        organization_id=99,
        workflow_configurations={"model_overrides": {"tts": {"voice": "wf-voice"}}},
    )

    # Workflow override wins for voice; platform key/provider still underneath.
    assert effective.tts.voice == "wf-voice"


def test_compile_v2_blob_returns_none_for_invalid():
    assert mod._compile_v2_blob(None) is None
    assert mod._compile_v2_blob({}) is None
    assert mod._compile_v2_blob({"version": 2, "mode": "convozent", "convozent": {}}) is None


# ---------------------------------------------------------------------------
# Preset selection (admin-defined named configurations)
# ---------------------------------------------------------------------------


def _preset(config_id: int, name: str, *, voice: str, is_active: bool = True):
    return SimpleNamespace(
        id=config_id,
        name=name,
        description=None,
        is_active=is_active,
        config=_convozent_blob(f"sk-{config_id}", voice),
    )


@pytest.mark.asyncio
async def test_selected_preset_takes_effect(monkeypatch):
    preset = _preset(3, "English Sarvam India", voice="sarvam-voice")
    monkeypatch.setattr(
        mod.platform_client,
        "get_model_configuration",
        AsyncMock(return_value=preset),
    )
    monkeypatch.setattr(
        mod.platform_client,
        "get_default_model_configuration",
        AsyncMock(return_value=None),
    )

    effective = await mod.get_effective_ai_model_configuration_for_workflow(
        user_id=1,
        organization_id=2,
        workflow_configurations={"platform_model_configuration_id": 3},
    )

    assert effective.tts.voice == "sarvam-voice"


@pytest.mark.asyncio
async def test_inactive_selected_preset_falls_back_to_default(monkeypatch):
    inactive = _preset(3, "Retired", voice="old-voice", is_active=False)
    default = _preset(9, "Default", voice="default-voice")
    monkeypatch.setattr(
        mod.platform_client,
        "get_model_configuration",
        AsyncMock(return_value=inactive),
    )
    monkeypatch.setattr(
        mod.platform_client,
        "get_default_model_configuration",
        AsyncMock(return_value=default),
    )

    effective = await mod.get_effective_ai_model_configuration_for_workflow(
        user_id=1,
        organization_id=2,
        workflow_configurations={"platform_model_configuration_id": 3},
    )

    assert effective.tts.voice == "default-voice"


@pytest.mark.asyncio
async def test_no_selection_uses_default_preset(monkeypatch):
    default = _preset(9, "Default", voice="default-voice")
    monkeypatch.setattr(
        mod.platform_client,
        "get_model_configuration",
        AsyncMock(return_value=None),
    )
    monkeypatch.setattr(
        mod.platform_client,
        "get_default_model_configuration",
        AsyncMock(return_value=default),
    )

    effective = await mod.get_effective_ai_model_configuration_for_workflow(
        user_id=1,
        organization_id=2,
        workflow_configurations={},
    )

    assert effective.tts.voice == "default-voice"


@pytest.mark.asyncio
async def test_org_options_endpoint_exposes_no_keys(monkeypatch):
    import api.routes.organization as org_routes

    preset = _preset(3, "English Sarvam India", voice="sarvam-voice")
    monkeypatch.setattr(
        org_routes.platform_client,
        "list_active_model_configurations",
        AsyncMock(return_value=[preset]),
    )

    options = await org_routes.get_model_configuration_options(
        SimpleNamespace(id=1, selected_organization_id=2)
    )

    assert len(options) == 1
    dumped = options[0].model_dump()
    assert set(dumped) == {"id", "name", "description"}
    assert "sk-3" not in str(dumped)
    assert "config" not in dumped and "api_key" not in dumped


@pytest.mark.asyncio
async def test_no_preset_falls_through_to_resolver_chain(monkeypatch):
    # No presets at all → existing resolver chain (global default here).
    _patch(monkeypatch, global_default=_convozent_blob("sk-global", "global-voice"))

    effective = await mod.get_effective_ai_model_configuration_for_workflow(
        user_id=1,
        organization_id=2,
        workflow_configurations={},
    )

    assert effective.tts.voice == "global-voice"
