"""Aniworld adapter — parses an aniworld.to series/season/episode page to enumerate
episodes and the streamhosters each offers, then emits Items pointing at the chosen
streamhoster embed with `needs_resolve=True`.

Per ADR 0001 this file owns only the *page structure* parsing (which episodes exist,
which hosters/languages are offered, and aniworld's own /redirect indirection to the
embed URL). Turning a VOE/Doodstream/Filemoon embed into a concrete stream is NOT done
here — that is delegated to the Resolver layer (user-supplied plugins + a generic
headless fallback). Cove ships no per-host deobfuscation.
"""

import re
import urllib.parse
import urllib.request

from bs4 import BeautifulSoup

from .base import Adapter, Item

_UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
       "(KHTML, like Gecko) Chrome/122.0 Safari/537.36")
_HOSTS = ("aniworld.to", "aniworld.", "s.to", "serienstream.")

# Preferred streamhoster order and language default when a Source doesn't specify.
DEFAULT_HOSTER_ORDER = ["voe", "filemoon", "vidoza", "doodstream", "streamtape"]
DEFAULT_LANGUAGE = "German Dub"   # German audio; strict by default (see enumerate)


class AniworldAdapter(Adapter):
    type = "aniworld"

    @classmethod
    def detect(cls, url: str) -> bool:
        return any(h in url for h in _HOSTS)

    def enumerate(self, target: str, settings: dict | None = None) -> list[Item]:
        settings = settings or {}
        order = [h.lower() for h in settings.get("hosters", DEFAULT_HOSTER_ORDER)]
        # Empty/"any" language = take whatever's offered. Otherwise, when `strict`
        # (default), episodes that don't have the chosen language are skipped
        # rather than silently falling back to another language.
        language = settings.get("language", DEFAULT_LANGUAGE) or None
        strict = settings.get("strict", True)
        quality = settings.get("quality", "best")
        library = settings.get("library", "Anime")

        episodes = self._episode_urls(target)
        items: list[Item] = []
        for ep_url in episodes:
            try:
                item = self._episode_item(ep_url, order, language, quality, library, strict)
            except Exception:
                item = None
            if item:
                items.append(item)
        return items

    # -- page discovery ----------------------------------------------------

    def _base(self, url: str) -> str:
        p = urllib.parse.urlparse(url)
        return f"{p.scheme}://{p.netloc}"

    def _fetch(self, url: str) -> str:
        req = urllib.request.Request(url, headers={"User-Agent": _UA})
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.read().decode("utf-8", "replace")

    def _episode_urls(self, target: str) -> list[str]:
        """Return the episode page URLs to process. If `target` is already an
        episode page, that's the only one; otherwise enumerate episodes linked
        from the series/season page."""
        if re.search(r"/episode-\d+", target):
            return [target]
        html = self._fetch(target)
        soup = BeautifulSoup(html, "html.parser")
        base = self._base(target)
        urls: list[str] = []
        for a in soup.select("a[href*='/episode-']"):
            href = a.get("href")
            if not href:
                continue
            full = href if href.startswith("http") else base + href
            if full not in urls:
                urls.append(full)
        return urls or [target]

    # -- one episode -------------------------------------------------------

    def _episode_item(self, ep_url, order, language, quality, library, strict=True) -> Item | None:
        html = self._fetch(ep_url)
        soup = BeautifulSoup(html, "html.parser")
        hosters = self._hosters(soup, language, strict)
        if not hosters:
            return None  # no host in the requested language (strict) -> skip episode
        chosen = self._choose(hosters, order)
        embed = self._resolve_redirect(self._base(ep_url), chosen["redirect"])
        season, episode = self._season_episode(ep_url)
        series = self._series_name(soup, ep_url)
        s2 = f"{season:02d}" if season else "01"
        e2 = f"{episode:02d}" if episode else "01"
        dest_rel = f"{series}/Season {s2}"
        filename = f"{series} - S{s2}E{e2}"
        return Item(
            title=f"{series} S{s2}E{e2}",
            url=embed or chosen["redirect"],
            kind="video", quality=quality, library=library,
            dest_rel=dest_rel, filename=filename,
            needs_resolve=True, resolver_hint=chosen["host"],
            meta={"series": series, "season": season, "episode": episode,
                  "language": language, "host": chosen["host"]},
        )

    def _hosters(self, soup, language, strict=True) -> list[dict]:
        """Extract [{host, lang, redirect}] from an episode page. Aniworld lists
        each hoster as a <li> carrying data-link-target (the /redirect/<id> path),
        a language key, and the hoster's display name."""
        out = []
        for li in soup.select("li[data-link-target]"):
            redirect = li.get("data-link-target")
            if not redirect:
                continue
            name_el = li.select_one("h4") or li.select_one(".watchEpisode") or li
            host = (name_el.get_text(strip=True) or "").lower()
            lang_key = li.get("data-lang-key") or ""
            out.append({"host": host, "lang": self._lang_label(lang_key), "redirect": redirect})
        if not language:
            return out  # "any language" — no filtering
        preferred = [h for h in out if h["lang"] == language]
        if preferred:
            return preferred
        # No host in the requested language: skip (strict) or fall back to all.
        return [] if strict else out

    def _choose(self, hosters, order) -> dict:
        def rank(h):
            for i, name in enumerate(order):
                if name in h["host"]:
                    return i
            return len(order)
        return sorted(hosters, key=rank)[0]

    def _resolve_redirect(self, base, redirect) -> str | None:
        """Follow aniworld's /redirect/<id> to the streamhoster embed URL. This is
        aniworld's own indirection, not hoster deobfuscation."""
        url = redirect if redirect.startswith("http") else base + redirect
        try:
            req = urllib.request.Request(url, headers={"User-Agent": _UA})
            with urllib.request.urlopen(req, timeout=30) as r:
                return r.geturl()  # final URL after aniworld's redirect
        except Exception:
            return None

    # -- naming helpers ----------------------------------------------------

    def _season_episode(self, url) -> tuple[int | None, int | None]:
        s = re.search(r"/staffel-(\d+)", url)
        e = re.search(r"/episode-(\d+)", url)
        return (int(s.group(1)) if s else None, int(e.group(1)) if e else None)

    def _series_name(self, soup, url) -> str:
        el = soup.select_one("h1") or soup.select_one(".series-title")
        if el and el.get_text(strip=True):
            return re.sub(r"\s+", " ", el.get_text(strip=True))
        m = re.search(r"/stream/([^/]+)", url)
        return m.group(1).replace("-", " ").title() if m else "Unknown"

    def _lang_label(self, key) -> str:
        return {"1": "German Dub", "2": "English Sub", "3": "German Sub"}.get(str(key), "German Sub")
