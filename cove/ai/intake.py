"""Natural-language intake (ADR 0002 — Sonnet tier).

The user types what they want ("grab the new Frieren episodes in German sub, and
this playlist as audio"). Claude returns structured candidates; Cove then runs
each candidate through the adapter layer so playlists/series/feeds get expanded
into concrete downloadable Items exactly as the manual New Download flow does.
"""

from .. import adapters, config
from . import client

_TOOL = {
    "name": "propose_downloads",
    "description": "Extract concrete download requests from the user's message.",
    "input_schema": {
        "type": "object",
        "properties": {
            "candidates": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "url": {"type": "string", "description": "A URL from the message."},
                        "title": {"type": ["string", "null"]},
                        "kind": {"type": "string", "enum": ["file", "video", "audio"]},
                        "quality": {"type": ["string", "null"],
                                    "description": "e.g. '1080' to cap height, else null."},
                        "library": {"type": ["string", "null"],
                                    "enum": ["Movies", "TV", "Anime", "Music", "Files", None]},
                        "expand": {"type": "boolean",
                                   "description": "True if the URL is a series/playlist/feed "
                                                  "that Cove should enumerate."},
                        "settings": {"type": "object",
                                     "description": "Per-source hints: language, hoster order, etc.",
                                     "additionalProperties": True},
                    },
                    "required": ["url", "kind", "expand"],
                },
            },
            "note": {"type": "string",
                     "description": "One short sentence summarizing what you queued, for the user."},
        },
        "required": ["candidates"],
    },
}

_SYSTEM = (
    "You turn a user's plain-language download request into structured candidates "
    "for Cove, a self-hosted media acquisition tool. Only include URLs actually "
    "present in the message — never invent links. Mark a candidate expand=true when "
    "the URL is a playlist, RSS feed, or a series/season page (e.g. aniworld.to) that "
    "should be enumerated into episodes; false for a single file or video. Put "
    "language or hoster preferences into settings (e.g. {\"language\":\"German Sub\"})."
)


def _item_dict(url, kind="file", title=None, quality=None, library=None,
               dest_rel=None, filename=None, needs_resolve=False, resolver_hint=None):
    return {"url": url, "kind": kind, "title": title, "quality": quality,
            "library": library, "dest_rel": dest_rel, "filename": filename,
            "needs_resolve": needs_resolve, "resolver_hint": resolver_hint}


def plan(text: str) -> dict:
    """Return {items: [...queueable dicts...], note: str}. Raises AIError if unavailable.

    Expands series/playlist candidates through the adapter layer; leaves single
    links as one item each. Never queues — the caller confirms first.
    """
    out = client.call_tool(config.MODEL_SMART, _SYSTEM, text, _TOOL, max_tokens=2048)
    items: list[dict] = []
    for c in out.get("candidates", []):
        url = c.get("url")
        if not url:
            continue
        settings = c.get("settings") or {}
        if c.get("library"):
            settings.setdefault("library", c["library"])
        if c.get("expand"):
            Adapter = adapters.detect(url)
            if Adapter:
                try:
                    for it in Adapter().enumerate(url, settings):
                        d = it.to_dict()
                        d.setdefault("library", c.get("library"))
                        items.append(d)
                    continue
                except Exception:
                    pass  # fall through to a single-item candidate
        items.append(_item_dict(
            url, c.get("kind", "file"), c.get("title"), c.get("quality"),
            c.get("library"),
        ))
    return {"items": items, "note": out.get("note", "")}
