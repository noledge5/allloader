"""Failure triage (ADR 0002 — Sonnet tier).

When a download fails — most often a streamhoster embed that no resolver could
crack — Claude explains the likely cause in plain language and suggests a next
action the user can actually take (try another hoster, install a resolver plugin,
paste a direct link). Read-only: it never changes state.
"""

from .. import config
from . import client

_SYSTEM = (
    "You are the troubleshooting assistant inside Cove, a self-hosted download "
    "manager. Given one failed download, explain in 2-3 sentences the most likely "
    "cause and the single best next step. Cove resolves streamhoster embeds (VOE, "
    "Doodstream, Filemoon, etc.) with pluggable resolver plugins plus a headless "
    "browser fallback; if none matched, say so and suggest trying a different hoster "
    "for that episode or adding a resolver plugin. Be concrete and brief. Never claim "
    "Cove bypasses DRM or paywalls."
)


def explain(download: dict) -> str:
    """Return a short human explanation for a failed download. Raises AIError."""
    fields = {
        "title": download.get("title"),
        "url": download.get("url"),
        "kind": download.get("kind"),
        "needs_resolve": download.get("needs_resolve"),
        "resolver_hint": download.get("resolver_hint"),
        "error": download.get("error"),
        "status": download.get("status"),
    }
    lines = "\n".join(f"{k}: {v}" for k, v in fields.items() if v is not None)
    return client.call_text(config.MODEL_SMART, _SYSTEM,
                            f"A download failed. Details:\n{lines}", max_tokens=400)
