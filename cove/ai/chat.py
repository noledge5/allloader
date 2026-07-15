"""Conversational control panel (ADR 0002 — Sonnet tier).

Lets the user drive Cove in natural language: "what's downloading?", "pause the
big one", "retry the failed episodes". We hand Claude the current queue as
context and ask for a JSON reply plus an optional list of actions to run, then
execute them. Single-shot (not a live tool-loop) so it works identically on the
API and the subscription-CLI backend.
"""

from .. import db, nas
from ..engine.manager import manager
from . import client

_SCHEMA = {
    "type": "object",
    "properties": {
        "reply": {"type": "string", "description": "Short, factual reply to the user."},
        "actions": {
            "type": "array",
            "description": "Actions to perform. Leave empty if none are needed.",
            "items": {
                "type": "object",
                "properties": {
                    "action": {"type": "string",
                               "enum": ["queue", "pause", "resume", "retry", "cancel"]},
                    "id": {"type": "string", "description": "Download id (from the queue list)."},
                    "url": {"type": "string", "description": "For action=queue."},
                    "kind": {"type": "string", "enum": ["file", "video", "audio"]},
                    "title": {"type": "string"},
                    "quality": {"type": "string"},
                    "library": {"type": "string"},
                },
                "required": ["action"],
            },
        },
    },
    "required": ["reply"],
}

_SYSTEM = (
    "You are the assistant inside Cove, a self-hosted download manager on a home NAS. "
    "You are given the current download queue. Answer the user and, when they ask you "
    "to act, include actions. Only use download ids that appear in the queue — never "
    "invent ids or URLs. 'retry' and 'resume' both requeue a stopped download. Keep "
    "the reply short and factual; if you lack something you need, ask for it instead "
    "of guessing."
)


def _snapshot() -> str:
    rows = db.list_downloads()
    if not rows:
        return "(the queue is empty)"
    out = []
    for r in rows:
        out.append(
            f"- id={r['id']} status={r['status']} kind={r.get('kind')} "
            f"title={r.get('title') or r.get('filename') or r.get('url')} "
            f"got={r.get('downloaded')}/{r.get('total')}"
            + (f" error={r['error']}" if r.get("error") else "")
        )
    return "\n".join(out)


def _run_action(a: dict) -> dict:
    action = a.get("action")
    if action == "queue":
        url = a.get("url")
        if not url:
            return {"action": action, "error": "no url"}
        did = _queue(url, a.get("kind", "file"), a.get("title"),
                     a.get("quality"), a.get("library"))
        return {"action": action, "id": did, "url": url}
    did = a.get("id")
    if not did or not db.get_download(did):
        return {"action": action, "error": f"no download with id {did}"}
    fn = {"pause": manager.pause, "resume": manager.resume,
          "retry": manager.resume, "cancel": manager.cancel}.get(action)
    if not fn:
        return {"action": action, "error": "unknown action"}
    fn(did)
    return {"action": action, "id": did}


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
    """Run one user message. Returns {reply, actions}. Raises AIError if unavailable."""
    convo = ""
    for h in (history or [])[-6:]:
        convo += f"{str(h.get('role', 'user')).upper()}: {h.get('content', '')}\n"
    user = f"Current downloads:\n{_snapshot()}\n\n{convo}USER: {message}"
    out = client.call_json("smart", _SYSTEM, user, _SCHEMA, max_tokens=1024)
    actions = [_run_action(a) for a in (out.get("actions") or [])]
    return {"reply": out.get("reply", ""), "actions": actions}
