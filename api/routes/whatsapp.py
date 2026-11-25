"""WhatsApp channel routes.

Phase 1: connect and manage WhatsApp numbers (OpenWA sessions) — create, list,
QR, start/stop, delete — plus a webhook receiver that keeps our connection
status in sync. Inbound message handling (Phase 3) plugs into the same webhook.
"""

from __future__ import annotations

import asyncio
import base64
from typing import Any, List, Optional

import redis.asyncio as redis
from fastapi import APIRouter, Depends, HTTPException, Request
from loguru import logger

from api.constants import REDIS_URL


def _default_media_settings(media_type: str = "general") -> dict:
    default_exts = {
        "image": [".jpg", ".jpeg", ".png", ".webp", ".gif", ".svg", ".heic"],
        "document": [".pdf", ".doc", ".docx", ".txt", ".csv", ".xlsx", ".pptx"],
        "audio": [".mp3", ".wav", ".ogg", ".m4a", ".aac", ".flac"],
    }.get(media_type, [])
    return {
        "enabled": True,
        "max_files": 20,
        "max_file_size_mb": 100,
        "allowed_extensions": default_exts,
        "reply_with_voice": False,
    }
from api.db import db_client
from api.db.models import UserModel, WhatsAppAgentModel
from api.db.whatsapp_agent_client import (
    WhatsAppAgentAssociationValidationError,
    WhatsAppAgentNameConflictError,
)
from api.schemas.whatsapp import (
    AttachAgentRequest,
    WhatsAppAgentCreate,
    WhatsAppAgentMediaSettings,
    WhatsAppAgentResponse,
    WhatsAppAgentUpdate,
    WhatsAppCharacter,
    WhatsAppConversationDetail,
    WhatsAppConversationSummary,
    WhatsAppMessage,
    WhatsAppNumberCreate,
    WhatsAppNumberResponse,
    WhatsAppQRResponse,
)
from api.services.auth.depends import get_user
from api.services.whatsapp.characters import DEFAULT_CHARACTERS
from api.services.whatsapp.conversation import handle_inbound, handle_inbound_media
from api.services.whatsapp.number_service import (
    WhatsAppNumberNameConflictError,
    create_connection,
    delete_connection,
    gateway_id,
    normalize_status,
    refresh_status,
)
from api.services.whatsapp.openwa_client import OpenWAError, get_openwa_client

router = APIRouter(prefix="/whatsapp")

_whatsapp_dedupe_redis = redis.from_url(REDIS_URL, decode_responses=True)
WHATSAPP_DEDUPE_TTL_SECONDS = 24 * 60 * 60

# Retain strong references to background processing tasks so Python's GC does not collect them mid-flight
_inbound_tasks: set[asyncio.Task] = set()


async def _claim_inbound_message(session_name: str, message_id: str | None) -> bool:
    """Claim one provider message across webhook retries and workers."""
    if not message_id:
        return True
    key = f"whatsapp:inbound:{session_name}:{message_id}"
    try:
        claimed = await _whatsapp_dedupe_redis.set(
            key, "1", nx=True, ex=WHATSAPP_DEDUPE_TTL_SECONDS
        )
        if not claimed:
            logger.info(
                "WhatsApp duplicate inbound acknowledged session={} message_id={}",
                session_name,
                message_id,
            )
        return bool(claimed)
    except Exception as exc:
        # Do not drop a real message if Redis is temporarily unavailable.
        logger.warning("WhatsApp dedupe unavailable: {}", exc)
        return True


async def _release_inbound_message(session_name: str, message_id: str | None) -> None:
    """Release the dedupe claim when message processing fails so retries can succeed."""
    if not message_id:
        return
    key = f"whatsapp:inbound:{session_name}:{message_id}"
    try:
        await _whatsapp_dedupe_redis.delete(key)
        logger.info(
            "Released WhatsApp dedupe key for session={} message_id={}",
            session_name,
            message_id,
        )
    except Exception as exc:
        logger.warning("WhatsApp dedupe release failed: {}", exc)


def _require_org(user: UserModel) -> int:
    if not user.selected_organization_id:
        raise HTTPException(status_code=400, detail="No organization selected")
    return user.selected_organization_id


async def _resolve_document_ids(document_uuids: list[str], organization_id: int) -> list[int]:
    if not document_uuids:
        return []
    from sqlalchemy import select
    from api.db.models import KnowledgeBaseDocumentModel

    async with db_client.async_session() as session:
        result = await session.execute(
            select(KnowledgeBaseDocumentModel).where(
                KnowledgeBaseDocumentModel.document_uuid.in_(document_uuids),
                KnowledgeBaseDocumentModel.organization_id == organization_id,
            )
        )
        documents = list(result.scalars().all())
    if len(documents) != len(set(document_uuids)):
        raise HTTPException(
            status_code=400,
            detail="One or more requested documents are invalid or inaccessible.",
        )
    return [document.id for document in documents]


def _normalize_ui_media_dict(raw: dict | None, media_type: str) -> dict:
    default_s = _default_media_settings(media_type)
    if not isinstance(raw, dict):
        return default_s
    enabled = raw.get("enabled", default_s["enabled"])
    max_files = raw.get("max_files", raw.get("maxFiles", default_s["max_files"]))
    max_file_size_mb = raw.get("max_file_size_mb", raw.get("maxSizeMB", default_s["max_file_size_mb"]))
    allowed = raw.get("allowed_extensions", raw.get("allowedTypes", default_s["allowed_extensions"]))
    reply_with_voice = raw.get("reply_with_voice", raw.get("replyWithVoice", default_s.get("reply_with_voice", False)))
    normalized_exts = []
    if isinstance(allowed, list):
        for ext in allowed:
            if isinstance(ext, str) and ext.strip():
                clean = ext.strip().lower()
                normalized_exts.append(clean if clean.startswith(".") else f".{clean}")
    return {
        "enabled": bool(enabled),
        "max_files": int(max_files) if max_files is not None else default_s["max_files"],
        "max_file_size_mb": int(max_file_size_mb) if max_file_size_mb is not None else default_s["max_file_size_mb"],
        "allowed_extensions": normalized_exts if normalized_exts else default_s["allowed_extensions"],
        "reply_with_voice": bool(reply_with_voice),
    }


def _serialize_agent_response(
    agent: WhatsAppAgentModel, total_runs: int = 0
) -> WhatsAppAgentResponse:
    """Serialize an agent with its associated tool IDs and document UUIDs."""
    tool_ids = [tool.id for tool in agent.tools] if agent.tools else []
    document_uuids = [doc.document_uuid for doc in agent.documents] if agent.documents else []

    # If top-level columns are empty, try extracting from model_config_ref.media_config
    ref_mc = (agent.model_config_ref or {}).get("media_config", {}) if isinstance(agent.model_config_ref, dict) else {}
    img_raw = agent.image_settings or ref_mc.get("images") or ref_mc.get("image")
    doc_raw = agent.document_settings or ref_mc.get("documents") or ref_mc.get("document")
    aud_raw = agent.audio_settings or ref_mc.get("audio")

    return WhatsAppAgentResponse(
        id=agent.id,
        name=agent.name,
        description=agent.description,
        character=agent.character,
        system_prompt=agent.system_prompt,
        greeting=agent.greeting,
        guardrails=agent.guardrails,
        model_config_ref=agent.model_config_ref or {},
        active_contacts=agent.active_contacts or [],
        deactive_contacts=agent.deactive_contacts or [],
        is_active=agent.is_active,
        tool_ids=tool_ids,
        document_uuids=document_uuids,
        total_runs=total_runs,
        image_settings=_normalize_ui_media_dict(img_raw, "image"),
        document_settings=_normalize_ui_media_dict(doc_raw, "document"),
        audio_settings=_normalize_ui_media_dict(aud_raw, "audio"),
        created_at=agent.created_at,
        updated_at=agent.updated_at,
    )


async def _get_owned_number(number_id: int, organization_id: int):
    number = await db_client.get_whatsapp_number(number_id, organization_id)
    if number is None:
        raise HTTPException(status_code=404, detail="WhatsApp number not found")
    return number


@router.post("/numbers", response_model=WhatsAppNumberResponse)
async def create_number(
    body: WhatsAppNumberCreate, user: UserModel = Depends(get_user)
):
    org_id = _require_org(user)
    try:
        number = await create_connection(org_id, body.name)
    except WhatsAppNumberNameConflictError as e:
        raise HTTPException(status_code=409, detail=str(e))
    except OpenWAError as e:
        raise HTTPException(status_code=502, detail=f"WhatsApp gateway error: {e}")
    return WhatsAppNumberResponse.model_validate(number)


@router.get("/numbers", response_model=List[WhatsAppNumberResponse])
async def list_numbers(user: UserModel = Depends(get_user)):
    org_id = _require_org(user)
    numbers = await db_client.list_whatsapp_numbers(org_id)
    return [WhatsAppNumberResponse.model_validate(n) for n in numbers]


@router.get("/numbers/{number_id}", response_model=WhatsAppNumberResponse)
async def get_number(number_id: int, user: UserModel = Depends(get_user)):
    org_id = _require_org(user)
    number = await _get_owned_number(number_id, org_id)
    number = await refresh_status(number)
    return WhatsAppNumberResponse.model_validate(number)


def _extract_qr(payload: Any) -> str | None:
    """Normalise the gateway's QR response to a data-URL string."""
    if isinstance(payload, dict):
        for key in ("qr", "qrCode", "dataUrl", "data", "image"):
            val = payload.get(key)
            if isinstance(val, str) and val:
                # Already a data-URL or http(s) URL → use as-is; else assume base64.
                if val.startswith(("data:", "http")):
                    return val
                return f"data:image/png;base64,{val}"
        raw = payload.get("raw")
        if isinstance(raw, (bytes, bytearray)):
            b64 = base64.b64encode(bytes(raw)).decode()
            ct = payload.get("contentType", "image/png")
            return f"data:{ct};base64,{b64}"
    return None


@router.get("/numbers/{number_id}/qr", response_model=WhatsAppQRResponse)
async def get_number_qr(number_id: int, user: UserModel = Depends(get_user)):
    org_id = _require_org(user)
    number = await _get_owned_number(number_id, org_id)
    client = get_openwa_client()
    gw = gateway_id(number)
    try:
        payload = await client.get_qr(gw)
    except OpenWAError as e:
        if e.status_code != 400:
            logger.debug(f"QR fetch for {number.openwa_session_name}: {e}")
            return WhatsAppQRResponse(status=number.status, qr=None)
        # 400 means there is no QR right now (initializing, authenticating, or
        # already connected). Never call /start here — a running session
        # rejects it and it can disturb an in-flight handshake. Only revive a
        # session that is actually stopped.
        try:
            session = await client.get_session(gw)
        except OpenWAError as e2:
            logger.debug(f"QR fetch for {number.openwa_session_name}: {e2}")
            return WhatsAppQRResponse(status=number.status, qr=None)
        raw_status = session.get("status") or session.get("state")
        current = normalize_status(raw_status) if raw_status else number.status
        if current not in {"created", "disconnected"}:
            return WhatsAppQRResponse(status=current, qr=None)
        try:
            await client.start_session(gw)
            payload = await client.get_qr(gw)
        except OpenWAError as e2:
            logger.debug(f"QR fetch for {number.openwa_session_name}: {e2}")
            return WhatsAppQRResponse(status="connecting", qr=None)
    status = number.status
    if isinstance(payload, dict) and payload.get("status"):
        status = normalize_status(payload.get("status"))
    return WhatsAppQRResponse(status=status, qr=_extract_qr(payload))


@router.post("/numbers/{number_id}/start", response_model=WhatsAppNumberResponse)
async def start_number(number_id: int, user: UserModel = Depends(get_user)):
    org_id = _require_org(user)
    number = await _get_owned_number(number_id, org_id)
    try:
        await get_openwa_client().start_session(gateway_id(number))
    except OpenWAError as e:
        raise HTTPException(status_code=502, detail=f"WhatsApp gateway error: {e}")
    return WhatsAppNumberResponse.model_validate(await refresh_status(number))


@router.post("/numbers/{number_id}/stop", response_model=WhatsAppNumberResponse)
async def stop_number(number_id: int, user: UserModel = Depends(get_user)):
    org_id = _require_org(user)
    number = await _get_owned_number(number_id, org_id)
    try:
        await get_openwa_client().stop_session(gateway_id(number))
    except OpenWAError as e:
        raise HTTPException(status_code=502, detail=f"WhatsApp gateway error: {e}")
    updated = await db_client.update_whatsapp_number(
        number.id, org_id, status="disconnected"
    )
    return WhatsAppNumberResponse.model_validate(updated or number)


@router.delete("/numbers/{number_id}")
async def delete_number(number_id: int, user: UserModel = Depends(get_user)):
    org_id = _require_org(user)
    number = await _get_owned_number(number_id, org_id)
    await delete_connection(number)
    return {"success": True}


@router.patch("/numbers/{number_id}/agent", response_model=WhatsAppNumberResponse)
async def attach_agent(
    number_id: int, body: AttachAgentRequest, user: UserModel = Depends(get_user)
):
    """Attach (or detach with agent_id=null) a WhatsApp agent to a number."""
    org_id = _require_org(user)
    await _get_owned_number(number_id, org_id)
    if body.agent_id is not None:
        # Validate the agent belongs to this org before linking it (tenant safety).
        agent = await db_client.get_whatsapp_agent(body.agent_id, org_id)
        if agent is None:
            raise HTTPException(status_code=404, detail="Agent not found")
    updated = await db_client.update_whatsapp_number(
        number_id, org_id, assigned_agent_id=body.agent_id
    )
    return WhatsAppNumberResponse.model_validate(updated)


# ── WhatsApp agents ──────────────────────────────────────────────────────────


@router.get("/characters", response_model=List[WhatsAppCharacter])
async def list_characters(user: UserModel = Depends(get_user)):
    """Curated default characters users can start an agent from."""
    return [WhatsAppCharacter(**c) for c in DEFAULT_CHARACTERS]


@router.post("/agents", response_model=WhatsAppAgentResponse)
async def create_agent(
    body: WhatsAppAgentCreate, user: UserModel = Depends(get_user)
):
    org_id = _require_org(user)
    from api.services.billing.agent_limits import agent_limit_guard

    await agent_limit_guard.assert_can_create_agent(org_id, kind="whatsapp", user=user)

    document_ids = await _resolve_document_ids(body.document_uuids, org_id)

    # Media settings can arrive top-level or nested under model_config_ref.media_config.
    media = body.model_dump(include={"image_settings", "document_settings", "audio_settings"})
    if isinstance(body.model_config_ref, dict):
        mc = body.model_config_ref.get("media_config")
        if isinstance(mc, dict):
            if "image_settings" not in body.model_fields_set and ("images" in mc or "image" in mc):
                media["image_settings"] = mc.get("images") or mc.get("image")
            if "document_settings" not in body.model_fields_set and ("documents" in mc or "document" in mc):
                media["document_settings"] = mc.get("documents") or mc.get("document")
            if "audio_settings" not in body.model_fields_set and "audio" in mc:
                media["audio_settings"] = mc.get("audio")

    try:
        agent = await db_client.create_whatsapp_agent(
            organization_id=org_id,
            name=body.name,
            description=body.description,
            character=body.character,
            system_prompt=body.system_prompt,
            greeting=body.greeting,
            guardrails=body.guardrails,
            model_config_ref=body.model_config_ref,
            active_contacts=body.active_contacts,
            deactive_contacts=body.deactive_contacts,
            tool_ids=body.tool_ids,
            document_ids=document_ids,
            image_settings=_normalize_ui_media_dict(media["image_settings"], "image"),
            document_settings=_normalize_ui_media_dict(media["document_settings"], "document"),
            audio_settings=_normalize_ui_media_dict(media["audio_settings"], "audio"),
        )
    except WhatsAppAgentNameConflictError as e:
        raise HTTPException(status_code=409, detail=str(e))
    except WhatsAppAgentAssociationValidationError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return _serialize_agent_response(agent, total_runs=0)


@router.get("/agents", response_model=List[WhatsAppAgentResponse])
async def list_agents(user: UserModel = Depends(get_user)):
    org_id = _require_org(user)
    agents = await db_client.list_whatsapp_agents(org_id)
    agent_ids = [a.id for a in agents]
    run_counts = await db_client.get_whatsapp_agent_run_counts(agent_ids, org_id)
    return [
        _serialize_agent_response(a, total_runs=run_counts.get(a.id, 0))
        for a in agents
    ]


@router.get("/agents/{agent_id}", response_model=WhatsAppAgentResponse)
async def get_agent(agent_id: int, user: UserModel = Depends(get_user)):
    org_id = _require_org(user)
    agent = await db_client.get_whatsapp_agent(agent_id, org_id)
    if agent is None:
        raise HTTPException(status_code=404, detail="Agent not found")
    run_counts = await db_client.get_whatsapp_agent_run_counts([agent_id], org_id)
    return _serialize_agent_response(agent, total_runs=run_counts.get(agent_id, 0))


@router.patch("/agents/{agent_id}", response_model=WhatsAppAgentResponse)
async def update_agent(
    agent_id: int, body: WhatsAppAgentUpdate, user: UserModel = Depends(get_user)
):
    org_id = _require_org(user)
    # Only apply fields the client actually sent.
    fields = body.model_dump(exclude_unset=True)

    if "document_uuids" in fields:
        fields["document_ids"] = await _resolve_document_ids(
            fields.pop("document_uuids"), org_id
        )

    # Sync media settings from model_config_ref if client only passed model_config_ref.media_config
    if "model_config_ref" in fields and isinstance(fields["model_config_ref"], dict):
        mc = fields["model_config_ref"].get("media_config")
        if isinstance(mc, dict):
            if "image_settings" not in fields and ("images" in mc or "image" in mc):
                fields["image_settings"] = _normalize_ui_media_dict(mc.get("images") or mc.get("image"), "image")
            if "document_settings" not in fields and ("documents" in mc or "document" in mc):
                fields["document_settings"] = _normalize_ui_media_dict(mc.get("documents") or mc.get("document"), "document")
            if "audio_settings" not in fields and "audio" in mc:
                fields["audio_settings"] = _normalize_ui_media_dict(mc.get("audio"), "audio")

    for k in ("image_settings", "document_settings", "audio_settings"):
        if k in fields and isinstance(fields[k], dict):
            mtype = k.split("_")[0]
            fields[k] = _normalize_ui_media_dict(fields[k], mtype)

    try:
        updated = await db_client.update_whatsapp_agent(agent_id, org_id, **fields)
    except WhatsAppAgentNameConflictError as e:
        raise HTTPException(status_code=409, detail=str(e))
    except WhatsAppAgentAssociationValidationError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if updated is None:
        raise HTTPException(status_code=404, detail="Agent not found")
    run_counts = await db_client.get_whatsapp_agent_run_counts([agent_id], org_id)
    return _serialize_agent_response(updated, total_runs=run_counts.get(agent_id, 0))


@router.delete("/agents/{agent_id}")
async def delete_agent(agent_id: int, user: UserModel = Depends(get_user)):
    org_id = _require_org(user)
    ok = await db_client.delete_whatsapp_agent(agent_id, org_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Agent not found")
    return {"success": True}


# ── WhatsApp conversations ───────────────────────────────────────────────────


async def _conversation_summary(convo, numbers_by_id, agents_by_id):
    msgs = convo.messages or []
    last = msgs[-1] if msgs else None
    number = numbers_by_id.get(convo.number_id)
    agent = None
    agent_id = None
    if number is not None and number.assigned_agent_id:
        agent_id = number.assigned_agent_id
        agent = agents_by_id.get(number.assigned_agent_id)
    return WhatsAppConversationSummary(
        id=convo.id,
        number_id=convo.number_id,
        number_name=number.name if number else None,
        agent_id=agent_id,
        agent_name=agent.name if agent else None,
        contact=convo.contact,
        message_count=len(msgs),
        last_message=(last or {}).get("content") if last else None,
        last_role=(last or {}).get("role") if last else None,
        updated_at=convo.updated_at,
    )


@router.get("/conversations", response_model=List[WhatsAppConversationSummary])
async def list_conversations(user: UserModel = Depends(get_user)):
    org_id = _require_org(user)
    convos = await db_client.list_whatsapp_conversations(org_id)
    numbers_by_id = {n.id: n for n in await db_client.list_whatsapp_numbers(org_id)}
    agents_by_id = {a.id: a for a in await db_client.list_whatsapp_agents(org_id)}
    return [
        await _conversation_summary(c, numbers_by_id, agents_by_id) for c in convos
    ]


@router.get(
    "/conversations/{conversation_id}", response_model=WhatsAppConversationDetail
)
async def get_conversation_detail(
    conversation_id: int, user: UserModel = Depends(get_user)
):
    org_id = _require_org(user)
    convo = await db_client.get_whatsapp_conversation(conversation_id, org_id)
    if convo is None:
        raise HTTPException(status_code=404, detail="Conversation not found")
    numbers_by_id = {n.id: n for n in await db_client.list_whatsapp_numbers(org_id)}
    agents_by_id = {a.id: a for a in await db_client.list_whatsapp_agents(org_id)}
    summary = await _conversation_summary(convo, numbers_by_id, agents_by_id)
    raw_messages: list[dict] = list(convo.messages or [])
    return WhatsAppConversationDetail(
        **summary.model_dump(),
        messages=[
            WhatsAppMessage(**m)
            for m in raw_messages
            if isinstance(m, dict) and m.get("content")
        ],
    )


@router.post("/webhook/{session_name}")
async def whatsapp_webhook(session_name: str, request: Request):
    """Receive OpenWA events for a session.

    Public endpoint (called by the gateway, not a logged-in user). Phase 1 keeps
    connection status in sync; Phase 3 dispatches inbound messages to the agent.
    """
    try:
        payload = await request.json()
    except Exception:
        payload = {}

    number = await db_client.get_whatsapp_number_by_session(session_name)
    if number is None:
        # Unknown session — ack so the gateway doesn't retry forever.
        logger.info(f"WhatsApp webhook for unknown session {session_name}")
        return {"ok": True}

    event = payload.get("event") or payload.get("type") or ""
    data = payload.get("data") or payload.get("payload") or payload
    if not isinstance(data, dict):
        data = {}
    logger.info(
        f"WA webhook session={session_name} event={event} keys={list(data)[:12]}"
    )
    if event in {"message.received", "message"}:
        media_value = data.get("media")
        media_keys = list(media_value)[:20] if isinstance(media_value, dict) else []
        logger.info(
            "WA inbound metadata session={} id={} chat_id={} type={} kind={} "
            "body_present={} media_present={} media_python_type={} media_keys={}",
            session_name,
            data.get("id"),
            data.get("chatId"),
            data.get("type"),
            data.get("kind"),
            bool(data.get("body")),
            media_value is not None,
            type(media_value).__name__,
            media_keys,
        )

    if event.startswith("session.") or event in {"session.status", "qr"}:
        raw_status = data.get("status") or data.get("state") or (
            "qr" if "qr" in event else None
        )
        phone = data.get("phoneNumber") or data.get("phone")
        await db_client.update_whatsapp_number(
            number.id,
            number.organization_id,
            status=normalize_status(raw_status) if raw_status else None,
            phone_number=phone,
        )
    elif event in {"message.received", "message"}:
        from_me, contact, msg_text, media = _extract_inbound_message(data)
        logger.info(
            "WA normalized media type={} filename={} chat_id={} message_id={}",
            media.get("type") if media else None,
            media.get("filename") if media else None,
            media.get("chat_id") if media else None,
            media.get("message_id") if media else None,
        )
        message_id = data.get("id") or (data.get("key") or {}).get("id")
        if from_me or not contact:
            return {"ok": True}  # our own message
        if not await _claim_inbound_message(session_name, message_id):
            return {"ok": True}
        if not msg_text and not media:
            return {"ok": True}  # nothing to reply to
        # Process message in background to avoid blocking the webhook response.
        # OpenWA times out and aborts HTTP requests that take > 10-15s (e.g. STT/LLM inference).
        async def _process_inbound():
            success = False
            try:
                if media:
                    logger.info("WA calling_media_handler=true")
                    success = await handle_inbound_media(
                        number, str(contact), msg_text or "", media, data
                    )
                else:
                    success = await handle_inbound(number, str(contact), str(msg_text))
            except Exception as e:
                logger.error(
                    f"WhatsApp inbound handling failed on {session_name}: {e}"
                )
            finally:
                if not success:
                    await _release_inbound_message(session_name, message_id)

        task = asyncio.create_task(_process_inbound())
        _inbound_tasks.add(task)
        task.add_done_callback(_inbound_tasks.discard)

    return {"ok": True}


def _extract_inbound_message(data: Any):
    """Pull (from_me, contact_chat_id, text, media_info) out of an OpenWA
    message payload, tolerating the various shapes across engine/versions.

    *media_info* is a dict with keys ``type``, ``mime_type``, ``filename``,
    ``caption``, ``message_key`` when the message carries a media attachment,
    or ``None`` for plain-text messages.
    """
    msg = data.get("message") if isinstance(data.get("message"), dict) else data
    key = data.get("key") if isinstance(data.get("key"), dict) else {}

    from_me = data.get("fromMe")
    if from_me is None:
        from_me = key.get("fromMe")

    contact = (
        data.get("from")
        or data.get("chatId")
        or data.get("sender")
        or key.get("remoteJid")
        or (data.get("chat") or {}).get("id")
    )
    if isinstance(contact, dict):
        contact = contact.get("_serialized") or contact.get("id") or None
    chat_id = data.get("chatId") or contact or key.get("remoteJid")

    text = (
        data.get("body")
        or data.get("text")
        or data.get("caption")
        or (msg.get("conversation") if isinstance(msg, dict) else None)
        or (msg.get("text") if isinstance(msg, dict) else None)
        or (
            (msg.get("extendedTextMessage") or {}).get("text")
            if isinstance(msg, dict)
            else None
        )
    )

    # Detect media message
    media = _extract_media_info(data, msg, key)
    if media:
        media["chat_id"] = chat_id
        media["message_id"] = data.get("id") or key.get("id")

    return bool(from_me), contact, text, media


def _extract_media_info(data: dict, msg: dict, key: dict) -> Optional[dict]:
    """Extract media metadata from the OpenWA payload if present.

    Returns ``None`` for plain-text messages, or a dict:
    ``{"type": "image"|"audio"|"document"|"video",
       "mime_type": ...,
       "filename": ...,
       "caption": ...,
       "message_key": ...}``
    """
    msg_type = data.get("type", "")
    if msg_type not in ("image", "audio", "document", "video", "ptt", "voice"):
        return None

    caption = data.get("caption") or ""

    # Normalize canonical media type: voice/ptt -> audio
    _VOICE_TYPES = frozenset({"ptt", "voice"})
    norm_type = "audio" if msg_type in _VOICE_TYPES else msg_type

    inner = msg if isinstance(msg, dict) else {}

    # The running OpenWA emits a simplified top-level media DTO. Keep the
    # nested raw-Baileys fallbacks for payloads that still include them.
    simplified_media = data.get("media")
    media_container = simplified_media if isinstance(simplified_media, dict) else None
    filename = ""
    mime_type = ""

    if media_container:
        mime_type = media_container.get("mimetype") or media_container.get("mimeType", "")
        filename = media_container.get("filename") or media_container.get("fileName") or ""
        caption = caption or media_container.get("caption") or ""

    if norm_type == "image" and not media_container:
        media_container = inner.get("imageMessage") or {}
        mime_type = media_container.get("mimetype", "image/jpeg")
        filename = media_container.get("fileName", "") or inner.get("fileName", "")
        caption = caption or media_container.get("caption", "")
    elif norm_type == "audio" and not media_container:
        media_container = inner.get("audioMessage") or {}
        mime_type = media_container.get("mimetype", "audio/ogg")
        filename = media_container.get("fileName", "") or "voice.ogg"
    elif norm_type == "document" and not media_container:
        media_container = inner.get("documentMessage") or {}
        mime_type = media_container.get("mimetype", "application/octet-stream")
        filename = (
            media_container.get("fileName", "")
            or inner.get("fileName", "")
            or data.get("filename", "")
            or "document"
        )
        caption = caption or media_container.get("caption", "")
    elif norm_type == "video" and not media_container:
        media_container = inner.get("videoMessage") or {}
        mime_type = media_container.get("mimetype", "video/mp4")
        filename = media_container.get("fileName", "") or "video.mp4"
        caption = caption or media_container.get("caption", "")

    if media_container and not mime_type:
        mime_type = {
            "image": "image/jpeg",
            "audio": "audio/ogg",
            "document": "application/octet-stream",
            "video": "video/mp4",
        }.get(norm_type, "application/octet-stream")

    raw_media = None
    if media_container:
        candidate = media_container.get("data") or media_container.get("base64")
        if isinstance(candidate, str) and candidate.strip():
            raw_media = candidate.strip()

    if not media_container:
        return None

    res = {
        "type": norm_type,
        "mime_type": mime_type,
        "filename": filename,
        "caption": caption,
        "message_key": {
            "id": key.get("id") or data.get("id"),
            "remoteJid": key.get("remoteJid") or data.get("chatId") or data.get("from"),
            "fromMe": key.get("fromMe", False),
        },
    }
    if raw_media:
        res["raw_media"] = raw_media
    return res


@router.post("/validate-provider")
async def validate_provider(
    payload: dict,
    user: UserModel = Depends(get_user),
) -> dict:
    """Validate whether an audio provider/model combination is supported for STT or TTS."""
    from api.services.audio_providers.registry import get_stt_provider, get_tts_provider

    provider = str(payload.get("provider") or "").lower().strip()
    service = str(payload.get("service") or "stt").lower().strip()
    model = payload.get("model")

    if service == "stt":
        inst = get_stt_provider(provider)
        valid = inst is not None
    elif service == "tts":
        inst = get_tts_provider(provider)
        valid = inst is not None
    else:
        raise HTTPException(status_code=400, detail="Invalid service type: must be 'stt' or 'tts'")

    return {
        "provider": provider,
        "service": service,
        "model": model,
        "supported": valid,
        "error": None if valid else f"{service.upper()} provider '{provider}' is not supported.",
    }

