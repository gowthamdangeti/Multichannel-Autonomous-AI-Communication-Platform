"""ARQ job: evaluate a finished chat conversation's completeness."""

from api.services.chat.auto_evaluation import evaluate_chat_conversation


async def evaluate_chat_conversation_job(_ctx, conversation_id: int, organization_id: int) -> None:
    await evaluate_chat_conversation(conversation_id, organization_id)
