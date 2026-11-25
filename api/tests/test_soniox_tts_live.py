import asyncio
import os
import sys

from api.services.audio_providers.base import TTSRequest
from api.services.audio_providers.registry import get_tts_provider
from api.services.configuration.ai_model_configuration import (
    get_effective_ai_model_configuration_for_workflow as get_cfg,
)


async def main():
    print("Fetching effective AI model config for organization 1...")
    c = await get_cfg(user_id=None, organization_id=1, workflow_configurations={})
    print(f"Config resolved: TTS provider='{c.tts.provider.value if hasattr(c.tts.provider, 'value') else c.tts.provider}', model='{c.tts.model}', voice='{getattr(c.tts, 'voice', 'Adrian')}'")

    provider = get_tts_provider("soniox")
    if not provider:
        print("ERROR: Soniox TTS provider not found in registry")
        sys.exit(1)

    req = TTSRequest(
        text="Hello, this is a test of the Soniox TTS WebSocket real-time audio generation.",
        model=c.tts.model or "tts-rt-v2",
        voice=getattr(c.tts, "voice", "Maya") or "Maya",
        api_key=c.tts.api_key,
    )
    print(f"Calling Soniox TTS WebSocket with model='{req.model}', voice='{req.voice}'...")
    try:
        audio = await provider.synthesize(req)
        print(f"SUCCESS: received {len(audio)} bytes from Soniox TTS WebSocket!")
        out_path = "/tmp/soniox_tts_test.ogg"
        with open(out_path, "wb") as f:
            f.write(audio)
        print(f"Saved audio output to {out_path}")
    except Exception as exc:
        print(f"FAILED: Soniox TTS synthesize raised {type(exc).__name__}: {exc}")
        sys.exit(2)


if __name__ == "__main__":
    asyncio.run(main())
