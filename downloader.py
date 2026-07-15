"""Resumable multi-download engine.

Each DownloadTask runs in its own thread, streams to an <output>.part file,
and checks pause/cancel flags between chunks. Pausing closes the connection
cleanly; resuming reopens with an HTTP Range request starting at the current
file size, so no bytes are re-downloaded or lost.
"""

import json
import os
import re
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid

from video_task import VideoTask

TIMEOUT = 30
CHUNK = 256 * 1024
META_SUFFIX = ".part.json"
STATE_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "tasks_state.json")
NOTIFY_INTERVAL = 2.0  # throttle for progress-only persistence writes


class DownloadTask:
    kind = "file"

    def __init__(self, task_id, url, output_dir, filename, headers, on_change=None):
        self.id = task_id
        self.url = url
        self.output_dir = output_dir
        self.filename = filename
        self.headers = dict(headers or {})
        self.headers.setdefault("User-Agent", "resume-download-gui/1.0")

        self.status = "queued"
        self.total = None
        self.downloaded = 0
        self.speed = 0.0
        self.error = None

        self.final_path = None
        self.part_path = None
        self.meta_path = None

        self.on_change = on_change
        self._last_notify = 0.0

        self._pause_flag = threading.Event()
        self._cancel_flag = threading.Event()
        self._lock = threading.Lock()
        self._window = []

    def _notify(self, force=False):
        if not self.on_change:
            return
        now = time.monotonic()
        if force or now - self._last_notify >= NOTIFY_INTERVAL:
            self._last_notify = now
            try:
                self.on_change()
            except Exception:
                pass

    def to_dict(self):
        with self._lock:
            pct = (self.downloaded / self.total * 100) if self.total else None
            eta = None
            if self.total and self.speed > 0:
                eta = (self.total - self.downloaded) / self.speed
            return {
                "id": self.id,
                "url": self.url,
                "filename": self.filename,
                "status": self.status,
                "total": self.total,
                "downloaded": self.downloaded,
                "speed": self.speed,
                "pct": pct,
                "eta": eta,
                "error": self.error,
                "kind": "file",
            }

    def start(self):
        self._cancel_flag.clear()
        self._pause_flag.clear()
        threading.Thread(target=self._run, daemon=True).start()

    def pause(self):
        if self.status == "downloading":
            self._pause_flag.set()

    def resume(self):
        if self.status in ("paused", "error"):
            self.status = "queued"
            self._notify(force=True)
            self.start()

    def cancel(self):
        self._cancel_flag.set()
        self._pause_flag.set()

    # -- internals --------------------------------------------------

    def _ensure_paths(self):
        if not self.filename:
            self.filename = self._detect_filename()
            self._notify(force=True)
        os.makedirs(self.output_dir, exist_ok=True)
        self.final_path = os.path.join(self.output_dir, self.filename)
        self.part_path = self.final_path + ".part"
        self.meta_path = self.final_path + META_SUFFIX

    def _detect_filename(self):
        try:
            req = urllib.request.Request(self.url, headers=self.headers, method="HEAD")
            with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
                return self._filename_from_response(resp)
        except Exception:
            try:
                req = urllib.request.Request(self.url, headers=self.headers)
                with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
                    return self._filename_from_response(resp)
            except Exception:
                pass
        path = urllib.parse.urlparse(self.url).path
        return os.path.basename(path) or f"download-{self.id}.bin"

    def _filename_from_response(self, resp):
        cd = resp.headers.get("Content-Disposition", "")
        m = re.search(r'filename\*?=(?:UTF-8\'\')?"?([^";]+)"?', cd)
        if m:
            return os.path.basename(urllib.parse.unquote(m.group(1).strip()))
        path = urllib.parse.urlparse(resp.url).path
        return os.path.basename(path) or f"download-{self.id}.bin"

    def _load_meta(self):
        if os.path.exists(self.meta_path):
            try:
                with open(self.meta_path, encoding="utf-8") as f:
                    return json.load(f)
            except (OSError, ValueError):
                return {}
        return {}

    def _save_meta(self, meta):
        with open(self.meta_path, "w", encoding="utf-8") as f:
            json.dump(meta, f)

    def _open_stream(self, pos, meta):
        headers = dict(self.headers)
        if pos:
            headers["Range"] = f"bytes={pos}-"
            validator = meta.get("etag") or meta.get("last_modified")
            if validator:
                headers["If-Range"] = validator
        req = urllib.request.Request(self.url, headers=headers)
        resp = urllib.request.urlopen(req, timeout=TIMEOUT)
        if pos and resp.status == 200:
            pos = 0
        if resp.status == 206:
            m = re.search(r"/(\d+)\s*$", resp.headers.get("Content-Range", ""))
            total = int(m.group(1)) if m else None
        else:
            cl = resp.headers.get("Content-Length")
            total = int(cl) if cl else None
        return resp, pos, total

    def _run(self):
        self.status = "downloading"
        self.error = None
        self._notify(force=True)
        try:
            self._ensure_paths()
            meta = self._load_meta()
            pos = os.path.getsize(self.part_path) if os.path.exists(self.part_path) else 0
            failures = 0

            while True:
                if self._cancel_flag.is_set():
                    self.status = "canceled"
                    self._notify(force=True)
                    return

                try:
                    resp, pos, total = self._open_stream(pos, meta)
                except urllib.error.HTTPError as e:
                    self.status = "error"
                    self.error = f"HTTP {e.code} {e.reason}"
                    self._notify(force=True)
                    return
                except Exception as e:
                    failures += 1
                    if failures > 20:
                        self.status = "error"
                        self.error = str(e)
                        self._notify(force=True)
                        return
                    time.sleep(min(2 ** failures, 30))
                    continue

                start_pos = pos
                with resp:
                    meta = {
                        "etag": resp.headers.get("ETag"),
                        "last_modified": resp.headers.get("Last-Modified"),
                    }
                    self._save_meta(meta)
                    self.total = total
                    mode = "r+b" if pos else "wb"
                    with open(self.part_path, mode) as f:
                        f.seek(pos)
                        f.truncate()
                        self._window = []
                        while True:
                            if self._cancel_flag.is_set():
                                self.status = "canceled"
                                self._notify(force=True)
                                return
                            if self._pause_flag.is_set():
                                self.status = "paused"
                                self.downloaded = pos
                                self._notify(force=True)
                                return
                            chunk = resp.read(CHUNK)
                            if not chunk:
                                break
                            f.write(chunk)
                            pos += len(chunk)
                            self._tick(pos)

                failures = 0 if pos > start_pos else failures + 1
                if failures > 20:
                    self.status = "error"
                    self.error = "connection kept closing without progress"
                    self._notify(force=True)
                    return
                if total is not None and pos < total:
                    continue  # dropped mid-stream — reopen with Range and keep going
                break

            os.replace(self.part_path, self.final_path)
            try:
                os.remove(self.meta_path)
            except OSError:
                pass
            self.downloaded = pos
            self.status = "completed"
            self._notify(force=True)
        except Exception as e:
            self.status = "error"
            self.error = str(e)
            self._notify(force=True)

    def _tick(self, pos):
        now = time.monotonic()
        self._window.append((now, pos))
        self._window = [(t, p) for t, p in self._window if now - t <= 10]
        if len(self._window) >= 2:
            dt = self._window[-1][0] - self._window[0][0]
            db = self._window[-1][1] - self._window[0][1]
            self.speed = db / dt if dt > 0 else 0.0
        self.downloaded = pos
        self._notify()


class Manager:
    """Keeps the in-memory task list in sync with STATE_FILE on disk.

    Every status change (and, throttled, every progress tick) triggers a
    rewrite of STATE_FILE. On startup, tasks that were mid-download when the
    app last stopped are resumed automatically; paused/error tasks are
    restored as-is so the user decides when to continue; completed tasks are
    kept as history; canceled tasks are dropped.
    """

    def __init__(self):
        self.tasks = {}
        self._lock = threading.Lock()
        self._load_state()

    def add(self, url, output_dir, filename, headers):
        task_id = uuid.uuid4().hex[:8]
        task = DownloadTask(task_id, url, output_dir, filename, headers, on_change=self._save_state)
        with self._lock:
            self.tasks[task_id] = task
        task.start()
        self._save_state()
        return task_id

    def add_video(self, url, output_dir, audio_only=False, quality="best"):
        task_id = uuid.uuid4().hex[:8]
        task = VideoTask(task_id, url, output_dir, audio_only, quality, on_change=self._save_state)
        with self._lock:
            self.tasks[task_id] = task
        task.start()
        self._save_state()
        return task_id

    def list_tasks(self):
        with self._lock:
            tasks = list(self.tasks.values())
        return [t.to_dict() for t in tasks]

    def get(self, task_id):
        return self.tasks.get(task_id)

    def pause(self, task_id):
        t = self.get(task_id)
        if t:
            t.pause()

    def resume(self, task_id):
        t = self.get(task_id)
        if t:
            t.resume()

    def cancel(self, task_id):
        t = self.get(task_id)
        if t:
            t.cancel()

    def remove(self, task_id):
        with self._lock:
            self.tasks.pop(task_id, None)
        self._save_state()

    # -- persistence --------------------------------------------------

    def _save_state(self):
        with self._lock:
            tasks = list(self.tasks.values())
        snapshot = []
        for t in tasks:
            if t.status == "canceled":
                continue
            entry = {
                "id": t.id,
                "url": t.url,
                "output_dir": t.output_dir,
                "filename": t.filename,
                "status": t.status,
                "total": t.total,
                "kind": t.kind,
            }
            if t.kind == "video":
                entry["audio_only"] = t.audio_only
                entry["quality"] = t.quality
            else:
                entry["headers"] = t.headers
            snapshot.append(entry)
        try:
            tmp = STATE_FILE + ".tmp"
            with open(tmp, "w", encoding="utf-8") as f:
                json.dump(snapshot, f, indent=2)
            os.replace(tmp, STATE_FILE)
        except OSError:
            pass

    def _load_state(self):
        if not os.path.exists(STATE_FILE):
            return
        try:
            with open(STATE_FILE, encoding="utf-8") as f:
                snapshot = json.load(f)
        except (OSError, ValueError):
            return

        for entry in snapshot:
            saved_status = entry.get("status", "paused")
            was_active = saved_status in ("downloading", "queued")

            if entry.get("kind") == "video":
                task = VideoTask(
                    entry["id"],
                    entry["url"],
                    entry["output_dir"],
                    entry.get("audio_only", False),
                    entry.get("quality", "best"),
                    on_change=self._save_state,
                )
                task.total = entry.get("total")
                task.filename = entry.get("filename")
                task.status = "downloading" if was_active else saved_status
                self.tasks[task.id] = task
                if was_active:
                    task.start()
                continue

            task = DownloadTask(
                entry["id"],
                entry["url"],
                entry["output_dir"],
                entry.get("filename"),
                entry.get("headers") or {},
                on_change=self._save_state,
            )
            task.total = entry.get("total")

            task._ensure_paths()
            if os.path.exists(task.part_path):
                task.downloaded = os.path.getsize(task.part_path)
            elif os.path.exists(task.final_path):
                task.status = "completed"
                task.downloaded = task.total or os.path.getsize(task.final_path)
                self.tasks[task.id] = task
                continue

            task.status = "downloading" if was_active else saved_status
            self.tasks[task.id] = task
            if was_active:
                task.start()

        self._save_state()
