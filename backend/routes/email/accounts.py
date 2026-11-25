"""FastAPI Email Account Management Routes (Gmail and Outlook)."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
import os
from typing import Annotated, Any, Dict, List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query
import httpx
from pydantic import BaseModel, ConfigDict
from sqlalchemy import select, update

from api.db import db_client
from api.db.models import EmailAgentModel, GmailAccountModel, OutlookAccountModel, UserModel
from api.services.auth.depends import get_user
from api.services.email.crypto import encrypt_token
from api.tasks.arq import enqueue_job
from api.tasks.function_names import FunctionNames
from loguru import logger

router = APIRouter(prefix="/accounts", tags=["email-accounts"])


def _require_org(user: UserModel) -> int:
    if not user.selected_organization_id:
        raise HTTPException(status_code=400, detail="No organization selected")
    return user.selected_organization_id


class AccountResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    provider: str  # "gmail" or "outlook"
    email: str
    email_address: Optional[str] = None
    status: str
    has_history_cursor: bool
    last_synced_at: Optional[datetime] = None
    created_at: Optional[datetime] = None


class SyncStatusResponse(BaseModel):
    account_id: int
    provider: str
    email: str
    status: str
    last_synced_at: Optional[datetime] = None
    has_cursor: bool


@router.get("", response_model=List[AccountResponse])
async def list_email_accounts(
    user: UserModel = Depends(get_user),
) -> List[AccountResponse]:
    """List all connected Gmail and Outlook accounts for the current organization."""
    org_id = _require_org(user)
    results: List[AccountResponse] = []

    async with db_client.async_session() as session:
        # 1. Gmail accounts
        g_stmt = select(GmailAccountModel).where(
            GmailAccountModel.organization_id == org_id
        ).order_by(GmailAccountModel.created_at.desc())
        g_res = await session.execute(g_stmt)
        for g in g_res.scalars().all():
            results.append(
                AccountResponse(
                    id=g.id,
                    provider="gmail",
                    email=g.email,
                    email_address=g.email,
                    status=g.status,
                    has_history_cursor=bool(g.history_id),
                    last_synced_at=g.updated_at,
                    created_at=g.created_at,
                )
            )

        # 2. Outlook accounts
        o_stmt = select(OutlookAccountModel).where(
            OutlookAccountModel.organization_id == org_id
        ).order_by(OutlookAccountModel.created_at.desc())
        o_res = await session.execute(o_stmt)
        for o in o_res.scalars().all():
            results.append(
                AccountResponse(
                    id=o.id,
                    provider="outlook",
                    email=o.email,
                    email_address=o.email,
                    status=o.status,
                    has_history_cursor=bool(o.delta_link),
                    last_synced_at=o.updated_at,
                    created_at=o.created_at,
                )
            )

    return results


class OAuthCallbackRequest(BaseModel):
    code: str
    redirect_uri: Optional[str] = None


@router.get("/oauth/gmail/url")
async def get_gmail_oauth_url(
    redirect_uri: Annotated[Optional[str], Query()] = None,
    user: UserModel = Depends(get_user),
) -> Dict[str, str]:
    """Generate Google OAuth authorization URL for Gmail sync."""
    org_id = _require_org(user)
    client_id = os.getenv("GMAIL_CLIENT_ID") or os.getenv("GOOGLE_CLIENT_ID", "")
    if not client_id:
        raise HTTPException(
            status_code=500,
            detail="GMAIL_CLIENT_ID (or GOOGLE_CLIENT_ID) is not configured in server environment variables",
        )

    r_uri = redirect_uri or os.getenv("GMAIL_REDIRECT_URI", "http://localhost:3000/email/settings")
    scope = "https://www.googleapis.com/auth/gmail.modify https://www.googleapis.com/auth/userinfo.email"
    state = f"org_{org_id}:gmail"
    auth_url = (
        f"https://accounts.google.com/o/oauth2/v2/auth?"
        f"client_id={client_id}&redirect_uri={r_uri}&response_type=code&"
        f"scope={scope}&access_type=offline&prompt=consent&state={state}"
    )
    return {"auth_url": auth_url, "provider": "gmail"}


@router.post("/oauth/gmail/callback", response_model=AccountResponse)
async def handle_gmail_oauth_callback(
    payload: OAuthCallbackRequest,
    user: UserModel = Depends(get_user),
) -> AccountResponse:
    """Exchange authorization code for Gmail access & refresh tokens and register account."""
    org_id = _require_org(user)
    client_id = os.getenv("GMAIL_CLIENT_ID") or os.getenv("GOOGLE_CLIENT_ID", "")
    client_secret = os.getenv("GMAIL_CLIENT_SECRET") or os.getenv("GOOGLE_CLIENT_SECRET", "")
    if not client_id or not client_secret:
        raise HTTPException(
            status_code=500,
            detail="GMAIL_CLIENT_ID or GMAIL_CLIENT_SECRET (or GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET) is not configured in server environment variables",
        )

    redirect_uri = payload.redirect_uri or os.getenv("GMAIL_REDIRECT_URI", "http://localhost:3000/email/settings")

    async with httpx.AsyncClient(timeout=15.0) as client:
        token_resp = await client.post(
            "https://oauth2.googleapis.com/token",
            data={
                "code": payload.code,
                "client_id": client_id,
                "client_secret": client_secret,
                "redirect_uri": redirect_uri,
                "grant_type": "authorization_code",
            },
        )
        if token_resp.status_code != 200:
            raise HTTPException(status_code=400, detail=f"Google token exchange failed: {token_resp.text}")

        token_data = token_resp.json()
        access_token = token_data.get("access_token")
        refresh_token = token_data.get("refresh_token")
        expires_in = token_data.get("expires_in", 3600)

        if not refresh_token:
            raise HTTPException(
                status_code=400,
                detail="Google did not return a refresh token. Please re-authorize with prompt=consent.",
            )

        profile_resp = await client.get(
            "https://gmail.googleapis.com/gmail/v1/users/me/profile",
            headers={"Authorization": f"Bearer {access_token}"},
        )
        if profile_resp.status_code != 200:
            raise HTTPException(status_code=400, detail=f"Failed to fetch Gmail profile: {profile_resp.text}")
        email_address = profile_resp.json().get("emailAddress", "")

    now = datetime.now(UTC)
    async with db_client.async_session() as session:
        stmt = select(GmailAccountModel).where(
            GmailAccountModel.organization_id == org_id,
            GmailAccountModel.email == email_address,
        )
        res = await session.execute(stmt)
        account = res.scalar_one_or_none()
        if not account:
            account = GmailAccountModel(
                organization_id=org_id,
                email=email_address,
                refresh_token_encrypted=encrypt_token(refresh_token),
                access_token_encrypted=encrypt_token(access_token),
                access_token_expires_at=now + timedelta(seconds=expires_in),
                status="connected",
            )
            session.add(account)
        else:
            account.refresh_token_encrypted = encrypt_token(refresh_token)
            account.access_token_encrypted = encrypt_token(access_token)
            account.access_token_expires_at = now + timedelta(seconds=expires_in)
            account.status = "connected"
            account.updated_at = now

        await session.commit()
        await session.refresh(account)

        await enqueue_job(FunctionNames.SYNC_GMAIL_ACCOUNT, account_id=account.id, organization_id=org_id)

        return AccountResponse(
            id=account.id,
            provider="gmail",
            email=account.email,
            email_address=account.email,
            status=account.status,
            has_history_cursor=bool(account.history_id),
            last_synced_at=account.updated_at,
            created_at=account.created_at,
        )


@router.get("/oauth/outlook/url")
async def get_outlook_oauth_url(
    redirect_uri: Annotated[Optional[str], Query()] = None,
    user: UserModel = Depends(get_user),
) -> Dict[str, str]:
    """Generate Microsoft OAuth authorization URL for Outlook sync."""
    org_id = _require_org(user)
    client_id = os.getenv("OUTLOOK_CLIENT_ID", "")
    if not client_id:
        raise HTTPException(status_code=500, detail="OUTLOOK_CLIENT_ID is not configured on the server")

    r_uri = redirect_uri or os.getenv("OUTLOOK_REDIRECT_URI", "http://localhost:3000/email/settings")
    scope = "https://graph.microsoft.com/Mail.ReadWrite https://graph.microsoft.com/User.Read offline_access"
    state = f"org_{org_id}:outlook"
    auth_url = (
        f"https://login.microsoftonline.com/common/oauth2/v2.0/authorize?"
        f"client_id={client_id}&response_type=code&redirect_uri={r_uri}&"
        f"response_mode=query&scope={scope}&state={state}"
    )
    return {"auth_url": auth_url, "provider": "outlook"}


@router.post("/oauth/outlook/callback", response_model=AccountResponse)
async def handle_outlook_oauth_callback(
    payload: OAuthCallbackRequest,
    user: UserModel = Depends(get_user),
) -> AccountResponse:
    """Exchange authorization code for Outlook access & refresh tokens and register account."""
    org_id = _require_org(user)
    client_id = os.getenv("OUTLOOK_CLIENT_ID", "")
    client_secret = os.getenv("OUTLOOK_CLIENT_SECRET", "")
    if not client_id or not client_secret:
        raise HTTPException(status_code=500, detail="OUTLOOK_CLIENT_ID or OUTLOOK_CLIENT_SECRET is not configured")

    redirect_uri = payload.redirect_uri or os.getenv("OUTLOOK_REDIRECT_URI", "http://localhost:3000/email/settings")

    async with httpx.AsyncClient(timeout=15.0) as client:
        token_resp = await client.post(
            "https://login.microsoftonline.com/common/oauth2/v2.0/token",
            data={
                "code": payload.code,
                "client_id": client_id,
                "client_secret": client_secret,
                "redirect_uri": redirect_uri,
                "grant_type": "authorization_code",
                "scope": "https://graph.microsoft.com/Mail.ReadWrite https://graph.microsoft.com/User.Read offline_access",
            },
        )
        if token_resp.status_code != 200:
            raise HTTPException(status_code=400, detail=f"Microsoft token exchange failed: {token_resp.text}")

        token_data = token_resp.json()
        access_token = token_data.get("access_token")
        refresh_token = token_data.get("refresh_token")
        expires_in = token_data.get("expires_in", 3600)

        if not refresh_token:
            raise HTTPException(
                status_code=400,
                detail="Microsoft did not return a refresh token. Ensure offline_access scope is requested.",
            )

        me_resp = await client.get(
            "https://graph.microsoft.com/v1.0/me",
            headers={"Authorization": f"Bearer {access_token}"},
        )
        if me_resp.status_code != 200:
            raise HTTPException(status_code=400, detail=f"Failed to fetch Microsoft profile: {me_resp.text}")
        me_data = me_resp.json()
        email_address = me_data.get("mail") or me_data.get("userPrincipalName", "")

    now = datetime.now(UTC)
    async with db_client.async_session() as session:
        stmt = select(OutlookAccountModel).where(
            OutlookAccountModel.organization_id == org_id,
            OutlookAccountModel.email == email_address,
        )
        res = await session.execute(stmt)
        account = res.scalar_one_or_none()
        if not account:
            account = OutlookAccountModel(
                organization_id=org_id,
                email=email_address,
                refresh_token_encrypted=encrypt_token(refresh_token),
                access_token_encrypted=encrypt_token(access_token),
                access_token_expires_at=now + timedelta(seconds=expires_in),
                status="connected",
            )
            session.add(account)
        else:
            account.refresh_token_encrypted = encrypt_token(refresh_token)
            account.access_token_encrypted = encrypt_token(access_token)
            account.access_token_expires_at = now + timedelta(seconds=expires_in)
            account.status = "connected"
            account.updated_at = now

        await session.commit()
        await session.refresh(account)

        await enqueue_job(FunctionNames.SYNC_OUTLOOK_ACCOUNT, account_id=account.id, organization_id=org_id)

        return AccountResponse(
            id=account.id,
            provider="outlook",
            email=account.email,
            email_address=account.email,
            status=account.status,
            has_history_cursor=bool(account.delta_link),
            last_synced_at=account.updated_at,
            created_at=account.created_at,
        )


@router.get("/{account_id}", response_model=AccountResponse)
async def get_email_account(
    account_id: int,
    provider: Annotated[Optional[str], Query(description="Provider: 'gmail' or 'outlook'")] = None,
    user: UserModel = Depends(get_user),
) -> AccountResponse:
    """Get details of a specific email account with provider auto-detection."""
    org_id = _require_org(user)
    prov = provider.lower() if provider else None

    async with db_client.async_session() as session:
        if prov == "outlook":
            stmt = select(OutlookAccountModel).where(
                OutlookAccountModel.id == account_id,
                OutlookAccountModel.organization_id == org_id,
            )
            res = await session.execute(stmt)
            acc = res.scalar_one_or_none()
            if not acc:
                raise HTTPException(status_code=404, detail="Outlook account not found")
            return AccountResponse(
                id=acc.id,
                provider="outlook",
                email=acc.email,
                email_address=acc.email,
                status=acc.status,
                has_history_cursor=bool(acc.delta_link),
                last_synced_at=acc.updated_at,
                created_at=acc.created_at,
            )
        elif prov == "gmail":
            stmt = select(GmailAccountModel).where(
                GmailAccountModel.id == account_id,
                GmailAccountModel.organization_id == org_id,
            )
            res = await session.execute(stmt)
            acc = res.scalar_one_or_none()
            if not acc:
                raise HTTPException(status_code=404, detail="Gmail account not found")
            return AccountResponse(
                id=acc.id,
                provider="gmail",
                email=acc.email,
                email_address=acc.email,
                status=acc.status,
                has_history_cursor=bool(acc.history_id),
                last_synced_at=acc.updated_at,
                created_at=acc.created_at,
            )
        else:
            # Auto-detect: try Gmail first, then Outlook
            stmt_g = select(GmailAccountModel).where(
                GmailAccountModel.id == account_id,
                GmailAccountModel.organization_id == org_id,
            )
            res_g = await session.execute(stmt_g)
            acc_g = res_g.scalar_one_or_none()
            if acc_g:
                return AccountResponse(
                    id=acc_g.id,
                    provider="gmail",
                    email=acc_g.email,
                    email_address=acc_g.email,
                    status=acc_g.status,
                    has_history_cursor=bool(acc_g.history_id),
                    last_synced_at=acc_g.updated_at,
                    created_at=acc_g.created_at,
                )
            stmt_o = select(OutlookAccountModel).where(
                OutlookAccountModel.id == account_id,
                OutlookAccountModel.organization_id == org_id,
            )
            res_o = await session.execute(stmt_o)
            acc_o = res_o.scalar_one_or_none()
            if acc_o:
                return AccountResponse(
                    id=acc_o.id,
                    provider="outlook",
                    email=acc_o.email,
                    email_address=acc_o.email,
                    status=acc_o.status,
                    has_history_cursor=bool(acc_o.delta_link),
                    last_synced_at=acc_o.updated_at,
                    created_at=acc_o.created_at,
                )
            raise HTTPException(status_code=404, detail="Email account not found")


@router.post("/{account_id}/sync")
async def trigger_account_sync(
    account_id: int,
    provider: Annotated[Optional[str], Query(description="Provider: 'gmail' or 'outlook'")] = None,
    user: UserModel = Depends(get_user),
) -> Dict[str, Any]:
    """Trigger manual background synchronization for an account with provider auto-detection."""
    org_id = _require_org(user)
    prov = provider.lower() if provider else None

    async with db_client.async_session() as session:
        if prov == "outlook":
            stmt = select(OutlookAccountModel).where(
                OutlookAccountModel.id == account_id,
                OutlookAccountModel.organization_id == org_id,
            )
            res = await session.execute(stmt)
            acc = res.scalar_one_or_none()
            if not acc:
                raise HTTPException(status_code=404, detail="Outlook account not found")
            task_fn = FunctionNames.SYNC_OUTLOOK_ACCOUNT
            detected_prov = "outlook"
        elif prov == "gmail":
            stmt = select(GmailAccountModel).where(
                GmailAccountModel.id == account_id,
                GmailAccountModel.organization_id == org_id,
            )
            res = await session.execute(stmt)
            acc = res.scalar_one_or_none()
            if not acc:
                raise HTTPException(status_code=404, detail="Gmail account not found")
            task_fn = FunctionNames.SYNC_GMAIL_ACCOUNT
            detected_prov = "gmail"
        else:
            # Auto-detect: check Gmail first
            stmt_g = select(GmailAccountModel).where(
                GmailAccountModel.id == account_id,
                GmailAccountModel.organization_id == org_id,
            )
            res_g = await session.execute(stmt_g)
            acc = res_g.scalar_one_or_none()
            if acc:
                task_fn = FunctionNames.SYNC_GMAIL_ACCOUNT
                detected_prov = "gmail"
            else:
                stmt_o = select(OutlookAccountModel).where(
                    OutlookAccountModel.id == account_id,
                    OutlookAccountModel.organization_id == org_id,
                )
                res_o = await session.execute(stmt_o)
                acc = res_o.scalar_one_or_none()
                if acc:
                    task_fn = FunctionNames.SYNC_OUTLOOK_ACCOUNT
                    detected_prov = "outlook"
                else:
                    raise HTTPException(status_code=404, detail="Email account not found")

    # Enqueue background sync job or fallback to inline execution
    from api.tasks.email_tasks import sync_gmail_account_task, sync_outlook_account_task

    try:
        job = await enqueue_job(
            task_fn,
            account_id=account_id,
            organization_id=org_id,
        )
        if job is None:
            logger.info(
                f"ARQ Redis not available or job was not queued. Running sync directly for account={account_id}, provider={detected_prov}"
            )
            if detected_prov == "gmail":
                await sync_gmail_account_task({}, account_id=account_id, organization_id=org_id)
            else:
                await sync_outlook_account_task({}, account_id=account_id, organization_id=org_id)
            return {
                "status": "sync_completed",
                "account_id": account_id,
                "provider": detected_prov,
                "message": "Mailbox synchronization completed successfully.",
            }
    except Exception as e:
        logger.exception(f"Failed to enqueue sync for account {account_id}: {e}")
        try:
            if detected_prov == "gmail":
                await sync_gmail_account_task({}, account_id=account_id, organization_id=org_id)
            else:
                await sync_outlook_account_task({}, account_id=account_id, organization_id=org_id)
            return {
                "status": "sync_completed",
                "account_id": account_id,
                "provider": detected_prov,
                "message": "Mailbox synchronization completed successfully.",
            }
        except Exception as sync_err:
            logger.exception(f"Direct sync execution also failed: {sync_err}")
            raise HTTPException(
                status_code=500,
                detail=f"Failed to synchronize email account: {sync_err}",
            )

    return {
        "status": "sync_enqueued",
        "account_id": account_id,
        "provider": detected_prov,
        "message": "Synchronization job enqueued successfully.",
    }


@router.get("/{account_id}/sync-status", response_model=SyncStatusResponse)
async def get_account_sync_status(
    account_id: int,
    provider: Annotated[Optional[str], Query(description="Provider: 'gmail' or 'outlook'")] = None,
    user: UserModel = Depends(get_user),
) -> SyncStatusResponse:
    """Get the latest sync status of an account with provider auto-detection."""
    org_id = _require_org(user)
    prov = provider.lower() if provider else None

    async with db_client.async_session() as session:
        if prov == "outlook":
            stmt = select(OutlookAccountModel).where(
                OutlookAccountModel.id == account_id,
                OutlookAccountModel.organization_id == org_id,
            )
            res = await session.execute(stmt)
            acc = res.scalar_one_or_none()
            if not acc:
                raise HTTPException(status_code=404, detail="Outlook account not found")
            return SyncStatusResponse(
                account_id=acc.id,
                provider="outlook",
                email=acc.email,
                status=acc.status,
                last_synced_at=acc.updated_at,
                has_cursor=bool(acc.delta_link),
            )
        elif prov == "gmail":
            stmt = select(GmailAccountModel).where(
                GmailAccountModel.id == account_id,
                GmailAccountModel.organization_id == org_id,
            )
            res = await session.execute(stmt)
            acc = res.scalar_one_or_none()
            if not acc:
                raise HTTPException(status_code=404, detail="Gmail account not found")
            return SyncStatusResponse(
                account_id=acc.id,
                provider="gmail",
                email=acc.email,
                status=acc.status,
                last_synced_at=acc.updated_at,
                has_cursor=bool(acc.history_id),
            )
        else:
            # Auto-detect: check Gmail first, then Outlook
            stmt_g = select(GmailAccountModel).where(
                GmailAccountModel.id == account_id,
                GmailAccountModel.organization_id == org_id,
            )
            res_g = await session.execute(stmt_g)
            acc_g = res_g.scalar_one_or_none()
            if acc_g:
                return SyncStatusResponse(
                    account_id=acc_g.id,
                    provider="gmail",
                    email=acc_g.email,
                    status=acc_g.status,
                    last_synced_at=acc_g.updated_at,
                    has_cursor=bool(acc_g.history_id),
                )
            stmt_o = select(OutlookAccountModel).where(
                OutlookAccountModel.id == account_id,
                OutlookAccountModel.organization_id == org_id,
            )
            res_o = await session.execute(stmt_o)
            acc_o = res_o.scalar_one_or_none()
            if acc_o:
                return SyncStatusResponse(
                    account_id=acc_o.id,
                    provider="outlook",
                    email=acc_o.email,
                    status=acc_o.status,
                    last_synced_at=acc_o.updated_at,
                    has_cursor=bool(acc_o.delta_link),
                )
            raise HTTPException(status_code=404, detail="Email account not found")


@router.post("/{account_id}/disconnect", response_model=AccountResponse)
async def disconnect_email_account(
    account_id: int,
    provider: Annotated[Optional[str], Query(description="Provider: 'gmail' or 'outlook'")] = None,
    user: UserModel = Depends(get_user),
) -> AccountResponse:
    """Disconnect an email account: pauses background synchronization and sets status to disconnected."""
    org_id = _require_org(user)
    prov = provider.lower() if provider else None

    async with db_client.async_session() as session:
        acc = None
        detected_prov = prov
        if prov == "outlook" or prov is None:
            stmt = select(OutlookAccountModel).where(
                OutlookAccountModel.id == account_id,
                OutlookAccountModel.organization_id == org_id,
            )
            res = await session.execute(stmt)
            acc = res.scalar_one_or_none()
            if acc:
                detected_prov = "outlook"

        if not acc and (prov == "gmail" or prov is None):
            stmt = select(GmailAccountModel).where(
                GmailAccountModel.id == account_id,
                GmailAccountModel.organization_id == org_id,
            )
            res = await session.execute(stmt)
            acc = res.scalar_one_or_none()
            if acc:
                detected_prov = "gmail"

        if not acc:
            raise HTTPException(status_code=404, detail="Email account not found")

        acc.status = "disconnected"
        acc.updated_at = datetime.now(UTC)
        await session.commit()
        await session.refresh(acc)

        return AccountResponse(
            id=acc.id,
            provider=detected_prov or "gmail",
            email=acc.email,
            email_address=acc.email,
            status=acc.status,
            has_history_cursor=bool(getattr(acc, "history_id", None) or getattr(acc, "delta_link", None)),
            last_synced_at=acc.updated_at,
            created_at=acc.created_at,
        )


@router.post("/{account_id}/reconnect", response_model=AccountResponse)
async def reconnect_email_account(
    account_id: int,
    provider: Annotated[Optional[str], Query(description="Provider: 'gmail' or 'outlook'")] = None,
    user: UserModel = Depends(get_user),
) -> AccountResponse:
    """Reconnect a disconnected email account and resume synchronization."""
    org_id = _require_org(user)
    prov = provider.lower() if provider else None

    async with db_client.async_session() as session:
        acc = None
        detected_prov = prov
        task_fn = None
        if prov == "outlook" or prov is None:
            stmt = select(OutlookAccountModel).where(
                OutlookAccountModel.id == account_id,
                OutlookAccountModel.organization_id == org_id,
            )
            res = await session.execute(stmt)
            acc = res.scalar_one_or_none()
            if acc:
                detected_prov = "outlook"
                task_fn = FunctionNames.SYNC_OUTLOOK_ACCOUNT

        if not acc and (prov == "gmail" or prov is None):
            stmt = select(GmailAccountModel).where(
                GmailAccountModel.id == account_id,
                GmailAccountModel.organization_id == org_id,
            )
            res = await session.execute(stmt)
            acc = res.scalar_one_or_none()
            if acc:
                detected_prov = "gmail"
                task_fn = FunctionNames.SYNC_GMAIL_ACCOUNT

        if not acc:
            raise HTTPException(status_code=404, detail="Email account not found")

        acc.status = "connected"
        acc.updated_at = datetime.now(UTC)
        await session.commit()
        await session.refresh(acc)

        if task_fn:
            try:
                await enqueue_job(task_fn, account_id=acc.id, organization_id=org_id)
            except Exception:
                pass

        return AccountResponse(
            id=acc.id,
            provider=detected_prov or "gmail",
            email=acc.email,
            email_address=acc.email,
            status=acc.status,
            has_history_cursor=bool(getattr(acc, "history_id", None) or getattr(acc, "delta_link", None)),
            last_synced_at=acc.updated_at,
            created_at=acc.created_at,
        )


@router.delete("/{account_id}")
async def delete_email_account(
    account_id: int,
    provider: Annotated[Optional[str], Query(description="Provider: 'gmail' or 'outlook'")] = None,
    user: UserModel = Depends(get_user),
) -> Dict[str, Any]:
    """Permanently delete an email account and its associated resources."""
    org_id = _require_org(user)
    prov = provider.lower() if provider else None
    deleted = False
    detected_prov = "unknown"

    async with db_client.async_session() as session:
        if prov == "outlook" or prov is None:
            stmt = select(OutlookAccountModel).where(
                OutlookAccountModel.id == account_id,
                OutlookAccountModel.organization_id == org_id,
            )
            res = await session.execute(stmt)
            acc = res.scalar_one_or_none()
            if acc:
                await session.execute(
                    update(EmailAgentModel)
                    .where(EmailAgentModel.outlook_account_id == account_id)
                    .values(outlook_account_id=None)
                )
                await session.delete(acc)
                await session.commit()
                deleted = True
                detected_prov = "outlook"

        if not deleted and (prov == "gmail" or prov is None):
            stmt = select(GmailAccountModel).where(
                GmailAccountModel.id == account_id,
                GmailAccountModel.organization_id == org_id,
            )
            res = await session.execute(stmt)
            acc = res.scalar_one_or_none()
            if acc:
                await session.execute(
                    update(EmailAgentModel)
                    .where(EmailAgentModel.gmail_account_id == account_id)
                    .values(gmail_account_id=None)
                )
                await session.delete(acc)
                await session.commit()
                deleted = True
                detected_prov = "gmail"

        if not deleted:
            raise HTTPException(status_code=404, detail="Email account not found")

        return {"status": "deleted", "account_id": account_id, "provider": detected_prov}
