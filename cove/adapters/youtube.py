"""YouTube / yt-dlp adapter — enumerates a video or playlist via yt-dlp without
downloading (extract_info flat), so the queue holds one Item per video.
"""

import yt_dlp

from .base import Adapter, Item

_HOSTS = ("youtube.com", "youtu.be", "vimeo.com", "dailymotion.com")


class YouTubeAdapter(Adapter):
    type = "youtube"

    @classmethod
    def detect(cls, url: str) -> bool:
        return any(h in url for h in _HOSTS)

    def enumerate(self, target: str, settings: dict | None = None) -> list[Item]:
        settings = settings or {}
        quality = settings.get("quality", "best")
        library = settings.get("library")
        opts = {"quiet": True, "no_warnings": True, "extract_flat": "in_playlist",
                "skip_download": True, "noplaylist": False}
        items: list[Item] = []
        try:
            with yt_dlp.YoutubeDL(opts) as ydl:
                info = ydl.extract_info(target, download=False)
        except Exception:
            # Fall back to a single opaque video Item; the video engine will try it.
            return [Item(title=target, url=target, kind="video", quality=quality, library=library)]

        entries = info.get("entries") if isinstance(info, dict) else None
        if entries:
            for e in entries:
                if not e:
                    continue
                url = e.get("url") or e.get("webpage_url") or target
                if url and not url.startswith("http"):
                    url = f"https://www.youtube.com/watch?v={url}"
                items.append(Item(title=e.get("title") or url, url=url, kind="video",
                                  quality=quality, library=library,
                                  meta={"channel": e.get("channel") or e.get("uploader")}))
        else:
            items.append(Item(title=(info or {}).get("title") or target, url=target,
                              kind="video", quality=quality, library=library))
        return items
