"""Generic headless-browser resolver (ADR 0001).

Loads a streamhoster embed in a real (headless) Chromium and captures the media
stream URL the player requests — .m3u8 (HLS) or a direct video response. This is a
*generic* network-sniff technique, not host-specific deobfuscation; it works to the
extent the player fetches a plain media URL and the host has no active anti-bot.

Runs in a worker thread (sync Playwright), so it must not be called from the asyncio
loop. Returns None if Playwright isn't installed or nothing is captured in time.
"""

import os

from .base import Resolver

_MEDIA_HINT = (".m3u8", ".mp4", ".mpd")
_UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
       "(KHTML, like Gecko) Chrome/122.0 Safari/537.36")


class HeadlessResolver(Resolver):
    name = "headless"

    def matches(self, url: str) -> bool:
        return url.startswith("http")

    def resolve(self, url: str, timeout_ms: int = 20000) -> str | None:
        try:
            from playwright.sync_api import sync_playwright
        except Exception:
            return None

        captured: list[str] = []
        exe = None
        base = os.environ.get("PLAYWRIGHT_BROWSERS_PATH")
        if base:
            cand = os.path.join(base, "chromium")
            if os.path.exists(cand):
                exe = cand

        def on_request(req):
            u = req.url
            if any(h in u.split("?")[0].lower() for h in _MEDIA_HINT):
                captured.append(u)

        try:
            with sync_playwright() as p:
                launch = {"headless": True}
                if exe:
                    launch["executable_path"] = exe
                browser = p.chromium.launch(**launch)
                page = browser.new_page(user_agent=_UA)
                page.on("request", on_request)
                try:
                    page.goto(url, wait_until="commit", timeout=timeout_ms)
                    # Give the player a moment to request its manifest; nudge play.
                    page.wait_for_timeout(3000)
                    try:
                        page.evaluate("document.querySelector('video')?.play()")
                    except Exception:
                        pass
                    page.wait_for_timeout(4000)
                finally:
                    browser.close()
        except Exception:
            return None

        # Prefer an HLS manifest, else the first media URL seen.
        for u in captured:
            if ".m3u8" in u:
                return u
        return captured[0] if captured else None
