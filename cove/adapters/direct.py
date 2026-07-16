"""Direct link adapter — a single file or media URL. The catch-all."""

import os
import urllib.parse

from .base import Adapter, Proposal

_VIDEO_EXT = (".mp4", ".mkv", ".webm", ".mov", ".avi", ".m4v", ".ts")
_AUDIO_EXT = (".mp3", ".flac", ".m4a", ".aac", ".ogg", ".wav")


class DirectAdapter(Adapter):
    type = "direct"

    @classmethod
    def detect(cls, url: str) -> bool:
        return url.startswith("http://") or url.startswith("https://")

    def enumerate(self, target: str, settings: dict | None = None) -> list[Proposal]:
        name = os.path.basename(urllib.parse.urlparse(target).path) or "download.bin"
        ext = os.path.splitext(name)[1].lower()
        kind = "video" if ext in _VIDEO_EXT else "audio" if ext in _AUDIO_EXT else "file"
        return [Proposal.single(title=name, url=target, kind=kind,
                                library=(settings or {}).get("library"))]
