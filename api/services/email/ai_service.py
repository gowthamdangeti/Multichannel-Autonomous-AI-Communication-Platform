"""AI Email Processing Service.

Provides LLM-driven email classification, summarization, key points extraction,
reply generation, and follow-up detection with structured Pydantic validation
and prompt-injection defenses.
"""

from __future__ import annotations

import json
import os
import re
from typing import Any, Dict, List, Optional

from loguru import logger
from openai import AsyncOpenAI
from pydantic import BaseModel, Field
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from api.db.models import (
    EmailAgentModel,
    EmailAIRunModel,
    EmailFollowUpModel,
    EmailMessageModel,
    GmailAccountModel,
    OutlookAccountModel,
)
from api.services.agents_llm import openai_params as _openai_params
from api.services.configuration.ai_model_configuration import (
    get_effective_ai_model_configuration_for_workflow,
)
from api.services.gen_ai.temperature import create_chat_completion

VALID_CATEGORIES = {
    "important",
    "work",
    "personal",
    "job_opportunity",
    "marketing",
    "newsletter",
    "notifications",
    "finance",
    "spam",
}

VALID_PRIORITIES = {"high", "medium", "low"}


class EmailClassificationResult(BaseModel):
    """Structured classification result."""
    category: str = Field(..., description="Classification category")
    priority: str = Field("medium", description="Urgency/priority: high, medium, or low")
    confidence: float = Field(1.0, ge=0.0, le=1.0)
    reasoning: str = Field("", description="Short explanation for classification")


class EmailAnalysisResult(BaseModel):
    """Full structured email analysis result."""
    summary: str = Field(..., description="Concise 1-3 sentence summary of the email")
    key_points: List[str] = Field(default_factory=list, description="Key action items or facts")
    needs_reply: bool = Field(False, description="Whether the sender is asking for or expecting a response")
    awaiting_reply: bool = Field(False, description="Whether this is our sent email awaiting response")
    suggested_action: str = Field("", description="Recommended next action (e.g. reply, archive, review invoice)")
    draft_reply: Optional[str] = Field(None, description="Contextual polite draft reply if a response is appropriate")


def sanitize_email_content(content: Optional[str], max_length: int = 8000) -> str:
    """Sanitize and constrain email content to defend against prompt injection."""
    if not content:
        return ""
    # Strip potential dangerous control characters while preserving readable text
    cleaned = re.sub(r"[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]", "", content)
    # Neutralize prompt injection markers such as System: or Assistant:
    cleaned = re.sub(r"(?i)\b(system|assistant|human|user)\s*:\s*", r"[\1]: ", cleaned)
    return cleaned[:max_length].strip()


def extract_sender_first_name(sender: Optional[str]) -> str:
    """Extract a friendly first name or fallback title from an email sender string."""
    if not sender:
        return "there"
    # Format: "John Doe <john@example.com>" or "john@example.com"
    clean = sender.split("<")[0].strip().strip('"').strip("'")
    if clean and "@" not in clean:
        parts = clean.split()
        if parts:
            return parts[0].capitalize()
    return "there"


def build_heuristic_draft(
    sender: Optional[str],
    subject: Optional[str],
    body_text: Optional[str],
    instructions: Optional[str] = None,
) -> str:
    """Build a courteous, high-quality fallback draft reply."""
    name = extract_sender_first_name(sender)
    clean_sub = (subject or "").strip()
    topic = f" regarding '{clean_sub}'" if clean_sub else ""
    instr_lower = (instructions or "").lower()

    if any(k in instr_lower for k in ["decline", "reject", "cannot", "can't", "no"]):
        body = (
            f"Thank you for reaching out{topic}.\n\n"
            "I appreciate the opportunity and details provided; however, I am unable to proceed with this at this time.\n\n"
            "Thank you again for your understanding, and I wish you all the best."
        )
    elif any(k in instr_lower for k in ["reschedule", "later", "busy", "postpone", "next week"]):
        body = (
            f"Thank you for your email{topic}.\n\n"
            "I am currently unavailable at the proposed time. Could we please reschedule this for sometime next week?\n\n"
            "Please let me know a few time windows that work best for your schedule."
        )
    elif any(k in instr_lower for k in ["confirm", "accept", "yes", "agree", "sounds good"]):
        body = (
            f"Thank you for following up{topic}.\n\n"
            "I would like to confirm that this works well for me. Let's proceed as planned.\n\n"
            "Looking forward to working together."
        )
    elif instructions and instructions.strip():
        body = (
            f"Thank you for your message{topic}.\n\n"
            f"Regarding your inquiry, {instructions.strip().rstrip('.')}.\n\n"
            "Please let me know if you need any additional details."
        )
    else:
        body = (
            f"Thank you for reaching out{topic}.\n\n"
            "I have received your email and am reviewing the details. I will get back to you with an update shortly.\n\n"
            "Please let me know if you have any questions in the meantime."
        )

    return f"Hi {name},\n\n{body}\n\nBest regards,"


def build_fallback_analysis(
    subject: Optional[str],
    sender: Optional[str],
    body_text: Optional[str],
    instructions: Optional[str] = None,
) -> EmailAnalysisResult:
    """Construct a clean, resilient heuristic analysis and draft reply."""
    clean_body = (body_text or "").strip()
    clean_sub = (subject or "").strip()

    sentences = [s.strip() for s in re.split(r"(?<=[.!?])\s+", clean_body) if s.strip()]
    if sentences:
        summary_text = " ".join(sentences[:2])
        if len(summary_text) > 300:
            summary_text = summary_text[:297] + "..."
    elif clean_sub:
        summary_text = f"Email concerning '{clean_sub}' received from {sender or 'sender'}."
    else:
        summary_text = "Email received."

    key_points: List[str] = []
    action_words = ("please", "attached", "meeting", "invoice", "deadline", "confirm", "review", "schedule")
    for s in sentences:
        if any(w in s.lower() for w in action_words):
            if len(s) < 160:
                key_points.append(s)
        if len(key_points) >= 3:
            break
    if not key_points and clean_sub:
        key_points.append(f"Subject: {clean_sub}")

    needs_reply = bool(
        "?" in clean_body
        or any(w in clean_body.lower() for w in ["let me know", "could you", "please confirm", "can you", "waiting for your response"])
    )

    suggested_action = "Reply to sender" if needs_reply else "Review email contents"
    draft_reply = build_heuristic_draft(sender, subject, body_text, instructions)

    return EmailAnalysisResult(
        summary=summary_text,
        key_points=key_points,
        needs_reply=needs_reply,
        awaiting_reply=False,
        suggested_action=suggested_action,
        draft_reply=draft_reply,
    )


def _fallback_classification(safe_subject: str, safe_body: str) -> EmailClassificationResult:
    """Rule-based keyword fallback classifier."""
    cat = "work"
    sub_lower = (safe_subject or "").lower()
    if any(w in sub_lower for w in ["interview", "job", "career", "offer", "recruiter"]):
        cat = "job_opportunity"
    elif any(w in sub_lower for w in ["unsubscribe", "sale", "% off", "discount", "deal"]):
        cat = "marketing"
    elif any(w in sub_lower for w in ["invoice", "receipt", "payment", "billing"]):
        cat = "finance"
    elif any(w in sub_lower for w in ["alert", "notification", "security", "verify"]):
        cat = "notifications"
    return EmailClassificationResult(
        category=cat,
        priority="medium",
        confidence=0.5,
        reasoning="Heuristic keyword classification",
    )


async def get_email_llm_client(
    organization_id: int,
    model_config_ref: Optional[dict] = None,
) -> tuple[AsyncOpenAI, str, bool]:
    """Resolve the organization's configured LLM and return (AsyncOpenAI client, model_name, is_valid)."""
    api_key = None
    base_url = None
    model_name = "gpt-4o-mini"

    try:
        model_config = await get_effective_ai_model_configuration_for_workflow(
            user_id=None,
            organization_id=organization_id,
            workflow_configurations=model_config_ref or {},
        )
        llm = getattr(model_config, "llm", None)
        if llm:
            base_url, model_name, api_key = _openai_params(llm)
    except Exception as exc:
        logger.warning(f"Error resolving model configuration for org {organization_id}: {exc}")

    # Fallback to environment variables if no org preset key
    if not api_key or api_key == "noop":
        if os.environ.get("OPENAI_API_KEY"):
            api_key = os.environ["OPENAI_API_KEY"]
            base_url = None
            model_name = model_name if model_name and model_name != "default" else "gpt-4o-mini"
        elif os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY"):
            api_key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
            base_url = "https://generativelanguage.googleapis.com/v1beta/openai/"
            model_name = "gemini-1.5-flash"
        elif os.environ.get("GROQ_API_KEY"):
            api_key = os.environ["GROQ_API_KEY"]
            base_url = "https://api.groq.com/openai/v1"
            model_name = "llama-3.3-70b-versatile"

    is_valid = bool(api_key and api_key.strip() and api_key != "noop")
    client = AsyncOpenAI(
        api_key=api_key or "noop",
        base_url=base_url,
        timeout=30.0,
    )
    return client, model_name or "gpt-4o-mini", is_valid


async def classify_email_content(
    organization_id: int,
    subject: Optional[str],
    sender: Optional[str],
    body_text: Optional[str],
    model_config_ref: Optional[dict] = None,
) -> EmailClassificationResult:
    """Classify an email into standard Inbox Zero categories."""
    safe_subject = sanitize_email_content(subject, 500)
    safe_sender = sanitize_email_content(sender, 200)
    safe_body = sanitize_email_content(body_text, 4000)

    try:
        client, model_name, api_key_valid = await get_email_llm_client(
            organization_id, model_config_ref=model_config_ref
        )
        if not api_key_valid or client is None:
            return _fallback_classification(safe_subject, safe_body)

        prompt = f"""You are an expert AI email classifier.
Analyze the following email metadata and content. Classify it strictly into ONE category and assign an urgency priority.

Categories allowed:
- important: critical announcements, urgent requests, high-value contracts
- work: professional communications, project updates, colleagues
- personal: friends, family, personal conversations
- job_opportunity: recruiter inquiries, interviews, job offers, hiring
- marketing: product promotions, discounts, sales pitches
- newsletter: blog digests, industry newsletters, subscribed articles
- notifications: automated system alerts, receipts, password resets, shipping updates
- finance: bank statements, bills, invoices, tax documents
- spam: unsolicited scams, phishing, suspicious requests

Priorities allowed: high, medium, low

<EMAIL_METADATA>
Sender: {safe_sender}
Subject: {safe_subject}
</EMAIL_METADATA>

<EMAIL_BODY>
{safe_body}
</EMAIL_BODY>

Respond ONLY with a valid JSON object matching this schema:
{{
  "category": "one of the allowed categories above",
  "priority": "high | medium | low",
  "confidence": 0.95,
  "reasoning": "short reason"
}}
"""
        response = await create_chat_completion(client,
            model=model_name,
            messages=[
                {"role": "system", "content": "You are a secure, precision email classifier. Output JSON only."},
                {"role": "user", "content": prompt},
            ],
            response_format={"type": "json_object"},
            temperature=0.1,
        )
        content = response.choices[0].message.content or "{}"
        data = json.loads(content)
        category = str(data.get("category", "work")).lower()
        if category not in VALID_CATEGORIES:
            category = "work"
        priority = str(data.get("priority", "medium")).lower()
        if priority not in VALID_PRIORITIES:
            priority = "medium"

        return EmailClassificationResult(
            category=category,
            priority=priority,
            confidence=float(data.get("confidence", 0.9)),
            reasoning=str(data.get("reasoning", "")),
        )
    except Exception as exc:
        logger.warning(f"AI email classification failed, using heuristic fallback: {exc}")
        return _fallback_classification(safe_subject, safe_body)


async def analyze_and_draft_reply(
    organization_id: int,
    subject: Optional[str],
    sender: Optional[str],
    body_text: Optional[str],
    system_prompt: Optional[str] = None,
    instructions: Optional[str] = None,
    model_config_ref: Optional[dict] = None,
) -> EmailAnalysisResult:
    """Summarize the email, extract key points, determine follow-up status, and generate a draft reply."""
    safe_subject = sanitize_email_content(subject, 500)
    safe_sender = sanitize_email_content(sender, 200)

    combined_body = body_text or ""
    if instructions and instructions.strip():
        combined_body += f"\n\n[User Draft Instructions]: {instructions.strip()}"
    safe_body = sanitize_email_content(combined_body, 6000)

    agent_instructions = sanitize_email_content(
        system_prompt or "Be polite, helpful, and professional in all email replies.", 1000
    )

    try:
        client, model_name, api_key_valid = await get_email_llm_client(
            organization_id, model_config_ref=model_config_ref
        )
        if not api_key_valid or client is None:
            logger.info(
                f"No active LLM API key configured for org {organization_id}; using heuristic analysis and drafting."
            )
            return build_fallback_analysis(subject, sender, body_text, instructions)

        prompt = f"""You are an executive AI email assistant.
Analyze the email content below. Produce a concise summary, extract actionable key points, check if it needs a response, suggest the best next action, and draft an appropriate reply.

Assistant Instructions:
{agent_instructions}

<EMAIL_METADATA>
Sender: {safe_sender}
Subject: {safe_subject}
</EMAIL_METADATA>

<EMAIL_BODY>
{safe_body}
</EMAIL_BODY>

Respond ONLY with a valid JSON object matching this schema:
{{
  "summary": "Concise 1-3 sentence summary",
  "key_points": ["bullet point 1", "bullet point 2"],
  "needs_reply": true or false,
  "awaiting_reply": false,
  "suggested_action": "e.g. Reply to confirm meeting time",
  "draft_reply": "Polite, contextual draft reply text"
}}
"""
        response = await create_chat_completion(client,
            model=model_name,
            messages=[
                {"role": "system", "content": "You are a professional executive email assistant. Output JSON only."},
                {"role": "user", "content": prompt},
            ],
            response_format={"type": "json_object"},
            temperature=0.3,
        )
        content = response.choices[0].message.content or "{}"
        data = json.loads(content)

        draft = data.get("draft_reply")
        if not draft or not str(draft).strip():
            draft = build_heuristic_draft(sender, subject, body_text, instructions)

        return EmailAnalysisResult(
            summary=str(data.get("summary") or "Email received."),
            key_points=list(data.get("key_points") or []),
            needs_reply=bool(data.get("needs_reply", False)),
            awaiting_reply=bool(data.get("awaiting_reply", False)),
            suggested_action=str(data.get("suggested_action") or "Review message"),
            draft_reply=draft,
        )
    except Exception as exc:
        logger.error(f"AI email analysis failed: {exc}, using fallback analysis")
        return build_fallback_analysis(subject, sender, body_text, instructions)


async def process_email_ai_pipeline(
    session: AsyncSession,
    message: EmailMessageModel,
    system_prompt: Optional[str] = None,
    email_agent_id: Optional[int] = None,
    model_config_ref: Optional[dict] = None,
) -> EmailAIRunModel:
    """Run full AI pipeline on an EmailMessageModel: classification, triage, analysis, and follow-up tracking."""
    # Resolve associated EmailAgent if not specified
    matched_agent = None
    if email_agent_id:
        agent_stmt = select(EmailAgentModel).where(EmailAgentModel.id == email_agent_id)
        matched_agent = (await session.execute(agent_stmt)).scalar_one_or_none()
    elif message.gmail_account_id or message.outlook_account_id:
        try:
            agent_conds = []
            if message.gmail_account_id:
                agent_conds.append(EmailAgentModel.gmail_account_id == message.gmail_account_id)
            if message.outlook_account_id:
                agent_conds.append(EmailAgentModel.outlook_account_id == message.outlook_account_id)
            if agent_conds:
                agent_stmt = (
                    select(EmailAgentModel)
                    .where(
                        EmailAgentModel.organization_id == message.organization_id,
                        or_(*agent_conds),
                    )
                    .limit(1)
                )
                agent_res = await session.execute(agent_stmt)
                matched_agent = agent_res.scalar_one_or_none()
                if matched_agent:
                    email_agent_id = matched_agent.id
                    if not system_prompt:
                        system_prompt = matched_agent.system_prompt
                    if not model_config_ref:
                        model_config_ref = matched_agent.model_config_ref
        except Exception as exc:
            logger.debug(f"Could not auto-resolve agent for message {message.id}: {exc}")

    # 1. Run Classification
    classification = await classify_email_content(
        organization_id=message.organization_id,
        subject=message.subject,
        sender=message.sender,
        body_text=message.body_text,
        model_config_ref=model_config_ref,
    )
    message.ai_category = classification.category
    message.ai_priority = classification.priority

    # 2. Run Analysis & Drafting
    analysis = await analyze_and_draft_reply(
        organization_id=message.organization_id,
        subject=message.subject,
        sender=message.sender,
        body_text=message.body_text,
        system_prompt=system_prompt,
        model_config_ref=model_config_ref,
    )

    # 3. Create or update EmailAIRunModel
    run_stmt = select(EmailAIRunModel).where(
        EmailAIRunModel.email_message_id == message.id,
    )
    if email_agent_id:
        run_stmt = run_stmt.where(EmailAIRunModel.email_agent_id == email_agent_id)
    else:
        run_stmt = run_stmt.where(EmailAIRunModel.email_agent_id.is_(None))

    existing_run = (await session.execute(run_stmt.limit(1))).scalar_one_or_none()
    if existing_run:
        existing_run.summary = analysis.summary
        existing_run.draft_reply = analysis.draft_reply
        existing_run.key_points = analysis.key_points
        existing_run.suggested_action = analysis.suggested_action
        existing_run.status = "completed"
        run = existing_run
    else:
        run = EmailAIRunModel(
            organization_id=message.organization_id,
            email_message_id=message.id,
            email_agent_id=email_agent_id,
            summary=analysis.summary,
            draft_reply=analysis.draft_reply,
            key_points=analysis.key_points,
            suggested_action=analysis.suggested_action,
            status="completed",
            auto_send_status="none",
        )
        session.add(run)

    # 4. Reply Zero Follow-up Tracking
    if analysis.needs_reply or analysis.awaiting_reply:
        status = "needs_reply" if analysis.needs_reply else "awaiting_reply"
        fu_stmt = select(EmailFollowUpModel).where(
            EmailFollowUpModel.email_message_id == message.id
        )
        existing_fu = (await session.execute(fu_stmt.limit(1))).scalar_one_or_none()
        if existing_fu:
            existing_fu.status = status
            existing_fu.suggested_followup = analysis.draft_reply
            existing_fu.last_contact_at = message.internal_date
        else:
            followup = EmailFollowUpModel(
                organization_id=message.organization_id,
                email_message_id=message.id,
                thread_id=message.gmail_thread_id,
                status=status,
                suggested_followup=analysis.draft_reply,
                last_contact_at=message.internal_date,
            )
            session.add(followup)

    # 5. Autonomous Auto-Reply Execution (if enabled for agent)
    if (
        matched_agent
        and matched_agent.is_active
        and matched_agent.auto_reply_enabled
        and analysis.draft_reply
    ):
        # 5a. Deduplication check: Has an auto-reply already been sent (or in-flight) for this message?
        sent_check_stmt = select(EmailAIRunModel.id).where(
            EmailAIRunModel.email_message_id == message.id,
            EmailAIRunModel.auto_send_status.in_(["sent", "sending"]),
        )
        if run.id:
            sent_check_stmt = sent_check_stmt.where(EmailAIRunModel.id != run.id)
        already_replied = (await session.execute(sent_check_stmt.limit(1))).scalar_one_or_none()

        sender_match = re.search(r"[\w\.-]+@[\w\.-]+\.\w+", message.sender or "")
        clean_sender = sender_match.group(0).lower() if sender_match else ""

        mailbox_email = ""
        gmail_acc = None
        outlook_acc = None
        if message.gmail_account_id:
            g_res = await session.execute(
                select(GmailAccountModel).where(GmailAccountModel.id == message.gmail_account_id)
            )
            gmail_acc = g_res.scalar_one_or_none()
            if gmail_acc:
                mailbox_email = (gmail_acc.email or "").strip().lower()
        elif message.outlook_account_id:
            o_res = await session.execute(
                select(OutlookAccountModel).where(OutlookAccountModel.id == message.outlook_account_id)
            )
            outlook_acc = o_res.scalar_one_or_none()
            if outlook_acc:
                mailbox_email = (outlook_acc.email or "").strip().lower()

        is_sent_folder = bool(
            message.gmail_labels and any(lbl.upper() in ("SENT", "DRAFT") for lbl in message.gmail_labels)
        )
        is_loop = bool(clean_sender and mailbox_email and clean_sender == mailbox_email)
        is_automated = any(
            kw in clean_sender
            for kw in [
                "noreply",
                "no-reply",
                "mailer-daemon",
                "notifications@",
                "donotreply",
                "auto-reply",
                "postmaster@",
                "bounce",
            ]
        )
        is_spam = classification.category in ("spam", "notifications", "marketing")

        if already_replied or run.auto_send_status == "sent":
            logger.info(
                f"[AutoReply] Skipped duplicate reply for message={message.id}: already replied or in-flight (run={already_replied or run.id})"
            )
        elif is_sent_folder:
            logger.info(
                f"[AutoReply] Skipped reply for message={message.id}: message is from SENT/DRAFT folder"
            )
        elif not clean_sender or is_loop or is_automated or is_spam:
            logger.info(
                f"[AutoReply] Skipped reply for message={message.id} (clean_sender={clean_sender}, is_loop={is_loop}, is_automated={is_automated}, category={classification.category})"
            )
        else:
            # Mark status as 'sending' and commit before dispatching to hold mutex against parallel tasks
            run.auto_send_status = "sending"
            await session.commit()

            logger.info(
                f"[AutoReply] Dispatching AI reply for message={message.id} from={mailbox_email} to={clean_sender} via agent '{matched_agent.name}'"
            )
            try:
                if message.gmail_account_id and gmail_acc:
                    from api.services.email.gmail_sync import send_gmail_reply

                    await send_gmail_reply(
                        session=session,
                        account=gmail_acc,
                        to_email=clean_sender,
                        subject=message.subject or "Re: Your message",
                        body_text=analysis.draft_reply,
                        thread_id=message.gmail_thread_id,
                        in_reply_to_message_id=message.gmail_message_id,
                    )
                    run.auto_send_status = "sent"
                    run.sent_at = datetime.now(UTC)
                elif message.outlook_account_id and outlook_acc:
                    from api.services.email.outlook_sync import send_outlook_reply

                    await send_outlook_reply(
                        session=session,
                        account=outlook_acc,
                        to_email=clean_sender,
                        subject=message.subject or "Re: Your message",
                        body_text=analysis.draft_reply,
                        outlook_message_id=message.gmail_message_id,
                    )
                    run.auto_send_status = "sent"
                    run.sent_at = datetime.now(UTC)
            except Exception as send_err:
                logger.error(
                    f"[AutoReply] Failed to dispatch auto-reply for message {message.id}: {send_err}"
                )
                run.auto_send_status = "failed"
                run.send_error = str(send_err)

    await session.commit()
    return run

