"""Resolver registry + plugin loader.

Cove ships no per-host deobfuscation resolvers (ADR 0001). It provides:
  1. a plugin slot — drop a .py exposing a `Resolver` subclass into the plugins dir
     (cove/resolvers/plugins/ or $COVE_RESOLVER_PLUGINS), and it's tried first;
  2. a generic headless-browser fallback that sniffs the media URL a player requests.

resolve() tries matching plugins in load order, then the headless fallback.
"""

import importlib.util
import inspect
import os
from pathlib import Path

from .base import Resolver
from .headless import HeadlessResolver

_PLUGIN_DIRS = [
    Path(__file__).resolve().parent / "plugins",
    *([Path(os.environ["COVE_RESOLVER_PLUGINS"])] if os.environ.get("COVE_RESOLVER_PLUGINS") else []),
]

_plugins: list[Resolver] = []
_loaded = False


def _load_plugins() -> list[Resolver]:
    global _loaded
    found: list[Resolver] = []
    for d in _PLUGIN_DIRS:
        if not d.is_dir():
            continue
        for f in sorted(d.glob("*.py")):
            if f.name.startswith("_"):
                continue
            try:
                spec = importlib.util.spec_from_file_location(f"cove_resolver_{f.stem}", f)
                mod = importlib.util.module_from_spec(spec)
                spec.loader.exec_module(mod)
                for _, obj in inspect.getmembers(mod, inspect.isclass):
                    if issubclass(obj, Resolver) and obj not in (Resolver, HeadlessResolver):
                        found.append(obj())
            except Exception:
                continue
    _loaded = True
    return found


def resolvers() -> list[Resolver]:
    global _plugins
    if not _loaded:
        _plugins = _load_plugins()
    # Plugins first (user-supplied, host-specific), headless fallback last.
    return _plugins + [HeadlessResolver()]


def resolve(embed_url: str, hint: str | None = None) -> str | None:
    """Turn a streamhoster embed URL into a concrete media URL, or None."""
    for r in resolvers():
        try:
            if r.matches(embed_url):
                out = r.resolve(embed_url)
                if out:
                    return out
        except Exception:
            continue
    return None
