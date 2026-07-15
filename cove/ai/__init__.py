"""Claude-powered features (ADR 0002): natural-language intake, failure triage,
title cleanup, and a conversational control panel. Tiered models — Haiku for cheap
deterministic calls, Sonnet for reasoning, Opus as a manual escalation. Everything
degrades gracefully when no API key is configured.
"""

from .client import available, status, AIError
from . import intake, naming, triage, chat

__all__ = ["available", "status", "AIError", "intake", "naming", "triage", "chat"]
