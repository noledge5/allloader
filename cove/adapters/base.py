"""Adapter base types.

An Adapter enumerates a Source into **Proposals** (CONTEXT.md) — not Downloads.
Each Proposal is one episode/item and carries every **Variant** the Adapter found
(a (Streamhoster, language) way to fetch it). Triage picks one Variant per Proposal
before anything becomes a Download.
"""

from dataclasses import dataclass, field, asdict


@dataclass
class Variant:
    """One concrete way to fetch a Proposal's episode."""
    url: str                          # concrete URL, or a streamhoster embed if needs_resolve
    language: str | None = None       # "German Dub" | "German Sub" | "English Sub" | None
    host: str | None = None           # streamhoster name (voe/…), or None for a direct link
    needs_resolve: bool = False       # True → url is a streamhoster embed to resolve first
    resolver_hint: str | None = None  # which Resolver to try (e.g. "voe")
    quality: str | None = None

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class Proposal:
    """One enumerated, not-yet-committed item with its available Variants."""
    title: str
    kind: str = "file"                # file | video | audio
    library: str | None = None        # top-level bucket (Movies/TV/Anime/Files)
    dest_rel: str | None = None       # Plex/Jellyfin-style subpath within the library
    filename: str | None = None
    variants: list[Variant] = field(default_factory=list)
    meta: dict = field(default_factory=dict)  # season/episode/series/etc.

    def to_dict(self) -> dict:
        return asdict(self)

    def languages(self) -> list[str]:
        """Distinct languages offered, in first-seen order (for the UI)."""
        seen: list[str] = []
        for v in self.variants:
            if v.language and v.language not in seen:
                seen.append(v.language)
        return seen

    @classmethod
    def single(cls, title, url, kind="file", quality=None, library=None,
               dest_rel=None, filename=None, needs_resolve=False,
               resolver_hint=None, language=None, host=None, meta=None):
        """A Proposal with exactly one Variant — for adapters that don't branch on
        streamhoster/language (direct link, YouTube, RSS, watch-folder)."""
        return cls(
            title=title, kind=kind, library=library, dest_rel=dest_rel,
            filename=filename, meta=meta or {},
            variants=[Variant(url=url, language=language, host=host,
                              needs_resolve=needs_resolve, resolver_hint=resolver_hint,
                              quality=quality)],
        )


class Adapter:
    """Base class. Subclasses set `type` and implement enumerate()."""

    type: str = "base"

    @classmethod
    def detect(cls, url: str) -> bool:
        """Return True if this adapter recognizes the URL/path. Override."""
        return False

    def enumerate(self, target: str, settings: dict | None = None) -> list[Proposal]:
        """Given a URL/path (or a Source's detail), return Proposals (each with its
        Variants). `settings` carries per-source preferences (hoster order, quality)."""
        raise NotImplementedError
