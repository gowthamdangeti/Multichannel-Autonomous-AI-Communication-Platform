import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from api.services.email.sender import send_email


@pytest.mark.asyncio
async def test_send_email_smtp_success():
    """Verify send_email uses SMTP when EMAIL_USER and EMAIL_PASS are set."""
    with patch("api.services.email.sender.SMTP_USER", "orbital79811@gmail.com"), \
         patch("api.services.email.sender.SMTP_PASS", "etre obuc yiuy fvrj"), \
         patch("api.services.email.sender.EMAIL_USER", "orbital79811@gmail.com"), \
         patch("api.services.email.sender.EMAIL_PASS", "etre obuc yiuy fvrj"), \
         patch("api.services.email.sender._send_smtp_sync") as mock_smtp_sync:
        
        await send_email(to="test@example.com", subject="Test OTP", html="<p>123456</p>")
        mock_smtp_sync.assert_called_once()
        args, _ = mock_smtp_sync.call_args
        assert args[0] == "test@example.com"
        assert args[1] == "Test OTP"


@pytest.mark.asyncio
async def test_send_email_resend_fallback():
    """Verify send_email falls back to Resend if SMTP is unset."""
    mock_resp = MagicMock()
    mock_resp.status_code = 200

    with patch.dict("os.environ", {"EMAIL_USER": "", "SMTP_USER": "", "EMAIL_PASS": "", "SMTP_PASS": ""}), \
         patch("api.services.email.sender.SMTP_USER", None), \
         patch("api.services.email.sender.SMTP_PASS", None), \
         patch("api.services.email.sender.EMAIL_USER", None), \
         patch("api.services.email.sender.EMAIL_PASS", None), \
         patch("api.services.email.sender.RESEND_API_KEY", "re_123456"), \
         patch("httpx.AsyncClient.post", new_callable=AsyncMock) as mock_post:
        
        mock_post.return_value = mock_resp
        await send_email(to="test@example.com", subject="Test", html="<p>Hi</p>")
        mock_post.assert_called_once()

