"""Cryptographic utilities for OAuth tokens and sensitive email credentials."""

from __future__ import annotations

import base64
import hashlib
import os
from typing import Optional

from cryptography.fernet import Fernet, InvalidToken
from loguru import logger

from api.constants import OSS_JWT_SECRET


def _get_fernet_key() -> bytes:
    """Derive a deterministic 32-byte urlsafe base64 key from EMAIL_CRYPTO_KEY or OSS_JWT_SECRET."""
    secret = (os.getenv("EMAIL_CRYPTO_KEY") or OSS_JWT_SECRET or "change-me-in-production").strip()
    digest = hashlib.sha256(secret.encode("utf-8")).digest()
    return base64.urlsafe_b64encode(digest)


def encrypt_token(token: Optional[str]) -> str:
    """Encrypt an OAuth refresh or access token.
    
    Returns an encrypted base64 token string, or empty string if token is None/empty.
    """
    if not token:
        return ""
    try:
        f = Fernet(_get_fernet_key())
        return f.encrypt(token.encode("utf-8")).decode("utf-8")
    except Exception as exc:
        logger.error(f"Failed to encrypt OAuth token: {exc}")
        raise RuntimeError("Encryption failed for OAuth token") from exc


def decrypt_token(encrypted_token: Optional[str]) -> str:
    """Decrypt an encrypted OAuth token.
    
    If the token is empty, returns empty string.
    If decryption fails (e.g. unencrypted legacy or corrupted), handles gracefully.
    """
    if not encrypted_token:
        return ""
    try:
        f = Fernet(_get_fernet_key())
        return f.decrypt(encrypted_token.encode("utf-8")).decode("utf-8")
    except InvalidToken:
        # Legacy/test fallback: if token is already plaintext and not valid Fernet, return as-is
        return encrypted_token
    except Exception as exc:
        logger.error(f"Failed to decrypt OAuth token: {exc}")
        return ""

