"""Browse the mounted NAS share for the destination picker, confined to NAS_BASE
so a client can't walk the whole filesystem.
"""

import os
from pathlib import Path

from . import config


def _safe(rel: str) -> Path:
    base = Path(config.NAS_BASE).resolve()
    target = (base / rel.lstrip("/\\")).resolve()
    if base != target and base not in target.parents:
        raise ValueError("path escapes NAS base")
    return target


def browse(rel: str = "") -> dict:
    """List immediate subfolders of NAS_BASE/rel."""
    base = Path(config.NAS_BASE)
    base.mkdir(parents=True, exist_ok=True)
    target = _safe(rel)
    dirs = []
    if target.is_dir():
        for entry in sorted(target.iterdir(), key=lambda p: p.name.lower()):
            if entry.is_dir():
                rel_path = str(entry.relative_to(Path(config.NAS_BASE)))
                has_children = any(c.is_dir() for c in _iter(entry))
                dirs.append({"name": entry.name, "rel": rel_path, "hasChildren": has_children})
    return {"rel": rel, "base": str(base), "dirs": dirs}


def _iter(p: Path):
    try:
        return list(p.iterdir())
    except OSError:
        return []


_VIDEO_EXT = (".mp4", ".mkv", ".webm", ".mov", ".avi", ".m4v", ".ts")
_AUDIO_EXT = (".mp3", ".flac", ".m4a", ".aac", ".ogg", ".wav")


def scan_library() -> list[dict]:
    """Walk the NAS media folders and return the media files actually on disk.

    This is the Library's source of truth (CONTEXT.md) — not Cove's DB — so a reset
    DB, a duplicate download, or a file deleted directly on the NAS all just reflect
    reality. Each item is keyed by its path relative to NAS_BASE.
    """
    base = Path(config.NAS_BASE)
    if not base.is_dir():
        return []
    out: list[dict] = []
    for root, dirs, files in os.walk(base):
        dirs[:] = [d for d in dirs if not d.startswith(".")]
        for name in files:
            ext = os.path.splitext(name)[1].lower()
            if ext not in _VIDEO_EXT and ext not in _AUDIO_EXT:
                continue
            full = Path(root) / name
            try:
                st = full.stat()
            except OSError:
                continue
            rel = str(full.relative_to(base))
            parts = Path(rel).parts
            out.append({
                "rel": rel, "id": rel, "name": name, "total": st.st_size,
                "mtime": st.st_mtime, "library": parts[0] if len(parts) > 1 else None,
                "kind": "audio" if ext in _AUDIO_EXT else "video",
                "filename": name, "title": os.path.splitext(name)[0],
            })
    out.sort(key=lambda d: d["mtime"], reverse=True)
    return out


def delete(rel: str) -> bool:
    """Delete one media file on the NAS (confined to NAS_BASE). Returns True if removed."""
    target = _safe(rel)
    if target.is_file():
        os.remove(target)
        return True
    return False


def resolve_dest(library: str | None, rel: str | None) -> str:
    """Absolute destination directory for a download."""
    base = Path(config.NAS_BASE)
    parts = [base]
    if library:
        parts.append(library)
    if rel:
        parts.append(rel.lstrip("/\\"))
    dest = Path(*[str(p) for p in parts])
    return str(dest)
