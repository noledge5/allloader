"""Download manager: a scheduler thread promotes queued downloads to running when
the Planner allows and concurrency permits, each running in its own worker thread.
Progress is persisted (throttled) and broadcast to WebSocket subscribers.

Threads touch the DB and push to the asyncio loop via call_soon_threadsafe.
"""

import asyncio
import os
import threading
import time
from typing import Optional

from .. import config, db, planner
from .http_download import HttpDownload
from .video import VideoDownload


class Manager:
    def __init__(self):
        self._loop: Optional[asyncio.AbstractEventLoop] = None
        self._subscribers: set[asyncio.Queue] = set()
        self._workers: dict[str, object] = {}   # download id -> HttpDownload/VideoDownload
        self._lock = threading.Lock()
        self._last_emit: dict[str, float] = {}
        self._stop = threading.Event()
        self._thread: Optional[threading.Thread] = None

    # -- lifecycle ---------------------------------------------------------

    def start(self, loop: asyncio.AbstractEventLoop):
        self._loop = loop
        # Crash recovery: anything left 'downloading' goes back to the queue.
        for d in db.list_downloads(["downloading"]):
            db.update_download(d["id"], status="queued")
        self._thread = threading.Thread(target=self._scheduler, daemon=True)
        self._thread.start()

    def stop(self):
        self._stop.set()

    # -- broadcast ---------------------------------------------------------

    def subscribe(self) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue()
        self._subscribers.add(q)
        return q

    def unsubscribe(self, q: asyncio.Queue):
        self._subscribers.discard(q)

    def _broadcast(self, msg: dict):
        if not self._loop:
            return
        for q in list(self._subscribers):
            self._loop.call_soon_threadsafe(q.put_nowait, msg)

    # -- scheduler ---------------------------------------------------------

    def _scheduler(self):
        while not self._stop.is_set():
            try:
                self._promote()
            except Exception:
                pass
            time.sleep(1.0)

    def _promote(self):
        with self._lock:
            running = sum(
                1 for d in db.list_downloads(["downloading"])
            )
            if running >= config.MAX_CONCURRENT:
                return
            if not planner.allowed_now():
                return
            nxt = None
            for d in db.list_downloads(["queued"]):
                nxt = d
                break
            if not nxt:
                return
            db.update_download(nxt["id"], status="downloading")
        self._broadcast({"type": "download", "id": nxt["id"], "status": "downloading"})
        threading.Thread(target=self._run, args=(nxt["id"],), daemon=True).start()

    # -- per-download worker ----------------------------------------------

    def _run_worker(self, download_id: str, worker):
        """Register a worker so pause/cancel can reach it, run it, and return
        its final status. Used for the primary attempt and the resolver fallback."""
        with self._lock:
            self._workers[download_id] = worker
        try:
            return worker.run()
        finally:
            with self._lock:
                self._workers.pop(download_id, None)

    def _resolve_embed(self, url: str, hint):
        """Best-effort resolver-chain lookup (plugins + headless), never raises."""
        try:
            from .. import resolvers
            return resolvers.resolve(url, hint)
        except Exception:
            return None

    def _run(self, download_id: str):
        d = db.get_download(download_id)
        if not d:
            return
        dest_dir = d["dest_dir"]
        kind = d["kind"]
        url = d["url"]
        needs_resolve = bool(d.get("needs_resolve"))

        def on_progress(info: dict):
            self._on_progress(download_id, info)

        if kind in ("video", "audio"):
            quality = (d.get("quality") or "best").replace("p", "") or "best"
            audio_only = kind == "audio"
            name = d.get("filename")

            def make_video(u, referer=None):
                return VideoDownload(u, dest_dir, quality=quality,
                                     audio_only=audio_only, name=name,
                                     referer=referer, on_progress=on_progress)

            # First try yt-dlp on the URL directly (covers YouTube etc.). Most
            # aniworld streamhosters (VOE, Doodstream, Filemoon) are NOT supported
            # by yt-dlp, so on failure fall back to Cove's resolver chain — the
            # built-in VOE resolver, then user plugins, then the headless sniffer
            # (ADR 0001/0008) — and download whatever concrete stream it yields,
            # passing the embed as Referer so the CDN doesn't 403.
            status = self._run_worker(download_id, make_video(url))
            if status == "failed" and needs_resolve:
                concrete = self._resolve_embed(url, d.get("resolver_hint"))
                if concrete and concrete != url:
                    status = self._run_worker(download_id, make_video(concrete, referer=url))
        else:
            # Non-video streamhoster embeds still resolve to a bare URL first.
            if needs_resolve:
                concrete = self._resolve_embed(url, d.get("resolver_hint"))
                if not concrete:
                    db.update_download(
                        download_id, status="failed",
                        error=f"could not resolve {d.get('resolver_hint') or 'streamhoster'} "
                              "— yt-dlp had no extractor and the headless fallback found no stream",
                    )
                    self._broadcast({"type": "download", "id": download_id, "status": "failed"})
                    return
                url = concrete
            import json
            filename = d.get("filename") or _guess_name(url)
            headers = json.loads(d.get("headers") or "{}")
            db.update_download(download_id, filename=filename)
            status = self._run_worker(download_id, HttpDownload(
                url, os.path.join(dest_dir, filename),
                headers=headers, on_progress=on_progress,
            ))

        # A 'paused'/'canceled' final status is set by _on_progress; only persist
        # terminal completed/failed here (queued for resume handled by resume()).
        if status == "completed":
            db.update_download(download_id, status="completed")
        elif status == "failed":
            db.update_download(download_id, status="failed")
        elif status == "canceled":
            db.update_download(download_id, status="canceled")
        elif status == "paused":
            db.update_download(download_id, status="paused")
        self._broadcast({"type": "download", "id": download_id, "status": status})

    def _on_progress(self, download_id: str, info: dict):
        status = info.get("status")
        fields = {}
        if "downloaded" in info:
            fields["downloaded"] = int(info.get("downloaded") or 0)
        if info.get("total") is not None:
            fields["total"] = int(info["total"])
        if info.get("filename"):
            fields["filename"] = info["filename"]
        if status == "failed":
            fields["error"] = info.get("error")

        now = time.monotonic()
        last = self._last_emit.get(download_id, 0)
        terminal = status in ("completed", "failed", "paused", "canceled")
        if terminal or now - last >= 0.5:
            self._last_emit[download_id] = now
            if fields:
                db.update_download(download_id, **fields)
            self._broadcast({
                "type": "progress", "id": download_id,
                "status": status, "downloaded": info.get("downloaded"),
                "total": info.get("total"), "speed": info.get("speed"),
            })

    # -- controls ----------------------------------------------------------

    _TERMINAL = ("completed", "failed", "canceled")

    def pause(self, download_id: str):
        with self._lock:
            w = self._workers.get(download_id)
        if w:
            w.pause()
            return
        d = db.get_download(download_id)
        if d and d["status"] == "queued":
            db.update_download(download_id, status="paused")
            self._broadcast({"type": "download", "id": download_id, "status": "paused"})

    def resume(self, download_id: str):
        d = db.get_download(download_id)
        if not d or d["status"] not in ("paused", "failed"):
            return  # only paused/failed downloads can be requeued
        db.update_download(download_id, status="queued", error=None)
        self._broadcast({"type": "download", "id": download_id, "status": "queued"})

    def cancel(self, download_id: str):
        with self._lock:
            w = self._workers.get(download_id)
        if w:
            w.cancel()
            return
        d = db.get_download(download_id)
        if d and d["status"] not in self._TERMINAL:
            db.update_download(download_id, status="canceled")
            self._broadcast({"type": "download", "id": download_id, "status": "canceled"})


def _guess_name(url: str) -> str:
    import urllib.parse
    path = urllib.parse.urlparse(url).path
    return os.path.basename(path) or "download.bin"


manager = Manager()
