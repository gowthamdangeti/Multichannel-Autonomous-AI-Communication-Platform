"""The live transcript of a chat conversation.

A reply the visitor asked to retry stays in the stored transcript, marked
``superseded``, so the tokens it cost are still counted. Everything that reads
the conversation as a dialogue (the model's history, the widget, the judge,
the titler) must skip it; usage and cost totals must not.
"""

from __future__ import annotations

from typing import Any, Iterable


def is_live(message: Any) -> bool:
    """A real message that is part of the dialogue (not a superseded retry)."""
    return isinstance(message, dict) and bool(message.get("role")) and not message.get("superseded")


def live_messages(messages: Iterable[Any]) -> list[dict]:
    return [m for m in messages or [] if is_live(m)]
