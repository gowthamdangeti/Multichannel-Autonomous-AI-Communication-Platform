"""Tests for the embed pre-call form resolution and validation."""

from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.routes import public_embed
from api.schemas.embed import PreCallFormSettings
from api.services.embed.pre_call_form import (
    build_pre_call_form,
    has_unpublished_variable_changes,
    normalize_embed_settings,
    validate_and_merge_context,
    validate_pre_call_form_settings,
)

_DEFINITION = SimpleNamespace(
    template_context_variables={"customer_name": None, "company": "Acme"},
    workflow_json=None,
)
_WORKFLOW = SimpleNamespace(
    released_definition=_DEFINITION,
    current_definition=None,
    template_context_variables={},
)
_SETTINGS = {
    "preCallForm": {
        "enabled": True,
        "title": "Tell us about you",
        "fields": {
            "customer_name": {"required": True, "type": "text"},
            "company": {"editable": False},
        },
    },
    "apiKey": "should-not-leak",
}
_TOKEN = SimpleNamespace(
    id=1,
    token="embed-token",
    is_active=True,
    expires_at=None,
    allowed_domains=[],
    workflow_id=5,
    created_by=7,
    usage_limit=None,
    usage_count=0,
    settings=_SETTINGS,
)


@pytest.fixture(autouse=True)
def _patch_db(monkeypatch):
    public_embed._init_attempts.clear()
    captured = {}

    async def _get_token(token):
        return _TOKEN if token == "embed-token" else None

    async def _get_token_by_id(token_id):
        return _TOKEN if token_id == _TOKEN.id else None

    async def _get_workflow_by_id(workflow_id):
        return _WORKFLOW if workflow_id == _TOKEN.workflow_id else None

    async def _create_workflow_run(**kwargs):
        captured["create_workflow_run"] = kwargs
        return SimpleNamespace(id=123)

    async def _noop(*_args, **_kwargs):
        return None

    monkeypatch.setattr(
        "api.routes.public_embed.db_client.get_embed_token_by_token", _get_token
    )
    monkeypatch.setattr(
        "api.routes.public_embed.db_client.get_embed_token_by_id", _get_token_by_id
    )
    monkeypatch.setattr(
        "api.routes.public_embed.db_client.get_workflow_by_id", _get_workflow_by_id
    )
    monkeypatch.setattr(
        "api.routes.public_embed.db_client.create_workflow_run",
        _create_workflow_run,
    )
    monkeypatch.setattr("api.routes.public_embed.db_client.create_embed_session", _noop)
    monkeypatch.setattr(
        "api.routes.public_embed.db_client.increment_embed_token_usage", _noop
    )
    return captured


@pytest.fixture
def client():
    app = FastAPI()
    app.include_router(public_embed.router, prefix="/api/v1")
    return TestClient(app, raise_server_exceptions=False)


def _config(client):
    return client.get(
        "/api/v1/public/embed/config/embed-token",
        headers={"Origin": "https://example.com"},
    )


def _init(client, payload):
    return client.post(
        "/api/v1/public/embed/init",
        headers={"Origin": "https://example.com"},
        json={"token": "embed-token", **payload},
    )


def test_config_exposes_form_but_not_locked_values_or_private_settings(client):
    resp = _config(client)

    assert resp.status_code == 200
    body = resp.json()
    assert "apiKey" not in body["settings"]
    assert "preCallForm" not in body["settings"]

    fields = {field["name"]: field for field in body["pre_call_form"]["fields"]}
    assert fields["customer_name"]["editable"] is True
    assert fields["customer_name"]["required"] is True
    assert fields["customer_name"]["value"] is None
    assert fields["company"]["editable"] is False
    assert fields["company"]["has_value"] is True
    assert fields["company"]["value"] is None


def test_init_merges_form_values_with_locked_defaults(client, _patch_db):
    resp = _init(client, {"form_values": {"customer_name": "Jane"}})

    assert resp.status_code == 200
    initial_context = _patch_db["create_workflow_run"]["initial_context"]
    assert initial_context == {"customer_name": "Jane", "company": "Acme"}


def test_init_accepts_legacy_context_variables(client, _patch_db):
    resp = _init(client, {"context_variables": {"customer_name": "Legacy"}})

    assert resp.status_code == 200
    initial_context = _patch_db["create_workflow_run"]["initial_context"]
    assert initial_context == {"customer_name": "Legacy", "company": "Acme"}


def test_init_rejects_missing_required_field(client):
    resp = _init(client, {"form_values": {}})

    assert resp.status_code == 422
    assert resp.json()["detail"] == {
        "code": "pre_call_form_invalid",
        "fields": {"customer_name": "This field is required."},
    }


def test_init_rejects_locked_field_tampering(client):
    resp = _init(
        client,
        {"form_values": {"customer_name": "Jane", "company": "Other"}},
    )

    assert resp.status_code == 422
    assert resp.json()["detail"]["fields"]["company"] == (
        "This value is provided by the site and cannot be changed."
    )


def test_init_rejects_unknown_field_when_extra_context_disabled(client):
    resp = _init(
        client,
        {"form_values": {"customer_name": "Jane", "unknown": "value"}},
    )

    assert resp.status_code == 422
    assert resp.json()["detail"]["fields"]["unknown"] == "Unknown field."


def test_init_rejects_inactive_token(monkeypatch, client):
    inactive = SimpleNamespace(**{**_TOKEN.__dict__, "is_active": False})
    monkeypatch.setattr(
        "api.routes.public_embed.db_client.get_embed_token_by_token",
        lambda _token: _async_value(inactive),
    )

    resp = _init(client, {"form_values": {"customer_name": "Jane"}})

    assert resp.status_code == 403


def test_published_empty_variables_do_not_fall_back_to_draft():
    draft = SimpleNamespace(
        template_context_variables={"draft_only": "secret"},
        workflow_json=None,
    )
    published = SimpleNamespace(template_context_variables={}, workflow_json=None)
    workflow = SimpleNamespace(
        released_definition=published,
        current_definition=draft,
        template_context_variables={"draft_only": "secret"},
    )

    form = build_pre_call_form(workflow, published, PreCallFormSettings())

    assert form.defaults == {}
    assert form.fields == []
    assert has_unpublished_variable_changes(workflow, draft, published) is True


def test_build_pre_call_form_skips_invalid_variable_names():
    definition = SimpleNamespace(
        template_context_variables={"valid_name": None, "bad name": None},
        workflow_json=None,
    )
    workflow = SimpleNamespace(
        released_definition=definition,
        current_definition=None,
        template_context_variables={},
    )

    form = build_pre_call_form(workflow, definition, PreCallFormSettings())

    assert [field.name for field in form.fields] == ["valid_name"]


def test_required_checkbox_must_be_checked():
    definition = SimpleNamespace(
        template_context_variables={"consent": None},
        workflow_json=None,
    )
    workflow = SimpleNamespace(
        released_definition=definition,
        current_definition=None,
        template_context_variables={},
    )
    settings = PreCallFormSettings(
        fields={"consent": {"type": "checkbox", "required": True}}
    )
    form = build_pre_call_form(workflow, definition, settings)

    _merged, errors = validate_and_merge_context(form, {"consent": False})

    assert errors == {"consent": "This field is required."}


def test_normalize_embed_settings_uses_camel_case():
    normalized = normalize_embed_settings(
        {
            "embedMode": "floating",
            "pre_call_form": {
                "enabled": True,
                "submit_label": "Go",
                "fields": {"customer_name": {"max_length": 20}},
            },
        }
    )

    assert normalized is not None
    assert normalized["embedMode"] == "floating"
    assert normalized["preCallForm"]["submitLabel"] == "Go"
    assert normalized["preCallForm"]["fields"]["customer_name"]["maxLength"] == 20


def test_select_field_requires_options():
    settings = PreCallFormSettings(fields={"choice": {"type": "select"}})

    with pytest.raises(ValueError, match="has no options"):
        validate_pre_call_form_settings(settings)


async def _async_value(value):
    return value
