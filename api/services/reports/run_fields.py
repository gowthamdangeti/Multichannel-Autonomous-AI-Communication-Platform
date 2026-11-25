"""Read the loosely typed JSON columns of a workflow run."""

from typing import Any


def as_dict(value: Any) -> dict:
    return value if isinstance(value, dict) else {}
