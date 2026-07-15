"""Conversational control panel (ADR 0002 — Sonnet tier).

A bounded tool-use loop that lets the user drive Cove in natural language:
"what's downloading?", "pause the big one", "retry the failed episodes". Claude
calls a small set of safe tools; Cove executes them against the manager/db and
feeds results back until the model answers in prose.
"""

from .. import config, db, nas
from ..engine.manager import manager
from . import client

MAX_TURNS = 6  # hard cap on tool round-trips per user message

_TOOLS = [
    {
        "name": "get_status",
        "description": "List current downloads with their status, progress and size.",
        "input_schema": {
            "type": "object",
            "properties": {
                "status": {"type": ["string", "null"],
                           "description": "Filter: queued|downloading|paused|completed|failed|canceled"},
            },
        },
    },
    {
        "name": "queue_download",
        "description": "Queue a single direct URL or video link for download.",
        "input_schema": {
            "type": "object",
            "properties": {
                "url": {"type": "string"},
                "kind": {"type": "string", "enum": ["file", "video", "audio"]},
                "title": {"type": ["string", "null"]},
                "quality": {"type": ["string", "null"]},
                "library": {"type": ["string", "null"]},
            },
            "required": ["url"],
        },
    },
    {
        "name": "control_download",
        "description": "Pause, resume, retry, or cancel a download by its id.",
        "input_schema": {
            "type": "object",
            "properties": {
                "id": {"type": "string"},
                "action": {"type": "string", "enum": ["pause", "resume", "retry", "cancel"]},
            },
            "required": ["id", "action"],
        },
    },
]

_SYSTEM = (
    "You are the assistant inside Cove, a self-hosted download manager on a home NAS. "
    "Help the user inspect and control their downloads using the provided tools. "
    "Prefer get_status before acting so you reference real ids. 'retry' and 'resume' "
    "both requeue a stopped download. Keep replies short and factual. Never invent "
    "download ids or URLs; if you lack something, ask."
)


def _run_tool(name: str, args: dict) -> dict:
    if name == "get_status":
        st = args.get("status")
        rows = db.list_downloads([st] if st else None)
        return {"downloads": [
            {"id": r["id"], "title": r.get("title"), "status": r["status"],
             "kind": r.get("kind"), "downloaded": r.get("downloaded"),
             "total": r.get("total"), "error": r.get("error")}
            for r in rows
        ]}
    if name == "queue_download":
        url = args["url"]
        did = _queue(url, args.get("kind", "file"), args.get("title"),
                     args.get("quality"), args.get("library"))
        return {"queued": did}
    if name == "control_download":
        did, action = args["id"], args["action"]
        if not db.get_download(did):
            return {"error": f"no download with id {did}"}
        {"pause": manager.pause, "resume": manager.resume,
         "retry": manager.resume, "cancel": manager.cancel}[action](did)
        return {"ok": True, "id": did, "action": action}
    return {"error": f"unknown tool {name}"}


def _queue(url, kind, title, quality, library):
    import uuid
    did = uuid.uuid4().hex[:10]
    db.insert_download({
        "id": did, "url": url, "kind": kind, "title": title,
        "dest_dir": nas.resolve_dest(library, None), "library": library,
        "quality": quality, "status": "queued",
    })
    return did


def reply(message: str, history: list | None = None) -> dict:
    """Run one user message through the tool-loop. Returns {reply, actions}.

    `history` is a list of prior {role, content} text turns from the client so the
    conversation has memory. Raises AIError if AI is unavailable.
    """
    messages = list(history or [])
    messages.append({"role": "user", "content": message})
    actions: list[dict] = []

    for _ in range(MAX_TURNS):
        msg = client.converse(config.MODEL_SMART, _SYSTEM, messages, _TOOLS)
        messages.append({"role": "assistant", "content": msg.content})
        tool_uses = [b for b in msg.content if b.type == "tool_use"]
        if not tool_uses:
            text = "".join(b.text for b in msg.content if b.type == "text").strip()
            return {"reply": text, "actions": actions}
        results = []
        for tu in tool_uses:
            out = _run_tool(tu.name, dict(tu.input))
            actions.append({"tool": tu.name, "input": dict(tu.input), "output": out})
            results.append({"type": "tool_result", "tool_use_id": tu.id,
                            "content": _json(out)})
        messages.append({"role": "user", "content": results})

    return {"reply": "I ran out of steps before finishing that. Try a smaller request.",
            "actions": actions}


def _json(obj) -> str:
    import json
    return json.dumps(obj, default=str)
