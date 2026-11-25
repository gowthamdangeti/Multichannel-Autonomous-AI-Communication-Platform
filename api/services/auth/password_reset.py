"""Password-reset via email OTP.

A 6-digit code is emailed to the user and stored (bcrypt-hashed) in Redis with a
short TTL. Verification is rate-limited by an attempt counter, and requests are
throttled by a cooldown key. Responses to the caller are deliberately generic so
the endpoints can't be used to enumerate registered emails.
"""

from __future__ import annotations

import secrets

import redis.asyncio as aioredis
from loguru import logger

from api.constants import REDIS_URL
from api.db import db_client
from api.services.email.sender import send_email
from api.utils.auth import hash_password, verify_password

OTP_TTL_SECONDS = 600  # code valid for 10 minutes
MAX_VERIFY_ATTEMPTS = 5
RESEND_COOLDOWN_SECONDS = 60  # min gap between OTP requests for the same email

_redis = aioredis.from_url(REDIS_URL, decode_responses=True)


def _otp_key(email: str) -> str:
    return f"pwreset:otp:{email}"


def _attempts_key(email: str) -> str:
    return f"pwreset:attempts:{email}"


def _cooldown_key(email: str) -> str:
    return f"pwreset:cooldown:{email}"


def _generate_otp() -> str:
    return f"{secrets.randbelow(1_000_000):06d}"


async def _send_otp_email(email: str, otp: str) -> None:
    subject = "Your password reset code"
    html = (
        f"<p>Your password reset code is <strong style='font-size:18px'>{otp}</strong>.</p>"
        f"<p>It expires in {OTP_TTL_SECONDS // 60} minutes. "
        "If you didn't request a password reset, you can safely ignore this email.</p>"
    )
    await send_email(to=email, subject=subject, html=html)


async def request_password_reset(email: str) -> None:
    """Generate + email an OTP. No-op (silently) if the email has no local account
    or is within the resend cooldown — caller always gets a generic response."""
    email = email.strip().lower()

    user = await db_client.get_user_by_email(email)
    if user is None or not user.password_hash:
        # No local-password account for this email — say nothing.
        return

    if await _redis.get(_cooldown_key(email)):
        logger.info(f"[pwreset] request throttled (cooldown) for {email}")
        return

    otp = _generate_otp()
    await _redis.set(_otp_key(email), hash_password(otp), ex=OTP_TTL_SECONDS)
    await _redis.set(_attempts_key(email), 0, ex=OTP_TTL_SECONDS)
    await _redis.set(_cooldown_key(email), "1", ex=RESEND_COOLDOWN_SECONDS)

    # Never let a delivery error change the endpoint's response — otherwise a
    # 500 for registered emails (vs 200 for unknown ones) leaks which emails
    # have accounts. Log and move on; the user can request a new code.
    try:
        await _send_otp_email(email, otp)
        logger.info(f"[pwreset] OTP issued for {email}")
    except Exception:
        logger.exception(f"[pwreset] failed to send OTP email to {email}")


async def reset_password(email: str, otp: str, new_password: str) -> bool:
    """Verify the OTP and set the new password. Returns False on any invalid/
    expired/exhausted attempt."""
    email = email.strip().lower()

    stored_hash = await _redis.get(_otp_key(email))
    if not stored_hash:
        return False  # no active code (never requested / expired / already used)

    attempts = int(await _redis.get(_attempts_key(email)) or 0)
    if attempts >= MAX_VERIFY_ATTEMPTS:
        await _redis.delete(_otp_key(email), _attempts_key(email))
        logger.warning(f"[pwreset] max attempts exceeded for {email}")
        return False

    if not verify_password(otp, stored_hash):
        await _redis.incr(_attempts_key(email))
        return False

    user = await db_client.get_user_by_email(email)
    if user is None:
        return False

    await db_client.update_user_password(user.id, hash_password(new_password))
    await _redis.delete(
        _otp_key(email), _attempts_key(email), _cooldown_key(email)
    )
    logger.info(f"[pwreset] password reset for {email}")
    return True
