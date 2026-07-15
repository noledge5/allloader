import os
import subprocess
import sys
import threading
import webbrowser

from flask import Flask, jsonify, render_template, request

from downloader import Manager

app = Flask(__name__)
manager = Manager()

DEFAULT_DIR = os.path.join(os.path.expanduser("~"), "Downloads", "resume-download-gui")


@app.route("/")
def index():
    return render_template("index.html", default_dir=DEFAULT_DIR)


@app.route("/api/tasks", methods=["GET"])
def list_tasks():
    return jsonify(manager.list_tasks())


@app.route("/api/tasks", methods=["POST"])
def add_task():
    data = request.get_json(force=True) or {}
    url = (data.get("url") or "").strip()
    if not url:
        return jsonify({"error": "url required"}), 400

    output_dir = (data.get("output_dir") or DEFAULT_DIR).strip() or DEFAULT_DIR
    kind = (data.get("kind") or "file").strip()

    if kind == "video":
        audio_only = bool(data.get("audio_only"))
        quality = (data.get("quality") or "best").strip() or "best"
        task_id = manager.add_video(url, output_dir, audio_only, quality)
        return jsonify({"id": task_id})

    filename = (data.get("filename") or "").strip() or None
    headers = {}
    raw_header = (data.get("header") or "").strip()
    if raw_header:
        name, _, value = raw_header.partition(":")
        if name.strip():
            headers[name.strip()] = value.strip()

    task_id = manager.add(url, output_dir, filename, headers)
    return jsonify({"id": task_id})


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


@app.route("/api/tasks/<task_id>/open-folder", methods=["POST"])
def open_folder(task_id):
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
    port = int(os.environ.get("PORT", 5000))
    threading.Timer(1.0, lambda: webbrowser.open(f"http://127.0.0.1:{port}")).start()
    app.run(host="127.0.0.1", port=port, debug=False)
