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
from .voe import VoeResolver

# Built-in host-specific resolvers, tried before the generic headless fallback.
_BUILTINS = [VoeResolver]

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
    # Built-in host resolvers (VOE) and user plugins first, headless fallback last.
    return [b() for b in _BUILTINS] + _plugins + [HeadlessResolver()]


def resolve(embed_url: str, hint: str | None = None) -> str | None:
    """Turn a streamhoster embed URL into a concrete media URL, or None.

    The `hint` (e.g. "voe") names the streamhoster the Adapter saw. It matters
    because hosts like VOE rotate to mirror domains that no longer contain their
    name, so URL matching alone would miss them — a resolver whose name equals the
    hint is tried even when matches() is False, and first.
    """
    rs = resolvers()
    if hint:
        rs = [r for r in rs if r.name == hint] + [r for r in rs if r.name != hint]
    for r in rs:
        try:
            if (hint and r.name == hint) or r.matches(embed_url):
                out = r.resolve(embed_url)
                if out:
                    return out
        except Exception:
            continue
    return None
