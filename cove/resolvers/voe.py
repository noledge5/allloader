"""VOE streamhoster resolver (VOE / voe.sx and its rotating mirror domains).

VOE is aniworld's default hoster, so a light HTTP-only resolver here avoids
spinning up headless Chromium for the common case. VOE obfuscates its stream URL
and changes the scheme periodically, so this tries several known layouts and
falls back to scraping any HLS/MP4 URL out of the page. When none match, it
returns None and Cove's headless resolver takes over (ADR 0001, 0008).

This is inherently brittle — when VOE changes format it breaks until updated.
"""

import base64
import codecs
import json
import re
import urllib.request

from .base import Resolver

_UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
       "(KHTML, like Gecko) Chrome/122.0 Safari/537.36")
_JUNK = ["@$", "^^", "~@", "%?", "*~", "!!", "#&"]
_MEDIA_RE = re.compile(r'https?://[^\s"\'<>\\]+?\.(?:m3u8|mp4)[^\s"\'<>\\]*')


class VoeResolver(Resolver):
    name = "voe"

    def matches(self, url: str) -> bool:
        u = url.lower()
        # VOE rotates domains; match the brand plus the common embed shapes.
        return "voe" in u or "/e/" in u and "voe" in u

    def resolve(self, url: str) -> str | None:
        html = self._get(url)
        if not html:
            return None
        # VOE often bounces to a fresh mirror domain before serving the player.
        redirect = self._redirect(html)
        if redirect and redirect != url:
            html = self._get(redirect) or html

        for strategy in (self._from_app_json, self._from_hls_key,
                         self._from_sources, self._from_regex):
            try:
                out = strategy(html)
            except Exception:
                out = None
            if out and out.startswith("http"):
                return out
        return None

    # -- fetch -------------------------------------------------------------

    def _get(self, url: str) -> str | None:
        try:
            req = urllib.request.Request(url, headers={"User-Agent": _UA})
            with urllib.request.urlopen(req, timeout=30) as r:
                return r.read().decode("utf-8", "replace")
        except Exception:
            return None

    def _redirect(self, html: str) -> str | None:
        m = re.search(r"""window\.location\.href\s*=\s*['"]([^'"]+)['"]""", html)
        if m:
            return m.group(1)
        m = re.search(r"""<meta[^>]+http-equiv=["']refresh["'][^>]+url=([^"'>]+)""", html, re.I)
        return m.group(1).strip() if m else None

    # -- strategies (first http match wins) --------------------------------

    def _from_app_json(self, html: str) -> str | None:
        """Current VOE: an obfuscated string in a JSON <script> block."""
        m = re.search(r'<script[^>]+application/json[^>]*>\s*(\[.*?\]|".*?")\s*</script>',
                      html, re.S)
        if not m:
            return None
        raw = m.group(1)
        try:
            payload = json.loads(raw)
            obf = payload[0] if isinstance(payload, list) else payload
        except Exception:
            obf = raw.strip('[]"')
        for decoded in self._deobfuscate(obf):
            url = self._pick(decoded)
            if url:
                return url
        return None

    def _deobfuscate(self, s: str):
        """Yield candidate decoded JSON dicts across VOE's known pipelines."""
        s = s.strip()
        # Pipeline A: rot13 -> strip junk -> b64 -> shift(-3) -> reverse -> b64.
        try:
            a = codecs.decode(s, "rot_13")
            for j in _JUNK:
                a = a.replace(j, "")
            a = base64.b64decode(a).decode("utf-8", "replace")
            a = "".join(chr(ord(c) - 3) for c in a)[::-1]
            yield json.loads(base64.b64decode(a).decode("utf-8", "replace"))
        except Exception:
            pass
        # Pipeline B: plain base64 -> JSON (older builds).
        try:
            yield json.loads(base64.b64decode(s).decode("utf-8", "replace"))
        except Exception:
            pass

    def _pick(self, obj) -> str | None:
        """Find a stream URL anywhere in a decoded dict."""
        if isinstance(obj, str):
            return obj if (".m3u8" in obj or ".mp4" in obj) and obj.startswith("http") else None
        if isinstance(obj, dict):
            for key in ("source", "file", "hls", "direct_access_url", "mp4", "url"):
                v = obj.get(key)
                got = self._pick(v) if isinstance(v, (dict, list, str)) else None
                if got:
                    return got
            for v in obj.values():
                got = self._pick(v)
                if got:
                    return got
        if isinstance(obj, list):
            for v in obj:
                got = self._pick(v)
                if got:
                    return got
        return None

    def _from_hls_key(self, html: str) -> str | None:
        """Older VOE: 'hls': '<base64 of the m3u8 url>'."""
        m = re.search(r"""['"]hls['"]\s*:\s*['"]([A-Za-z0-9+/=]+)['"]""", html)
        if not m:
            return None
        try:
            dec = base64.b64decode(m.group(1)).decode("utf-8", "replace")
            return dec if dec.startswith("http") else None
        except Exception:
            return None

    def _from_sources(self, html: str) -> str | None:
        """`var sources = { ... }` object literal."""
        m = re.search(r"var\s+sources\s*=\s*(\{.*?\})\s*;", html, re.S)
        if not m:
            return None
        try:
            return self._pick(json.loads(m.group(1)))
        except Exception:
            return None

    def _from_regex(self, html: str) -> str | None:
        """Last resort: any bare HLS/MP4 URL in the page."""
        m = _MEDIA_RE.search(html)
        return m.group(0) if m else None
