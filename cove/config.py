"""Runtime configuration, resolved from environment variables with dev-friendly
defaults. On the user's PC these come from the launcher (start.bat) or a .env.
"""

import os
from pathlib import Path


def _bool(name: str, default: bool) -> bool:
    val = os.environ.get(name)
    if val is None:
        return default
    return val.strip().lower() in ("1", "true", "yes", "on")


# Where the Cove package lives, and the repo root above it.
PKG_DIR = Path(__file__).resolve().parent
ROOT_DIR = PKG_DIR.parent

# The NAS share, mounted on the PC. Downloads land under here (per Library).
# On Windows this is typically a UNC path (\\NAS\media) or a mapped drive (Z:\).
# Default keeps dev on this machine.
NAS_BASE = Path(os.environ.get("COVE_NAS_BASE", str(Path.home() / "Downloads" / "Cove")))

# SQLite lives next to the package by default (not on the NAS — it's PC-local state).
DB_PATH = Path(os.environ.get("COVE_DB", str(ROOT_DIR / "cove_state.sqlite3")))

# Compiled React bundle served as the GUI. Absent until Phase 4 builds it.
WEB_DIST = Path(os.environ.get("COVE_WEB_DIST", str(ROOT_DIR / "web" / "dist")))

# Bind to the LAN (ADR 0003) so phones/TVs can reach it; no auth by design.
HOST = os.environ.get("COVE_HOST", "0.0.0.0")
PORT = int(os.environ.get("COVE_PORT", "5100"))

# How many downloads may run at once.
MAX_CONCURRENT = int(os.environ.get("COVE_MAX_CONCURRENT", "3"))

# Claude — the user's own key, PC-local, never written to the repo or state file.
ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "")
# Tiered models (ADR 0002).
MODEL_CHEAP = os.environ.get("COVE_MODEL_CHEAP", "claude-haiku-4-5")
MODEL_SMART = os.environ.get("COVE_MODEL_SMART", "claude-sonnet-5")
MODEL_MAX = os.environ.get("COVE_MODEL_MAX", "claude-opus-4-8")

DEBUG = _bool("COVE_DEBUG", False)
