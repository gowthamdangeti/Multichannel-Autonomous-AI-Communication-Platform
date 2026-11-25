"""What a visitor can do to a reply from the widget: rate it, or ask for it again.

Both act on the stored transcript by message index (the position the widget
was given), never by content, so two identical replies are never confused.
"""

from __future__ import annotations

from typing import Optional

from api.db import db_client
from api.db.models import ChatAgentModel, ChatConversationModel
from api.services.chat.reply import ChatReplyFailure, generate_chat_reply
from api.services.chat.transcript import is_live

FEEDBACK_VALUES = ("like", "dislike")


class ChatActionError(Exception):
    """A request the conversation cannot honour; carries the HTTP status for the route."""

    def __init__(self, status_code: int, detail: str):
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


async def rate_reply(convo: ChatConversationModel, index: int, value: Optional[str]) -> list[dict]:
    """Set (or clear, with None) the visitor's rating of one agent reply."""
    if value is not None and value not in FEEDBACK_VALUES:
        raise ChatActionError(422, "Feedback must be 'like', 'dislike' or null")
    messages = list(convo.messages or [])
    if not 0 <= index < len(messages) or not is_live(messages[index]) or messages[index].get("role") != "assistant":
        raise ChatActionError(404, "No such reply")
    rated = dict(messages[index])
    if value is None:
        rated.pop("feedback", None)
    else:
        rated["feedback"] = value
    messages[index] = rated
    await db_client.replace_chat_transcript(convo.session_token, messages, keep_activity_time=True)
    return messages


async def retry_last_reply(agent: ChatAgentModel, convo: ChatConversationModel) -> list[dict]:
    """Ask the model again for the reply to the visitor's latest message.

    The reply being replaced is kept and marked ``superseded``: it is hidden from
    the dialogue but its reported usage still counts. If the new attempt fails,
    nothing changes and the caller reports the failure.
    """
    if convo.end_reason == "completed":
        raise ChatActionError(409, "This conversation has ended. Start a new chat to continue.")
    messages = list(convo.messages or [])
    live = [i for i, m in enumerate(messages) if is_live(m)]
    last_user = next((i for i in reversed(live) if messages[i].get("role") == "user"), None)
    if last_user is None:
        raise ChatActionError(409, "There is no message to reply to yet.")

    history = [messages[i] for i in live if i < last_user]
    reply = await generate_chat_reply(agent, history, messages[last_user]["content"])
    if isinstance(reply, ChatReplyFailure):
        raise ChatActionError(502, "The assistant could not reply right now. Please try again.")

    for i in live:
        if i > last_user and messages[i].get("role") == "assistant":
            messages[i] = {**messages[i], "superseded": True}
    messages.append(reply.as_message())
    await db_client.replace_chat_transcript(convo.session_token, messages, last_error=None)
    return messages
