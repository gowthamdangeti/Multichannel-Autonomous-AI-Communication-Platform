"""Public API endpoints for managing WhatsApp numbers, agents, and conversations.

Accessible with API key authentication (X-API-Key header).
"""

import base64
from typing import Any, List

from fastapi import APIRouter, Header, HTTPException
from loguru import logger

from api.db import db_client
from api.db.whatsapp_agent_client import WhatsAppAgentNameConflictError
from api.schemas.whatsapp import (
    AttachAgentRequest,
    WhatsAppAgentCreate,
    WhatsAppAgentListResponse,
    WhatsAppAgentResponse,
    WhatsAppAgentUpdate,
    WhatsAppCharacter,
    WhatsAppConversationDetail,
    WhatsAppConversationListResponse,
    WhatsAppConversationSummary,
    WhatsAppMessage,
    WhatsAppNumberCreate,
    WhatsAppNumberListResponse,
    WhatsAppNumberResponse,
    WhatsAppQRResponse,
)
from api.services.whatsapp.characters import DEFAULT_CHARACTERS
from api.services.whatsapp.number_service import (
    create_connection,
    delete_connection,
    gateway_id,
    normalize_status,
    refresh_status,
)
from api.services.whatsapp.openwa_client import OpenWAError, get_openwa_client

router = APIRouter(prefix="/public/whatsapp", tags=["public-whatsapp"])


async def _validate_api_key(x_api_key: str):
    """Validate the org API key used to invoke public endpoints."""
    api_key = await db_client.validate_api_key(x_api_key)
    if not api_key:
        raise HTTPException(status_code=401, detail="Invalid API key")
    return api_key


async def _ensure_number_belongs_to_org(number_id: int, organization_id: int):
    number = await db_client.get_whatsapp_number(number_id, organization_id)
    if number is None:
        raise HTTPException(status_code=404, detail="WhatsApp number not found")
    return number


async def _ensure_agent_belongs_to_org(agent_id: int, organization_id: int):
    agent = await db_client.get_whatsapp_agent(agent_id, organization_id)
    if agent is None:
        raise HTTPException(status_code=404, detail="WhatsApp agent not found")
    return agent


def _extract_qr(payload: Any) -> str | None:
    """Normalise the gateway's QR response to a data-URL string."""
    if isinstance(payload, dict):
        for key in ("qr", "qrCode", "dataUrl", "data", "image"):
            val = payload.get(key)
            if isinstance(val, str) and val:
                if val.startswith(("data:", "http")):
                    return val
                return f"data:image/png;base64,{val}"
        raw = payload.get("raw")
        if isinstance(raw, (bytes, bytearray)):
            b64 = base64.b64encode(bytes(raw)).decode()
            ct = payload.get("contentType", "image/png")
            return f"data:{ct};base64,{b64}"
    return None


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


# ---------------------------------------------------------------------------
# WhatsApp Numbers Public APIs
# ---------------------------------------------------------------------------


@router.get("/numbers", response_model=WhatsAppNumberListResponse)
async def list_numbers(x_api_key: str = Header(..., alias="X-API-Key")):
    """List the organization's WhatsApp numbers via public API key."""
    api_key = await _validate_api_key(x_api_key)
    numbers = await db_client.list_whatsapp_numbers(api_key.organization_id)
    return WhatsAppNumberListResponse(
        numbers=[WhatsAppNumberResponse.model_validate(n) for n in numbers]
    )


@router.post("/numbers", response_model=WhatsAppNumberResponse)
async def create_number(
    body: WhatsAppNumberCreate, x_api_key: str = Header(..., alias="X-API-Key")
):
    """Register a new WhatsApp number / session via public API key."""
    api_key = await _validate_api_key(x_api_key)
    try:
        number = await create_connection(api_key.organization_id, body.name)
    except OpenWAError as e:
        raise HTTPException(status_code=502, detail=f"WhatsApp gateway error: {e}")
    return WhatsAppNumberResponse.model_validate(number)


@router.get("/numbers/{number_id}", response_model=WhatsAppNumberResponse)
async def get_number(
    number_id: int, x_api_key: str = Header(..., alias="X-API-Key")
):
    """Get WhatsApp number details & refresh status via public API key."""
    api_key = await _validate_api_key(x_api_key)
    number = await _ensure_number_belongs_to_org(number_id, api_key.organization_id)
    number = await refresh_status(number)
    return WhatsAppNumberResponse.model_validate(number)


@router.get("/numbers/{number_id}/qr", response_model=WhatsAppQRResponse)
async def get_number_qr(
    number_id: int, x_api_key: str = Header(..., alias="X-API-Key")
):
    """Fetch live QR code for pairing a WhatsApp number via public API key."""
    api_key = await _validate_api_key(x_api_key)
    number = await _ensure_number_belongs_to_org(number_id, api_key.organization_id)
    client = get_openwa_client()
    gw = gateway_id(number)
    try:
        payload = await client.get_qr(gw)
    except OpenWAError as e:
        if e.status_code == 400:
            try:
                await client.start_session(gw)
                payload = await client.get_qr(gw)
            except OpenWAError as e2:
                logger.debug(f"QR fetch for {number.openwa_session_name}: {e2}")
                return WhatsAppQRResponse(status="connecting", qr=None)
        else:
            logger.debug(f"QR fetch for {number.openwa_session_name}: {e}")
            return WhatsAppQRResponse(status=number.status, qr=None)

    status = number.status
    if isinstance(payload, dict) and payload.get("status"):
        status = normalize_status(payload.get("status"))
    return WhatsAppQRResponse(status=status, qr=_extract_qr(payload))


@router.post("/numbers/{number_id}/start", response_model=WhatsAppNumberResponse)
async def start_number(
    number_id: int, x_api_key: str = Header(..., alias="X-API-Key")
):
    """Start WhatsApp gateway session via public API key."""
    api_key = await _validate_api_key(x_api_key)
    number = await _ensure_number_belongs_to_org(number_id, api_key.organization_id)
    try:
        await get_openwa_client().start_session(gateway_id(number))
    except OpenWAError as e:
        raise HTTPException(status_code=502, detail=f"WhatsApp gateway error: {e}")
    return WhatsAppNumberResponse.model_validate(await refresh_status(number))


@router.post("/numbers/{number_id}/stop", response_model=WhatsAppNumberResponse)
async def stop_number(
    number_id: int, x_api_key: str = Header(..., alias="X-API-Key")
):
    """Stop WhatsApp gateway session via public API key."""
    api_key = await _validate_api_key(x_api_key)
    number = await _ensure_number_belongs_to_org(number_id, api_key.organization_id)
    try:
        await get_openwa_client().stop_session(gateway_id(number))
    except OpenWAError as e:
        raise HTTPException(status_code=502, detail=f"WhatsApp gateway error: {e}")
    updated = await db_client.update_whatsapp_number(
        number.id, api_key.organization_id, status="disconnected"
    )
    return WhatsAppNumberResponse.model_validate(updated or number)


@router.delete("/numbers/{number_id}")
async def delete_number(
    number_id: int, x_api_key: str = Header(..., alias="X-API-Key")
):
    """Delete a WhatsApp number / session via public API key."""
    api_key = await _validate_api_key(x_api_key)
    number = await _ensure_number_belongs_to_org(number_id, api_key.organization_id)
    await delete_connection(number)
    return {"message": "WhatsApp number deleted"}


@router.patch("/numbers/{number_id}/agent", response_model=WhatsAppNumberResponse)
async def attach_agent(
    number_id: int,
    body: AttachAgentRequest,
    x_api_key: str = Header(..., alias="X-API-Key"),
):
    """Attach (or detach with agent_id=null) a WhatsApp agent to a number via public API key."""
    api_key = await _validate_api_key(x_api_key)
    org_id = api_key.organization_id
    await _ensure_number_belongs_to_org(number_id, org_id)

    if body.agent_id is not None:
        await _ensure_agent_belongs_to_org(body.agent_id, org_id)

    updated = await db_client.update_whatsapp_number(
        number_id, org_id, assigned_agent_id=body.agent_id
    )
    return WhatsAppNumberResponse.model_validate(updated)


# ---------------------------------------------------------------------------
# WhatsApp Agents Public APIs
# ---------------------------------------------------------------------------


@router.get("/characters", response_model=List[WhatsAppCharacter])
async def list_characters(x_api_key: str = Header(..., alias="X-API-Key")):
    """List default character presets via public API key."""
    await _validate_api_key(x_api_key)
    return [WhatsAppCharacter(**c) for c in DEFAULT_CHARACTERS]


@router.get("/agents", response_model=WhatsAppAgentListResponse)
async def list_agents(x_api_key: str = Header(..., alias="X-API-Key")):
    """List organization's WhatsApp agents via public API key."""
    api_key = await _validate_api_key(x_api_key)
    org_id = api_key.organization_id
    agents = await db_client.list_whatsapp_agents(org_id)
    run_counts = {}
    if hasattr(db_client, "get_whatsapp_agent_run_counts"):
        run_counts = await db_client.get_whatsapp_agent_run_counts([a.id for a in agents], org_id)
    serialized = []
    for a in agents:
        setattr(a, "total_runs", run_counts.get(a.id, 0))
        serialized.append(WhatsAppAgentResponse.model_validate(a))
    return WhatsAppAgentListResponse(agents=serialized)


@router.post("/agents", response_model=WhatsAppAgentResponse)
async def create_agent(
    body: WhatsAppAgentCreate, x_api_key: str = Header(..., alias="X-API-Key")
):
    """Create a new WhatsApp agent via public API key."""
    api_key = await _validate_api_key(x_api_key)
    try:
        agent = await db_client.create_whatsapp_agent(
            organization_id=api_key.organization_id,
            name=body.name,
            description=body.description,
            character=body.character,
            system_prompt=body.system_prompt,
            greeting=body.greeting,
            model_config_ref=body.model_config_ref,
            active_contacts=body.active_contacts,
            deactive_contacts=body.deactive_contacts,
        )
    except WhatsAppAgentNameConflictError as e:
        raise HTTPException(status_code=409, detail=str(e))
    setattr(agent, "total_runs", 0)
    return WhatsAppAgentResponse.model_validate(agent)


@router.get("/agents/{agent_id}", response_model=WhatsAppAgentResponse)
async def get_agent(
    agent_id: int, x_api_key: str = Header(..., alias="X-API-Key")
):
    """Get WhatsApp agent details via public API key."""
    api_key = await _validate_api_key(x_api_key)
    org_id = api_key.organization_id
    agent = await _ensure_agent_belongs_to_org(agent_id, org_id)
    if hasattr(db_client, "get_whatsapp_agent_run_counts"):
        run_counts = await db_client.get_whatsapp_agent_run_counts([agent_id], org_id)
        setattr(agent, "total_runs", run_counts.get(agent_id, 0))
    return WhatsAppAgentResponse.model_validate(agent)


@router.patch("/agents/{agent_id}", response_model=WhatsAppAgentResponse)
async def update_agent(
    agent_id: int,
    body: WhatsAppAgentUpdate,
    x_api_key: str = Header(..., alias="X-API-Key"),
):
    """Update WhatsApp agent details via public API key."""
    api_key = await _validate_api_key(x_api_key)
    org_id = api_key.organization_id
    await _ensure_agent_belongs_to_org(agent_id, org_id)

    fields = body.model_dump(exclude_unset=True)
    try:
        updated = await db_client.update_whatsapp_agent(agent_id, org_id, **fields)
    except WhatsAppAgentNameConflictError as e:
        raise HTTPException(status_code=409, detail=str(e))
    if updated is None:
        raise HTTPException(status_code=404, detail="WhatsApp agent not found")
    if hasattr(db_client, "get_whatsapp_agent_run_counts"):
        run_counts = await db_client.get_whatsapp_agent_run_counts([agent_id], org_id)
        setattr(updated, "total_runs", run_counts.get(agent_id, 0))
    return WhatsAppAgentResponse.model_validate(updated)


@router.delete("/agents/{agent_id}")
async def delete_agent(
    agent_id: int, x_api_key: str = Header(..., alias="X-API-Key")
):
    """Delete a WhatsApp agent via public API key."""
    api_key = await _validate_api_key(x_api_key)
    org_id = api_key.organization_id
    ok = await db_client.delete_whatsapp_agent(agent_id, org_id)
    if not ok:
        raise HTTPException(status_code=404, detail="WhatsApp agent not found")
    return {"message": "WhatsApp agent deleted"}


# ---------------------------------------------------------------------------
# WhatsApp Conversations Public APIs
# ---------------------------------------------------------------------------


@router.get("/conversations", response_model=WhatsAppConversationListResponse)
async def list_conversations(x_api_key: str = Header(..., alias="X-API-Key")):
    """List WhatsApp conversation summaries via public API key."""
    api_key = await _validate_api_key(x_api_key)
    org_id = api_key.organization_id
    convos = await db_client.list_whatsapp_conversations(org_id)
    numbers_by_id = {n.id: n for n in await db_client.list_whatsapp_numbers(org_id)}
    agents_by_id = {a.id: a for a in await db_client.list_whatsapp_agents(org_id)}
    items = [
        await _conversation_summary(c, numbers_by_id, agents_by_id) for c in convos
    ]
    return WhatsAppConversationListResponse(conversations=items)


@router.get(
    "/conversations/{conversation_id}", response_model=WhatsAppConversationDetail
)
async def get_conversation_detail(
    conversation_id: int, x_api_key: str = Header(..., alias="X-API-Key")
):
    """Get WhatsApp conversation thread details via public API key."""
    api_key = await _validate_api_key(x_api_key)
    org_id = api_key.organization_id
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
