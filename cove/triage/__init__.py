"""Triage seam: pick one Variant per Proposal (or skip) before anything becomes a
Download. Two Selectors — deterministic policy and Claude — behind one interface.

`select()` dispatches to the configured Selector (Claude by default, falling back
to policy when Claude isn't set up).
"""

from .base import Selector
from .policy import PolicySelector
from .claude import ClaudeSelector

__all__ = ["Selector", "PolicySelector", "ClaudeSelector", "select"]


def select(proposals, settings=None, prefer="claude"):
    """Return one chosen Variant index (or None) per Proposal."""
    settings = settings or {}
    mode = settings.get("selector", prefer)
    selector = ClaudeSelector() if mode == "claude" else PolicySelector()
    return selector.select(proposals, settings)
