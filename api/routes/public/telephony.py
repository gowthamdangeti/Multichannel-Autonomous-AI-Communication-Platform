"""Public API endpoints for managing telephony configurations and phone numbers.

Accessible with API key authentication (X-API-Key header).
"""

from typing import List, Optional

from fastapi import APIRouter, Header, HTTPException
from loguru import logger
from sqlalchemy.exc import IntegrityError

from api.db import db_client
from api.db.telephony_configuration_client import TelephonyConfigurationInUseError
from api.enums import PostHogEvent
from api.schemas.telephony_config import (
    TelephonyConfigurationCreateRequest,
    TelephonyConfigurationDetail,
    TelephonyConfigurationListItem,
    TelephonyConfigurationListResponse,
    TelephonyConfigurationUpdateRequest,
)
from api.schemas.telephony_phone_number import (
    PhoneNumberCreateRequest,
    PhoneNumberListResponse,
    PhoneNumberResponse,
    PhoneNumberUpdateRequest,
)
from api.services.posthog_client import capture_event
from api.services.telephony import registry as telephony_registry
from api.routes.organization import (
    _credentials_from_payload,
    _detail_response,
    _phone_number_to_response,
    _run_preprocess_hook,
    _sync_inbound_for_phone_number,
    preserve_masked_fields,
)

router = APIRouter(prefix="/public/telephony-configs", tags=["public-telephony"])


async def _validate_api_key(x_api_key: str):
    """Validate the org API key used to invoke public endpoints."""
    api_key = await db_client.validate_api_key(x_api_key)
    if not api_key:
        raise HTTPException(status_code=401, detail="Invalid API key")
    return api_key


async def _ensure_config_belongs_to_org(config_id: int, organization_id: int):
    cfg = await db_client.get_telephony_configuration_for_org(
        config_id, organization_id
    )
    if not cfg:
        raise HTTPException(status_code=404, detail="Telephony configuration not found")
    return cfg


async def _ensure_workflow_belongs_to_org(workflow_id: int, organization_id: int):
    workflow = await db_client.get_workflow(
        workflow_id, organization_id=organization_id
    )
    if not workflow:
        raise HTTPException(status_code=404, detail="Workflow not found")
    return workflow


# ---------------------------------------------------------------------------
# Multi-config CRUD (Public API)
# ---------------------------------------------------------------------------


@router.get("", response_model=TelephonyConfigurationListResponse)
async def list_telephony_configurations(
    x_api_key: str = Header(..., alias="X-API-Key")
):
    """List the organization's telephony configurations via public API key."""
    api_key = await _validate_api_key(x_api_key)
    org_id = api_key.organization_id

    rows = await db_client.list_telephony_configurations(org_id)
    items: List[TelephonyConfigurationListItem] = []
    for row in rows:
        numbers = await db_client.list_phone_numbers_for_config(row.id)
        items.append(
            TelephonyConfigurationListItem(
                id=row.id,
                name=row.name,
                provider=row.provider,
                is_default_outbound=row.is_default_outbound,
                phone_number_count=len([n for n in numbers if n.is_active]),
                created_at=row.created_at,
                updated_at=row.updated_at,
            )
        )
    return TelephonyConfigurationListResponse(configurations=items)


@router.post("", response_model=TelephonyConfigurationDetail)
async def create_telephony_configuration(
    request: TelephonyConfigurationCreateRequest,
    x_api_key: str = Header(..., alias="X-API-Key"),
):
    """Create a new telephony configuration for the organization via public API key."""
    api_key = await _validate_api_key(x_api_key)
    org_id = api_key.organization_id

    credentials = _credentials_from_payload(request.config)
    credentials = await _run_preprocess_hook(request.config.provider, credentials)

    try:
        row = await db_client.create_telephony_configuration(
            organization_id=org_id,
            name=request.name,
            provider=request.config.provider,
            credentials=credentials,
            is_default_outbound=request.is_default_outbound,
        )
    except IntegrityError as e:
        if "uq_telephony_configurations_org_name" in str(e):
            raise HTTPException(
                status_code=409,
                detail=(
                    f"A telephony configuration named '{request.name}' already "
                    f"exists in this organization. Pick a different name."
                ),
            )
        raise HTTPException(
            status_code=409,
            detail="Telephony configuration violates a uniqueness constraint.",
        )

    capture_event(
        distinct_id=f"api_key_{api_key.id}",
        event=PostHogEvent.TELEPHONY_CONFIGURED,
        properties={
            "provider": request.config.provider,
            "organization_id": org_id,
            "config_id": row.id,
        },
    )

    return _detail_response(row)


@router.get("/{config_id}", response_model=TelephonyConfigurationDetail)
async def get_telephony_configuration_by_id(
    config_id: int,
    x_api_key: str = Header(..., alias="X-API-Key"),
):
    """Get telephony configuration details via public API key."""
    api_key = await _validate_api_key(x_api_key)
    row = await _ensure_config_belongs_to_org(config_id, api_key.organization_id)
    return _detail_response(row)


@router.put("/{config_id}", response_model=TelephonyConfigurationDetail)
async def update_telephony_configuration(
    config_id: int,
    request: TelephonyConfigurationUpdateRequest,
    x_api_key: str = Header(..., alias="X-API-Key"),
):
    """Update a telephony configuration via public API key."""
    api_key = await _validate_api_key(x_api_key)
    org_id = api_key.organization_id

    existing = await _ensure_config_belongs_to_org(config_id, org_id)

    credentials = None
    if request.config is not None:
        if request.config.provider != existing.provider:
            raise HTTPException(
                status_code=400,
                detail="Provider cannot be changed; create a new configuration instead.",
            )
        credentials = _credentials_from_payload(request.config)
        preserve_masked_fields(
            existing.provider, credentials, existing.credentials or {}
        )
        credentials = await _run_preprocess_hook(existing.provider, credentials)

    row = await db_client.update_telephony_configuration(
        config_id=config_id,
        organization_id=org_id,
        name=request.name,
        credentials=credentials,
    )

    return _detail_response(row)


@router.post(
    "/{config_id}/set-default-outbound",
    response_model=TelephonyConfigurationDetail,
)
async def set_default_outbound(
    config_id: int,
    x_api_key: str = Header(..., alias="X-API-Key"),
):
    """Set a telephony configuration as default outbound carrier via public API key."""
    api_key = await _validate_api_key(x_api_key)
    org_id = api_key.organization_id

    await _ensure_config_belongs_to_org(config_id, org_id)

    row = await db_client.set_default_telephony_configuration(config_id, org_id)
    if not row:
        raise HTTPException(status_code=404, detail="Telephony configuration not found")
    return _detail_response(row)


@router.delete("/{config_id}")
async def delete_telephony_configuration(
    config_id: int,
    x_api_key: str = Header(..., alias="X-API-Key"),
):
    """Delete a telephony configuration via public API key."""
    api_key = await _validate_api_key(x_api_key)
    org_id = api_key.organization_id

    await _ensure_config_belongs_to_org(config_id, org_id)

    try:
        deleted = await db_client.delete_telephony_configuration(config_id, org_id)
    except TelephonyConfigurationInUseError as e:
        raise HTTPException(status_code=409, detail=str(e))

    if not deleted:
        raise HTTPException(status_code=404, detail="Telephony configuration not found")
    return {"message": "Telephony configuration deleted"}


# ---------------------------------------------------------------------------
# Phone Numbers (Nested under a config via Public API)
# ---------------------------------------------------------------------------


@router.get("/{config_id}/phone-numbers", response_model=PhoneNumberListResponse)
async def list_phone_numbers(
    config_id: int,
    x_api_key: str = Header(..., alias="X-API-Key"),
):
    """List phone numbers for a telephony configuration via public API key."""
    api_key = await _validate_api_key(x_api_key)
    await _ensure_config_belongs_to_org(config_id, api_key.organization_id)

    rows = await db_client.list_phone_numbers_with_workflow_name_for_config(config_id)
    return PhoneNumberListResponse(
        phone_numbers=[_phone_number_to_response(r, name) for r, name in rows]
    )


@router.post("/{config_id}/phone-numbers", response_model=PhoneNumberResponse)
async def create_phone_number(
    config_id: int,
    request: PhoneNumberCreateRequest,
    x_api_key: str = Header(..., alias="X-API-Key"),
):
    """Create / add a phone number to a telephony configuration via public API key."""
    api_key = await _validate_api_key(x_api_key)
    org_id = api_key.organization_id

    cfg = await _ensure_config_belongs_to_org(config_id, org_id)

    if request.inbound_workflow_id is not None:
        await _ensure_workflow_belongs_to_org(request.inbound_workflow_id, org_id)

    spec = telephony_registry.get_optional(cfg.provider)
    account_field = spec.account_id_credential_field if spec else ""
    account_id = (cfg.credentials or {}).get(account_field) if account_field else None
    if account_id:
        try:
            conflict = await db_client.find_inbound_routing_conflict(
                provider=cfg.provider,
                account_id_field=account_field,
                account_id=account_id,
                address=request.address,
                country_hint=request.country_code,
            )
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))
        if conflict:
            existing_cfg, existing_phone = conflict
            same_org = existing_cfg.organization_id == org_id
            scope = (
                f"telephony configuration '{existing_cfg.name}'"
                if same_org
                else "another organization using the same provider account"
            )
            raise HTTPException(
                status_code=409,
                detail=(
                    f"Phone number {existing_phone.address} is already registered "
                    f"under {scope}. Inbound calls cannot be uniquely routed when "
                    f"the same number is configured against the same provider "
                    f"account in more than one place."
                ),
            )

    try:
        row = await db_client.create_phone_number(
            organization_id=org_id,
            telephony_configuration_id=config_id,
            address=request.address,
            country_code=request.country_code,
            label=request.label,
            inbound_workflow_id=request.inbound_workflow_id,
            is_active=request.is_active,
            is_default_caller_id=request.is_default_caller_id,
            extra_metadata=request.extra_metadata,
        )
    except IntegrityError:
        raise HTTPException(
            status_code=409,
            detail="A phone number with this address already exists in the org.",
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    response = _phone_number_to_response(row)
    if request.inbound_workflow_id is not None:
        response.provider_sync = await _sync_inbound_for_phone_number(
            config_id, org_id, row.address
        )
    return response


@router.get(
    "/{config_id}/phone-numbers/{phone_number_id}",
    response_model=PhoneNumberResponse,
)
async def get_phone_number(
    config_id: int,
    phone_number_id: int,
    x_api_key: str = Header(..., alias="X-API-Key"),
):
    """Get phone number details via public API key."""
    api_key = await _validate_api_key(x_api_key)
    await _ensure_config_belongs_to_org(config_id, api_key.organization_id)

    row = await db_client.get_phone_number_for_config(phone_number_id, config_id)
    if not row:
        raise HTTPException(status_code=404, detail="Phone number not found")
    return _phone_number_to_response(row)


@router.put(
    "/{config_id}/phone-numbers/{phone_number_id}",
    response_model=PhoneNumberResponse,
)
async def update_phone_number(
    config_id: int,
    phone_number_id: int,
    request: PhoneNumberUpdateRequest,
    x_api_key: str = Header(..., alias="X-API-Key"),
):
    """Update phone number settings via public API key."""
    api_key = await _validate_api_key(x_api_key)
    org_id = api_key.organization_id

    await _ensure_config_belongs_to_org(config_id, org_id)

    existing = await db_client.get_phone_number_for_config(phone_number_id, config_id)
    if not existing:
        raise HTTPException(status_code=404, detail="Phone number not found")

    if request.inbound_workflow_id is not None:
        await _ensure_workflow_belongs_to_org(request.inbound_workflow_id, org_id)

    row = await db_client.update_phone_number(
        phone_number_id=phone_number_id,
        telephony_configuration_id=config_id,
        label=request.label,
        inbound_workflow_id=request.inbound_workflow_id,
        is_active=request.is_active,
        country_code=request.country_code,
        extra_metadata=request.extra_metadata,
        clear_inbound_workflow=request.clear_inbound_workflow,
    )
    if not row:
        raise HTTPException(status_code=404, detail="Phone number not found")

    response = _phone_number_to_response(row)
    response.provider_sync = await _sync_inbound_for_phone_number(
        config_id, org_id, row.address
    )
    return response


@router.post(
    "/{config_id}/phone-numbers/{phone_number_id}/set-default-caller",
    response_model=PhoneNumberResponse,
)
async def set_default_caller_id(
    config_id: int,
    phone_number_id: int,
    x_api_key: str = Header(..., alias="X-API-Key"),
):
    """Set phone number as default caller ID via public API key."""
    api_key = await _validate_api_key(x_api_key)
    org_id = api_key.organization_id

    await _ensure_config_belongs_to_org(config_id, org_id)

    row = await db_client.set_default_caller_id(phone_number_id, config_id)
    if not row:
        raise HTTPException(status_code=404, detail="Phone number not found")
    return _phone_number_to_response(row)


@router.delete("/{config_id}/phone-numbers/{phone_number_id}")
async def delete_phone_number(
    config_id: int,
    phone_number_id: int,
    x_api_key: str = Header(..., alias="X-API-Key"),
):
    """Delete a phone number registration via public API key."""
    api_key = await _validate_api_key(x_api_key)
    org_id = api_key.organization_id

    await _ensure_config_belongs_to_org(config_id, org_id)

    existing = await db_client.get_phone_number_for_config(phone_number_id, config_id)
    if not existing:
        raise HTTPException(status_code=404, detail="Phone number not found")

    deleted = await db_client.delete_phone_number(phone_number_id, config_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Phone number not found")

    return {"message": "Phone number deleted"}
