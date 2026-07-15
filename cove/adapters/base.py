"""Adapter base types."""

from dataclasses import dataclass, field, asdict


@dataclass
class Item:
    """One enumerable, downloadable thing an Adapter found."""
    title: str
    url: str                       # concrete URL, or a streamhoster embed if needs_resolve
    kind: str = "file"             # file | video | audio
    quality: str | None = None
    library: str | None = None     # top-level bucket (Movies/TV/Anime/Files)
    dest_rel: str | None = None    # Plex/Jellyfin-style subpath within the library
    filename: str | None = None
    needs_resolve: bool = False    # True → url is a streamhoster embed; resolve before download
    resolver_hint: str | None = None  # e.g. "voe" / "filemoon" — which resolver plugin to try
    meta: dict = field(default_factory=dict)  # season/episode/language/etc.

    def to_dict(self) -> dict:
        return asdict(self)


class Adapter:
    """Base class. Subclasses set `type` and implement enumerate()."""

    type: str = "base"

    @classmethod
    def detect(cls, url: str) -> bool:
        """Return True if this adapter recognizes the URL/path. Override."""
        return False

    def enumerate(self, target: str, settings: dict | None = None) -> list[Item]:
        """Given a URL/path (or a Source's detail), return downloadable Items.
        `settings` carries per-source preferences (hoster order, language, quality).
        """
        raise NotImplementedError
