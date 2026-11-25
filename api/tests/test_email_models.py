"""Tests for email automation models and relationships."""

import unittest

from api.db.models import (
    EmailAIRunModel,
    EmailAgentModel,
    EmailAttachmentModel,
    EmailDigestModel,
    EmailFollowUpModel,
    EmailMessageModel,
    EmailRuleActionModel,
    EmailRuleConditionModel,
    EmailRuleExecutionModel,
    EmailRuleModel,
    GmailAccountModel,
    OutlookAccountModel,
)


class TestEmailModels(unittest.TestCase):
    def test_email_model_declarations(self):
        """Verify all 12 models are properly mapped with correct table names."""
        self.assertEqual(GmailAccountModel.__tablename__, "gmail_accounts")
        self.assertEqual(OutlookAccountModel.__tablename__, "outlook_accounts")
        self.assertEqual(EmailAgentModel.__tablename__, "email_agents")
        self.assertEqual(EmailMessageModel.__tablename__, "email_messages")
        self.assertEqual(EmailAIRunModel.__tablename__, "email_ai_runs")
        self.assertEqual(EmailRuleModel.__tablename__, "email_rules")
        self.assertEqual(EmailRuleConditionModel.__tablename__, "email_rule_conditions")
        self.assertEqual(EmailRuleActionModel.__tablename__, "email_rule_actions")
        self.assertEqual(EmailRuleExecutionModel.__tablename__, "email_rule_executions")
        self.assertEqual(EmailFollowUpModel.__tablename__, "email_followups")
        self.assertEqual(EmailAttachmentModel.__tablename__, "email_attachments")
        self.assertEqual(EmailDigestModel.__tablename__, "email_digests")

    def test_email_message_triage_columns(self):
        """Verify triage and classification columns exist on EmailMessageModel."""
        cols = {c.name for c in EmailMessageModel.__table__.columns}
        self.assertIn("ai_category", cols)
        self.assertIn("ai_priority", cols)
        self.assertIn("is_read", cols)
        self.assertIn("is_archived", cols)
        self.assertIn("provider", cols)
        self.assertIn("gmail_labels", cols)
        self.assertIn("headers", cols)

    def test_email_rule_relationships(self):
        """Verify EmailRuleModel relationships to conditions, actions, executions."""
        rule = EmailRuleModel(
            organization_id=1,
            name="Test Rule",
            natural_language_prompt="Archive newsletters",
        )
        condition = EmailRuleConditionModel(
            field="category",
            operator="equals",
            value="newsletter",
        )
        action = EmailRuleActionModel(
            action_type="archive",
            parameters={"label": "Newsletters"},
        )
        rule.conditions.append(condition)
        rule.actions.append(action)

        self.assertEqual(len(rule.conditions), 1)
        self.assertEqual(rule.conditions[0].field, "category")
        self.assertEqual(len(rule.actions), 1)
        self.assertEqual(rule.actions[0].action_type, "archive")

    def test_email_followup_relationship(self):
        """Verify EmailFollowUpModel relationship with EmailMessageModel."""
        msg = EmailMessageModel(
            organization_id=1,
            gmail_message_id="msg_123",
            subject="Interview Invitation",
        )
        followup = EmailFollowUpModel(
            organization_id=1,
            status="needs_reply",
            suggested_followup="Thank you for the invitation...",
        )
        msg.followup = followup
        self.assertEqual(msg.followup.status, "needs_reply")

    def test_email_attachment_relationship(self):
        """Verify EmailAttachmentModel relationship with EmailMessageModel."""
        msg = EmailMessageModel(
            organization_id=1,
            gmail_message_id="msg_456",
            subject="Invoice attached",
        )
        att = EmailAttachmentModel(
            organization_id=1,
            filename="invoice.pdf",
            content_type="application/pdf",
            file_size=1024,
            storage_path="email-attachments/1/invoice.pdf",
        )
        msg.attachments.append(att)
        self.assertEqual(len(msg.attachments), 1)
        self.assertEqual(msg.attachments[0].filename, "invoice.pdf")


if __name__ == "__main__":
    unittest.main()
