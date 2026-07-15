"""Facade over the AI provider backends.

The rest of the app imports from here so the api/cli backend split (provider.py)
stays invisible. Kept as a thin re-export to avoid churn at every call site.
"""

from .provider import (
    AIError,
    active_provider,
    available,
    call_json,
    call_text,
    complete,
    status,
)

__all__ = [
    "AIError", "active_provider", "available", "call_json",
    "call_text", "complete", "status",
]
