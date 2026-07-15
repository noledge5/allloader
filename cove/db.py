"""SQLite persistence for Cove.

A single file on the PC holds sources, downloads, batches, schedule windows, and
settings. The Catalog is derived (completed downloads), not a separate table.

Access is guarded by one lock because the download engine touches the DB from
worker threads while FastAPI touches it from the event loop.
"""

import json
import sqlite3
import threading
import time
from pathlib import Path
from typing import Any, Optional

from . import config

_lock = threading.RLock()
_conn: Optional[sqlite3.Connection] = None

SCHEMA = """
CREATE TABLE IF NOT EXISTS downloads (
    id          TEXT PRIMARY KEY,
    url         TEXT NOT NULL,
    kind        TEXT NOT NULL DEFAULT 'file',   -- file | video | audio
    title       TEXT,
    filename    TEXT,
    dest_dir    TEXT NOT NULL,                  -- absolute dir on the NAS
    library     TEXT,                           -- top-level bucket (Anime/Movies/Files)
    quality     TEXT,
    headers     TEXT,                           -- JSON extra request headers
    source_id   TEXT,
    batch_id    TEXT,
    status      TEXT NOT NULL DEFAULT 'queued', -- queued|downloading|paused|completed|failed|canceled
    total       INTEGER,
    downloaded  INTEGER NOT NULL DEFAULT 0,
    error       TEXT,
    created_at  REAL NOT NULL,
    updated_at  REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS sources (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    type        TEXT NOT NULL,     -- aniworld | rss | youtube | watchfolder | direct
    detail      TEXT,              -- url or path
    settings    TEXT,              -- JSON (hoster order, language, credentials ref)
    status      TEXT NOT NULL DEFAULT 'idle',   -- idle | scanning | error
    last_scan   REAL,
    created_at  REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS batches (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    run_at      TEXT,              -- human schedule string, e.g. "Sat 02:00"
    recurring   INTEGER NOT NULL DEFAULT 0,
    status      TEXT NOT NULL DEFAULT 'scheduled',
    created_at  REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT
);
"""

# Default off-peak schedule: 4 time bands x 7 days, all off (= always allowed).
DEFAULT_SCHEDULE = {
    "row_labels": ["00-06", "06-12", "12-18", "18-24"],
    "grid": [[False] * 7 for _ in range(4)],
    "bandwidth_kbps": 0,  # 0 = unlimited
}


def connect() -> sqlite3.Connection:
    global _conn
    with _lock:
        if _conn is None:
            Path(config.DB_PATH).parent.mkdir(parents=True, exist_ok=True)
            _conn = sqlite3.connect(config.DB_PATH, check_same_thread=False)
            _conn.row_factory = sqlite3.Row
            _conn.executescript(SCHEMA)
            _conn.commit()
            if get_setting("schedule") is None:
                set_setting("schedule", DEFAULT_SCHEDULE)
        return _conn


def _q(sql: str, params: tuple = ()) -> sqlite3.Cursor:
    with _lock:
        cur = connect().execute(sql, params)
        connect().commit()
        return cur


def rows(sql: str, params: tuple = ()) -> list[dict]:
    with _lock:
        cur = connect().execute(sql, params)
        return [dict(r) for r in cur.fetchall()]


def row(sql: str, params: tuple = ()) -> Optional[dict]:
    r = rows(sql, params)
    return r[0] if r else None


# -- settings (JSON values) ------------------------------------------------

def get_setting(key: str) -> Any:
    r = row("SELECT value FROM settings WHERE key=?", (key,))
    if r is None:
        return None
    try:
        return json.loads(r["value"])
    except (ValueError, TypeError):
        return r["value"]


def set_setting(key: str, value: Any) -> None:
    _q(
        "INSERT INTO settings(key,value) VALUES(?,?) "
        "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        (key, json.dumps(value)),
    )


# -- downloads -------------------------------------------------------------

def insert_download(d: dict) -> None:
    now = time.time()
    _q(
        """INSERT INTO downloads
        (id,url,kind,title,filename,dest_dir,library,quality,headers,source_id,batch_id,
         status,total,downloaded,error,created_at,updated_at)
        VALUES (:id,:url,:kind,:title,:filename,:dest_dir,:library,:quality,:headers,
                :source_id,:batch_id,:status,:total,:downloaded,:error,:created_at,:updated_at)""",
        {
            "id": d["id"], "url": d["url"], "kind": d.get("kind", "file"),
            "title": d.get("title"), "filename": d.get("filename"),
            "dest_dir": d["dest_dir"], "library": d.get("library"),
            "quality": d.get("quality"),
            "headers": json.dumps(d.get("headers") or {}),
            "source_id": d.get("source_id"), "batch_id": d.get("batch_id"),
            "status": d.get("status", "queued"), "total": d.get("total"),
            "downloaded": d.get("downloaded", 0), "error": d.get("error"),
            "created_at": now, "updated_at": now,
        },
    )


def update_download(id: str, **fields) -> None:
    if not fields:
        return
    fields["updated_at"] = time.time()
    cols = ", ".join(f"{k}=:{k}" for k in fields)
    fields["id"] = id
    _q(f"UPDATE downloads SET {cols} WHERE id=:id", fields)


def list_downloads(statuses: Optional[list[str]] = None) -> list[dict]:
    if statuses:
        marks = ",".join("?" * len(statuses))
        return rows(
            f"SELECT * FROM downloads WHERE status IN ({marks}) ORDER BY created_at",
            tuple(statuses),
        )
    return rows("SELECT * FROM downloads ORDER BY created_at DESC")


def get_download(id: str) -> Optional[dict]:
    return row("SELECT * FROM downloads WHERE id=?", (id,))


def delete_download(id: str) -> None:
    _q("DELETE FROM downloads WHERE id=?", (id,))
