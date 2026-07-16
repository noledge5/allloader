"""Adapters turn a Source or a pasted URL into Proposals (each with its Variants).

Each Adapter handles one kind of origin (direct link, YouTube, RSS, watch-folder,
aniworld/streamhoster page). The registry picks one by explicit type or by
detecting the URL. Aniworld additionally leans on the Resolver layer.
"""

from .base import Adapter, Proposal, Variant
from .direct import DirectAdapter
from .rss import RssAdapter
from .youtube import YouTubeAdapter
from .watchfolder import WatchFolderAdapter
from .aniworld import AniworldAdapter

# Order matters for detect(): most specific first, direct last (catch-all).
_ADAPTERS: list[type[Adapter]] = [
    AniworldAdapter,
    YouTubeAdapter,
    RssAdapter,
    WatchFolderAdapter,
    DirectAdapter,
]

_BY_TYPE = {a.type: a for a in _ADAPTERS}


def get_adapter(type_: str) -> type[Adapter] | None:
    return _BY_TYPE.get(type_)


def detect(url: str) -> type[Adapter]:
    """Pick the adapter that best fits a URL/path. Always returns one
    (DirectAdapter is the catch-all)."""
    for a in _ADAPTERS:
        try:
            if a.detect(url):
                return a
        except Exception:
            continue
    return DirectAdapter


__all__ = ["Adapter", "Proposal", "Variant", "get_adapter", "detect", "_ADAPTERS"]
