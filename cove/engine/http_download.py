"""Resumable HTTP download of one file, with pause/cancel and progress callbacks.

Streams to <output>.part and resumes from the current byte offset via HTTP Range,
so pauses, crashes, and network drops never lose progress. Ported from the
allloader downloader (which was verified byte-identical across pause/resume and
hard-crash recovery).
"""

import os
import re
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

TIMEOUT = 30
CHUNK = 256 * 1024


class HttpDownload:
    """One resumable file download. `on_progress(dict)` is called as bytes arrive
    and on every state change; it must be cheap and thread-safe.
    """

    def __init__(self, url, dest_path, headers=None, on_progress=None):
        self.url = url
        self.dest_path = dest_path          # final absolute path on the NAS
        self.part_path = dest_path + ".part"
        self.meta_path = dest_path + ".part.json"
        self.headers = dict(headers or {})
        self.headers.setdefault("User-Agent", "Cove/0.1")
        self.on_progress = on_progress or (lambda info: None)

        self.total = None
        self.downloaded = 0
        self.speed = 0.0
        self._pause = threading.Event()
        self._cancel = threading.Event()
        self._window = []

    def pause(self):
        self._pause.set()

    def cancel(self):
        self._cancel.set()
        self._pause.set()

    def _emit(self, status):
        self.on_progress({
            "status": status,
            "total": self.total,
            "downloaded": self.downloaded,
            "speed": self.speed,
        })

    def _load_validator(self):
        import json
        if os.path.exists(self.meta_path):
            try:
                with open(self.meta_path, encoding="utf-8") as f:
                    return json.load(f)
            except (OSError, ValueError):
                return {}
        return {}

    def _save_validator(self, meta):
        import json
        with open(self.meta_path, "w", encoding="utf-8") as f:
            json.dump(meta, f)

    def _open(self, pos, meta):
        headers = dict(self.headers)
        if pos:
            headers["Range"] = f"bytes={pos}-"
            validator = meta.get("etag") or meta.get("last_modified")
            if validator:
                headers["If-Range"] = validator
        req = urllib.request.Request(self.url, headers=headers)
        resp = urllib.request.urlopen(req, timeout=TIMEOUT)
        if pos and resp.status == 200:
            pos = 0  # server ignored Range / file changed — restart cleanly
        if resp.status == 206:
            m = re.search(r"/(\d+)\s*$", resp.headers.get("Content-Range", ""))
            total = int(m.group(1)) if m else None
        else:
            cl = resp.headers.get("Content-Length")
            total = int(cl) if cl else None
        return resp, pos, total

    def run(self):
        """Blocking. Returns final status: completed | paused | canceled | failed."""
        os.makedirs(os.path.dirname(self.dest_path), exist_ok=True)
        if os.path.exists(self.dest_path):
            self.downloaded = self.total = os.path.getsize(self.dest_path)
            self._emit("completed")
            return "completed"

        meta = self._load_validator()
        pos = os.path.getsize(self.part_path) if os.path.exists(self.part_path) else 0
        failures = 0

        while True:
            if self._cancel.is_set():
                return "canceled"
            try:
                resp, pos, total = self._open(pos, meta)
            except urllib.error.HTTPError as e:
                if e.code in (408, 429) or e.code >= 500:
                    failures += 1
                    if failures > 20:
                        self._fail(f"HTTP {e.code} {e.reason}")
                        return "failed"
                    time.sleep(min(2 ** failures, 30))
                    continue
                self._fail(f"HTTP {e.code} {e.reason}")
                return "failed"
            except Exception as e:
                failures += 1
                if failures > 20:
                    self._fail(str(e))
                    return "failed"
                time.sleep(min(2 ** failures, 30))
                continue

            start_pos = pos
            with resp:
                meta = {
                    "etag": resp.headers.get("ETag"),
                    "last_modified": resp.headers.get("Last-Modified"),
                }
                self._save_validator(meta)
                self.total = total
                self.downloaded = pos
                self._window = []
                mode = "r+b" if pos else "wb"
                with open(self.part_path, mode) as f:
                    f.seek(pos)
                    f.truncate()
                    while True:
                        if self._cancel.is_set():
                            return "canceled"
                        if self._pause.is_set():
                            self.downloaded = pos
                            self._emit("paused")
                            return "paused"
                        chunk = resp.read(CHUNK)
                        if not chunk:
                            break
                        f.write(chunk)
                        pos += len(chunk)
                        self._tick(pos)

            failures = 0 if pos > start_pos else failures + 1
            if failures > 20:
                self._fail("connection kept closing without progress")
                return "failed"
            if total is not None and pos < total:
                continue  # dropped mid-stream — reopen with Range
            break

        os.replace(self.part_path, self.dest_path)
        try:
            os.remove(self.meta_path)
        except OSError:
            pass
        self.downloaded = pos
        self._emit("completed")
        return "completed"

    def _tick(self, pos):
        now = time.monotonic()
        self._window.append((now, pos))
        self._window = [(t, p) for t, p in self._window if now - t <= 10]
        if len(self._window) >= 2:
            dt = self._window[-1][0] - self._window[0][0]
            db = self._window[-1][1] - self._window[0][1]
            self.speed = db / dt if dt > 0 else 0.0
        self.downloaded = pos
        self._emit("downloading")

    def _fail(self, msg):
        self.error = msg
        self.on_progress({
            "status": "failed", "error": msg,
            "total": self.total, "downloaded": self.downloaded, "speed": 0.0,
        })
