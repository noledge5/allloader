"""RSS/Atom feed adapter — enumerates enclosures / media links from a feed using
the standard library (no third-party feed parser). Manual re-scan only.
"""

import urllib.request
import xml.etree.ElementTree as ET

from .base import Adapter, Proposal

_UA = "Cove/0.1"
_AUDIO = ("audio/", ".mp3", ".m4a", ".ogg", ".flac")
_VIDEO = ("video/", ".mp4", ".mkv", ".webm", ".mov")
_MEDIA_NS = "{http://search.yahoo.com/mrss/}"


class RssAdapter(Adapter):
    type = "rss"

    @classmethod
    def detect(cls, url: str) -> bool:
        u = url.lower()
        return u.endswith(".xml") or u.endswith(".rss") or "/rss" in u or "/feed" in u

    def enumerate(self, target: str, settings: dict | None = None) -> list[Proposal]:
        library = (settings or {}).get("library")
        req = urllib.request.Request(target, headers={"User-Agent": _UA})
        with urllib.request.urlopen(req, timeout=30) as r:
            root = ET.fromstring(r.read())
        out: list[Proposal] = []
        # RSS: channel/item ; Atom: feed/entry
        entries = root.findall(".//item") or root.findall(
            ".//{http://www.w3.org/2005/Atom}entry")
        for e in entries:
            link, kind = self._media(e)
            if not link:
                continue
            out.append(Proposal.single(title=self._title(e) or link, url=link,
                                       kind=kind, library=library))
        return out

    def _title(self, e):
        for tag in ("title", "{http://www.w3.org/2005/Atom}title"):
            el = e.find(tag)
            if el is not None and el.text:
                return el.text.strip()
        return None

    def _media(self, e) -> tuple[str | None, str]:
        # RSS <enclosure url= type=>
        enc = e.find("enclosure")
        if enc is not None and enc.get("url"):
            return enc.get("url"), self._kind(enc.get("url", "") + (enc.get("type") or ""))
        # media:content
        mc = e.find(f"{_MEDIA_NS}content")
        if mc is not None and mc.get("url"):
            return mc.get("url"), self._kind(mc.get("url", "") + (mc.get("type") or ""))
        # Atom <link rel="enclosure" href=>
        for ln in e.findall("{http://www.w3.org/2005/Atom}link"):
            if ln.get("rel") == "enclosure" and ln.get("href"):
                return ln.get("href"), self._kind(ln.get("href", "") + (ln.get("type") or ""))
        # plain <link>
        ln = e.find("link")
        if ln is not None and (ln.text or ln.get("href")):
            return (ln.text or ln.get("href")).strip(), "file"
        return None, "file"

    def _kind(self, hint: str) -> str:
        h = hint.lower()
        if any(a in h for a in _AUDIO):
            return "audio"
        if any(v in h for v in _VIDEO):
            return "video"
        return "file"
