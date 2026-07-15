"""REST + WebSocket routes for Cove (Phase 1: downloads, sources, batches,
schedule, NAS browse, catalog). Adapters and the Claude layer arrive in later
phases; the create-download endpoint already accepts direct URLs and video URLs.
"""

import os
import time
import uuid

from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse
from pydantic import BaseModel

from .. import adapters, db, nas
from ..engine.manager import manager

router = APIRouter(prefix="/api")


# -- schemas ---------------------------------------------------------------

class NewDownload(BaseModel):
    url: str
    kind: str = "file"          # file | video | audio
    title: str | None = None
    quality: str | None = None
    library: str | None = None
    dest_rel: str | None = None
    filename: str | None = None
    headers: dict | None = None
    source_id: str | None = None
    batch_id: str | None = None
    needs_resolve: bool = False
    resolver_hint: str | None = None


class AnalyzeIn(BaseModel):
    url: str
    type: str | None = None      # force an adapter type, else auto-detect
    settings: dict | None = None


class ScheduleIn(BaseModel):
    row_labels: list[str] | None = None
    grid: list[list[bool]] | None = None
    bandwidth_kbps: int | None = None


# -- downloads -------------------------------------------------------------

@router.get("/downloads")
def list_downloads():
    return db.list_downloads()


def _queue_item(url, kind="file", title=None, quality=None, library=None,
                dest_rel=None, filename=None, headers=None, source_id=None,
                batch_id=None, needs_resolve=False, resolver_hint=None):
    did = uuid.uuid4().hex[:10]
    dest_dir = nas.resolve_dest(library, dest_rel)
    db.insert_download({
        "id": did, "url": url, "kind": kind, "title": title,
        "dest_dir": dest_dir, "library": library, "quality": quality,
        "filename": filename, "headers": headers, "source_id": source_id,
        "batch_id": batch_id, "needs_resolve": needs_resolve,
        "resolver_hint": resolver_hint, "status": "queued",
    })
    return did


@router.post("/downloads")
def create_download(body: NewDownload):
    return {"id": _queue_item(
        body.url, body.kind, body.title, body.quality, body.library,
        body.dest_rel, body.filename, body.headers, body.source_id,
        body.batch_id, body.needs_resolve, body.resolver_hint,
    )}


# -- adapters: analyze a URL / scan a source -------------------------------

@router.post("/analyze")
def analyze(body: AnalyzeIn):
    """Enumerate downloadable items from a URL (playlist, feed, aniworld series,
    or a single link) without queuing them. Powers the New Download flow."""
    Adapter = adapters.get_adapter(body.type) if body.type else adapters.detect(body.url)
    if not Adapter:
        raise HTTPException(400, "no adapter for this URL")
    try:
        items = Adapter().enumerate(body.url, body.settings or {})
    except Exception as e:
        raise HTTPException(502, f"could not analyze: {e}")
    return {"adapter": Adapter.type, "items": [i.to_dict() for i in items]}


class QueueItems(BaseModel):
    items: list[dict]


@router.post("/queue")
def queue_items(body: QueueItems):
    """Queue a set of items previously returned by /analyze (or /sources/{id}/scan)."""
    ids = []
    for it in body.items:
        ids.append(_queue_item(
            it["url"], it.get("kind", "file"), it.get("title"), it.get("quality"),
            it.get("library"), it.get("dest_rel"), it.get("filename"),
            needs_resolve=it.get("needs_resolve", False),
            resolver_hint=it.get("resolver_hint"),
        ))
    return {"queued": len(ids), "ids": ids}


@router.post("/sources/{sid}/scan")
def scan_source(sid: str):
    """Re-scan a Source and queue everything it finds (manual, per ADR 0004)."""
    import json
    s = db.row("SELECT * FROM sources WHERE id=?", (sid,))
    if not s:
        raise HTTPException(404, "source not found")
    Adapter = adapters.get_adapter(s["type"]) or adapters.detect(s["detail"] or "")
    settings = {}
    try:
        settings = json.loads(s.get("settings") or "{}")
    except ValueError:
        pass
    try:
        items = Adapter().enumerate(s["detail"] or "", settings)
    except Exception as e:
        db._q("UPDATE sources SET status=?, last_scan=? WHERE id=?", ("error", time.time(), sid))
        raise HTTPException(502, f"scan failed: {e}")
    ids = [_queue_item(
        it.url, it.kind, it.title, it.quality, it.library or settings.get("library"),
        it.dest_rel, it.filename, source_id=sid,
        needs_resolve=it.needs_resolve, resolver_hint=it.resolver_hint,
    ) for it in items]
    db._q("UPDATE sources SET status=?, last_scan=? WHERE id=?", ("idle", time.time(), sid))
    return {"queued": len(ids)}


@router.post("/downloads/{did}/pause")
def pause(did: str):
    manager.pause(did)
    return {"ok": True}


@router.post("/downloads/{did}/resume")
def resume(did: str):
    manager.resume(did)
    return {"ok": True}


@router.post("/downloads/{did}/cancel")
def cancel(did: str):
    manager.cancel(did)
    return {"ok": True}


@router.delete("/downloads/{did}")
def remove(did: str):
    manager.cancel(did)
    db.delete_download(did)
    return {"ok": True}


# -- catalog (derived: completed downloads) --------------------------------

@router.get("/catalog")
def catalog():
    return db.list_downloads(["completed"])


@router.get("/downloads/{did}/file")
def download_file(did: str):
    """Serve a completed download for the direct-play preview. FileResponse
    honors HTTP Range, so the browser can seek/scrub. No transcoding.
    """
    d = db.get_download(did)
    if not d or d["status"] != "completed" or not d.get("filename"):
        raise HTTPException(status_code=404, detail="not available")
    path = os.path.join(d["dest_dir"], d["filename"])
    if not os.path.isfile(path):
        raise HTTPException(status_code=404, detail="file missing")
    return FileResponse(path, filename=d["filename"])


# -- sources ---------------------------------------------------------------

@router.get("/sources")
def list_sources():
    return db.rows("SELECT * FROM sources ORDER BY created_at")


class NewSource(BaseModel):
    name: str
    type: str
    detail: str | None = None
    settings: dict | None = None


@router.post("/sources")
def add_source(body: NewSource):
    import json
    sid = uuid.uuid4().hex[:10]
    db._q(
        "INSERT INTO sources(id,name,type,detail,settings,status,created_at) "
        "VALUES(?,?,?,?,?,?,?)",
        (sid, body.name, body.type, body.detail,
         json.dumps(body.settings or {}), "idle", time.time()),
    )
    return {"id": sid}


@router.delete("/sources/{sid}")
def remove_source(sid: str):
    db._q("DELETE FROM sources WHERE id=?", (sid,))
    return {"ok": True}


# -- batches ---------------------------------------------------------------

@router.get("/batches")
def list_batches():
    return db.rows("SELECT * FROM batches ORDER BY created_at")


class NewBatch(BaseModel):
    name: str
    run_at: str | None = None
    recurring: bool = False


@router.post("/batches")
def add_batch(body: NewBatch):
    bid = uuid.uuid4().hex[:10]
    db._q(
        "INSERT INTO batches(id,name,run_at,recurring,status,created_at) "
        "VALUES(?,?,?,?,?,?)",
        (bid, body.name, body.run_at, int(body.recurring), "scheduled", time.time()),
    )
    return {"id": bid}


@router.delete("/batches/{bid}")
def remove_batch(bid: str):
    db._q("DELETE FROM batches WHERE id=?", (bid,))
    return {"ok": True}


# -- schedule --------------------------------------------------------------

@router.get("/schedule")
def get_schedule():
    return db.get_setting("schedule")


@router.put("/schedule")
def put_schedule(body: ScheduleIn):
    cur = db.get_setting("schedule") or {}
    if body.row_labels is not None:
        cur["row_labels"] = body.row_labels
    if body.grid is not None:
        cur["grid"] = body.grid
    if body.bandwidth_kbps is not None:
        cur["bandwidth_kbps"] = body.bandwidth_kbps
    db.set_setting("schedule", cur)
    return cur


# -- NAS browse ------------------------------------------------------------

@router.get("/nas")
def nas_browse(rel: str = ""):
    try:
        return nas.browse(rel)
    except ValueError:
        return {"rel": "", "base": "", "dirs": []}


# -- live progress ---------------------------------------------------------

@router.websocket("/ws")
async def ws(websocket: WebSocket):
    await websocket.accept()
    q = manager.subscribe()
    try:
        # Send a snapshot so a freshly-connected client is current.
        await websocket.send_json({"type": "snapshot", "downloads": db.list_downloads()})
        while True:
            msg = await q.get()
            await websocket.send_json(msg)
    except WebSocketDisconnect:
        pass
    finally:
        manager.unsubscribe(q)
