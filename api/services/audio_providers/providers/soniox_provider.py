"""Soniox audio provider for STT (dual transport) and TTS (real-time WebSocket).

Documentation:
- Real-Time STT (WebSocket): https://soniox.com/docs/speech-recognition/real-time/getting-started
- Real-Time STT Reference: https://soniox.com/docs/speech-recognition/real-time/api-reference
- Asynchronous STT (REST): https://soniox.com/docs/speech-recognition/asynchronous/getting-started
- Real-Time TTS (WebSocket): https://soniox.com/docs/text-to-speech/real-time
"""
from __future__ import annotations

import asyncio
import base64
import json
import os
import uuid

import httpx
from loguru import logger

from api.services.audio_providers.base import (
    BaseSTTProvider,
    BaseTTSProvider,
    ProviderConfigurationError,
    ProviderExecutionError,
    STTRequest,
    TTSRequest,
)
from api.services.audio_providers.registry import register_stt_provider, register_tts_provider


@register_stt_provider
class SonioxSTTProvider(BaseSTTProvider):
    @property
    def provider_name(self) -> str:
        return "soniox"

    async def transcribe(self, request: STTRequest) -> str:
        if not request.api_key:
            self.log_stt_error(None, "Missing API key")
            raise ProviderConfigurationError(self.provider_name, "API key is required.")

        model = (request.model or "stt-rt-v5").strip()
        req_model_lower = model.lower()

        # Dual transport dispatch: real-time models use WebSocket; async models use REST
        if "rt" in req_model_lower or req_model_lower.startswith("stt-rt"):
            return await self._transcribe_ws(request, model)
        return await self._transcribe_rest(request, model)

    async def _transcribe_ws(self, request: STTRequest, model: str) -> str:
        """Stream transcription over Soniox Real-Time WebSocket API."""
        import websockets

        ws_url = "wss://stt-rt.soniox.com/transcribe-websocket"
        headers = {"Authorization": f"Bearer {request.api_key}"}

        # If audio is an MP4/M4A/AAC/unknown container format, convert to standard Ogg Opus via ffmpeg
        # because Soniox real-time WebSocket auto-detection fails on MP4 container packets.
        audio_data = request.audio_bytes
        content_type = (request.content_type or "").lower()
        filename = (request.filename or "").lower()
        if (
            "mp4" in content_type
            or "m4a" in content_type
            or "aac" in content_type
            or filename.endswith((".mp4", ".m4a", ".aac"))
            or audio_data[:8].startswith((b"\x00\x00\x00", b"ftyp"))
        ):
            in_file = None
            out_file = None
            try:
                import tempfile
                in_ext = ".mp4" if "mp4" in content_type or "m4a" in content_type else ".bin"
                with tempfile.NamedTemporaryFile(suffix=in_ext, delete=False) as f_in:
                    f_in.write(audio_data)
                    in_file = f_in.name

                with tempfile.NamedTemporaryFile(suffix=".ogg", delete=False) as f_out:
                    out_file = f_out.name

                proc = await asyncio.create_subprocess_exec(
                    "ffmpeg",
                    "-hide_banner",
                    "-loglevel", "error",
                    "-y",
                    "-i", in_file,
                    "-c:a", "libopus",
                    "-b:a", "32k",
                    "-vbr", "on",
                    "-ar", "48000",
                    "-ac", "1",
                    "-f", "ogg",
                    out_file,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE,
                )
                _, stderr = await proc.communicate()
                if proc.returncode == 0 and os.path.exists(out_file):
                    with open(out_file, "rb") as f_res:
                        conv_bytes = f_res.read()
                    if conv_bytes and len(conv_bytes) > 1000:
                        logger.info(f"Soniox STT converted {len(audio_data)} bytes of {content_type} to {len(conv_bytes)} bytes Ogg Opus")
                        audio_data = conv_bytes
                    else:
                        logger.warning(f"ffmpeg conversion produced too small audio ({len(conv_bytes)} bytes)")
                else:
                    logger.warning(f"ffmpeg conversion failed: {stderr.decode(errors='replace')}")
            except Exception as ffmpeg_err:
                logger.warning(f"ffmpeg audio conversion error for Soniox STT: {ffmpeg_err}")
            finally:
                for temp_p in (in_file, out_file):
                    if temp_p and os.path.exists(temp_p):
                        try:
                            os.remove(temp_p)
                        except Exception:
                            pass

        start_time = self.log_stt_start(model, "ws", len(audio_data))

        try:
            async with websockets.connect(
                ws_url,
                additional_headers=headers,
                ping_interval=20,
                ping_timeout=20,
            ) as ws:
                # 1. First message: JSON configuration
                config_msg = {
                    "model": model,
                    "audio_format": "auto",
                }
                if request.language and request.language != "auto":
                    config_msg["language"] = request.language
                await ws.send(json.dumps(config_msg))

                # 2. Stream binary audio chunks
                chunk_size = 8192
                data = audio_data
                for i in range(0, len(data), chunk_size):
                    await ws.send(data[i : i + chunk_size])

                # 3. Graceful termination: empty string text frame
                await ws.send("")

                # 4. Receive and accumulate tokens until finished or connection closed
                transcript_parts = []
                try:
                    while True:
                        resp = await ws.recv()
                        if isinstance(resp, str):
                            resp_json = json.loads(resp)
                            tokens = resp_json.get("tokens", [])
                            for t in tokens:
                                text_val = t.get("text", "")
                                if text_val not in ("<end>", "<fin>"):
                                    transcript_parts.append(text_val)
                            if resp_json.get("finished", False):
                                break
                except websockets.exceptions.ConnectionClosed as cc:
                    # Code 1000 indicates normal graceful closure by server after receiving ""
                    if cc.code != 1000:
                        logger.warning(f"Soniox WebSocket closed with code {cc.code}: {cc.reason}")

                full_text = "".join(transcript_parts).strip()
                self.log_stt_success(full_text, start_time)
                return full_text
        except ProviderExecutionError:
            raise
        except Exception as exc:
            self.log_stt_error(None, str(exc))
            raise ProviderExecutionError(self.provider_name, None, f"WebSocket error: {exc}") from exc

    async def _transcribe_rest(self, request: STTRequest, model: str) -> str:
        """Upload and poll transcription using Soniox Asynchronous REST API."""
        headers = {"Authorization": f"Bearer {request.api_key}"}
        base_url = (request.base_url or "https://api.soniox.com").rstrip("/")
        start_time = self.log_stt_start(model, "rest", len(request.audio_bytes))

        try:
            async with httpx.AsyncClient(timeout=600.0) as client:
                # 1. Upload audio file
                files = {
                    "file": (
                        request.filename or "audio.ogg",
                        request.audio_bytes,
                        request.content_type or "audio/ogg",
                    )
                }
                upload_resp = await client.post(f"{base_url}/v1/files", headers=headers, files=files)
                if upload_resp.status_code not in (200, 201):
                    err_msg = upload_resp.text
                    self.log_stt_error(upload_resp.status_code, err_msg)
                    raise ProviderExecutionError(self.provider_name, upload_resp.status_code, err_msg)

                file_id = upload_resp.json().get("id")

                # 2. Create transcription task
                create_payload = {"file_id": file_id, "model": model}
                if request.language and request.language != "auto":
                    create_payload["language"] = request.language

                create_resp = await client.post(
                    f"{base_url}/v1/transcriptions", headers=headers, json=create_payload
                )
                if create_resp.status_code not in (200, 201):
                    err_msg = create_resp.text
                    self.log_stt_error(create_resp.status_code, err_msg)
                    raise ProviderExecutionError(self.provider_name, create_resp.status_code, err_msg)

                trans_id = create_resp.json().get("id")

                # 3. Poll for status
                for _ in range(40):
                    await asyncio.sleep(1.5)
                    poll = await client.get(f"{base_url}/v1/transcriptions/{trans_id}", headers=headers)
                    if poll.status_code != 200:
                        continue
                    poll_data = poll.json()
                    status = poll_data.get("status")
                    if status == "completed":
                        res_poll = await client.get(
                            f"{base_url}/v1/transcriptions/{trans_id}/transcript",
                            headers=headers,
                        )
                        if res_poll.status_code == 200:
                            tr_json = res_poll.json()
                            transcript = (tr_json.get("text") or tr_json.get("transcript") or "").strip()
                            self.log_stt_success(transcript, start_time)
                            return transcript
                    elif status in ("failed", "error"):
                        err_msg = str(poll_data)
                        self.log_stt_error(poll.status_code, err_msg)
                        raise ProviderExecutionError(self.provider_name, poll.status_code, err_msg)

                raise ProviderExecutionError(self.provider_name, 408, "Transcription polling timed out")
        except ProviderExecutionError:
            raise
        except Exception as exc:
            self.log_stt_error(None, str(exc))
            raise ProviderExecutionError(self.provider_name, None, f"REST error: {exc}") from exc


@register_tts_provider
class SonioxTTSProvider(BaseTTSProvider):
    @property
    def provider_name(self) -> str:
        return "soniox"

    async def synthesize(self, request: TTSRequest) -> bytes:
        if not request.api_key:
            self.log_tts_error(None, "Missing API key")
            raise ProviderConfigurationError(self.provider_name, "API key is required.")

        import websockets

        model = request.model or "tts-rt-v2"
        voice = request.voice or "Adrian"
        ws_url = "wss://tts-rt.soniox.com/tts-websocket"
        headers = {"Authorization": f"Bearer {request.api_key}"}
        stream_id = f"st_{uuid.uuid4().hex[:12]}"

        start_time = self.log_tts_start(model, voice, request.text)

        try:
            async with websockets.connect(
                ws_url,
                additional_headers=headers,
                ping_interval=20,
                ping_timeout=20,
            ) as ws:
                # 1. Config message with stream_id, language, voice, and audio_format
                tts_lang = getattr(request, "language", None)
                if not tts_lang or tts_lang == "auto":
                    tts_lang = "en"
                cfg = {
                    "model": model,
                    "voice": voice,
                    "language": tts_lang,
                    "audio_format": "opus",
                    "stream_id": stream_id,
                }
                if request.speed:
                    cfg["speed"] = request.speed
                await ws.send(json.dumps(cfg))

                # 2. Text message with explicit text_end: true marker per Soniox TTS WS protocol
                text_frame = {
                    "text": request.text,
                    "text_end": True,
                    "stream_id": stream_id,
                }
                await ws.send(json.dumps(text_frame))

                # 3. Collect audio chunks with hard 8.0s timeout
                audio_chunks = []
                while True:
                    try:
                        msg_raw = await asyncio.wait_for(ws.recv(), timeout=8.0)
                    except asyncio.TimeoutError:
                        raise ProviderExecutionError(
                            self.provider_name,
                            None,
                            "TTS WebSocket timeout after 8s — no audio received",
                        )

                    if isinstance(msg_raw, bytes):
                        audio_chunks.append(msg_raw)
                    elif isinstance(msg_raw, str):
                        msg_data = json.loads(msg_raw)
                        if msg_data.get("stream_id") and msg_data.get("stream_id") != stream_id:
                            continue
                        if "error_message" in msg_data:
                            err_msg = msg_data.get("error_message") or str(msg_data)
                            err_code = msg_data.get("error_code")
                            raise ProviderExecutionError(self.provider_name, err_code, err_msg)
                        if "audio" in msg_data:
                            audio_chunks.append(base64.b64decode(msg_data["audio"]))
                        if msg_data.get("audio_end", False) or msg_data.get("terminated", False):
                            break

                raw_audio = b"".join(audio_chunks)
                if not raw_audio:
                    raise ProviderExecutionError(
                        self.provider_name,
                        None,
                        "TTS WebSocket finished with empty audio data",
                    )
                self.log_tts_success(raw_audio, start_time)
                return raw_audio
        except ProviderExecutionError as p_err:
            self.log_tts_error(p_err.status_code, p_err.message)
            raise
        except Exception as exc:
            self.log_tts_error(None, str(exc))
            raise ProviderExecutionError(self.provider_name, None, f"WebSocket error: {exc}") from exc
