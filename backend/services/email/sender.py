"""Transactional email sending via SMTP (Gmail / Nodemailer compatible) or Resend API.

Provider precedence:
1. SMTP (if EMAIL_USER/SMTP_USER and EMAIL_PASS/SMTP_PASS are set)
2. Resend API (if RESEND_API_KEY is set)
3. Development fallback logger
"""

from __future__ import annotations

import asyncio
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
import os
import smtplib

import httpx
from loguru import logger


from api.constants import (
    EMAIL_FROM,
    EMAIL_FROM_NAME,
    EMAIL_PASS,
    EMAIL_USER,
    RESEND_API_KEY,
    SMTP_HOST,
    SMTP_PASS,
    SMTP_PORT,
    SMTP_SECURE,
    SMTP_USER,
)

_RESEND_ENDPOINT = "https://api.resend.com/emails"


def _send_smtp_sync(to: str, subject: str, html: str, from_addr: str) -> None:
    """Synchronous SMTP email delivery using standard Python smtplib."""
    user = (SMTP_USER or EMAIL_USER or os.getenv("SMTP_USER") or os.getenv("EMAIL_USER") or "").strip()
    # Strip spaces from password if present (e.g. Gmail App Passwords 'etre obuc yiuy fvrj')
    raw_pass = (SMTP_PASS or EMAIL_PASS or os.getenv("SMTP_PASS") or os.getenv("EMAIL_PASS") or "").strip()
    password = raw_pass.replace(" ", "") if " " in raw_pass else raw_pass
    host = (SMTP_HOST or os.getenv("SMTP_HOST") or "smtp.gmail.com").strip()
    port = int(os.getenv("SMTP_PORT") or SMTP_PORT or 587)

    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = from_addr
    msg["To"] = to

    html_part = MIMEText(html, "html", "utf-8")
    msg.attach(html_part)

    if port == 465 or (SMTP_SECURE and port == 465):
        server = smtplib.SMTP_SSL(host, port, timeout=15)
        server.ehlo()
    else:
        server = smtplib.SMTP(host, port, timeout=15)
        server.ehlo()
        server.starttls()
        server.ehlo()

    try:
        if user and password:
            server.login(user, password)
        server.sendmail(from_addr, [to], msg.as_string())
    finally:
        try:
            server.quit()
        except Exception:
            pass


async def send_email(*, to: str, subject: str, html: str) -> None:
    """Send a single transactional email. Swappable between SMTP & Resend API."""
    import os

    smtp_user = (SMTP_USER or EMAIL_USER or os.getenv("SMTP_USER") or os.getenv("EMAIL_USER") or "").strip()
    smtp_pass = (SMTP_PASS or EMAIL_PASS or os.getenv("SMTP_PASS") or os.getenv("EMAIL_PASS") or "").strip()
    resend_key = RESEND_API_KEY or os.getenv("RESEND_API_KEY")

    sender_email = (EMAIL_FROM or os.getenv("EMAIL_FROM") or smtp_user or "onboarding@resend.dev").strip()
    from_name = EMAIL_FROM_NAME or os.getenv("EMAIL_FROM_NAME") or "Convozent"
    sender = f"{from_name} <{sender_email}>" if from_name else sender_email

    # 1. Primary: SMTP Delivery (Gmail App Passwords / Custom SMTP)
    if smtp_user and smtp_pass:
        try:
            current_host = (SMTP_HOST or os.getenv("SMTP_HOST") or "smtp.gmail.com").strip()
            current_port = int(os.getenv("SMTP_PORT") or SMTP_PORT or 587)
            logger.info(f"Sending email via SMTP to {to} (host={current_host}:{current_port}, user={smtp_user})")
            await asyncio.to_thread(_send_smtp_sync, to, subject, html, sender)
            logger.info(f"Successfully sent SMTP email to {to} (subject={subject!r})")
            return
        except Exception as err:
            logger.error(f"SMTP send failed for {to}: {err}")
            if not resend_key:
                raise RuntimeError(f"Failed to send email via SMTP: {err}") from err
            logger.info("SMTP failed, falling back to Resend API...")

    # 2. Secondary: Resend API Delivery
    if resend_key:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.post(
                _RESEND_ENDPOINT,
                headers={"Authorization": f"Bearer {resend_key}"},
                json={"from": sender, "to": [to], "subject": subject, "html": html},
            )
        if resp.status_code >= 400:
            logger.error(f"Resend send failed ({resp.status_code}): {resp.text}")
            raise RuntimeError("Failed to send email via Resend")
        logger.info(f"Sent email via Resend to {to} (subject={subject!r})")
        return

    # 3. Local Development Fallback Log
    logger.warning(
        "Neither SMTP nor RESEND_API_KEY configured — email logged instead of sent.\n"
        f"  to={to}\n  subject={subject}\n  html={html}"
    )


