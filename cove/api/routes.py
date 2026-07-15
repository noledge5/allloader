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

from .. import db, nas
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
    headers: dict | None = None
    source_id: str | None = None
    batch_id: str | None = None


class ScheduleIn(BaseModel):
    row_labels: list[str] | None = None
    grid: list[list[bool]] | None = None
    bandwidth_kbps: int | None = None


# -- downloads -------------------------------------------------------------

@router.get("/downloads")
def list_downloads():
    return db.list_downloads()


@router.post("/downloads")
def create_download(body: NewDownload):
    did = uuid.uuid4().hex[:10]
    dest_dir = nas.resolve_dest(body.library, body.dest_rel)
    db.insert_download({
        "id": did, "url": body.url, "kind": body.kind, "title": body.title,
        "dest_dir": dest_dir, "library": body.library, "quality": body.quality,
        "headers": body.headers, "source_id": body.source_id,
        "batch_id": body.batch_id, "status": "queued",
    })
    return {"id": did}


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
