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

from .. import adapters, ai, db, nas, triage
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

def _with_exists(d: dict) -> dict:
    """Flag whether a completed download's file is still on the NAS, so the UI can
    show/prune ghosts left when a user deletes the file directly."""
    if d.get("status") == "completed" and d.get("filename"):
        d["exists"] = os.path.isfile(os.path.join(d["dest_dir"], d["filename"]))
    else:
        d["exists"] = True
    return d


@router.get("/downloads")
def list_downloads():
    return [_with_exists(d) for d in db.list_downloads()]


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


# Adapters that expand one pasted URL into many items (a series/feed) rather than
# being a single downloadable link. Pasting one of these into New Download should
# enumerate it, not try to download the page itself.
_ENUMERATING = ("aniworld", "rss")


@router.post("/downloads")
def create_download(body: NewDownload):
    # A series/feed link (e.g. aniworld) is enumerated into its episodes; anything
    # else it is queued as the single download the user asked for.
    if not body.needs_resolve:
        Adapter = adapters.detect(body.url)
        if Adapter and getattr(Adapter, "type", "") in _ENUMERATING:
            settings = {"quality": body.quality or "best", "selector": "claude"}
            if body.library:
                settings["library"] = body.library
            try:
                created = _stage_proposals(Adapter, body.url, settings)
            except Exception as e:
                raise HTTPException(502, f"could not read {Adapter.type}: {e}")
            return {"proposed": len(created), "proposal_ids": created}

    return {"id": _queue_item(
        body.url, body.kind, body.title, body.quality, body.library,
        body.dest_rel, body.filename, body.headers, body.source_id,
        body.batch_id, body.needs_resolve, body.resolver_hint,
    )}


# -- Proposals: staging between a Source scan and Downloads ----------------

def _stage_proposals(Adapter, target, settings, source_id=None) -> list[str]:
    """Enumerate into Proposals, let the Selector pre-pick a Variant per Proposal,
    and persist them as `proposed`. Nothing is downloaded — that waits for confirm."""
    proposals = Adapter().enumerate(target, settings)
    # Belt-and-suspenders on top of the adapter's dedup: never stage the same
    # episode twice within one scan (keyed by its destination identity).
    seen, uniq = set(), []
    for p in proposals:
        key = (p.dest_rel, p.filename, p.title)
        if key in seen:
            continue
        seen.add(key)
        uniq.append(p)
    proposals = uniq
    picks = triage.select(proposals, settings)
    created: list[str] = []
    for p, sel in zip(proposals, picks):
        pid = uuid.uuid4().hex[:10]
        db.insert_proposal({
            "id": pid, "source_id": source_id, "title": p.title, "kind": p.kind,
            "library": p.library or settings.get("library"), "dest_rel": p.dest_rel,
            "filename": p.filename, "variants": [v.to_dict() for v in p.variants],
            "selected": sel, "status": "proposed", "meta": p.meta,
        })
        created.append(pid)
    return created


@router.post("/analyze")
def analyze(body: AnalyzeIn):
    """Enumerate Proposals (with their Variants) from a URL without staging or
    downloading — a preview."""
    Adapter = adapters.get_adapter(body.type) if body.type else adapters.detect(body.url)
    if not Adapter:
        raise HTTPException(400, "no adapter for this URL")
    try:
        proposals = Adapter().enumerate(body.url, body.settings or {})
    except Exception as e:
        raise HTTPException(502, f"could not analyze: {e}")
    return {"adapter": Adapter.type, "proposals": [p.to_dict() for p in proposals]}


@router.post("/sources/{sid}/scan")
def scan_source(sid: str):
    """Re-scan a Source into Proposals (staging), pre-picked by the Selector. A
    Source produces Proposals, never Downloads directly (CONTEXT.md, ADR 0004)."""
    import json
    s = db.row("SELECT * FROM sources WHERE id=?", (sid,))
    if not s:
        raise HTTPException(404, "source not found")
    Adapter = adapters.get_adapter(s["type"]) or adapters.detect(s["detail"] or "")
    try:
        settings = json.loads(s.get("settings") or "{}")
    except ValueError:
        settings = {}
    settings.setdefault("selector", "claude")   # Claude pre-selects by default
    # Start clean: drop this Source's stale proposals AND any orphans from the
    # paste flow (source_id NULL), which a per-source clear would otherwise leave.
    db.clear_proposals(sid)
    db._q("DELETE FROM proposals WHERE source_id IS NULL AND status='proposed'")
    try:
        created = _stage_proposals(Adapter, s["detail"] or "", settings, source_id=sid)
    except Exception as e:
        db._q("UPDATE sources SET status=?, last_scan=? WHERE id=?", ("error", time.time(), sid))
        raise HTTPException(502, f"scan failed: {e}")
    db._q("UPDATE sources SET status=?, last_scan=? WHERE id=?", ("idle", time.time(), sid))
    return {"proposed": len(created)}


@router.get("/proposals")
def list_proposals():
    """Pending Proposals awaiting Triage (with Variants + the pre-picked index)."""
    return db.list_proposals(["proposed"])


class ConfirmProposals(BaseModel):
    # {proposal_id: variant_index or null-to-skip}; omit for stored pre-pick.
    selections: dict[str, int | None] | None = None
    ids: list[str] | None = None            # confirm these; default = all proposed


@router.post("/proposals/confirm")
def confirm_proposals(body: ConfirmProposals):
    """Turn chosen Proposals into Downloads using the selected Variant, then mark
    them confirmed. Proposals with no chosen Variant are skipped (dismissed)."""
    sel = body.selections or {}
    targets = body.ids or [p["id"] for p in db.list_proposals(["proposed"])]
    queued = 0
    for pid in targets:
        p = db.get_proposal(pid)
        if not p or p["status"] != "proposed":
            continue
        idx = sel.get(pid, p.get("selected"))
        variants = p.get("variants") or []
        if idx is None or not (isinstance(idx, int) and 0 <= idx < len(variants)):
            db.update_proposal(pid, status="dismissed")
            continue
        v = variants[idx]
        _queue_item(
            v["url"], p.get("kind", "video"), p["title"], v.get("quality"),
            p.get("library"), p.get("dest_rel"), p.get("filename"),
            source_id=p.get("source_id"),
            needs_resolve=v.get("needs_resolve", False),
            resolver_hint=v.get("resolver_hint"),
        )
        db.update_proposal(pid, status="confirmed")
        queued += 1
    return {"queued": queued}


@router.post("/proposals/dismiss")
def dismiss_proposals(body: ConfirmProposals):
    """Drop Proposals without downloading them."""
    targets = body.ids or [p["id"] for p in db.list_proposals(["proposed"])]
    for pid in targets:
        db.delete_proposal(pid)
    return {"dismissed": len(targets)}


class QueueItems(BaseModel):
    items: list[dict]


@router.post("/queue")
def queue_items(body: QueueItems):
    """Queue flat item dicts directly (used by the natural-language Intake flow,
    which has already chosen a single URL per item)."""
    ids = []
    for it in body.items:
        ids.append(_queue_item(
            it["url"], it.get("kind", "file"), it.get("title"), it.get("quality"),
            it.get("library"), it.get("dest_rel"), it.get("filename"),
            needs_resolve=it.get("needs_resolve", False),
            resolver_hint=it.get("resolver_hint"),
        ))
    return {"queued": len(ids), "ids": ids}


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


# -- Claude workflow layer (ADR 0002) --------------------------------------

class IntakeIn(BaseModel):
    text: str


class ChatIn(BaseModel):
    message: str
    history: list[dict] | None = None


@router.get("/ai/status")
def ai_status():
    """Whether Claude features are usable; the GUI hides them when configured=false."""
    return ai.status()


@router.post("/ai/intake")
def ai_intake(body: IntakeIn):
    """Natural-language → proposed download items (does NOT queue; caller confirms)."""
    if not ai.available():
        raise HTTPException(503, "Claude is not configured (set ANTHROPIC_API_KEY).")
    try:
        return ai.intake.plan(body.text)
    except ai.AIError as e:
        raise HTTPException(502, str(e))


@router.post("/ai/chat")
def ai_chat(body: ChatIn):
    """Conversational control of the download queue via a bounded tool-loop."""
    if not ai.available():
        raise HTTPException(503, "Claude is not configured (set ANTHROPIC_API_KEY).")
    try:
        return ai.chat.reply(body.message, body.history)
    except ai.AIError as e:
        raise HTTPException(502, str(e))


@router.post("/ai/triage/{did}")
def ai_triage(did: str):
    """Explain why a (usually failed) download didn't work and what to try next."""
    d = db.get_download(did)
    if not d:
        raise HTTPException(404, "download not found")
    if not ai.available():
        raise HTTPException(503, "Claude is not configured (set ANTHROPIC_API_KEY).")
    try:
        return {"explanation": ai.triage.explain(d)}
    except ai.AIError as e:
        raise HTTPException(502, str(e))


# -- catalog (derived: completed downloads) --------------------------------

@router.get("/catalog")
def catalog():
    return [_with_exists(d) for d in db.list_downloads(["completed"])]


@router.post("/catalog/prune")
def prune_catalog():
    """Delete Catalog entries whose file is no longer on the NAS (ghosts)."""
    gone = [d for d in db.list_downloads(["completed"])
            if d.get("filename") and not os.path.isfile(os.path.join(d["dest_dir"], d["filename"]))]
    for d in gone:
        db.delete_download(d["id"])
    return {"pruned": len(gone)}


# -- library (the NAS folder IS the source of truth) -----------------------

@router.get("/library")
def library():
    """The media files actually on the NAS — the Library's source of truth, not
    Cove's DB. Reflects reality: no phantom rows, no duplicates a folder can't have."""
    return nas.scan_library()


class DeleteFiles(BaseModel):
    rels: list[str]


@router.post("/library/delete")
def library_delete(body: DeleteFiles):
    """Delete the actual file(s) from the NAS (confined to NAS_BASE)."""
    n = 0
    for rel in body.rels:
        try:
            if nas.delete(rel):
                n += 1
        except ValueError:
            continue
    return {"deleted": n}


@router.get("/library/file")
def library_file(rel: str):
    """Serve a library file by its NAS-relative path (Range-enabled for scrubbing)."""
    try:
        path = nas._safe(rel)
    except ValueError:
        raise HTTPException(400, "bad path")
    if not path.is_file():
        raise HTTPException(404, "not found")
    return FileResponse(str(path), filename=path.name)


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
