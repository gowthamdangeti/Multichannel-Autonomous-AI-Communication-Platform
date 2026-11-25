"""Unit tests for Email Synchronization Services (Gmail & Outlook) and Token Crypto."""

import asyncio
from datetime import datetime, timedelta, UTC
import unittest
from unittest.mock import AsyncMock, MagicMock, patch

from api.db.models import (
    EmailMessageModel,
    GmailAccountModel,
    OutlookAccountModel,
)
from api.services.email.crypto import decrypt_token, encrypt_token
from api.services.email.gmail_sync import (
    GmailSyncError,
    refresh_gmail_access_token,
    sync_gmail_account,
)
from api.services.email.outlook_sync import (
    OutlookSyncError,
    refresh_outlook_access_token,
    sync_outlook_account,
)


class TestEmailSync(unittest.TestCase):
    def test_crypto_token_encryption_decryption(self):
        """Verify tokens can be safely encrypted and decrypted."""
        raw_token = "ya29.a0AfH6SMD_sample_oauth_token_123456789"
        encrypted = encrypt_token(raw_token)
        self.assertNotEqual(raw_token, encrypted)
        self.assertTrue(encrypted.startswith("gAAAAA"))

        decrypted = decrypt_token(encrypted)
        self.assertEqual(raw_token, decrypted)

    def test_crypto_empty_or_none(self):
        """Verify handling of empty or missing tokens."""
        self.assertEqual(encrypt_token(""), "")
        self.assertEqual(decrypt_token(""), "")
        self.assertEqual(encrypt_token(None), "")  # type: ignore
        self.assertEqual(decrypt_token(None), "")  # type: ignore

    def test_gmail_refresh_access_token(self):
        """Verify Gmail token refresh flow via Google OAuth endpoint."""
        session_mock = AsyncMock()

        account = GmailAccountModel(
            id=1,
            organization_id=42,
            email="user@example.com",
            refresh_token_encrypted=encrypt_token("mock_refresh_token"),
            access_token_encrypted=encrypt_token("old_access_token"),
            access_token_expires_at=None,
            extra_metadata={"client_id": "test_cid", "client_secret": "test_csec"},
        )

        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "access_token": "new_refreshed_access_token",
            "expires_in": 3600,
        }

        async def run_test():
            with patch("httpx.AsyncClient.post", new_callable=AsyncMock) as mock_post:
                mock_post.return_value = mock_response
                new_token = await refresh_gmail_access_token(session_mock, account)
                self.assertEqual(new_token, "new_refreshed_access_token")
                self.assertEqual(
                    decrypt_token(account.access_token_encrypted),
                    "new_refreshed_access_token",
                )

        asyncio.run(run_test())

    def test_gmail_sync_org_isolation(self):
        """Verify sync_gmail_account rejects accounts belonging to different orgs."""
        session_mock = AsyncMock()

        account = GmailAccountModel(
            id=2,
            organization_id=999,  # Belongs to org 999
            email="intruder@example.com",
        )

        async def run_test():
            with self.assertRaises(GmailSyncError) as ctx:
                await sync_gmail_account(
                    session=session_mock,
                    account=account,
                    organization_id=42,  # Attempting to sync under org 42
                )
            self.assertIn("Tenant isolation violation", str(ctx.exception))

        asyncio.run(run_test())

    def test_gmail_history_cursor_expired_triggers_full_sync(self):
        """Verify when historyId expires (HTTP 404), fallback to full sync is triggered."""
        session_mock = AsyncMock()

        account = GmailAccountModel(
            id=1,
            organization_id=42,
            email="user@example.com",
            history_id="12345",
            refresh_token_encrypted=encrypt_token("mock_refresh_token"),
            access_token_encrypted=encrypt_token("valid_token"),
            access_token_expires_at=datetime.now(UTC) + timedelta(hours=1),
            extra_metadata={"client_id": "cid", "client_secret": "csec"},
        )

        # 1. history request returns 404 (History cursor expired)
        mock_404_resp = MagicMock()
        mock_404_resp.status_code = 404

        # 2. messages full list returns empty
        mock_list_resp = MagicMock()
        mock_list_resp.status_code = 200
        mock_list_resp.json.return_value = {"messages": []}

        # 3. profile returns updated historyId
        mock_profile_resp = MagicMock()
        mock_profile_resp.status_code = 200
        mock_profile_resp.json.return_value = {"historyId": "99999"}

        async def run_test():
            with patch("httpx.AsyncClient.get", new_callable=AsyncMock) as mock_get:
                mock_get.side_effect = [mock_404_resp, mock_list_resp, mock_profile_resp]
                result = await sync_gmail_account(
                    session=session_mock,
                    account=account,
                    organization_id=42,
                )
                self.assertEqual(result["status"], "success")
                self.assertEqual(result["mode"], "full")
                self.assertEqual(result["messages_synced"], 0)
                self.assertEqual(account.history_id, "99999")

        asyncio.run(run_test())

    def test_outlook_delta_sync_flow(self):
        """Verify Microsoft Graph delta sync parses delta messages and updates delta_link."""
        session_mock = AsyncMock()

        account = OutlookAccountModel(
            id=1,
            organization_id=10,
            email="outlook_user@convozent.ai",
            refresh_token_encrypted=encrypt_token("mock_refresh_token"),
            access_token_encrypted=encrypt_token("graph_token"),
            access_token_expires_at=datetime.now(UTC) + timedelta(hours=1),
            delta_link=None,
            extra_metadata={"client_id": "cid", "client_secret": "csec"},
        )

        delta_response_page = {
            "value": [
                {
                    "id": "AAMkAGI2AA==",
                    "subject": "Team Sync Meeting",
                    "from": {"emailAddress": {"address": "lead@convozent.ai", "name": "Team Lead"}},
                    "toRecipients": [{"emailAddress": {"address": "outlook_user@convozent.ai"}}],
                    "body": {"content": "Let's meet tomorrow at 10 AM.", "contentType": "text"},
                    "receivedDateTime": "2026-11-05T08:00:00Z",
                    "categories": ["Work"],
                }
            ],
            "@odata.deltaLink": "https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages/delta?$deltatoken=new_token_789",
        }

        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = delta_response_page

        async def run_test():
            # Mock session.execute for existing message check
            mock_result = MagicMock()
            mock_result.scalar_one_or_none.return_value = None
            session_mock.execute.return_value = mock_result

            with patch("httpx.AsyncClient.get", new_callable=AsyncMock) as mock_get:
                mock_get.return_value = mock_resp
                result = await sync_outlook_account(
                    session=session_mock,
                    account=account,
                    organization_id=10,
                )
                self.assertEqual(result["status"], "success")
                self.assertEqual(result["messages_synced"], 1)
                self.assertEqual(
                    account.delta_link,
                    "https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages/delta?$deltatoken=new_token_789",
                )

        asyncio.run(run_test())

    def test_outlook_expired_delta_link_recovery(self):
        """Verify expired deltaLink (HTTP 410 Gone) recovers by resetting delta_link."""
        session_mock = AsyncMock()

        account = OutlookAccountModel(
            id=1,
            organization_id=10,
            email="outlook_user@convozent.ai",
            refresh_token_encrypted=encrypt_token("mock_refresh_token"),
            access_token_encrypted=encrypt_token("graph_token"),
            access_token_expires_at=datetime.now(UTC) + timedelta(hours=1),
            delta_link="https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages/delta?expired=true",
            extra_metadata={"client_id": "cid", "client_secret": "csec"},
        )

        # First call with expired link returns 410, second call returns fresh delta
        mock_410 = MagicMock()
        mock_410.status_code = 410

        mock_fresh = MagicMock()
        mock_fresh.status_code = 200
        mock_fresh.json.return_value = {
            "value": [],
            "@odata.deltaLink": "https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages/delta?fresh=1",
        }

        async def run_test():
            with patch("httpx.AsyncClient.get", new_callable=AsyncMock) as mock_get:
                mock_get.side_effect = [mock_410, mock_fresh]
                result = await sync_outlook_account(
                    session=session_mock,
                    account=account,
                    organization_id=10,
                )
                self.assertEqual(result["status"], "success")
                self.assertEqual(result["messages_synced"], 0)
                self.assertEqual(
                    account.delta_link,
                    "https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages/delta?fresh=1",
                )

        asyncio.run(run_test())


if __name__ == "__main__":
    unittest.main()
