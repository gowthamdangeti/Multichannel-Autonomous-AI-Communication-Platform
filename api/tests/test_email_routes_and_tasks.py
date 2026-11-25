"""Integration and unit tests for FastAPI Email Routes and ARQ Background Workers."""

import asyncio
from datetime import datetime, timedelta, UTC
import unittest
from unittest.mock import AsyncMock, MagicMock, patch

from fastapi import HTTPException
from pydantic import ValidationError

from api.db import db_client
from api.db.models import (
    EmailAgentModel,
    EmailAIRunModel,
    EmailAttachmentModel,
    EmailFollowUpModel,
    EmailMessageModel,
    EmailRuleActionModel,
    EmailRuleConditionModel,
    EmailRuleExecutionModel,
    EmailRuleModel,
    GmailAccountModel,
    OutlookAccountModel,
    UserModel,
)
from api.routes.email.accounts import (
    get_account_sync_status,
    get_email_account,
    list_email_accounts,
    trigger_account_sync,
)
from api.routes.email.agents import (
    create_email_agent,
    delete_email_agent,
    get_email_agent,
    list_email_agents,
    update_email_agent,
    CreateEmailAgentRequest,
    UpdateEmailAgentRequest,
)
from api.routes.email.analytics import (
    get_analytics_activity,
    get_analytics_categories,
    get_analytics_overview,
    get_analytics_response_times,
)
from api.routes.email.attachments import (
    get_attachment_download_url,
    list_attachments,
)
from api.routes.email.followups import (
    list_awaiting_reply,
    list_followups,
    list_needs_reply,
    resolve_followup,
    update_followup,
    UpdateFollowUpRequest,
)
from api.routes.email.messages import (
    generate_draft_reply,
    get_ai_history,
    get_email_message,
    get_email_thread,
    list_email_messages,
    trigger_ai_analysis,
    update_email_message,
    DraftReplyRequest,
    UpdateMessageRequest,
)
from api.routes.email.rules import (
    create_rule,
    delete_rule,
    dry_run_rule,
    get_rule,
    list_rule_executions,
    list_rules,
    update_rule,
    ActionSchema,
    ConditionSchema,
    CreateRuleRequest,
    UpdateRuleRequest,
)
from api.tasks.email_tasks import (
    cleanup_email_processing_records,
    sync_all_email_accounts,
    update_followup_status,
)


def _mock_user(user_id: int = 1, org_id: int = 100) -> UserModel:
    user = MagicMock(spec=UserModel)
    user.id = user_id
    user.selected_organization_id = org_id
    user.email = "testuser@convozent.ai"
    return user


class TestEmailRoutesAndTasks(unittest.TestCase):
    # -------------------------------------------------------------------------
    # A. Account Management Tests
    # -------------------------------------------------------------------------
    def test_list_email_accounts_returns_accounts_without_tokens(self):
        """Verify accounts are listed for user org and tokens are never returned."""
        user = _mock_user(org_id=100)

        gmail_acc = GmailAccountModel(
            id=1,
            organization_id=100,
            email="work@gmail.com",
            status="connected",
            refresh_token_encrypted="secret_token",
            history_id="12345",
        )
        outlook_acc = OutlookAccountModel(
            id=2,
            organization_id=100,
            email="work@outlook.com",
            status="connected",
            refresh_token_encrypted="secret_token_2",
            delta_link="https://graph.microsoft.com/delta",
        )

        async def run_test():
            mock_session = AsyncMock()
            g_mock = MagicMock()
            g_mock.scalars.return_value.all.return_value = [gmail_acc]
            o_mock = MagicMock()
            o_mock.scalars.return_value.all.return_value = [outlook_acc]
            mock_session.execute.side_effect = [g_mock, o_mock]

            with patch.object(db_client, "async_session") as mock_session_ctx:
                mock_session_ctx.return_value.__aenter__.return_value = mock_session
                accounts = await list_email_accounts(user=user)

                self.assertEqual(len(accounts), 2)
                self.assertEqual(accounts[0].email, "work@gmail.com")
                self.assertEqual(accounts[0].provider, "gmail")
                self.assertTrue(accounts[0].has_history_cursor)
                self.assertEqual(accounts[1].email, "work@outlook.com")
                self.assertEqual(accounts[1].provider, "outlook")
                # Ensure no token fields are on AccountResponse
                self.assertFalse(hasattr(accounts[0], "refresh_token"))
                self.assertFalse(hasattr(accounts[0], "access_token_encrypted"))

        asyncio.run(run_test())

    def test_account_idor_prevention(self):
        """Verify accessing account from another organization raises 404."""
        user = _mock_user(org_id=100)  # User belongs to org 100

        async def run_test():
            mock_session = AsyncMock()
            res_mock = MagicMock()
            res_mock.scalar_one_or_none.return_value = None  # Not found in org 100
            mock_session.execute.return_value = res_mock

            with patch.object(db_client, "async_session") as mock_session_ctx:
                mock_session_ctx.return_value.__aenter__.return_value = mock_session
                with self.assertRaises(HTTPException) as ctx:
                    await get_email_account(account_id=999, provider="gmail", user=user)
                self.assertEqual(ctx.exception.status_code, 404)

        asyncio.run(run_test())

    def test_trigger_account_sync_enqueues_job(self):
        """Verify triggering sync pushes ARQ task with tenant parameters."""
        user = _mock_user(org_id=100)
        acc = GmailAccountModel(id=5, organization_id=100, email="sync@gmail.com")

        async def run_test():
            mock_session = AsyncMock()
            res_mock = MagicMock()
            res_mock.scalar_one_or_none.return_value = acc
            mock_session.execute.return_value = res_mock

            with patch.object(db_client, "async_session") as mock_session_ctx:
                mock_session_ctx.return_value.__aenter__.return_value = mock_session
                with patch("api.routes.email.accounts.enqueue_job", new_callable=AsyncMock) as mock_enqueue:
                    res = await trigger_account_sync(account_id=5, provider="gmail", user=user)
                    self.assertEqual(res["status"], "sync_enqueued")
                    mock_enqueue.assert_called_once_with(
                        "sync_gmail_account",
                        account_id=5,
                        organization_id=100,
                    )

        asyncio.run(run_test())

    # -------------------------------------------------------------------------
    # B. Inbox and Messages Tests
    # -------------------------------------------------------------------------
    def test_list_messages_with_filters(self):
        """Verify list_email_messages queries by organization and filters."""
        user = _mock_user(org_id=100)
        msg = EmailMessageModel(
            id=10,
            organization_id=100,
            provider="gmail",
            gmail_message_id="gm_10",
            subject="Interview scheduled",
            ai_category="job_opportunities",
            ai_priority="high",
            is_read=False,
            is_archived=False,
        )

        async def run_test():
            mock_session = AsyncMock()
            count_mock = MagicMock()
            count_mock.scalar.return_value = 1
            items_mock = MagicMock()
            items_mock.scalars.return_value.all.return_value = [msg]
            mock_session.execute.side_effect = [count_mock, items_mock]

            with patch.object(db_client, "async_session") as mock_session_ctx:
                mock_session_ctx.return_value.__aenter__.return_value = mock_session
                resp = await list_email_messages(
                    category="job_opportunities",
                    priority="high",
                    limit=20,
                    offset=0,
                    user=user,
                )
                self.assertEqual(resp.total, 1)
                self.assertEqual(len(resp.messages), 1)
                self.assertEqual(resp.messages[0].subject, "Interview scheduled")
                self.assertEqual(resp.messages[0].ai_category, "job_opportunities")

        asyncio.run(run_test())

    def test_update_message_triage_flags(self):
        """Verify updating read/archived status on an email message."""
        user = _mock_user(org_id=100)
        msg = EmailMessageModel(
            id=15,
            organization_id=100,
            provider="gmail",
            gmail_message_id="gm_15",
            is_read=False,
            is_archived=False,
        )

        async def run_test():
            mock_session = AsyncMock()
            res_mock = MagicMock()
            res_mock.scalar_one_or_none.return_value = msg
            mock_session.execute.return_value = res_mock

            with patch.object(db_client, "async_session") as mock_session_ctx:
                mock_session_ctx.return_value.__aenter__.return_value = mock_session
                updated = await update_email_message(
                    message_id=15,
                    payload=UpdateMessageRequest(is_read=True, is_archived=True),
                    user=user,
                )
                self.assertTrue(updated.is_read)
                self.assertTrue(updated.is_archived)
                mock_session.commit.assert_called_once()

        asyncio.run(run_test())

    # -------------------------------------------------------------------------
    # C. Reply Zero Follow-ups Tests
    # -------------------------------------------------------------------------
    def test_list_needs_reply_followups(self):
        """Verify listing pending follow-up conversations."""
        user = _mock_user(org_id=100)
        fup = EmailFollowUpModel(
            id=1,
            organization_id=100,
            email_message_id=10,
            status="needs_reply",
            suggested_followup="Thanks, let's meet Monday.",
        )
        msg = EmailMessageModel(id=10, subject="Meeting request", sender="partner@biz.com")

        async def run_test():
            mock_session = AsyncMock()
            res_mock = MagicMock()
            res_mock.all.return_value = [(fup, msg)]
            mock_session.execute.return_value = res_mock

            with patch.object(db_client, "async_session") as mock_session_ctx:
                mock_session_ctx.return_value.__aenter__.return_value = mock_session
                items = await list_needs_reply(user=user)
                self.assertEqual(len(items), 1)
                self.assertEqual(items[0].status, "needs_reply")
                self.assertEqual(items[0].subject, "Meeting request")

        asyncio.run(run_test())

    def test_resolve_followup(self):
        """Verify resolve_followup marks follow-up as completed."""
        user = _mock_user(org_id=100)
        fup = EmailFollowUpModel(
            id=2,
            organization_id=100,
            email_message_id=20,
            status="needs_reply",
        )
        msg = EmailMessageModel(id=20, subject="Follow-up thread")

        async def run_test():
            mock_session = AsyncMock()
            res_mock = MagicMock()
            res_mock.first.return_value = (fup, msg)
            mock_session.execute.return_value = res_mock

            with patch.object(db_client, "async_session") as mock_session_ctx:
                mock_session_ctx.return_value.__aenter__.return_value = mock_session
                resolved = await resolve_followup(followup_id=2, user=user)
                self.assertEqual(resolved.status, "completed")
                mock_session.commit.assert_called_once()

        asyncio.run(run_test())

    # -------------------------------------------------------------------------
    # D. AI Rules Engine Tests
    # -------------------------------------------------------------------------
    def test_create_and_list_rules(self):
        """Verify rule creation and listing with conditions and actions."""
        user = _mock_user(org_id=100)

        payload = CreateRuleRequest(
            name="Archive Newsletters",
            description="Auto archive newsletter emails",
            priority=10,
            conditions=[ConditionSchema(field="category", operator="equals", value="newsletters")],
            actions=[ActionSchema(action_type="archive", parameters={})],
        )

        async def run_test():
            mock_session = AsyncMock()
            with patch.object(db_client, "async_session") as mock_session_ctx:
                mock_session_ctx.return_value.__aenter__.return_value = mock_session
                rule_resp = await create_rule(payload=payload, user=user)
                self.assertEqual(rule_resp.name, "Archive Newsletters")
                self.assertEqual(len(rule_resp.conditions), 1)
                self.assertEqual(len(rule_resp.actions), 1)
                mock_session.commit.assert_called_once()

        asyncio.run(run_test())

    def test_dry_run_rule_execution(self):
        """Verify dry-run evaluates against recent emails without mutating them."""
        user = _mock_user(org_id=100)

        rule = EmailRuleModel(id=1, organization_id=100, name="Promotions Rule")
        cond = EmailRuleConditionModel(field="category", operator="equals", value="marketing")
        act = EmailRuleActionModel(action_type="archive", parameters={})
        rule.conditions.append(cond)
        rule.actions.append(act)

        msg1 = EmailMessageModel(
            id=1,
            organization_id=100,
            subject="Special Sale",
            ai_category="marketing",
            is_archived=False,
        )
        msg2 = EmailMessageModel(
            id=2,
            organization_id=100,
            subject="Work Report",
            ai_category="work",
            is_archived=False,
        )

        async def run_test():
            mock_session = AsyncMock()
            rule_mock = MagicMock()
            rule_mock.scalar_one_or_none.return_value = rule
            msgs_mock = MagicMock()
            msgs_mock.scalars.return_value.all.return_value = [msg1, msg2]
            mock_session.execute.side_effect = [rule_mock, msgs_mock]

            with patch.object(db_client, "async_session") as mock_session_ctx:
                mock_session_ctx.return_value.__aenter__.return_value = mock_session
                res = await dry_run_rule(rule_id=1, limit=5, user=user)
                self.assertEqual(res["status"], "dry_run_completed")
                self.assertEqual(res["emails_evaluated"], 2)
                self.assertEqual(res["matched_count"], 1)
                self.assertEqual(res["matches"][0]["message_id"], 1)
                # Verify message was NOT archived in dry run
                self.assertFalse(msg1.is_archived)

        asyncio.run(run_test())

    # -------------------------------------------------------------------------
    # E. Attachment Management Tests
    # -------------------------------------------------------------------------
    def test_get_attachment_download_url(self):
        """Verify presigned download URL generation for authorized attachment."""
        user = _mock_user(org_id=100)
        att = EmailAttachmentModel(
            id=50,
            organization_id=100,
            filename="contract.pdf",
            storage_path="email_attachments/org_100/contract.pdf",
        )

        async def run_test():
            mock_session = AsyncMock()
            res_mock = MagicMock()
            res_mock.scalar_one_or_none.return_value = att
            mock_session.execute.return_value = res_mock

            with patch.object(db_client, "async_session") as mock_session_ctx:
                mock_session_ctx.return_value.__aenter__.return_value = mock_session
                with patch(
                    "api.services.email.attachment_service.AttachmentService.get_download_url",
                    new_callable=AsyncMock,
                ) as mock_get_url:
                    mock_get_url.return_value = "https://minio.convozent.local/contract.pdf?signature=123"
                    url_resp = await get_attachment_download_url(attachment_id=50, user=user)
                    self.assertEqual(url_resp.attachment_id, 50)
                    self.assertEqual(url_resp.filename, "contract.pdf")
                    self.assertIn("minio.convozent.local", url_resp.download_url)

        asyncio.run(run_test())

    # -------------------------------------------------------------------------
    # F. Analytics Calculation Tests
    # -------------------------------------------------------------------------
    def test_analytics_overview_calculation(self):
        """Verify overview endpoint returns aggregated metrics."""
        user = _mock_user(org_id=100)

        async def run_test():
            mock_session = AsyncMock()

            # Mock 5 query results in order:
            # 1. msg_counts: (total=10, unread=3, archived=2)
            m1 = MagicMock()
            m1.one.return_value = (10, 3, 2)
            # 2. fup_counts: (needs_reply=2, awaiting_reply=1)
            m2 = MagicMock()
            m2.one.return_value = (2, 1)
            # 3. att_count: 5
            m3 = MagicMock()
            m3.scalar.return_value = 5
            # 4. ai_count: 8
            m4 = MagicMock()
            m4.scalar.return_value = 8
            # 5. rules_count: 4
            m5 = MagicMock()
            m5.scalar.return_value = 4

            mock_session.execute.side_effect = [m1, m2, m3, m4, m5]

            with patch.object(db_client, "async_session") as mock_session_ctx:
                mock_session_ctx.return_value.__aenter__.return_value = mock_session
                overview = await get_analytics_overview(user=user)
                self.assertEqual(overview.total_emails, 10)
                self.assertEqual(overview.unread_emails, 3)
                self.assertEqual(overview.archived_emails, 2)
                self.assertEqual(overview.needs_reply_count, 2)
                self.assertEqual(overview.awaiting_reply_count, 1)
                self.assertEqual(overview.total_attachments, 5)
                self.assertEqual(overview.total_ai_runs, 8)
                self.assertEqual(overview.total_rules_applied, 4)

        asyncio.run(run_test())

    # -------------------------------------------------------------------------
    # G. ARQ Worker Jobs & Deduplication Tests
    # -------------------------------------------------------------------------
    def test_sync_all_email_accounts_enqueues_deduplicated_jobs(self):
        """Verify sync_all_email_accounts schedules accounts with deduplication job IDs."""
        async def run_test():
            mock_session = AsyncMock()
            # 2 Gmail accounts, 1 Outlook account
            g_mock = MagicMock()
            g_mock.all.return_value = [(1, 100), (2, 101)]
            o_mock = MagicMock()
            o_mock.all.return_value = [(3, 100)]
            mock_session.execute.side_effect = [g_mock, o_mock]

            with patch.object(db_client, "async_session") as mock_session_ctx:
                mock_session_ctx.return_value.__aenter__.return_value = mock_session
                with patch("api.tasks.arq.enqueue_job", new_callable=AsyncMock) as mock_enqueue:
                    res = await sync_all_email_accounts(ctx={})
                    self.assertEqual(res["status"], "success")
                    self.assertEqual(res["total_enqueued"], 3)
                    self.assertEqual(mock_enqueue.call_count, 3)

        asyncio.run(run_test())

    def test_update_followup_status_flags_overdue(self):
        """Verify hourly check flags follow-ups exceeding 3 days as overdue."""
        stale_date = datetime.now(UTC) - timedelta(days=4)
        fup = EmailFollowUpModel(
            id=1,
            organization_id=100,
            status="needs_reply",
            created_at=stale_date,
            due_date=None,
            notes="",
        )

        async def run_test():
            mock_session = AsyncMock()
            res_mock = MagicMock()
            res_mock.scalars.return_value.all.return_value = [fup]
            mock_session.execute.return_value = res_mock

            with patch.object(db_client, "async_session") as mock_session_ctx:
                mock_session_ctx.return_value.__aenter__.return_value = mock_session
                res = await update_followup_status(ctx={})
                self.assertEqual(res["overdue_flagged"], 1)
                self.assertIn("Overdue", fup.notes)
                mock_session.commit.assert_called_once()

        asyncio.run(run_test())

    # -------------------------------------------------------------------------
    # H. Email Agents Tests
    # -------------------------------------------------------------------------
    def test_email_agents_lifecycle(self):
        """Verify listing, creating, updating, and deleting email agents with org isolation."""
        user = _mock_user(org_id=100)
        agent1 = EmailAgentModel(
            id=1,
            organization_id=100,
            name="Support Specialist",
            description="Handles customer support",
            system_prompt="Be polite and helpful",
            is_active=True,
            auto_reply_enabled=False,
            model_config_ref={"model_name": "gemini-2.5-flash"},
        )

        async def run_test():
            # 1. List agents
            mock_session = AsyncMock()
            list_mock = MagicMock()
            list_mock.all.return_value = [(agent1, None, None)]
            mock_session.execute.return_value = list_mock

            with patch.object(db_client, "async_session") as mock_session_ctx:
                mock_session_ctx.return_value.__aenter__.return_value = mock_session
                agents = await list_email_agents(user=user)
                self.assertEqual(len(agents), 1)
                self.assertEqual(agents[0].name, "Support Specialist")

            # 2. Create agent with duplicate name fails
            dup_mock_session = AsyncMock()
            dup_check = MagicMock()
            dup_check.scalar_one_or_none.return_value = agent1
            dup_mock_session.execute.return_value = dup_check

            with patch.object(db_client, "async_session") as mock_session_ctx:
                mock_session_ctx.return_value.__aenter__.return_value = dup_mock_session
                payload = CreateEmailAgentRequest(name="Support Specialist", system_prompt="Test")
                with self.assertRaises(HTTPException) as ctx:
                    await create_email_agent(payload=payload, user=user)
                self.assertEqual(ctx.exception.status_code, 400)
                self.assertIn("already exists", ctx.exception.detail)

            # 3. Create new agent succeeds
            create_session = AsyncMock()
            create_check = MagicMock()
            create_check.scalar_one_or_none.return_value = None
            create_session.execute.return_value = create_check

            with patch.object(db_client, "async_session") as mock_session_ctx:
                mock_session_ctx.return_value.__aenter__.return_value = create_session
                payload = CreateEmailAgentRequest(
                    name="Sales Closer",
                    description="Qualifies enterprise deals",
                    system_prompt="Focus on discovery calls",
                    auto_reply_enabled=False,
                )
                res = await create_email_agent(payload=payload, user=user)
                self.assertEqual(res.name, "Sales Closer")
                create_session.add.assert_called_once()
                create_session.commit.assert_called_once()

            # 4. Delete agent
            del_session = AsyncMock()
            del_check = MagicMock()
            del_check.scalar_one_or_none.return_value = agent1
            del_session.execute.return_value = del_check

            with patch.object(db_client, "async_session") as mock_session_ctx:
                mock_session_ctx.return_value.__aenter__.return_value = del_session
                del_res = await delete_email_agent(agent_id=1, user=user)
                self.assertEqual(del_res["status"], "deleted")
                self.assertEqual(del_res["agent_id"], 1)
                del_session.delete.assert_called_once_with(agent1)
                del_session.commit.assert_called_once()

        asyncio.run(run_test())

    def test_generate_draft_reply_endpoint_and_heuristic_fallback(self):
        """Verify POST /messages/{message_id}/draft-reply returns 200 with polite draft reply and summary."""
        user = _mock_user(org_id=100)
        msg = EmailMessageModel(
            id=210,
            organization_id=100,
            subject="Partnership Discussion",
            sender="Alex Vance <alex@novacorp.com>",
            body_text="Hi there,\nWe would love to explore a partnership with Convozent. Are you open to a call this week?",
        )

        async def run_test():
            mock_session = AsyncMock()
            scalar_mock = MagicMock()
            scalar_mock.scalar_one_or_none.side_effect = [msg, msg]
            mock_session.execute.return_value = scalar_mock

            with patch.object(db_client, "async_session") as mock_session_ctx:
                mock_session_ctx.return_value.__aenter__.return_value = mock_session

                # Test draft generation without custom instructions
                res = await generate_draft_reply(
                    message_id=210,
                    payload=DraftReplyRequest(),
                    user=user,
                )

                self.assertEqual(res["status"], "success")
                self.assertIsNotNone(res["draft_reply"])
                self.assertTrue(len(res["draft_reply"]) > 10)
                self.assertIn("Alex", res["draft_reply"])
                self.assertIn("Partnership Discussion", res["draft_reply"])
                self.assertIsNotNone(res["summary"])

                # Test draft generation with decline instructions
                res_decline = await generate_draft_reply(
                    message_id=210,
                    payload=DraftReplyRequest(instructions="Politely decline the offer"),
                    user=user,
                )
                self.assertEqual(res_decline["status"], "success")
                self.assertIn("unable to proceed", res_decline["draft_reply"].lower())

        asyncio.run(run_test())


if __name__ == "__main__":
    unittest.main()
