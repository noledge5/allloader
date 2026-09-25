import hashlib
import hmac
import os
import subprocess
import sys
import threading
import webbrowser
from datetime import timedelta
from urllib.parse import urlparse

from flask import Flask, jsonify, redirect, render_template, request, send_from_directory, session

from downloader import Manager

# Everything that differs between "local app on Windows" and "container on a
# NAS" comes from environment variables; the defaults are the local app.
HOST = os.environ.get("HOST", "127.0.0.1")
PORT = int(os.environ.get("PORT", 5000))
PASSWORD = os.environ.get("ALLLOADER_PASSWORD", "")
OPEN_BROWSER = os.environ.get("OPEN_BROWSER", "1") != "0"
DEFAULT_DIR = os.environ.get("DOWNLOAD_DIR") or os.path.join(
    os.path.expanduser("~"), "Downloads", "resume-download-gui"
)
# Opening a folder in the file manager only makes sense on the machine itself.
LOCAL = HOST in ("127.0.0.1", "localhost", "::1")

STATIC_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")

app = Flask(__name__)
app.secret_key = hashlib.sha256(("allloader-session:" + PASSWORD).encode()).digest()
app.permanent_session_lifetime = timedelta(days=90)
manager = Manager()


def _parse_roots(raw):
    """DOWNLOAD_ROOTS="Downloads=/downloads,/models" -> allowed target folders.

    When set, downloads may only be written inside these folders (the app is
    reachable from the whole network then). Unset means no restriction, as
    in the local Windows app.
    """
    roots = []
    for item in raw.split(","):
        item = item.strip()
        if not item:
            continue
        name, sep, path = item.partition("=")
        if not sep:
            name, path = "", item
        path = os.path.realpath(path.strip())
        if os.path.isdir(path):
            roots.append({"name": name.strip() or os.path.basename(path) or path, "path": path})
    return roots


ROOTS = _parse_roots(os.environ.get("DOWNLOAD_ROOTS", ""))
if ROOTS and not os.environ.get("DOWNLOAD_DIR"):
    DEFAULT_DIR = ROOTS[0]["path"]

VIDEO_HOSTS = (
    "youtube.com", "youtu.be", "vimeo.com", "tiktok.com", "twitter.com", "x.com",
    "instagram.com", "reddit.com", "redd.it", "soundcloud.com", "twitch.tv",
    "dailymotion.com", "facebook.com", "fb.watch", "bilibili.com", "streamable.com",
    "bandcamp.com", "mixcloud.com", "arte.tv", "ardmediathek.de", "zdf.de",
)


def _guess_kind(url):
    host = (urlparse(url).hostname or "").lower()
    return "video" if any(host == h or host.endswith("." + h) for h in VIDEO_HOSTS) else "file"


def _allowed_dir(path):
    """Real path of `path` if downloads may go there, else None."""
    if not ROOTS:
        return path
    real = os.path.realpath(path)
    for root in ROOTS:
        if os.path.commonpath((real, root["path"])) == root["path"]:
            return real
    return None


# --- login (only when ALLLOADER_PASSWORD is set) ------------------------------


def _session_token():
    return hashlib.sha256(("allloader-auth:" + PASSWORD).encode()).hexdigest()


def _password_ok(supplied):
    return bool(supplied) and hmac.compare_digest(supplied.encode(), PASSWORD.encode())


@app.before_request
def require_login():
    if not PASSWORD:
        return None
    if request.path.startswith("/static/") or request.path in ("/login", "/manifest.webmanifest"):
        return None
    if hmac.compare_digest(session.get("auth", ""), _session_token()):
        return None
    # iOS Shortcuts and scripts send the password as a header instead.
    header = request.headers.get("Authorization", "")
    supplied = header[7:].strip() if header.lower().startswith("bearer ") else request.headers.get("X-Allloader-Password", "")
    if _password_ok(supplied):
        return None
    if request.path.startswith("/api/"):
        return jsonify({"error": "Passwort erforderlich"}), 401
    return redirect("/login?next=" + request.full_path.rstrip("?"))


@app.route("/login", methods=["GET", "POST"])
def login():
    next_url = request.values.get("next") or "/"
    if not next_url.startswith("/") or next_url.startswith("//"):
        next_url = "/"
    if not PASSWORD:
        return redirect(next_url)
    error = None
    if request.method == "POST":
        if _password_ok(request.form.get("password", "")):
            session.permanent = True
            session["auth"] = _session_token()
            return redirect(next_url)
        error = "Falsches Passwort."
    return render_template("login.html", error=error, next_url=next_url), (401 if error else 200)


@app.route("/logout", methods=["POST"])
def logout():
    session.clear()
    return redirect("/login")


# --- pages ------------------------------------------------------------------------


@app.route("/")
def index():
    return render_template("index.html", default_dir=DEFAULT_DIR)


@app.route("/manifest.webmanifest")
def manifest():
    return send_from_directory(STATIC_DIR, "manifest.webmanifest", mimetype="application/manifest+json")


@app.route("/api/config")
def config():
    return jsonify(
        {
            "roots": ROOTS,
            "default_dir": DEFAULT_DIR,
            "can_open_folder": LOCAL,
            "auth": bool(PASSWORD),
        }
    )


# --- folders (only with DOWNLOAD_ROOTS) ---------------------------------------


def _root_of(real):
    for root in ROOTS:
        if os.path.commonpath((real, root["path"])) == root["path"]:
            return root
    return None


@app.route("/api/folders", methods=["GET"])
def list_folders():
    if not ROOTS:
        return jsonify({"error": "Keine Zielordner konfiguriert (DOWNLOAD_ROOTS)."}), 400
    real = _allowed_dir(request.args.get("path") or ROOTS[0]["path"])
    if not real or not os.path.isdir(real):
        return jsonify({"error": "Ordner nicht erlaubt oder nicht vorhanden."}), 404
    try:
        folders = sorted(
            (e.name for e in os.scandir(real) if e.is_dir() and not e.name.startswith((".", "@", "#"))),
            key=str.lower,
        )
    except OSError as e:
        return jsonify({"error": str(e)}), 500
    root = _root_of(real)
    return jsonify({"path": real, "root": root, "folders": folders})


@app.route("/api/folders", methods=["POST"])
def create_folder():
    data = request.get_json(force=True) or {}
    parent = _allowed_dir(data.get("path") or "")
    name = (data.get("name") or "").strip()
    if not parent or not os.path.isdir(parent):
        return jsonify({"error": "Ordner nicht erlaubt."}), 403
    if not name or name in (".", "..") or any(c in name for c in '/\\:*?"<>|'):
        return jsonify({"error": "Ungültiger Ordnername."}), 400
    path = os.path.join(parent, name)
    try:
        os.makedirs(path, exist_ok=True)
    except OSError as e:
        return jsonify({"error": str(e)}), 500
    return jsonify({"path": path})


# --- tasks ------------------------------------------------------------------------


@app.route("/api/tasks", methods=["GET"])
def list_tasks():
    return jsonify(manager.list_tasks())


@app.route("/api/tasks", methods=["POST"])
def add_task():
    data = request.get_json(force=True, silent=True) or request.form.to_dict() or {}
    url = (data.get("url") or "").strip()
    if not url:
        return jsonify({"error": "url required"}), 400

    output_dir = (data.get("output_dir") or DEFAULT_DIR).strip() or DEFAULT_DIR
    allowed = _allowed_dir(output_dir)
    if not allowed:
        return jsonify({"error": f"Zielordner nicht erlaubt: {output_dir}"}), 403
    output_dir = allowed

    kind = (data.get("kind") or "file").strip()
    if kind == "auto":
        kind = _guess_kind(url)

    if kind in ("video", "audio"):
        audio_only = kind == "audio" or str(data.get("audio_only")).lower() in ("1", "true")
        quality = (data.get("quality") or "best").strip() or "best"
        task_id = manager.add_video(url, output_dir, audio_only, quality)
        return jsonify({"id": task_id, "kind": "video"})

    filename = (data.get("filename") or "").strip() or None
    if filename:
        filename = os.path.basename(filename)
    headers = {}
    raw_header = (data.get("header") or "").strip()
    if raw_header:
        name, _, value = raw_header.partition(":")
        if name.strip():
            headers[name.strip()] = value.strip()

    task_id = manager.add(url, output_dir, filename, headers)
    return jsonify({"id": task_id, "kind": "file"})


@app.route("/api/tasks/<task_id>/pause", methods=["POST"])
def pause_task(task_id):
    manager.pause(task_id)
    return jsonify({"ok": True})


@app.route("/api/tasks/<task_id>/resume", methods=["POST"])
def resume_task(task_id):
    manager.resume(task_id)
    return jsonify({"ok": True})


@app.route("/api/tasks/<task_id>/cancel", methods=["POST"])
def cancel_task(task_id):
    manager.cancel(task_id)
    return jsonify({"ok": True})


@app.route("/api/tasks/<task_id>", methods=["DELETE"])
def remove_task(task_id):
    manager.remove(task_id)
    return jsonify({"ok": True})


@app.route("/api/tasks/clear-finished", methods=["POST"])
def clear_finished():
    return jsonify({"removed": manager.remove_finished()})


@app.route("/api/tasks/<task_id>/open-folder", methods=["POST"])
def open_folder(task_id):
    if not LOCAL:
        return jsonify({"error": "Ordner öffnen geht nur direkt am Rechner."}), 400
    task = manager.get(task_id)
    if not task:
        return jsonify({"error": "not found"}), 404
    path = task.output_dir
    if not os.path.isdir(path):
        return jsonify({"error": f"Ordner existiert (noch) nicht: {path}"}), 404
    try:
        if sys.platform == "win32":
            os.startfile(path)  # noqa: S606 - local-only server, user's own folder
        elif sys.platform == "darwin":
            subprocess.Popen(["open", path])
        else:
            subprocess.Popen(["xdg-open", path])
        return jsonify({"ok": True})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


if __name__ == "__main__":
    if OPEN_BROWSER and LOCAL:
        threading.Timer(1.0, lambda: webbrowser.open(f"http://127.0.0.1:{PORT}")).start()
    app.run(host=HOST, port=PORT, debug=False, threaded=True)
