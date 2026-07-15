"""Watch-folder adapter — enumerates media files already sitting in a NAS folder
so Cove can import them into a Library bucket. Re-scanned manually.

Emits `file://` Items; the manager copies them into the library (a local import,
not an HTTP download). Only files, never recurses into hidden dirs.
"""

import os

from .base import Adapter, Item

_MEDIA = (".mp4", ".mkv", ".webm", ".mov", ".avi", ".m4v", ".mp3", ".flac", ".m4a", ".srt")


class WatchFolderAdapter(Adapter):
    type = "watchfolder"

    @classmethod
    def detect(cls, url: str) -> bool:
        # A local path, not an http(s) URL.
        return not url.startswith("http") and (os.path.sep in url or url.startswith("/"))

    def enumerate(self, target: str, settings: dict | None = None) -> list[Item]:
        settings = settings or {}
        library = settings.get("library")
        items: list[Item] = []
        if not os.path.isdir(target):
            return items
        for root, dirs, files in os.walk(target):
            dirs[:] = [d for d in dirs if not d.startswith(".")]
            for name in sorted(files):
                ext = os.path.splitext(name)[1].lower()
                if ext not in _MEDIA:
                    continue
                path = os.path.join(root, name)
                kind = "audio" if ext in (".mp3", ".flac", ".m4a") else "video"
                items.append(Item(title=name, url="file://" + path, kind=kind,
                                  library=library, filename=name))
        return items
