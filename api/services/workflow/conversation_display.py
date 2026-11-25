"""Conversation display title — read-time fallback for APIs.

Rules (in order):
1. Embed runs (`Embed Run - ...`) → `{workflow_name}_embed`
2. Stored `conversation_title` → as-is
3. Otherwise → `{workflow_name} {name}` (e.g.
   "Aurubindo Pharma Case study WR-2217")

Lives in the `workflow` package (empty `__init__`, no heavy imports) so
`api/db/*` clients can import it without the circular import that
`api/services/reports/__init__.py` would trigger. Pure function, never raises.
"""

from __future__ import annotations

from typing import Any


def is_embed_run_name(run_name: Any) -> bool:
    """Voice embed runs are created as `Embed Run - <timestamp>` (public_embed)."""
    return isinstance(run_name, str) and run_name.strip().lower().startswith("embed run")


def resolve_display_title(
    conversation_title: Any,
    workflow_name: Any,
    run_name: Any,
) -> str | None:
    """Display title per the rules above. None only when everything is blank."""
    wname = workflow_name.strip() if isinstance(workflow_name, str) and workflow_name.strip() else ""
    rname = run_name.strip() if isinstance(run_name, str) and run_name.strip() else ""

    if wname and is_embed_run_name(rname):
        return f"{wname}_embed"
    if isinstance(conversation_title, str) and conversation_title.strip():
        return conversation_title.strip()
    if wname and rname:
        return f"{wname} {rname}"
    if wname:
        return wname
    if rname:
        return rname
    return None


__all__ = [
    "is_embed_run_name",
    "resolve_display_title",
]
