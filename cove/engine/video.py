"""Video/audio download via yt-dlp, with pause/cancel and progress callbacks.

Handles YouTube/Vimeo/etc. and any resolved stream URL an Adapter hands us. yt-dlp
resumes partial files itself, so pause = raise out of the progress hook and resume =
re-invoke on the same output template. Ported from the allloader video task.
"""

import os
import threading

import yt_dlp

try:
    import imageio_ffmpeg
    FFMPEG_PATH = imageio_ffmpeg.get_ffmpeg_exe()
except Exception:
    FFMPEG_PATH = None


class _Paused(Exception):
    pass


class _Canceled(Exception):
    pass


class VideoDownload:
    def __init__(self, url, dest_dir, quality="best", audio_only=False, on_progress=None):
        self.url = url
        self.dest_dir = dest_dir
        self.quality = quality            # "best" | "2160" | "1080" | "720"
        self.audio_only = audio_only
        self.on_progress = on_progress or (lambda info: None)
        self.filename = None
        self._pause = threading.Event()
        self._cancel = threading.Event()

    def pause(self):
        self._pause.set()

    def cancel(self):
        self._cancel.set()
        self._pause.set()

    def _hook(self, d):
        if self._cancel.is_set():
            raise _Canceled()
        if self._pause.is_set():
            raise _Paused()
        if d["status"] == "downloading":
            fn = d.get("filename")
            if fn:
                self.filename = os.path.basename(fn)
            self.on_progress({
                "status": "downloading",
                "total": d.get("total_bytes") or d.get("total_bytes_estimate"),
                "downloaded": d.get("downloaded_bytes") or 0,
                "speed": d.get("speed") or 0.0,
                "filename": self.filename,
            })

    def run(self):
        os.makedirs(self.dest_dir, exist_ok=True)
        opts = {
            "outtmpl": os.path.join(self.dest_dir, "%(title).200s [%(id)s].%(ext)s"),
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
            opts["ffmpeg_location"] = FFMPEG_PATH

        h = "" if self.quality == "best" else f"[height<=?{self.quality}]"
        if self.audio_only:
            opts["format"] = "bestaudio/best"
            if FFMPEG_PATH:
                opts["postprocessors"] = [
                    {"key": "FFmpegExtractAudio", "preferredcodec": "mp3"}
                ]
        elif FFMPEG_PATH:
            # Prefer a browser-friendly MP4 so it previews (ADR: direct-play only).
            opts["format"] = (
                f"bestvideo{h}[ext=mp4]+bestaudio[ext=m4a]/bestvideo{h}+bestaudio/best{h}"
            )
            opts["merge_output_format"] = "mp4"
        else:
            opts["format"] = f"best{h}/best"

        try:
            with yt_dlp.YoutubeDL(opts) as ydl:
                ydl.download([self.url])
            self.on_progress({"status": "completed", "filename": self.filename})
            return "completed"
        except _Paused:
            self.on_progress({"status": "paused", "filename": self.filename})
            return "paused"
        except _Canceled:
            self.on_progress({"status": "canceled", "filename": self.filename})
            return "canceled"
        except Exception as e:
            self.on_progress({"status": "failed", "error": str(e)})
            return "failed"
