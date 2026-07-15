"""Video/audio download task backed by yt-dlp.

yt-dlp supports YouTube, Vimeo, TikTok, X/Twitter, Reddit, SoundCloud, and
hundreds of other sites via the same URL-in, file-out interface. It already
resumes partially-written files by default (continuedl), so "resume" here
just re-invokes it on the same output template — yt-dlp finds the .part file
itself. "Pause"/"cancel" raise out of the progress hook, which aborts the
current fragment cleanly and keeps whatever is already on disk.
"""

import os
import threading
import time

import yt_dlp

try:
    import imageio_ffmpeg

    FFMPEG_PATH = imageio_ffmpeg.get_ffmpeg_exe()
except Exception:
    # Bundled ffmpeg failed to install (e.g. pip timeout) or isn't supported
    # on this platform. yt-dlp still works without it, just without stream
    # merging/audio-conversion — see _run() below.
    FFMPEG_PATH = None


class _PausedError(Exception):
    pass


class _CanceledError(Exception):
    pass


class VideoTask:
    kind = "video"

    def __init__(self, task_id, url, output_dir, audio_only, quality="best", on_change=None):
        self.id = task_id
        self.url = url
        self.output_dir = output_dir
        self.audio_only = audio_only
        self.quality = quality

        self.status = "queued"
        self.total = None
        self.downloaded = 0
        self.speed = 0.0
        self.error = None
        self.filename = None

        self.on_change = on_change
        self._last_notify = 0.0
        self._pause_flag = threading.Event()
        self._cancel_flag = threading.Event()
        self._lock = threading.Lock()

    def to_dict(self):
        with self._lock:
            pct = (self.downloaded / self.total * 100) if self.total else None
            eta = None
            if self.total and self.speed:
                eta = (self.total - self.downloaded) / self.speed
            return {
                "id": self.id,
                "url": self.url,
                "filename": self.filename or self.url,
                "status": self.status,
                "total": self.total,
                "downloaded": self.downloaded,
                "speed": self.speed,
                "pct": pct,
                "eta": eta,
                "error": self.error,
                "kind": "video",
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

    def _notify(self, force=False):
        if not self.on_change:
            return
        now = time.monotonic()
        if force or now - self._last_notify >= 2.0:
            self._last_notify = now
            try:
                self.on_change()
            except Exception:
                pass

    def _hook(self, d):
        if self._cancel_flag.is_set():
            raise _CanceledError()
        if self._pause_flag.is_set():
            raise _PausedError()
        if d["status"] == "downloading":
            self.downloaded = d.get("downloaded_bytes") or 0
            self.total = d.get("total_bytes") or d.get("total_bytes_estimate")
            self.speed = d.get("speed") or 0.0
            fn = d.get("filename")
            if fn:
                self.filename = os.path.basename(fn)
            self._notify()
        elif d["status"] == "finished":
            self.downloaded = d.get("downloaded_bytes") or self.downloaded
            self._notify(force=True)

    def _run(self):
        self.status = "downloading"
        self.error = None
        self._notify(force=True)
        os.makedirs(self.output_dir, exist_ok=True)

        ydl_opts = {
            "outtmpl": os.path.join(self.output_dir, "%(title).200s [%(id)s].%(ext)s"),
            "progress_hooks": [self._hook],
            "continuedl": True,
            "noplaylist": True,
            "windowsfilenames": True,
            "quiet": True,
            "no_warnings": True,
            "noprogress": True,
            "retries": 20,
            "fragment_retries": 20,
        }
        if FFMPEG_PATH:
            ydl_opts["ffmpeg_location"] = FFMPEG_PATH

        if self.audio_only:
            ydl_opts["format"] = "bestaudio/best"
            if FFMPEG_PATH:
                # Without ffmpeg we can't transcode; keep the native codec
                # (m4a/webm/opus) instead of failing the whole download.
                ydl_opts["postprocessors"] = [
                    {"key": "FFmpegExtractAudio", "preferredcodec": "mp3"}
                ]
        else:
            # height<=? (with the "?") skips the filter instead of excluding
            # formats that don't report a height, so odd sites don't end up
            # with zero matching formats.
            height_filter = f"[height<=?{self.quality}]" if self.quality != "best" else ""
            # bestvideo+bestaudio needs ffmpeg to mux; without it, fall back
            # to a single pre-muxed stream so the download still succeeds.
            if FFMPEG_PATH:
                ydl_opts["format"] = f"bestvideo{height_filter}+bestaudio/best{height_filter}"
            else:
                ydl_opts["format"] = f"best{height_filter}/best"

        try:
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                ydl.download([self.url])
            self.status = "completed"
            self._notify(force=True)
        except _PausedError:
            self.status = "paused"
            self._notify(force=True)
        except _CanceledError:
            self.status = "canceled"
            self._notify(force=True)
        except Exception as e:
            self.status = "error"
            self.error = str(e)
            self._notify(force=True)
