"""Voice preview generation: scope enforcement, capability gating, cache reuse.

These tests run without a database: the preview DB client and storage backend
are replaced, and only the provider call is faked.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.routes.voice_previews import router
from api.schemas.ai_model_configuration import EffectiveAIModelConfiguration
from api.services.audio_providers.base import TTSRequest
from api.services.auth.depends import get_user
from api.services.configuration.masking import mask_key
from api.services.voice_preview.audio_transcode import PreviewAudio

ORG_ID = 7


class FakeTTSProvider:
    """Stands in for the registered provider so no network call happens."""

    def __init__(self):
        self.requests: list[TTSRequest] = []

    @property
    def provider_name(self) -> str:
        return "openai"

    async def synthesize(self, request: TTSRequest) -> bytes:
        self.requests.append(request)
        return b"OggS" + b"\x00" * 32 + b"OpusHead" + b"\x01" * 256


@pytest.fixture
def fake_provider() -> FakeTTSProvider:
    return FakeTTSProvider()


@pytest.fixture
def preview_backend():
    """Replace the DB client and storage used by the preview service."""
    client = SimpleNamespace(
        get_voice_preview=AsyncMock(return_value=None),
        upsert_voice_preview=AsyncMock(
            side_effect=lambda *, data, organization_id: SimpleNamespace(
                id=1,
                audio_key=data.audio_key,
                content_type=data.content_type,
                byte_size=data.byte_size,
                render_ms=data.render_ms,
                scope=data.scope,
                service_type=data.service_type,
            )
        ),
        list_voice_previews_by_provider=AsyncMock(return_value=[]),
        is_audio_key_referenced=AsyncMock(return_value=False),
    )
    storage = SimpleNamespace(
        adelete_file=AsyncMock(return_value=True),
        aupload_file=AsyncMock(return_value=True),
        aget_signed_url=AsyncMock(
            side_effect=lambda key, **_: f"http://storage.local/voice-audio/{key}"
        ),
    )
    with (
        patch(
            "api.services.voice_preview.preview_service.voice_preview_client", client
        ),
        patch("api.services.voice_preview.preview_service.storage_fs", storage),
        patch("api.services.voice_preview.artifact_store.storage_fs", storage),
        patch(
            "api.services.voice_preview.preview_service.consume_render_budget",
            new=AsyncMock(),
        ),
        patch(
            "api.services.voice_preview.preview_service.normalize_preview_audio",
            new=AsyncMock(
                return_value=PreviewAudio(b"ID3fake-mp3", "audio/mpeg", "mp3")
            ),
        ),
    ):
        yield SimpleNamespace(client=client, storage=storage)


def _client(*, is_superuser: bool, selected_organization_id: int | None) -> TestClient:
    app = FastAPI()
    app.include_router(router, prefix="/api/v1")

    user = MagicMock()
    user.id = 42
    user.is_superuser = is_superuser
    user.selected_organization_id = selected_organization_id
    app.dependency_overrides[get_user] = lambda: user
    return TestClient(app)


def _request_body(**overrides) -> dict:
    body = {
        "service_type": "tts",
        "provider": "openai",
        "voice": "alloy",
        "model": "gpt-4o-mini-tts",
        "scope": "organization",
        "config": {
            "provider": "openai",
            "api_key": "sk-real-key-1234567890abcdef",
            "model": "gpt-4o-mini-tts",
            "voice": "alloy",
        },
    }
    body.update(overrides)
    return body


class TestVoicePreviewCapabilities:
    def test_reports_supported_and_unsupported_providers(self):
        response = _client(is_superuser=True, selected_organization_id=ORG_ID).get(
            "/api/v1/voice-previews/capabilities"
        )

        assert response.status_code == 200
        providers = response.json()["providers"]
        assert providers["tts"]["openai"]["supported"] is True
        assert providers["tts"]["openai"]["preview_provider"] == "openai"
        # No runtime TTS renderer exists for ElevenLabs yet.
        assert providers["tts"]["elevenlabs"]["supported"] is False
        assert providers["tts"]["elevenlabs"]["reason"]
        # Real-time providers preview through their TTS sibling.
        assert providers["sts"]["openai_realtime"]["preview_provider"] == "openai"

    def test_includes_default_sample_text_per_language(self):
        """The UI shows these samples; the backend is their only source."""
        response = _client(is_superuser=True, selected_organization_id=ORG_ID).get(
            "/api/v1/voice-previews/capabilities"
        )

        payload = response.json()
        assert payload["default_sample_language"] == "en"
        assert payload["sample_texts"]["en"].startswith("Hello, this is a preview")
        assert payload["sample_texts"]["ta"].startswith("வணக்கம்")


class TestSavedPreviewText:
    """The typed preview sentence is saved with the model configuration."""

    @staticmethod
    def _configuration(**extra):
        from api.schemas.ai_model_configuration import (
            OrganizationAIModelConfigurationV2,
        )

        return OrganizationAIModelConfigurationV2.model_validate(
            {
                "mode": "byok",
                "byok": {
                    "mode": "pipeline",
                    "pipeline": {
                        "llm": {
                            "provider": "openai",
                            "api_key": "sk-a",
                            "model": "gpt-4o",
                        },
                        "tts": {
                            "provider": "openai",
                            "api_key": "sk-a",
                            "voice": "alloy",
                        },
                        "stt": {"provider": "deepgram", "api_key": "dg-a"},
                    },
                },
                **extra,
            }
        )

    def test_round_trips_through_save_and_load(self):
        from api.services.configuration.ai_model_configuration import (
            mask_ai_model_configuration_v2,
            merge_ai_model_configuration_v2_secrets,
        )

        saved = self._configuration(voice_preview_texts={"tts": "Book my demo"})
        merged = merge_ai_model_configuration_v2_secrets(saved, saved)

        assert merged.voice_preview_texts == {"tts": "Book my demo"}
        assert mask_ai_model_configuration_v2(merged)["voice_preview_texts"] == {
            "tts": "Book my demo"
        }

    def test_blank_text_is_dropped_and_long_text_is_trimmed(self):
        configuration = self._configuration(
            voice_preview_texts={"tts": "  ", "realtime": "x" * 900}
        )

        assert configuration.voice_preview_texts == {"realtime": "x" * 500}

    def test_unknown_service_is_rejected(self):
        from pydantic import ValidationError

        with pytest.raises(ValidationError):
            self._configuration(voice_preview_texts={"llm": "nope"})


class TestPreviewSampleText:
    """Default samples follow the voice's language; custom text is kept."""

    @pytest.mark.parametrize("language", ["ta", "ta-IN", "ta_IN", "TA-in"])
    def test_regional_codes_use_the_base_language_sample(self, language):
        from api.services.voice_preview.sample_text import (
            PREVIEW_SAMPLE_TEXTS,
            get_default_preview_text,
        )

        assert get_default_preview_text(language) == PREVIEW_SAMPLE_TEXTS["ta"]

    @pytest.mark.parametrize("language", [None, "", "auto", "multi", "xx-YY"])
    def test_unknown_or_auto_language_falls_back_to_english(self, language):
        from api.services.voice_preview.sample_text import (
            DEFAULT_PREVIEW_TEXT,
            get_default_preview_text,
        )

        assert get_default_preview_text(language) == DEFAULT_PREVIEW_TEXT

    def test_custom_text_wins_for_organization_previews(self):
        from api.services.voice_preview.sample_text import normalize_preview_text

        text = normalize_preview_text(
            "  Book my demo please  ", use_custom_text=True, language="ta"
        )
        assert text == "Book my demo please"

    def test_platform_previews_use_the_language_sample(self):
        from api.services.voice_preview.sample_text import (
            PREVIEW_SAMPLE_TEXTS,
            normalize_preview_text,
        )

        text = normalize_preview_text("secret", use_custom_text=False, language="hi-IN")
        assert text == PREVIEW_SAMPLE_TEXTS["hi"]

    def test_render_passes_the_voice_language(self, preview_backend, fake_provider):
        from api.services.voice_preview import preview_service

        language_config = SimpleNamespace(
            language="ta-IN", model="gpt-4o-mini-tts", speed=1.0
        )
        with (
            patch.object(
                preview_service, "get_tts_provider", return_value=fake_provider
            ),
            patch.object(
                preview_service, "compile_preview_config", return_value=language_config
            ),
            patch.object(
                preview_service, "resolve_api_key", new=AsyncMock(return_value="k")
            ),
            patch.object(
                preview_service,
                "build_tts_request",
                side_effect=lambda **kw: TTSRequest(
                    text=kw["text"], voice="alloy", api_key="k", model="m"
                ),
            ),
        ):
            response = _client(is_superuser=True, selected_organization_id=ORG_ID).post(
                "/api/v1/voice-previews", json=_request_body(scope="global")
            )

        assert response.status_code == 200
        assert fake_provider.requests[0].text.startswith("வணக்கம்")


class TestVoicePreviewScopeAccess:
    def test_non_superadmin_cannot_create_global_preview(self, preview_backend):
        response = _client(is_superuser=False, selected_organization_id=ORG_ID).post(
            "/api/v1/voice-previews", json=_request_body(scope="global")
        )

        assert response.status_code == 403
        preview_backend.client.upsert_voice_preview.assert_not_awaited()

    def test_organization_scope_requires_selected_organization(self, preview_backend):
        response = _client(is_superuser=True, selected_organization_id=None).post(
            "/api/v1/voice-previews", json=_request_body(scope="organization")
        )

        assert response.status_code == 400
        preview_backend.client.upsert_voice_preview.assert_not_awaited()

    def test_unsupported_provider_is_rejected(self, preview_backend):
        response = _client(is_superuser=True, selected_organization_id=ORG_ID).post(
            "/api/v1/voice-previews",
            json=_request_body(
                provider="elevenlabs",
                config={
                    "provider": "elevenlabs",
                    "api_key": "sk-real-key-1234567890abcdef",
                    "model": "eleven_multilingual_v2",
                    "voice": "alloy",
                },
            ),
        )

        assert response.status_code == 422
        preview_backend.client.upsert_voice_preview.assert_not_awaited()


class TestVoicePreviewRendering:
    def test_renders_preview_and_stores_it_for_the_caller_organization(
        self, preview_backend, fake_provider
    ):
        with patch(
            "api.services.voice_preview.preview_service.get_tts_provider",
            return_value=fake_provider,
        ):
            response = _client(
                is_superuser=False, selected_organization_id=ORG_ID
            ).post(
                "/api/v1/voice-previews", json=_request_body(text="Speak this please")
            )

        assert response.status_code == 200
        payload = response.json()
        assert payload["provider"] == "openai"
        assert payload["voice_id"] == "alloy"
        assert payload["cached"] is False
        assert payload["content_type"] == "audio/mpeg"
        assert payload["preview_url"].startswith("http://storage.local/voice-audio/")
        assert fake_provider.requests[0].text == "Speak this please"
        assert fake_provider.requests[0].voice == "alloy"

        upsert_kwargs = preview_backend.client.upsert_voice_preview.await_args.kwargs
        assert upsert_kwargs["organization_id"] == ORG_ID
        stored = upsert_kwargs["data"]
        assert stored.scope == "organization"
        assert stored.audio_key.endswith(".mp3")
        assert stored.byte_size == len(b"ID3fake-mp3")

    def test_global_preview_uses_platform_sample_and_no_organization(
        self, preview_backend, fake_provider
    ):
        with patch(
            "api.services.voice_preview.preview_service.get_tts_provider",
            return_value=fake_provider,
        ):
            response = _client(is_superuser=True, selected_organization_id=ORG_ID).post(
                "/api/v1/voice-previews",
                json=_request_body(scope="global", text="tenant secret text"),
            )

        assert response.status_code == 200
        upsert_kwargs = preview_backend.client.upsert_voice_preview.await_args.kwargs
        # Platform rows are never scoped to the caller's organization.
        assert upsert_kwargs["organization_id"] is None
        stored = upsert_kwargs["data"]
        assert "tenant secret text" not in stored.sample_text
        assert fake_provider.requests[0].text == stored.sample_text

    def test_cached_preview_is_returned_without_calling_the_provider(
        self, preview_backend, fake_provider
    ):
        preview_backend.client.get_voice_preview = AsyncMock(
            return_value=SimpleNamespace(
                id=5,
                provider="openai",
                voice_id="alloy",
                model="gpt-4o-mini-tts",
                audio_key="voice-previews/global/openai/alloy/abc.mp3",
                content_type="audio/mpeg",
                byte_size=4242,
                render_ms=310,
                cached=True,
                scope="global",
                service_type="tts",
            )
        )
        with patch(
            "api.services.voice_preview.preview_service.get_tts_provider",
            return_value=fake_provider,
        ):
            response = _client(
                is_superuser=False, selected_organization_id=ORG_ID
            ).post("/api/v1/voice-previews", json=_request_body())

        assert response.status_code == 200
        assert response.json()["cached"] is True
        assert response.json()["byte_size"] == 4242
        assert fake_provider.requests == []
        preview_backend.client.upsert_voice_preview.assert_not_awaited()

    def test_masked_api_key_without_saved_configuration_is_rejected(
        self, preview_backend
    ):
        masked = mask_key("sk-real-key-1234567890abcdef")
        body = _request_body()
        body["config"]["api_key"] = masked

        with patch(
            "api.services.voice_preview.credentials.get_resolved_ai_model_configuration",
            new=AsyncMock(
                return_value=SimpleNamespace(effective=EffectiveAIModelConfiguration())
            ),
        ):
            response = _client(
                is_superuser=False, selected_organization_id=ORG_ID
            ).post("/api/v1/voice-previews", json=body)

        assert response.status_code == 400
        assert "api key" in response.json()["detail"].lower()
        preview_backend.client.upsert_voice_preview.assert_not_awaited()

    def test_masked_api_key_is_restored_from_saved_configuration(
        self, preview_backend, fake_provider
    ):
        real_key = "sk-real-key-1234567890abcdef"
        body = _request_body()
        body["config"]["api_key"] = mask_key(real_key)
        saved_tts = SimpleNamespace(
            provider="openai",
            model="gpt-4o-mini-tts",
            voice="alloy",
            api_key=[real_key],
            language=None,
            base_url=None,
            speed=1.0,
            credentials=None,
            location=None,
            get_all_api_keys=lambda: [real_key],
        )

        with (
            patch(
                "api.services.voice_preview.credentials.get_resolved_ai_model_configuration",
                new=AsyncMock(
                    return_value=SimpleNamespace(
                        effective=EffectiveAIModelConfiguration.model_construct(
                            tts=saved_tts
                        )
                    )
                ),
            ),
            patch(
                "api.services.voice_preview.preview_service.get_tts_provider",
                return_value=fake_provider,
            ),
        ):
            response = _client(
                is_superuser=False, selected_organization_id=ORG_ID
            ).post("/api/v1/voice-previews", json=body)

        assert response.status_code == 200
        assert fake_provider.requests[0].api_key == real_key

    def test_masked_api_key_is_restored_from_edited_admin_preset(
        self, preview_backend, fake_provider
    ):
        """Admin presets are not the org config; their own saved key is used."""
        real_key = "sk-preset-key-1234567890abcdef"
        body = _request_body(scope="global", model_configuration_id=3)
        body["config"]["api_key"] = mask_key(real_key)
        preset_tts = SimpleNamespace(
            provider="openai",
            api_key=[real_key],
            get_all_api_keys=lambda: [real_key],
        )
        preset_loader = AsyncMock(
            return_value=EffectiveAIModelConfiguration.model_construct(tts=preset_tts)
        )
        org_resolver = AsyncMock(
            return_value=SimpleNamespace(effective=EffectiveAIModelConfiguration())
        )

        with (
            patch(
                "api.services.voice_preview.credentials._preset_effective",
                new=preset_loader,
            ),
            patch(
                "api.services.voice_preview.credentials.get_resolved_ai_model_configuration",
                new=org_resolver,
            ),
            patch(
                "api.services.voice_preview.preview_service.get_tts_provider",
                return_value=fake_provider,
            ),
        ):
            response = _client(is_superuser=True, selected_organization_id=ORG_ID).post(
                "/api/v1/voice-previews", json=body
            )

        assert response.status_code == 200
        assert fake_provider.requests[0].api_key == real_key
        preset_loader.assert_awaited_once_with(3)
        org_resolver.assert_not_awaited()

    def test_non_superadmin_cannot_use_admin_preset_key(self, preview_backend):
        response = _client(is_superuser=False, selected_organization_id=ORG_ID).post(
            "/api/v1/voice-previews", json=_request_body(model_configuration_id=3)
        )

        assert response.status_code == 403
        preview_backend.client.upsert_voice_preview.assert_not_awaited()


class TestVoicePreviewListing:
    async def test_organization_preview_wins_over_platform_preview(self):
        from api.services.voice_preview.listing import get_voice_preview_urls

        rows = [
            SimpleNamespace(voice_id="alloy", audio_key="org/alloy.mp3"),
            SimpleNamespace(voice_id="alloy", audio_key="global/alloy.mp3"),
            SimpleNamespace(voice_id="verse", audio_key="global/verse.mp3"),
        ]
        client = SimpleNamespace(
            list_voice_previews_by_provider=AsyncMock(return_value=rows)
        )
        storage = SimpleNamespace(
            aget_signed_url=AsyncMock(side_effect=lambda key, **_: f"url:{key}")
        )

        with (
            patch("api.services.voice_preview.listing.voice_preview_client", client),
            patch("api.services.voice_preview.listing.storage_fs", storage),
        ):
            urls = await get_voice_preview_urls(
                provider="OpenAI", organization_id=ORG_ID
            )

        assert urls == {"alloy": "url:org/alloy.mp3", "verse": "url:global/verse.mp3"}
        client.list_voice_previews_by_provider.assert_awaited_once_with(
            provider="openai", organization_id=ORG_ID
        )


class TestAutoRenderOnSave:
    """Saving a model configuration stores previews for its voices."""

    @staticmethod
    def _effective(**services):
        return EffectiveAIModelConfiguration.model_construct(
            tts=services.get("tts"), realtime=services.get("realtime")
        )

    @staticmethod
    def _service(provider: str, voice: str):
        return SimpleNamespace(
            provider=provider,
            voice=voice,
            model="gpt-4o-mini-tts",
            model_dump=lambda **_: {
                "provider": provider,
                "voice": voice,
                "model": "gpt-4o-mini-tts",
                "api_key": "sk-real-key-1234567890abcdef",
            },
        )

    async def test_renders_configured_voice_with_saved_key(self):
        from api.services.voice_preview import auto_render

        render = AsyncMock(
            return_value=SimpleNamespace(
                provider="openai", voice_id="alloy", cached=False
            )
        )
        with (
            patch.object(
                auto_render,
                "compile_ai_model_configuration_v2",
                return_value=self._effective(tts=self._service("openai", "alloy")),
            ),
            patch.object(auto_render, "render_voice_preview", new=render),
        ):
            await auto_render.render_previews_for_saved_configuration(
                MagicMock(), scope="organization", organization_id=ORG_ID, user_id=42
            )

        render.assert_awaited_once()
        kwargs = render.await_args.kwargs
        assert kwargs["organization_id"] == ORG_ID
        assert kwargs["request"].voice == "alloy"
        assert kwargs["request"].scope == "organization"
        assert kwargs["request"].config["api_key"] == "sk-real-key-1234567890abcdef"

    async def test_global_scope_never_attaches_an_organization(self):
        from api.services.voice_preview import auto_render

        render = AsyncMock(
            return_value=SimpleNamespace(
                provider="openai", voice_id="alloy", cached=True
            )
        )
        with (
            patch.object(
                auto_render,
                "compile_ai_model_configuration_v2",
                return_value=self._effective(tts=self._service("openai", "alloy")),
            ),
            patch.object(auto_render, "render_voice_preview", new=render),
        ):
            await auto_render.render_previews_for_saved_configuration(
                MagicMock(), scope="global", organization_id=ORG_ID, user_id=42
            )

        assert render.await_args.kwargs["organization_id"] is None

    async def test_failures_and_unsupported_providers_do_not_raise(self):
        from api.services.voice_preview import auto_render
        from api.services.voice_preview.exceptions import VoicePreviewRenderError

        render = AsyncMock(
            side_effect=VoicePreviewRenderError("openai", "provider down")
        )
        with (
            patch.object(
                auto_render,
                "compile_ai_model_configuration_v2",
                return_value=self._effective(
                    tts=self._service("openai", "alloy"),
                    # No preview renderer exists for ElevenLabs: skipped.
                    realtime=self._service("elevenlabs", "rachel"),
                ),
            ),
            patch.object(auto_render, "render_voice_preview", new=render),
        ):
            await auto_render.render_previews_for_saved_configuration(
                MagicMock(), scope="global", organization_id=None, user_id=42
            )

        render.assert_awaited_once()


class TestPresetVoicePreview:
    """Agent settings: hear the selected model stack's voice before picking it."""

    @staticmethod
    def _request(voice: str = "alloy"):
        from api.schemas.voice_preview import VoicePreviewRequest

        return VoicePreviewRequest(
            service_type="tts",
            provider="openai",
            voice=voice,
            model="gpt-4o-mini-tts",
            scope="global",
        )

    @staticmethod
    def _row(model: str, key: str):
        return SimpleNamespace(
            voice_id="alloy", model=model, audio_key=key, sample_text="Hello there."
        )

    def _patches(
        self,
        preset_preview,
        *,
        preset,
        rows,
        render=None,
        voices=(),
        configured=None,
        requests=None,
    ):
        storage = SimpleNamespace(
            aget_signed_url=AsyncMock(side_effect=lambda key, **_: f"url:{key}")
        )
        configured_voices = (
            configured
            if configured is not None
            else [SimpleNamespace(provider="openai", voice="alloy")]
        )
        return (
            patch.multiple(
                preset_preview.platform_client,
                get_model_configuration=AsyncMock(return_value=preset),
                list_voices=AsyncMock(return_value=list(voices)),
            ),
            patch.multiple(
                preset_preview,
                list_configured_voices=MagicMock(return_value=configured_voices),
                list_preview_requests=MagicMock(
                    return_value=requests if requests is not None else [self._request()]
                ),
            ),
            patch.object(
                preset_preview,
                "voice_preview_client",
                SimpleNamespace(list_voice_previews_by_provider=rows),
            ),
            patch.object(preset_preview, "storage_fs", storage),
            patch.object(
                preset_preview, "render_voice_preview", new=render or AsyncMock()
            ),
            patch.object(
                preset_preview.OrganizationAIModelConfigurationV2,
                "model_validate",
                return_value=MagicMock(),
            ),
        )

    async def test_returns_stored_preview_preferring_exact_model(self):
        from api.services.voice_preview import preset_preview

        rows = AsyncMock(
            return_value=[
                self._row("other-model", "a.mp3"),
                self._row("gpt-4o-mini-tts", "b.mp3"),
            ]
        )
        preset = SimpleNamespace(is_active=True, config={"mode": "byok"})
        p = self._patches(preset_preview, preset=preset, rows=rows)
        with p[0], p[1], p[2], p[3], p[4] as render, p[5]:
            result = await preset_preview.get_preset_voice_preview(
                preset_id=3, organization_id=ORG_ID
            )

        assert result.voice == "alloy"
        assert result.preview_url == "url:b.mp3"
        assert result.sample_text == "Hello there."
        render.assert_not_awaited()

    async def test_renders_once_when_preset_has_no_stored_preview(self):
        from api.services.voice_preview import preset_preview

        rows = AsyncMock(side_effect=[[], [self._row("gpt-4o-mini-tts", "new.mp3")]])
        preset = SimpleNamespace(is_active=True, config={"mode": "byok"})
        p = self._patches(preset_preview, preset=preset, rows=rows)
        with p[0], p[1], p[2], p[3], p[4] as render, p[5]:
            result = await preset_preview.get_preset_voice_preview(
                preset_id=3, organization_id=ORG_ID
            )

        render.assert_awaited_once()
        assert render.await_args.kwargs["organization_id"] is None
        assert result.preview_url == "url:new.mp3"

    async def test_inactive_preset_is_not_found(self):
        from api.services.voice_preview import preset_preview

        preset = SimpleNamespace(is_active=False, config={"mode": "byok"})
        p = self._patches(preset_preview, preset=preset, rows=AsyncMock())
        with p[0], p[1], p[2], p[3], p[4], p[5]:
            result = await preset_preview.get_preset_voice_preview(
                preset_id=3, organization_id=ORG_ID
            )

        assert result is None

    async def test_gender_comes_from_provider_tables(self):
        from api.services.voice_preview import preset_preview

        rows = AsyncMock(return_value=[self._row("gpt-4o-mini-tts", "b.mp3")])
        preset = SimpleNamespace(is_active=True, config={"mode": "byok"})
        p = self._patches(preset_preview, preset=preset, rows=rows)
        with (
            p[0],
            p[1],
            p[2],
            p[3],
            p[4],
            p[5],
            patch.object(
                preset_preview, "voice_metadata", return_value=("female", None)
            ),
        ):
            result = await preset_preview.get_preset_voice_preview(
                preset_id=3, organization_id=ORG_ID
            )

        assert result.gender == "female"

    async def test_admin_catalog_gender_wins(self):
        from api.services.voice_preview import preset_preview

        rows = AsyncMock(return_value=[self._row("gpt-4o-mini-tts", "b.mp3")])
        preset = SimpleNamespace(is_active=True, config={"mode": "byok"})
        voices = [SimpleNamespace(provider="openai", voice_id="alloy", gender="male")]
        p = self._patches(preset_preview, preset=preset, rows=rows, voices=voices)
        with (
            p[0],
            p[1],
            p[2],
            p[3],
            p[4],
            p[5],
            patch.object(
                preset_preview, "voice_metadata", return_value=("female", None)
            ),
        ):
            result = await preset_preview.get_preset_voice_preview(
                preset_id=3, organization_id=ORG_ID
            )

        assert result.gender == "male"
        assert result.preview_url == "url:b.mp3"

    async def test_gender_shown_when_voice_cannot_be_previewed(self):
        """Speech-to-speech voices (e.g. Grok realtime) have no preview audio."""
        from api.services.voice_preview import preset_preview

        rows = AsyncMock()
        preset = SimpleNamespace(is_active=True, config={"mode": "byok"})
        p = self._patches(
            preset_preview,
            preset=preset,
            rows=rows,
            configured=[SimpleNamespace(provider="grok_realtime", voice="Ara")],
            requests=[],
        )
        with p[0], p[1], p[2], p[3], p[4] as render, p[5]:
            result = await preset_preview.get_preset_voice_preview(
                preset_id=2, organization_id=ORG_ID
            )

        assert result.voice == "Ara"
        assert result.gender == "female"
        assert result.preview_url is None
        render.assert_not_awaited()
        rows.assert_not_awaited()


class TestRenderFailure:
    """A provider that refuses to render must reach the user with its message."""

    def test_provider_failure_is_424_with_provider_message(self, preview_backend):
        from api.services.voice_preview.exceptions import VoicePreviewRenderError

        with patch(
            "api.routes.voice_previews.render_voice_preview",
            new=AsyncMock(
                side_effect=VoicePreviewRenderError("soniox", "Unknown voice 'priya'")
            ),
        ):
            response = _client(is_superuser=True, selected_organization_id=ORG_ID).post(
                "/api/v1/voice-previews", json=_request_body()
            )

        # Not 502: Cloudflare swaps origin 502s for its own "Bad gateway" page.
        assert response.status_code == 424
        assert "Unknown voice 'priya'" in response.json()["detail"]


class TestRenderBudget:
    """Paid tenant renders are capped per organization (shared across workers)."""

    def test_over_budget_returns_429_with_retry_after(self, preview_backend):
        from api.services.voice_preview.exceptions import VoicePreviewRateLimitError

        with patch(
            "api.services.voice_preview.preview_service.consume_render_budget",
            new=AsyncMock(side_effect=VoicePreviewRateLimitError(1200)),
        ):
            response = _client(
                is_superuser=False, selected_organization_id=ORG_ID
            ).post("/api/v1/voice-previews", json=_request_body())

        assert response.status_code == 429
        assert response.headers["Retry-After"] == "1200"
        preview_backend.client.upsert_voice_preview.assert_not_awaited()

    def test_cache_hit_does_not_spend_budget(self, preview_backend):
        preview_backend.client.get_voice_preview = AsyncMock(
            return_value=SimpleNamespace(
                id=5,
                provider="openai",
                voice_id="alloy",
                model="gpt-4o-mini-tts",
                audio_key="voice-previews/global/openai/alloy/abc.mp3",
                content_type="audio/mpeg",
                byte_size=10,
                render_ms=1,
                scope="global",
                service_type="tts",
            )
        )
        budget = AsyncMock()
        with patch(
            "api.services.voice_preview.preview_service.consume_render_budget",
            new=budget,
        ):
            response = _client(
                is_superuser=False, selected_organization_id=ORG_ID
            ).post("/api/v1/voice-previews", json=_request_body())

        assert response.status_code == 200
        budget.assert_not_awaited()

    async def test_counts_per_organization_and_raises_past_limit(self):
        from api.services.voice_preview import rate_limit
        from api.services.voice_preview.exceptions import VoicePreviewRateLimitError

        counts: dict[str, int] = {}

        async def incr(key):
            counts[key] = counts.get(key, 0) + 1
            return counts[key]

        redis = SimpleNamespace(
            incr=incr, expire=AsyncMock(), ttl=AsyncMock(return_value=900)
        )
        with patch.object(rate_limit, "_get_redis", return_value=redis):
            await rate_limit.consume_render_budget(organization_id=ORG_ID, limit=2)
            await rate_limit.consume_render_budget(organization_id=ORG_ID, limit=2)
            # Another tenant has its own budget.
            await rate_limit.consume_render_budget(organization_id=99, limit=2)
            with pytest.raises(VoicePreviewRateLimitError) as exc_info:
                await rate_limit.consume_render_budget(organization_id=ORG_ID, limit=2)

        assert exc_info.value.retry_after_seconds == 900
        redis.expire.assert_any_await(
            f"voice_preview:renders:org:{ORG_ID}", rate_limit.WINDOW_SECONDS
        )

    async def test_fails_open_when_redis_is_down(self):
        from redis.exceptions import ConnectionError as RedisConnectionError

        from api.services.voice_preview import rate_limit

        redis = SimpleNamespace(
            incr=AsyncMock(side_effect=RedisConnectionError("down"))
        )
        with patch.object(rate_limit, "_get_redis", return_value=redis):
            await rate_limit.consume_render_budget(organization_id=ORG_ID, limit=1)


class TestAutoRenderFromSource:
    """The ARQ job carries only a source id and reloads the saved config."""

    async def test_organization_source_renders_tenant_previews(self):
        from api.services.voice_preview import auto_render

        configuration = MagicMock()
        render = AsyncMock()
        with (
            patch.object(
                auto_render,
                "get_saved_configuration",
                new=AsyncMock(return_value=configuration),
            ) as loader,
            patch.object(
                auto_render, "render_previews_for_saved_configuration", new=render
            ),
        ):
            await auto_render.render_previews_for_saved_source(
                source="organization", source_id=ORG_ID, user_id=42
            )

        loader.assert_awaited_once_with(source="organization", source_id=ORG_ID)
        assert render.await_args.args == (configuration,)
        assert render.await_args.kwargs == {
            "scope": "organization",
            "organization_id": ORG_ID,
            "user_id": 42,
        }

    async def test_platform_preset_source_renders_global_previews(self):
        from api.services.voice_preview import auto_render

        render = AsyncMock()
        with (
            patch.object(
                auto_render,
                "get_saved_configuration",
                new=AsyncMock(return_value=MagicMock()),
            ),
            patch.object(
                auto_render, "render_previews_for_saved_configuration", new=render
            ),
        ):
            await auto_render.render_previews_for_saved_source(
                source="platform_preset", source_id=3, user_id=1
            )

        assert render.await_args.kwargs["scope"] == "global"
        assert render.await_args.kwargs["organization_id"] is None

    async def test_missing_configuration_is_skipped(self):
        from api.services.voice_preview import auto_render

        render = AsyncMock()
        with (
            patch.object(
                auto_render, "get_saved_configuration", new=AsyncMock(return_value=None)
            ),
            patch.object(
                auto_render, "render_previews_for_saved_configuration", new=render
            ),
        ):
            await auto_render.render_previews_for_saved_source(
                source="platform_preset", source_id=404, user_id=1
            )

        render.assert_not_awaited()


class TestStoredAudioLifecycle:
    """Tenant audio is isolated per organization; replaced audio is cleaned up."""

    @staticmethod
    def _render(preview_backend, fake_provider, *, is_superuser=False, body=None):
        with patch(
            "api.services.voice_preview.preview_service.get_tts_provider",
            return_value=fake_provider,
        ):
            return _client(
                is_superuser=is_superuser, selected_organization_id=ORG_ID
            ).post("/api/v1/voice-previews", json=body or _request_body())

    @staticmethod
    def _unreachable_row(*, scope: str, organization_id, audio_key: str):
        return SimpleNamespace(
            id=9,
            scope=scope,
            organization_id=organization_id,
            audio_key=audio_key,
        )

    def test_tenant_audio_key_contains_the_organization(
        self, preview_backend, fake_provider
    ):
        response = self._render(preview_backend, fake_provider)

        assert response.status_code == 200
        stored = preview_backend.client.upsert_voice_preview.await_args.kwargs["data"]
        assert stored.audio_key.startswith(f"voice-previews/organization/{ORG_ID}/")

    def test_rerender_deletes_the_replaced_unreferenced_audio(
        self, preview_backend, fake_provider
    ):
        old_key = f"voice-previews/organization/{ORG_ID}/openai/alloy/old.ogg"
        preview_backend.client.get_voice_preview = AsyncMock(
            return_value=self._unreachable_row(
                scope="organization", organization_id=ORG_ID, audio_key=old_key
            )
        )
        # The old object is gone, so the cached row cannot be signed.
        preview_backend.storage.aget_signed_url = AsyncMock(
            side_effect=lambda key, **_: (
                None if key == old_key else f"http://storage.local/{key}"
            )
        )

        response = self._render(preview_backend, fake_provider)

        assert response.status_code == 200
        preview_backend.storage.adelete_file.assert_awaited_once_with(old_key)

    def test_audio_still_used_by_another_row_is_kept(
        self, preview_backend, fake_provider
    ):
        old_key = "voice-previews/organization/openai/alloy/legacy-shared.ogg"
        preview_backend.client.get_voice_preview = AsyncMock(
            return_value=self._unreachable_row(
                scope="organization", organization_id=ORG_ID, audio_key=old_key
            )
        )
        preview_backend.client.is_audio_key_referenced = AsyncMock(return_value=True)
        preview_backend.storage.aget_signed_url = AsyncMock(
            side_effect=lambda key, **_: (
                None if key == old_key else f"http://storage.local/{key}"
            )
        )

        response = self._render(preview_backend, fake_provider)

        assert response.status_code == 200
        preview_backend.storage.adelete_file.assert_not_awaited()

    def test_platform_row_is_never_deleted_by_a_tenant_render(
        self, preview_backend, fake_provider
    ):
        platform_key = "voice-previews/global/openai/alloy/shared.ogg"
        preview_backend.client.get_voice_preview = AsyncMock(
            return_value=self._unreachable_row(
                scope="global", organization_id=None, audio_key=platform_key
            )
        )
        preview_backend.storage.aget_signed_url = AsyncMock(
            side_effect=lambda key, **_: (
                None if key == platform_key else f"http://storage.local/{key}"
            )
        )

        response = self._render(preview_backend, fake_provider)

        assert response.status_code == 200
        preview_backend.storage.adelete_file.assert_not_awaited()
