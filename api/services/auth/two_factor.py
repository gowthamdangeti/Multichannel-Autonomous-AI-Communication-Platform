"""Two-Factor Authentication (2FA) OTP service.

Handles generating 6-digit verification codes, storing hashed OTPs in Redis with TTL,
rate-limiting resends, attempt tracking, and delivering email OTPs via transactional email sender.
"""

from __future__ import annotations

import hashlib
import hmac
import secrets
from datetime import UTC, datetime

import redis.asyncio as aioredis
from loguru import logger

from api.constants import OSS_JWT_SECRET, REDIS_URL
from api.db import db_client
from api.enums import UserConfigurationKey
from api.services.email.sender import send_email
from api.utils.auth import hash_password, verify_password

OTP_TTL_SECONDS = 600  # 10 minutes
MAX_VERIFY_ATTEMPTS = 5
RESEND_COOLDOWN_SECONDS = 60

RECOVERY_CODE_COUNT = 8
RECOVERY_CODE_GROUP_LENGTH = 5
# No 0/O or 1/I, so a code survives being written down.
RECOVERY_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
RECOVERY_WINDOW_SECONDS = 900  # 15 minutes
MAX_RECOVERY_ATTEMPTS = 5

_redis = aioredis.from_url(REDIS_URL, decode_responses=True)


def _2fa_otp_key(email: str) -> str:
    return f"2fa:otp:{email}"


def _2fa_attempts_key(email: str) -> str:
    return f"2fa:attempts:{email}"


def _2fa_cooldown_key(email: str) -> str:
    return f"2fa:cooldown:{email}"


async def send_2fa_email_otp(email: str) -> None:
    """Generate a 6-digit OTP code and deliver it via email (throttled by cooldown)."""
    email = email.strip().lower()

    if await _redis.get(_2fa_cooldown_key(email)):
        logger.info(f"[2fa] request throttled (cooldown) for {email}")
        return

    otp = f"{secrets.randbelow(1_000_000):06d}"

    await _redis.set(_2fa_otp_key(email), hash_password(otp), ex=OTP_TTL_SECONDS)
    await _redis.set(_2fa_attempts_key(email), 0, ex=OTP_TTL_SECONDS)
    await _redis.set(_2fa_cooldown_key(email), "1", ex=RESEND_COOLDOWN_SECONDS)

    subject = "Your Convozent 2FA Verification Code"
    html = (
        "<div style='font-family:sans-serif; padding:20px; border:1px solid #e2e8f0; border-radius:8px; max-width:500px;'>"
        "<h2 style='color:#0f172a; margin-top:0;'>Two-Factor Authentication Code</h2>"
        "<p>Use the following 6-digit code to verify your email address for 2FA:</p>"
        f"<div style='background-color:#f1f5f9; padding:15px; border-radius:6px; text-align:center; font-size:24px; font-weight:bold; letter-spacing:4px; color:#0f172a; margin:20px 0;'>{otp}</div>"
        "<p style='color:#64748b; font-size:14px;'>This code will expire in 10 minutes. If you did not request this code, please ignore this email.</p>"
        "</div>"
    )

    logger.info(f"[2fa] sending OTP code to {email}")
    await send_email(to=email, subject=subject, html=html)


async def verify_2fa_email_otp(email: str, otp: str) -> bool:
    """Verify 2FA OTP against stored Redis hash with attempt rate limiting."""
    email = email.strip().lower()

    stored_hash = await _redis.get(_2fa_otp_key(email))
    if not stored_hash:
        return False

    attempts = int(await _redis.get(_2fa_attempts_key(email)) or 0)
    if attempts >= MAX_VERIFY_ATTEMPTS:
        await _redis.delete(_2fa_otp_key(email), _2fa_attempts_key(email))
        logger.warning(f"[2fa] max attempts exceeded for {email}")
        return False

    if not verify_password(otp, stored_hash):
        await _redis.incr(_2fa_attempts_key(email))
        return False

    await _redis.delete(_2fa_otp_key(email), _2fa_attempts_key(email), _2fa_cooldown_key(email))
    return True


def _verify_otp_key(email: str) -> str:
    return f"verify:otp:{email}"


def _verify_attempts_key(email: str) -> str:
    return f"verify:attempts:{email}"


def _verify_cooldown_key(email: str) -> str:
    return f"verify:cooldown:{email}"


async def send_email_verification_otp(email: str) -> None:
    """Send a 6-digit code to confirm the account's email address.

    Separate Redis namespace from the 2FA challenges, so the two flows never
    overwrite each other's codes for the same address. Throttled by cooldown.
    """
    email = email.strip().lower()

    if await _redis.get(_verify_cooldown_key(email)):
        logger.info(f"[verify] request throttled (cooldown) for {email}")
        return

    otp = f"{secrets.randbelow(1_000_000):06d}"

    await _redis.set(_verify_otp_key(email), hash_password(otp), ex=OTP_TTL_SECONDS)
    await _redis.set(_verify_attempts_key(email), 0, ex=OTP_TTL_SECONDS)
    await _redis.set(_verify_cooldown_key(email), "1", ex=RESEND_COOLDOWN_SECONDS)

    subject = "Your Convozent Email Verification Code"
    html = (
        "<div style='font-family:sans-serif; padding:20px; border:1px solid #e2e8f0; border-radius:8px; max-width:500px;'>"
        "<h2 style='color:#0f172a; margin-top:0;'>Verify your email address</h2>"
        "<p>Use the following 6-digit code to verify your email address:</p>"
        f"<div style='background-color:#f1f5f9; padding:15px; border-radius:6px; text-align:center; font-size:24px; font-weight:bold; letter-spacing:4px; color:#0f172a; margin:20px 0;'>{otp}</div>"
        "<p style='color:#64748b; font-size:14px;'>This code will expire in 10 minutes. If you did not request this code, please ignore this email.</p>"
        "</div>"
    )

    logger.info(f"[verify] sending email verification OTP to {email}")
    await send_email(to=email, subject=subject, html=html)


async def verify_email_verification_otp(email: str, otp: str) -> bool:
    """Verify an email-verification OTP with attempt rate limiting."""
    email = email.strip().lower()

    stored_hash = await _redis.get(_verify_otp_key(email))
    if not stored_hash:
        return False

    attempts = int(await _redis.get(_verify_attempts_key(email)) or 0)
    if attempts >= MAX_VERIFY_ATTEMPTS:
        await _redis.delete(_verify_otp_key(email), _verify_attempts_key(email))
        logger.warning(f"[verify] max attempts exceeded for {email}")
        return False

    if not verify_password(otp, stored_hash):
        await _redis.incr(_verify_attempts_key(email))
        return False

    await _redis.delete(_verify_otp_key(email), _verify_attempts_key(email), _verify_cooldown_key(email))
    return True


def _2fa_recovery_attempts_key(email: str) -> str:
    return f"2fa:recovery-attempts:{email}"


def _normalize_recovery_code(code: str) -> str:
    return "".join(char for char in code.upper() if char.isalnum())


def _hash_recovery_code(user_id: int, code: str) -> str:
    """Keyed so a database leak alone can't be brute-forced, and fast enough to look up."""
    message = f"{user_id}:{_normalize_recovery_code(code)}".encode()
    return hmac.new(OSS_JWT_SECRET.encode(), message, hashlib.sha256).hexdigest()


def _generate_recovery_code() -> str:
    length = RECOVERY_CODE_GROUP_LENGTH
    chars = [secrets.choice(RECOVERY_CODE_ALPHABET) for _ in range(length * 2)]
    return f"{''.join(chars[:length])}-{''.join(chars[length:])}"


async def issue_recovery_codes(user_id: int) -> list[str]:
    """Replace the user's codes. The plain text is only ever returned here."""
    codes = [_generate_recovery_code() for _ in range(RECOVERY_CODE_COUNT)]
    await db_client.upsert_user_configuration_value(
        user_id,
        UserConfigurationKey.TWO_FACTOR_RECOVERY.value,
        {
            "hashes": [_hash_recovery_code(user_id, code) for code in codes],
            "generated_at": datetime.now(UTC).isoformat(),
        },
    )
    return codes


async def clear_recovery_codes(user_id: int) -> None:
    await db_client.upsert_user_configuration_value(
        user_id, UserConfigurationKey.TWO_FACTOR_RECOVERY.value, {"hashes": []}
    )


async def get_recovery_status(user_id: int) -> tuple[int, str | None]:
    stored = await db_client.get_user_configuration_value(
        user_id, UserConfigurationKey.TWO_FACTOR_RECOVERY.value
    )
    stored = stored or {}
    return len(stored.get("hashes", [])), stored.get("generated_at")


async def allow_recovery_attempt(email: str) -> bool:
    """Count an attempt against the email; False once the window's limit is used."""
    key = _2fa_recovery_attempts_key(email.strip().lower())
    attempts = await _redis.incr(key)
    if attempts == 1:
        await _redis.expire(key, RECOVERY_WINDOW_SECONDS)
    return attempts <= MAX_RECOVERY_ATTEMPTS


async def redeem_recovery_code(user_id: int, code: str) -> bool:
    return await db_client.consume_2fa_recovery_hash(user_id, _hash_recovery_code(user_id, code))
