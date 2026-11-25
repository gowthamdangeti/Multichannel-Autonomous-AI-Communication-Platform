"""ARQ job: title a chat conversation after the visitor's session ends."""

from api.services.chat.conversation_title import generate_chat_conversation_title


async def generate_chat_conversation_title_job(_ctx, conversation_id: int, organization_id: int) -> None:
    await generate_chat_conversation_title(conversation_id, organization_id)
