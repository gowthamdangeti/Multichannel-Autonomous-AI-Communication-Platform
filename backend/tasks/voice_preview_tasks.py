"""Render stored voice previews after a model configuration is saved."""

from api.services.voice_preview.auto_render import (
    ConfigurationSource,
    render_previews_for_saved_source,
)


async def render_saved_configuration_voice_previews(
    ctx,
    source: ConfigurationSource,
    source_id: int | None,
    user_id: int | None = None,
) -> None:
    """Idempotent: voices that already have a stored preview are cache hits."""
    await render_previews_for_saved_source(
        source=source, source_id=source_id, user_id=user_id
    )
