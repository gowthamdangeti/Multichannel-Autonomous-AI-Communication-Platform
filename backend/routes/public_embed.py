"""Public API endpoints for workflow embedding.

These endpoints are accessible without authentication but require valid embed tokens.
They handle CORS, domain validation, and session management for embedded workflows.
"""

import json
import secrets
import time
from datetime import UTC, datetime, timedelta
from typing import Any, Optional
from urllib.parse import urlsplit

from fastapi import (
    APIRouter,
    HTTPException,
    Request,
    Response,
)
from loguru import logger
from pydantic import BaseModel, Field
from starlette.datastructures import Headers
from starlette.types import ASGIApp, Receive, Scope, Send

from api.db import db_client
from api.db.models import ChatAgentModel
from api.enums import WorkflowRunMode
from api.routes.turn_credentials import (
    TURN_ENABLED,
    TurnCredentialsResponse,
    generate_user_turn_credentials,
)
from api.schemas.embed import PublicPreCallForm
from api.services.chat.conversation_stats import END_REASONS, conversation_status
from api.services.chat.auto_evaluation import queue_chat_finish_jobs
from api.services.chat.message_actions import ChatActionError, rate_reply, retry_last_reply
from api.services.chat.reply import ChatReplyFailure, generate_chat_reply
from api.services.chat.transcript import is_live
from api.services.chat.session_context import build_initial_context
from api.services.embed.pre_call_form import (
    build_pre_call_form,
    parse_pre_call_form_settings,
    public_pre_call_form,
    resolve_published_definition,
    validate_and_merge_context,
)

router = APIRouter(prefix="/public/embed")

EMBED_CORS_ALLOW_HEADERS = "Content-Type, Origin, ngrok-skip-browser-warning"
EMBED_CORS_MAX_AGE = "86400"


class InitEmbedRequest(BaseModel):
    """Request model for initializing an embed session"""

    token: str
    form_values: Optional[dict] = None
    context_variables: Optional[dict] = None


class InitEmbedResponse(BaseModel):
    """Response model for embed initialization"""

    session_token: str
    workflow_run_id: int
    config: dict


class EmbedConfigResponse(BaseModel):
    """Response model for embed configuration"""

    workflow_id: int
    settings: dict
    theme: str
    position: str
    button_text: str
    button_color: str
    size: str
    auto_start: bool
    pre_call_form: Optional[PublicPreCallForm] = None


# ── Chat embed (chat agents) ─────────────────────────────────────────────────


class InitChatRequest(BaseModel):
    """Start a chat-agent embed session (keyed by the agent's public key)."""

    public_key: str


class ChatMessageOut(BaseModel):
    role: str  # "user" | "assistant"
    content: str
    # Position in the stored transcript; the widget sends it back to rate or retry a reply.
    index: int
    feedback: Optional[str] = None


class ChatConfigResponse(BaseModel):
    name: str
    appearance: dict
    greeting: Optional[str] = None


class ChatInitResponse(BaseModel):
    session_token: str
    messages: list[ChatMessageOut]
    config: dict


class SendChatMessageRequest(BaseModel):
    session_token: str
    text: str = Field(min_length=1, max_length=4000)


class RateChatReplyRequest(BaseModel):
    session_token: str
    index: int = Field(ge=0)
    # "like" | "dislike"; null clears the rating.
    feedback: Optional[str] = None


class RetryChatReplyRequest(BaseModel):
    session_token: str


class ChatMessageResponse(BaseModel):
    messages: list[ChatMessageOut]


def _chat_config(agent: ChatAgentModel) -> dict:
    return {"name": agent.name, "appearance": dict(agent.appearance or {})}


def _to_message_out(messages: Any) -> list[ChatMessageOut]:
    """The dialogue the visitor sees: superseded (retried) replies are left out."""
    out: list[ChatMessageOut] = []
    for index, m in enumerate(messages or []):
        if not is_live(m) or not m.get("content"):
            continue
        out.append(
            ChatMessageOut(role=m["role"], content=m["content"], index=index, feedback=m.get("feedback"))
        )
    return out


def validate_origin(origin: str, allowed_domains: list) -> bool:
    """Validate if the origin is in the allowed domains list.

    Args:
        origin: The origin header from the request
        allowed_domains: List of allowed domain patterns

    Returns:
        True if origin is allowed, False otherwise
    """
    if not allowed_domains:
        # If no domains specified, allow all origins
        return True

    domain, origin_port = _parse_origin_host_port(origin)
    if not domain:
        return False

    # Normalize domain for www matching
    def normalize_www(d: str) -> tuple[str, str]:
        """Return both www and non-www versions of a domain"""
        if d.startswith("www."):
            return (d, d[4:])  # (www.x.com, x.com)
        else:
            return (d, f"www.{d}")  # (x.com, www.x.com)

    domain_variants = normalize_www(domain)

    for allowed in allowed_domains:
        allowed = str(allowed).strip().lower()
        if allowed == "*":
            return True
        allowed_domain, allowed_port = _parse_origin_host_port(allowed)
        if not allowed_domain:
            continue
        if allowed_port is not None and allowed_port != origin_port:
            continue

        if allowed_domain.startswith("*."):
            # Wildcard subdomain matching
            base_domain = allowed_domain[2:]
            if domain == base_domain or domain.endswith("." + base_domain):
                return True
        else:
            # Check both www and non-www versions
            allowed_variants = normalize_www(allowed_domain)
            # If any variant of domain matches any variant of allowed, it's valid
            if any(
                dv in allowed_variants or av in domain_variants
                for dv in domain_variants
                for av in allowed_variants
            ):
                return True

    return False


def _parse_origin_host_port(value: str) -> tuple[str, str | None]:
    candidate = value.strip().lower()
    if not candidate:
        return "", None

    if "://" not in candidate and not candidate.startswith("//"):
        candidate = f"//{candidate}"

    parsed = urlsplit(candidate)
    try:
        parsed_port = parsed.port
    except ValueError:
        parsed_port = None

    port = str(parsed_port) if parsed_port is not None else None
    return (parsed.hostname or "").rstrip("."), port


def generate_session_token() -> str:
    """Generate a cryptographically secure session token"""
    return f"emb_session_{secrets.token_urlsafe(32)}"


def get_request_origin(request: Request) -> str:
    """Extract origin from request headers, falling back to referer if not present."""
    origin = request.headers.get("origin", "")
    if not origin:
        origin = request.headers.get("referer", "")
    return origin


def _cors_response(origin: str, methods: str) -> Response:
    return Response(
        headers={
            "Access-Control-Allow-Origin": origin,
            "Access-Control-Allow-Methods": methods,
            "Access-Control-Allow-Headers": EMBED_CORS_ALLOW_HEADERS,
            "Access-Control-Max-Age": EMBED_CORS_MAX_AGE,
            "Vary": "Origin",
        }
    )


def _allow_embed_origin(response: Response, origin: str) -> None:
    response.headers["Access-Control-Allow-Origin"] = origin
    vary = response.headers.get("Vary")
    if not vary:
        response.headers["Vary"] = "Origin"
        return

    vary_values = {value.strip().lower() for value in vary.split(",")}
    if "origin" not in vary_values:
        response.headers["Vary"] = f"{vary}, Origin"


_PUBLIC_SETTING_KEYS = {
    "embedMode",
    "containerId",
    "buttonText",
    "buttonColor",
    "callToActionText",
    "theme",
    "size",
    "position",
    "autoStart",
}

_INIT_RATE_LIMIT = 30
_INIT_RATE_WINDOW_SECONDS = 60
_init_attempts: dict[str, list[float]] = {}


def _ensure_token_usable(embed_token: Any, check_usage: bool = True) -> None:
    if not embed_token.is_active:
        raise HTTPException(status_code=403, detail="Embed token is inactive")
    if embed_token.expires_at and embed_token.expires_at < datetime.now(UTC):
        raise HTTPException(status_code=403, detail="Embed token has expired")
    if (
        check_usage
        and embed_token.usage_limit
        and embed_token.usage_count >= embed_token.usage_limit
    ):
        raise HTTPException(status_code=403, detail="Embed token usage limit exceeded")


def _public_settings(settings: dict | None) -> dict:
    if not settings:
        return {}
    return {key: settings[key] for key in _PUBLIC_SETTING_KEYS if key in settings}


def _resolve_embed_form(workflow: Any, settings: dict | None):
    if workflow is None:
        return None
    definition = resolve_published_definition(workflow)
    parsed = parse_pre_call_form_settings(settings)
    return build_pre_call_form(workflow, definition, parsed)


async def _get_embed_workflow(embed_token: Any) -> Any | None:
    try:
        return await db_client.get_workflow_by_id(embed_token.workflow_id)
    except Exception as exc:
        logger.warning(f"Could not load workflow for embed form: {exc}")
        return None


def _check_init_rate_limit(embed_token: Any, request: Request) -> None:
    client_ip = request.client.host if request.client else "unknown"
    key = f"{embed_token.id}:{client_ip}"
    now = time.monotonic()
    attempts = [
        attempt
        for attempt in _init_attempts.get(key, [])
        if now - attempt < _INIT_RATE_WINDOW_SECONDS
    ]
    if len(attempts) >= _INIT_RATE_LIMIT:
        _init_attempts[key] = attempts
        raise HTTPException(
            status_code=429,
            detail="Too many embed sessions. Please try again shortly.",
        )
    attempts.append(now)
    _init_attempts[key] = attempts
    if len(_init_attempts) > 1000:
        for stale_key in list(_init_attempts):
            active = [
                attempt
                for attempt in _init_attempts[stale_key]
                if now - attempt < _INIT_RATE_WINDOW_SECONDS
            ]
            if active:
                _init_attempts[stale_key] = active
            else:
                _init_attempts.pop(stale_key, None)


async def _config_preflight_response(token: str, origin: str) -> Response:
    embed_token = await db_client.get_embed_token_by_token(token)
    if not embed_token:
        return Response(status_code=403)

    try:
        _ensure_token_usable(embed_token)
    except HTTPException:
        return Response(status_code=403)

    if not validate_origin(origin, embed_token.allowed_domains or []):
        return Response(status_code=403)

    return _cors_response(origin, "GET, OPTIONS")


async def _chat_config_preflight_response(public_key: str, origin: str) -> Response:
    agent = await db_client.get_chat_agent_by_public_key(public_key)
    if not agent or not agent.is_active:
        return Response(status_code=403)
    if not validate_origin(origin, agent.allowed_domains or []):
        return Response(status_code=403)
    return _cors_response(origin, "GET, OPTIONS")


async def _turn_credentials_preflight_response(
    session_token: str, origin: str
) -> Response:
    embed_session = await db_client.get_embed_session_by_token(session_token)
    if not embed_session:
        return Response(status_code=403)

    if embed_session.expires_at and embed_session.expires_at < datetime.now(UTC):
        return Response(status_code=403)

    embed_token = await db_client.get_embed_token_by_id(embed_session.embed_token_id)
    if not embed_token:
        return Response(status_code=403)

    try:
        _ensure_token_usable(embed_token, check_usage=False)
    except HTTPException:
        return Response(status_code=403)

    if not validate_origin(origin, embed_token.allowed_domains or []):
        return Response(status_code=403)

    return _cors_response(origin, "GET, OPTIONS")


async def build_public_embed_preflight_response(
    path: str, origin: str, requested_method: str, api_prefix: str = "/api/v1"
) -> Response | None:
    """Handle embed preflights before global CORSMiddleware rejects external sites."""
    public_embed_prefix = f"{api_prefix.rstrip('/')}/public/embed"

    if path == f"{public_embed_prefix}/init":
        if requested_method.upper() != "POST":
            return Response(status_code=405)
        return _cors_response(origin, "POST, OPTIONS")

    # Chat POST endpoints carry the key/session in the body, so the preflight is
    # permissive (validation happens on the actual POST) — same as /init.
    if path in (
        f"{public_embed_prefix}/chat/init",
        f"{public_embed_prefix}/chat/message",
        f"{public_embed_prefix}/chat/end",
        f"{public_embed_prefix}/chat/feedback",
        f"{public_embed_prefix}/chat/retry",
    ):
        if requested_method.upper() != "POST":
            return Response(status_code=405)
        return _cors_response(origin, "POST, OPTIONS")

    chat_config_prefix = f"{public_embed_prefix}/chat/config/"
    if path.startswith(chat_config_prefix):
        if requested_method.upper() != "GET":
            return Response(status_code=405)
        public_key = path[len(chat_config_prefix) :].split("/", 1)[0]
        return await _chat_config_preflight_response(public_key, origin)

    config_prefix = f"{public_embed_prefix}/config/"
    if path.startswith(config_prefix):
        if requested_method.upper() != "GET":
            return Response(status_code=405)
        token = path[len(config_prefix) :].split("/", 1)[0]
        return await _config_preflight_response(token, origin)

    turn_credentials_prefix = f"{public_embed_prefix}/turn-credentials/"
    if path.startswith(turn_credentials_prefix):
        if requested_method.upper() != "GET":
            return Response(status_code=405)
        session_token = path[len(turn_credentials_prefix) :].split("/", 1)[0]
        return await _turn_credentials_preflight_response(session_token, origin)

    return None


class PublicEmbedCORSMiddleware:
    """Allow token-gated embed CORS before global SaaS CORS rejects preflights."""

    def __init__(self, app: ASGIApp, api_prefix: str = "/api/v1"):
        self.app = app
        self.api_prefix = api_prefix

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or scope.get("method") != "OPTIONS":
            await self.app(scope, receive, send)
            return

        headers = Headers(scope=scope)
        origin = headers.get("origin")
        requested_method = headers.get("access-control-request-method")

        if origin and requested_method:
            response = await build_public_embed_preflight_response(
                scope.get("path", ""), origin, requested_method, self.api_prefix
            )
            if response is not None:
                await response(scope, receive, send)
                return

        await self.app(scope, receive, send)


@router.post("/init", response_model=InitEmbedResponse)
async def initialize_embed_session(
    request: Request, init_request: InitEmbedRequest, response: Response
):
    """Initialize an embed session with token validation and domain checking.

    This endpoint:
    1. Validates the embed token
    2. Checks domain whitelist
    3. Creates a workflow run
    4. Generates a temporary session token
    5. Returns configuration for the widget
    """
    origin = get_request_origin(request)

    # Validate embed token
    embed_token = await db_client.get_embed_token_by_token(init_request.token)
    if not embed_token:
        raise HTTPException(status_code=404, detail="Invalid embed token")

    _ensure_token_usable(embed_token)
    _check_init_rate_limit(embed_token, request)

    # Validate domain
    if not validate_origin(origin, embed_token.allowed_domains or []):
        logger.warning(
            f"Domain validation failed: {origin} not in {embed_token.allowed_domains}"
        )
        raise HTTPException(status_code=403, detail=f"Domain not allowed: {origin}")

    if origin:
        _allow_embed_origin(response, origin)

    workflow = await _get_embed_workflow(embed_token)
    try:
        pre_call_form = _resolve_embed_form(workflow, embed_token.settings)
    except ValueError as exc:
        logger.error(f"Invalid pre-call form configuration: {exc}")
        pre_call_form = None

    submitted = (
        init_request.form_values
        if init_request.form_values is not None
        else init_request.context_variables
    )
    initial_context: dict | None = submitted
    if pre_call_form is not None and pre_call_form.enabled and pre_call_form.fields:
        initial_context, field_errors = validate_and_merge_context(
            pre_call_form, submitted
        )
        if field_errors:
            raise HTTPException(
                status_code=422,
                detail={
                    "code": "pre_call_form_invalid",
                    "fields": field_errors,
                },
            )

    # Create workflow run
    try:
        workflow_run = await db_client.create_workflow_run(
            name=f"Embed Run - {datetime.now(UTC).isoformat()}",
            workflow_id=embed_token.workflow_id,
            mode=WorkflowRunMode.SMALLWEBRTC.value,
            user_id=embed_token.created_by,  # Use token creator as run owner
            initial_context=initial_context,
        )
    except Exception as e:
        logger.error(f"Failed to create workflow run: {e}")
        raise HTTPException(status_code=500, detail="Failed to create workflow run")

    # Generate session token
    session_token = generate_session_token()

    # Create embed session
    try:
        await db_client.create_embed_session(
            session_token=session_token,
            embed_token_id=embed_token.id,
            workflow_run_id=workflow_run.id,
            client_ip=request.client.host if request.client else None,
            user_agent=request.headers.get("user-agent", "")[:500],
            origin=origin[:255],
            expires_at=datetime.now(UTC) + timedelta(hours=1),  # 1 hour expiry
        )
    except Exception as e:
        logger.error(f"Failed to create embed session: {e}")
        raise HTTPException(status_code=500, detail="Failed to create session")

    # Increment usage count
    await db_client.increment_embed_token_usage(embed_token.id)

    # Prepare configuration
    config = {
        "workflow_id": embed_token.workflow_id,
        "workflow_run_id": workflow_run.id,
        **_public_settings(embed_token.settings),
    }

    return InitEmbedResponse(
        session_token=session_token, workflow_run_id=workflow_run.id, config=config
    )


@router.options("/config/{token}")
async def options_embed_config(token: str, request: Request):
    """Fallback OPTIONS handler for the embed config endpoint.

    Browser preflights include Access-Control-Request-Method and are handled by
    PublicEmbedCORSMiddleware before global CORS. This keeps non-conformant
    OPTIONS requests on the same validation path.
    """
    return await _config_preflight_response(token, request.headers.get("origin", ""))


@router.get("/config/{token}", response_model=EmbedConfigResponse)
async def get_embed_config(token: str, request: Request, response: Response):
    """Get embed configuration without creating a session.

    This endpoint is used to fetch widget configuration for display purposes
    without actually starting a call session.
    """
    origin = get_request_origin(request)

    # Validate embed token
    embed_token = await db_client.get_embed_token_by_token(token)
    if not embed_token:
        raise HTTPException(status_code=404, detail="Invalid embed token")

    # Check if token is active, unexpired, and under its usage limit
    _ensure_token_usable(embed_token)

    # Validate domain
    if not validate_origin(origin, embed_token.allowed_domains or []):
        raise HTTPException(status_code=403, detail=f"Domain not allowed: {origin}")

    # Set CORS header explicitly; the global CORSMiddleware covers only
    # first-party origins; this endpoint is fetched by external embed sites.
    if origin:
        _allow_embed_origin(response, origin)

    # Extract settings with defaults
    settings = embed_token.settings or {}
    workflow = await _get_embed_workflow(embed_token)
    try:
        pre_call_form = _resolve_embed_form(workflow, settings)
    except ValueError as exc:
        logger.error(f"Invalid pre-call form configuration: {exc}")
        pre_call_form = None

    return EmbedConfigResponse(
        workflow_id=embed_token.workflow_id,
        settings=_public_settings(settings),
        theme=settings.get("theme", "light"),
        position=settings.get("position", "bottom-right"),
        button_text=settings.get("buttonText", "Start Voice Call"),
        button_color=settings.get("buttonColor", "#3B82F6"),
        size=settings.get("size", "medium"),
        auto_start=settings.get("autoStart", False),
        pre_call_form=public_pre_call_form(pre_call_form),
    )


@router.options("/init")
async def options_init(request: Request):
    """Fallback OPTIONS handler for init endpoint."""
    # Browser preflights are handled by PublicEmbedCORSMiddleware before global CORS.
    # For init endpoint, we need to check the token in the request body
    # But OPTIONS requests don't have body, so we'll be permissive
    # The actual validation happens in the POST request
    origin = request.headers.get("origin", "*")

    return _cors_response(origin, "POST, OPTIONS")


@router.get("/turn-credentials/{session_token}", response_model=TurnCredentialsResponse)
async def get_public_turn_credentials(
    session_token: str, request: Request, response: Response
):
    """Get TURN credentials for an embed session.

    This endpoint allows embedded widgets to obtain TURN server credentials
    for WebRTC connections without requiring authentication.

    Args:
        session_token: The session token from embed initialization

    Returns:
        TurnCredentialsResponse with username, password, ttl, and TURN URIs
    """
    origin = get_request_origin(request)

    # Validate session token
    embed_session = await db_client.get_embed_session_by_token(session_token)
    if not embed_session:
        raise HTTPException(status_code=404, detail="Invalid session token")

    # Check if session is expired
    if embed_session.expires_at and embed_session.expires_at < datetime.now(UTC):
        raise HTTPException(status_code=403, detail="Session expired")

    # Get the embed token to check allowed domains
    embed_token = await db_client.get_embed_token_by_id(embed_session.embed_token_id)
    if not embed_token:
        raise HTTPException(status_code=404, detail="Invalid embed token")

    _ensure_token_usable(embed_token, check_usage=False)

    # Validate domain (empty allowed_domains means allow all)
    if not validate_origin(origin, embed_token.allowed_domains or []):
        logger.warning(
            f"Domain validation failed for TURN credentials: {origin} not in {embed_token.allowed_domains}"
        )
        raise HTTPException(status_code=403, detail=f"Domain not allowed: {origin}")

    if origin:
        _allow_embed_origin(response, origin)

    # Check if TURN is configured
    if not TURN_ENABLED:
        raise HTTPException(
            status_code=503,
            detail="TURN server not configured",
        )

    try:
        # Use session token as identifier for TURN credentials
        credentials = await generate_user_turn_credentials(
            f"embed:{session_token[:16]}"
        )
        return TurnCredentialsResponse(**credentials)
    except Exception as e:
        logger.error(f"Failed to generate TURN credentials for embed session: {e}")
        raise HTTPException(
            status_code=500,
            detail="Failed to generate TURN credentials",
        )


@router.options("/turn-credentials/{session_token}")
async def options_turn_credentials(request: Request, session_token: str):
    """Fallback OPTIONS handler for TURN credentials endpoint."""
    # Browser preflights are handled by PublicEmbedCORSMiddleware before global CORS.
    return await _turn_credentials_preflight_response(
        session_token, request.headers.get("origin", "")
    )


# ── Chat embed endpoints ─────────────────────────────────────────────────────


@router.get("/chat/config/{public_key}", response_model=ChatConfigResponse)
async def get_chat_config(public_key: str, request: Request, response: Response):
    """Widget config (name + appearance + greeting) for a chat agent."""
    origin = get_request_origin(request)
    agent = await db_client.get_chat_agent_by_public_key(public_key)
    if not agent or not agent.is_active:
        raise HTTPException(status_code=404, detail="Chat agent not found")
    if not validate_origin(origin, agent.allowed_domains or []):
        raise HTTPException(status_code=403, detail=f"Domain not allowed: {origin}")
    if origin:
        _allow_embed_origin(response, origin)
    return ChatConfigResponse(
        name=agent.name,
        appearance=dict(agent.appearance or {}),
        greeting=agent.greeting,
    )


@router.post("/chat/init", response_model=ChatInitResponse)
async def initialize_chat_session(
    request: Request, init_request: InitChatRequest, response: Response
):
    """Start a chat-agent session: validate the agent + origin, open a visitor
    conversation, seed the greeting, and return the transcript + widget config."""
    origin = get_request_origin(request)

    agent = await db_client.get_chat_agent_by_public_key(init_request.public_key)
    if not agent or not agent.is_active:
        raise HTTPException(status_code=404, detail="Chat agent not found")
    if not validate_origin(origin, agent.allowed_domains or []):
        logger.warning(
            f"Chat embed domain validation failed: {origin} not in "
            f"{agent.allowed_domains}"
        )
        raise HTTPException(status_code=403, detail=f"Domain not allowed: {origin}")

    if origin:
        _allow_embed_origin(response, origin)

    session_token = generate_session_token()
    await db_client.create_chat_conversation(
        organization_id=agent.organization_id,
        chat_agent_id=agent.id,
        session_token=session_token,
        origin=(origin or "")[:255] or None,
        initial_context=await build_initial_context(agent, origin or None),
    )

    messages: list[ChatMessageOut] = []
    greeting = (agent.greeting or "").strip()
    if greeting:
        await db_client.append_chat_messages(
            session_token, [{"role": "assistant", "content": greeting}]
        )
        messages = [ChatMessageOut(role="assistant", content=greeting, index=0)]

    return ChatInitResponse(
        session_token=session_token,
        messages=messages,
        config=_chat_config(agent),
    )


@router.post("/chat/message", response_model=ChatMessageResponse)
async def send_chat_message(
    request: Request, body: SendChatMessageRequest, response: Response
):
    """Append a visitor message, generate the agent's reply, return the transcript."""
    origin = get_request_origin(request)

    convo = await db_client.get_chat_conversation_by_token(body.session_token)
    if not convo:
        raise HTTPException(status_code=404, detail="Invalid session token")

    agent = await db_client.get_chat_agent(convo.chat_agent_id, convo.organization_id)
    if not agent or not agent.is_active:
        raise HTTPException(status_code=403, detail="Chat agent is unavailable")
    if not validate_origin(origin, agent.allowed_domains or []):
        raise HTTPException(status_code=403, detail=f"Domain not allowed: {origin}")

    if origin:
        _allow_embed_origin(response, origin)

    if convo.end_reason == "completed":
        raise HTTPException(
            status_code=409,
            detail="This conversation has ended. Start a new chat to continue.",
            headers={"Access-Control-Allow-Origin": origin, "Vary": "Origin"} if origin else None,
        )

    history = list(convo.messages or [])
    reply = await generate_chat_reply(agent, history, body.text)

    new_messages: list[dict] = [{"role": "user", "content": body.text}]
    failed = isinstance(reply, ChatReplyFailure)
    if not failed:
        new_messages.append(reply.as_message())
    # A good reply clears an earlier failure; a failed one records why.
    convo = await db_client.append_chat_messages(
        body.session_token,
        new_messages,
        last_error=reply.as_error() if failed else None,
    )

    if failed:
        # The visitor's message is saved; tell the widget instead of staying silent.
        raise HTTPException(
            status_code=502,
            detail="The assistant could not reply right now. Please try again.",
            headers={"Access-Control-Allow-Origin": origin, "Vary": "Origin"} if origin else None,
        )

    return ChatMessageResponse(
        messages=_to_message_out(convo.messages if convo else [])
    )


async def _session_for_action(request: Request, response: Response, session_token: str):
    """The conversation and agent behind a widget action, origin-checked like /chat/message."""
    origin = get_request_origin(request)
    convo = await db_client.get_chat_conversation_by_token(session_token)
    if not convo:
        raise HTTPException(status_code=404, detail="Invalid session token")
    agent = await db_client.get_chat_agent(convo.chat_agent_id, convo.organization_id)
    if not agent or not agent.is_active:
        raise HTTPException(status_code=403, detail="Chat agent is unavailable")
    if not validate_origin(origin, agent.allowed_domains or []):
        raise HTTPException(status_code=403, detail=f"Domain not allowed: {origin}")
    if origin:
        _allow_embed_origin(response, origin)
    return convo, agent, origin


def _action_error(err: ChatActionError, origin: Optional[str]) -> HTTPException:
    return HTTPException(
        status_code=err.status_code,
        detail=err.detail,
        headers={"Access-Control-Allow-Origin": origin, "Vary": "Origin"} if origin else None,
    )


@router.post("/chat/feedback", response_model=ChatMessageResponse)
async def rate_chat_reply(request: Request, body: RateChatReplyRequest, response: Response):
    """The visitor's thumbs up / down on one reply (or clearing it)."""
    convo, _agent, origin = await _session_for_action(request, response, body.session_token)
    try:
        messages = await rate_reply(convo, body.index, body.feedback)
    except ChatActionError as err:
        raise _action_error(err, origin)
    return ChatMessageResponse(messages=_to_message_out(messages))


@router.post("/chat/retry", response_model=ChatMessageResponse)
async def retry_chat_reply(request: Request, body: RetryChatReplyRequest, response: Response):
    """Ask again for the reply to the visitor's latest message."""
    convo, agent, origin = await _session_for_action(request, response, body.session_token)
    try:
        messages = await retry_last_reply(agent, convo)
    except ChatActionError as err:
        raise _action_error(err, origin)
    return ChatMessageResponse(messages=_to_message_out(messages))


@router.options("/chat/feedback")
@router.options("/chat/retry")
async def options_chat_actions(request: Request):
    """Fallback OPTIONS handler; real preflights are served by the middleware."""
    return _cors_response(request.headers.get("origin", "*"), "POST, OPTIONS")


@router.post("/chat/end")
async def end_chat_session(request: Request, response: Response):
    """Record how a visitor's session ended: ``completed`` (Exit / new chat) or
    ``disconnected`` (tab closed or refreshed).

    The body is parsed by hand because the widget reports a disconnect with
    ``navigator.sendBeacon`` during page unload, which sends ``text/plain`` (a
    CORS-simple request, so no preflight) rather than ``application/json``.
    """
    origin = get_request_origin(request)
    try:
        payload = json.loads((await request.body()) or b"{}")
    except ValueError:
        raise HTTPException(status_code=422, detail="Invalid request body")
    if not isinstance(payload, dict):
        raise HTTPException(status_code=422, detail="Invalid request body")
    session_token = payload.get("session_token")
    reason = payload.get("reason")
    if not isinstance(session_token, str) or reason not in END_REASONS:
        raise HTTPException(status_code=422, detail="Invalid request body")

    convo = await db_client.get_chat_conversation_by_token(session_token)
    if not convo:
        raise HTTPException(status_code=404, detail="Invalid session token")
    agent = await db_client.get_chat_agent(convo.chat_agent_id, convo.organization_id)
    if not agent:
        raise HTTPException(status_code=403, detail="Chat agent is unavailable")
    if not validate_origin(origin, agent.allowed_domains or []):
        raise HTTPException(status_code=403, detail=f"Domain not allowed: {origin}")

    if origin:
        _allow_embed_origin(response, origin)

    convo = await db_client.end_chat_conversation(session_token, reason)
    if convo is not None:
        await queue_chat_finish_jobs(convo)
    return {
        "ok": True,
        "status": conversation_status(
            convo.last_error, convo.updated_at, end_reason=convo.end_reason
        )
        if convo
        else None,
    }


@router.options("/chat/end")
async def options_chat_end(request: Request):
    """Fallback OPTIONS handler; real preflights are served by the middleware."""
    return _cors_response(request.headers.get("origin", "*"), "POST, OPTIONS")


@router.options("/chat/config/{public_key}")
async def options_chat_config(public_key: str, request: Request):
    """Fallback OPTIONS handler; real preflights are served by the middleware."""
    return await _chat_config_preflight_response(
        public_key, request.headers.get("origin", "")
    )


@router.options("/chat/init")
async def options_chat_init(request: Request):
    """Fallback OPTIONS handler; real preflights are served by the middleware."""
    return _cors_response(request.headers.get("origin", "*"), "POST, OPTIONS")


@router.options("/chat/message")
async def options_chat_message(request: Request):
    """Fallback OPTIONS handler; real preflights are served by the middleware."""
    return _cors_response(request.headers.get("origin", "*"), "POST, OPTIONS")
