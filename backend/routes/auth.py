import os
import uuid
from fastapi import APIRouter, Depends, HTTPException
from loguru import logger
from pydantic import BaseModel, field_validator

from api.constants import GOOGLE_CLIENT_ID
from api.db import db_client
from api.db.models import UserModel
from api.enums import PostHogEvent
from api.schemas.auth import (
    AuthResponse,
    ForgotPasswordRequest,
    GoogleLoginRequest,
    Login2FARequest,
    LoginRecoveryRequest,
    LoginRequest,
    MessageResponse,
    RecoveryCodesResponse,
    RecoveryStatusResponse,
    ResetPasswordRequest,
    SignupRequest,
    TwoFactorCodeRequest,
    UserResponse,
)
from api.services.auth.depends import get_user
from api.services.auth.password_reset import request_password_reset, reset_password
from api.services.auth.two_factor import (
    allow_recovery_attempt,
    clear_recovery_codes,
    get_recovery_status,
    issue_recovery_codes,
    redeem_recovery_code,
    send_2fa_email_otp,
    send_email_verification_otp,
    verify_2fa_email_otp,
    verify_email_verification_otp,
)
from api.services.posthog_client import capture_event
from api.services.storage import storage_fs
from api.utils.auth import create_jwt_token, hash_password, verify_password


router = APIRouter(
    prefix="/auth",
    tags=["auth"],
)


@router.post("/signup", response_model=AuthResponse)
async def signup(request: SignupRequest):
    # Check if email is already taken
    existing_user = await db_client.get_user_by_email(request.email)
    if existing_user:
        raise HTTPException(status_code=409, detail="Email already registered")

    # Compute full display name if not explicitly set
    display_name = request.name
    if not display_name and (request.first_name or request.last_name):
        display_name = f"{request.first_name or ''} {request.last_name or ''}".strip()

    # Hash password and create user
    hashed = hash_password(request.password)
    user = await db_client.create_user_with_email(
        email=request.email,
        password_hash=hashed,
        name=display_name,
        first_name=request.first_name,
        last_name=request.last_name,
        country=request.country,
        phone_number=request.phone_number,
    )

    # Create organization for the user
    org_provider_id = f"org_{user.provider_id}"
    organization, _ = await db_client.get_or_create_organization_by_provider_id(
        org_provider_id=org_provider_id, user_id=user.id
    )

    # Link user to organization
    await db_client.add_user_to_organization(user.id, organization.id)
    await db_client.update_user_selected_organization(user.id, organization.id)

    # Initialize wallet with appropriate currency based on user location (INR for India, USD for international)
    try:
        from api.services.billing.service import billing_service, get_currency_for_location
        user_currency = get_currency_for_location(request.country, request.phone_number)
        await billing_service.get_or_create_wallet(organization.id, currency=user_currency)
    except Exception as err:
        from loguru import logger
        logger.warning(f"Failed to initialize wallet on signup for org {organization.id}: {err}")

    # If a plan was selected during onboarding, link it to the organization wallet
    if request.selected_plan_id:
        try:
            from loguru import logger
            from api.db.models import OrgWalletModel
            from api.services.billing.service import billing_service

            plan = await billing_service.get_plan(request.selected_plan_id)
            if plan:
                wallet = await billing_service.get_or_create_wallet(
                    organization.id, currency=plan.currency
                )
                async with billing_service.async_session() as s:
                    wallet_row = await s.get(OrgWalletModel, wallet.id)
                    if wallet_row:
                        wallet_row.billing_plan_id = plan.id
                        wallet_row.currency = plan.currency
                        await s.commit()
        except Exception as err:
            logger.warning(f"Failed to assign selected_plan_id {request.selected_plan_id} on signup: {err}")


    # Create JWT token
    token = create_jwt_token(user.id, request.email)

    capture_event(
        distinct_id=str(user.provider_id),
        event=PostHogEvent.SIGNED_UP,
        properties={
            "organization_id": organization.id,
            "auth_provider": "local",
        },
    )

    return AuthResponse(
        token=token,
        user=UserResponse(
            id=user.id,
            email=user.email,
            name=display_name,
            first_name=user.first_name,
            last_name=user.last_name,
            country=user.country,
            phone_number=user.phone_number,
            organization_id=organization.id,
            provider_id=user.provider_id,
            is_superuser=user.is_superuser,
        ),
    )


@router.post("/login", response_model=AuthResponse)
async def login(request: LoginRequest):
    # Look up user by email
    user = await db_client.get_user_by_email(request.email)
    if not user or not user.password_hash:
        raise HTTPException(status_code=401, detail="Invalid email or password")

    # Verify password
    if not verify_password(request.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid email or password")

    # If 2FA is enabled, trigger 2FA challenge and return requires_2fa=True
    if getattr(user, "is_2fa_enabled", False):
        try:
            await send_2fa_email_otp(user.email)
        except Exception as err:
            logger.warning(f"Failed to send 2FA OTP on login for {user.email}: {err}")
        return AuthResponse(
            requires_2fa=True,
            message=f"2FA verification code sent to {user.email}",
        )

    # Create JWT token for users without 2FA
    token = create_jwt_token(user.id, user.email)

    capture_event(
        distinct_id=str(user.provider_id),
        event=PostHogEvent.SIGNED_IN,
        properties={
            "organization_id": user.selected_organization_id,
            "auth_provider": "local",
        },
    )

    return AuthResponse(
        token=token,
        user=await _user_response(user),
    )


async def _complete_2fa_login(user: UserModel, auth_provider: str) -> AuthResponse:
    capture_event(
        distinct_id=str(user.provider_id),
        event=PostHogEvent.SIGNED_IN,
        properties={
            "organization_id": user.selected_organization_id,
            "auth_provider": auth_provider,
        },
    )
    return AuthResponse(
        token=create_jwt_token(user.id, user.email),
        user=await _user_response(user),
    )


@router.post("/login/verify-2fa", response_model=AuthResponse)
async def login_verify_2fa(request: Login2FARequest):
    """Complete login challenge by verifying 2FA OTP code."""
    user = await db_client.get_user_by_email(request.email)
    if not user:
        raise HTTPException(status_code=401, detail="Invalid email or verification code")

    ok = await verify_2fa_email_otp(request.email, request.otp)
    if not ok:
        raise HTTPException(status_code=400, detail="Invalid or expired 2FA code")

    return await _complete_2fa_login(user, "local_2fa")


@router.post("/login/recovery", response_model=AuthResponse)
async def login_with_recovery_code(request: LoginRecoveryRequest):
    """Sign in with a recovery code. The password is rechecked, so a code alone isn't enough."""
    if not await allow_recovery_attempt(request.email):
        raise HTTPException(status_code=429, detail="Too many attempts. Please try again later.")

    invalid = HTTPException(status_code=401, detail="Invalid email, password or recovery code")
    user = await db_client.get_user_by_email(request.email)
    if not user or not user.password_hash or not user.is_2fa_enabled:
        raise invalid
    if not verify_password(request.password, user.password_hash):
        raise invalid
    if not await redeem_recovery_code(user.id, request.code):
        raise invalid

    return await _complete_2fa_login(user, "local_2fa_recovery")


@router.post("/forgot-password", response_model=MessageResponse)
async def forgot_password(request: ForgotPasswordRequest):
    """Send a password-reset OTP to the email if a local account exists.

    Always returns the same generic message regardless of whether the email is
    registered, to avoid leaking which emails have accounts.
    """
    await request_password_reset(request.email)
    return MessageResponse(
        message="If an account exists for this email, a reset code has been sent."
    )


@router.post("/reset-password", response_model=MessageResponse)
async def reset_password_endpoint(request: ResetPasswordRequest):
    """Verify the OTP and set a new password."""
    ok = await reset_password(request.email, request.otp, request.new_password)
    if not ok:
        raise HTTPException(
            status_code=400, detail="Invalid or expired code. Please request a new one."
        )
    return MessageResponse(message="Password has been reset. You can now sign in.")


def _account_email(user: UserModel) -> str:
    if not user.email:
        raise HTTPException(status_code=400, detail="This account has no email address")
    return user.email


async def _require_email_code(user: UserModel, otp: str) -> None:
    if not await verify_2fa_email_otp(_account_email(user), otp):
        raise HTTPException(status_code=400, detail="Invalid or expired verification code")


@router.post("/2fa/send-email-otp", response_model=MessageResponse)
async def send_2fa_email_otp_endpoint(user: UserModel = Depends(get_user)):
    """Email a verification code to the signed-in user's own address."""
    email = _account_email(user)
    try:
        await send_2fa_email_otp(email)
    except Exception as err:
        logger.exception(f"Failed to send 2FA OTP email: {err}")
        raise HTTPException(status_code=502, detail="Failed to send verification email")
    return MessageResponse(message=f"Verification code sent to {email}")


@router.post("/2fa/verify-email-otp", response_model=RecoveryCodesResponse)
async def verify_2fa_email_otp_endpoint(
    request: TwoFactorCodeRequest,
    user: UserModel = Depends(get_user),
):
    """Turn 2FA on for the signed-in user and return their recovery codes once."""
    await _require_email_code(user, request.otp)
    await db_client.update_user_2fa_status(user.id, True)
    return RecoveryCodesResponse(recovery_codes=await issue_recovery_codes(user.id))


@router.post("/2fa/disable", response_model=MessageResponse)
async def disable_2fa(
    request: TwoFactorCodeRequest,
    user: UserModel = Depends(get_user),
):
    """Turn 2FA off. Needs an emailed code, so a stolen session alone can't do it."""
    await _require_email_code(user, request.otp)
    await db_client.update_user_2fa_status(user.id, False)
    await clear_recovery_codes(user.id)
    return MessageResponse(message="Two-Factor Authentication has been disabled.")


@router.get("/2fa/recovery-codes", response_model=RecoveryStatusResponse)
async def get_2fa_recovery_status(user: UserModel = Depends(get_user)):
    remaining, generated_at = await get_recovery_status(user.id)
    return RecoveryStatusResponse(remaining=remaining, generated_at=generated_at)


@router.post("/2fa/recovery-codes", response_model=RecoveryCodesResponse)
async def regenerate_2fa_recovery_codes(
    request: TwoFactorCodeRequest,
    user: UserModel = Depends(get_user),
):
    """Replace all recovery codes, returning the new ones once."""
    if not user.is_2fa_enabled:
        raise HTTPException(status_code=400, detail="Two-Factor Authentication is not enabled")
    await _require_email_code(user, request.otp)
    return RecoveryCodesResponse(recovery_codes=await issue_recovery_codes(user.id))


async def _user_response(user: UserModel) -> UserResponse:
    avatar_url = None
    if getattr(user, "avatar_key", None):
        try:
            avatar_url = await storage_fs.aget_signed_url(
                user.avatar_key, expiration=3600
            )
        except Exception as exc:
            logger.warning(f"Failed to sign avatar URL for user {user.id}: {exc}")
    return UserResponse(
        id=user.id,
        email=user.email,
        email_verified=getattr(user, "email_verified", False),
        organization_id=user.selected_organization_id,
        provider_id=user.provider_id,
        is_superuser=user.is_superuser,
        is_2fa_enabled=getattr(user, "is_2fa_enabled", False),
        first_name=user.first_name,
        last_name=user.last_name,
        avatar_key=user.avatar_key,
        avatar_url=avatar_url,
        country=user.country,
        phone_number=user.phone_number,
    )


@router.get("/me", response_model=UserResponse)
async def get_current_user(user: UserModel = Depends(get_user)):
    return await _user_response(user)


class UpdateProfileRequest(BaseModel):
    """Profile fields editable from the profile settings page."""

    first_name: str | None = None
    last_name: str | None = None
    avatar_key: str | None = None
    phone_number: str | None = None

    @field_validator("first_name", "last_name")
    @classmethod
    def _validate_name(cls, value: str | None) -> str | None:
        if value is None:
            return value
        value = value.strip()
        if not value:
            raise ValueError("Name cannot be empty")
        if len(value) > 100:
            raise ValueError("Name must be 100 characters or fewer")
        return value

    @field_validator("phone_number")
    @classmethod
    def _validate_phone(cls, value: str | None) -> str | None:
        if value is None:
            return value
        value = value.strip()
        if not value:
            return None
        if len(value) > 30:
            raise ValueError("Phone number must be 30 characters or fewer")
        return value


@router.put("/me", response_model=UserResponse)
async def update_current_user(
    request: UpdateProfileRequest,
    user: UserModel = Depends(get_user),
):
    """Update the signed-in user's profile (name, avatar key, phone)."""
    fields = request.model_dump(exclude_unset=True)
    avatar_key = fields.get("avatar_key")
    if avatar_key is not None and not avatar_key.startswith(f"avatars/{user.id}/"):
        raise HTTPException(
            status_code=400,
            detail="avatar_key must reference the user's own avatar",
        )
    updated = await db_client.update_user_profile(user.id, fields)
    if updated is None:
        raise HTTPException(status_code=404, detail="User not found")
    return await _user_response(updated)


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str

    @field_validator("new_password")
    @classmethod
    def _validate_new_password(cls, value: str) -> str:
        if len(value) < 8:
            raise ValueError("New password must be at least 8 characters")
        return value


@router.post("/change-password", response_model=MessageResponse)
async def change_password(
    request: ChangePasswordRequest,
    user: UserModel = Depends(get_user),
):
    """Change the signed-in user's password after verifying the current one."""
    if not user.password_hash:
        raise HTTPException(
            status_code=400,
            detail="This account has no password set",
        )
    if not verify_password(request.current_password, user.password_hash):
        raise HTTPException(
            status_code=400,
            detail="Current password is incorrect",
        )
    await db_client.update_user_password(
        user.id, hash_password(request.new_password)
    )
    return MessageResponse(message="Password updated successfully")


class VerifyEmailRequest(BaseModel):
    otp: str

    @field_validator("otp")
    @classmethod
    def _validate_otp(cls, value: str) -> str:
        value = value.strip()
        if not value.isdigit() or len(value) != 6:
            raise ValueError("OTP must be a 6-digit code")
        return value


@router.post("/me/send-email-otp", response_model=MessageResponse)
async def send_email_otp(user: UserModel = Depends(get_user)):
    """Email a 6-digit verification code to the signed-in user's address."""
    email = _account_email(user)
    try:
        await send_email_verification_otp(email)
    except Exception as exc:
        logger.warning(f"Failed to send email verification OTP to {email}: {exc}")
    return MessageResponse(message=f"Verification code sent to {email}")


@router.post("/me/verify-email", response_model=UserResponse)
async def verify_email(
    request: VerifyEmailRequest,
    user: UserModel = Depends(get_user),
):
    """Verify the signed-in user's email with the code sent to it."""
    email = _account_email(user)
    if not await verify_email_verification_otp(email, request.otp):
        raise HTTPException(status_code=400, detail="Invalid or expired verification code")
    updated = await db_client.update_user_profile(user.id, {"email_verified": True})
    if updated is None:
        raise HTTPException(status_code=404, detail="User not found")
    return await _user_response(updated)


class AvatarUploadUrlRequest(BaseModel):
    content_type: str

    @field_validator("content_type")
    @classmethod
    def _validate_content_type(cls, value: str) -> str:
        allowed = ("image/jpeg", "image/png", "image/webp")
        if value not in allowed:
            raise ValueError("content_type must be image/jpeg, image/png or image/webp")
        return value


class AvatarUploadUrlResponse(BaseModel):
    upload_url: str
    avatar_key: str
    expires_in: int


@router.post("/me/avatar-upload-url", response_model=AvatarUploadUrlResponse)
async def get_avatar_upload_url(
    request: AvatarUploadUrlRequest,
    user: UserModel = Depends(get_user),
):
    """Return a presigned PUT URL for uploading the user's profile picture."""
    ext = {
        "image/jpeg": "jpg",
        "image/png": "png",
        "image/webp": "webp",
    }[request.content_type]
    avatar_key = f"avatars/{user.id}/{uuid.uuid4().hex}.{ext}"
    upload_url = await storage_fs.aget_presigned_put_url(
        file_path=avatar_key,
        expiration=900,
        content_type=request.content_type,
    )
    if not upload_url:
        raise HTTPException(status_code=500, detail="Failed to generate upload URL")
    return AvatarUploadUrlResponse(
        upload_url=upload_url, avatar_key=avatar_key, expires_in=900
    )


