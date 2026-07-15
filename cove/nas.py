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
