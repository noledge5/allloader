"""The Planner: decides *when* queued downloads may run (ADR: scheduling only, never
discovery). An off-peak schedule is a 4-band x 7-day grid of booleans. If no cell is
enabled, downloads are always allowed; if any cell is enabled, downloads run only
inside enabled bands for the current day.
"""

import datetime

from . import db

_BAND_HOURS = 6  # 4 bands of 6 hours: 0-6, 6-12, 12-18, 18-24


def allowed_now(now: datetime.datetime | None = None) -> bool:
    sched = db.get_setting("schedule") or {}
    grid = sched.get("grid") or []
    if not any(any(row) for row in grid):
        return True  # no windows configured → always allowed
    now = now or datetime.datetime.now()
    band = min(now.hour // _BAND_HOURS, len(grid) - 1)
    weekday = now.weekday()  # Mon=0 .. Sun=6
    try:
        return bool(grid[band][weekday])
    except (IndexError, TypeError):
        return True


def bandwidth_kbps() -> int:
    sched = db.get_setting("schedule") or {}
    try:
        return int(sched.get("bandwidth_kbps") or 0)
    except (ValueError, TypeError):
        return 0
