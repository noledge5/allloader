"""ComfyUI Mobile — a touch-friendly phone UI served by ComfyUI itself.

Drop this folder into ComfyUI's ``custom_nodes`` directory. It adds no nodes;
it only registers a route that serves the web app in ``app/`` under
``/mobile``. Because the app is served from the same origin as ComfyUI, it can
talk to the normal ComfyUI API and websocket without any CORS setup.
"""

import logging
import os
import socket

from aiohttp import web
from server import PromptServer

NODE_CLASS_MAPPINGS = {}
NODE_DISPLAY_NAME_MAPPINGS = {}

ROUTE = "/mobile"
APP_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "app")

# Explicit types: Windows' registry-based mimetypes lookup is unreliable and
# browsers refuse ES modules that aren't served as JavaScript.
CONTENT_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json",
    ".webmanifest": "application/manifest+json",
    ".svg": "image/svg+xml",
    ".png": "image/png",
}


def _lan_ips():
    ips = []
    try:
        # Connecting a UDP socket sends nothing; it just picks the outbound interface.
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("10.255.255.255", 1))
            ips.append(s.getsockname()[0])
    except OSError:
        pass
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            ip = info[4][0]
            if ip not in ips and not ip.startswith("127."):
                ips.append(ip)
    except OSError:
        pass
    return ips


def _server_config():
    try:
        from comfy.cli_args import args

        return args.listen or "127.0.0.1", args.port
    except Exception:
        return "127.0.0.1", 8188


def _loopback_only(listen):
    hosts = [h.strip() for h in str(listen).split(",") if h.strip()]
    return all(h in ("127.0.0.1", "localhost", "::1") for h in hosts)


def _phone_urls():
    listen, port = _server_config()
    if _loopback_only(listen):
        return []
    return [f"http://{ip}:{port}{ROUTE}/" for ip in _lan_ips()]


routes = PromptServer.instance.routes


@routes.get(ROUTE)
async def mobile_redirect(request):
    raise web.HTTPFound(ROUTE + "/")


@routes.get(ROUTE + "/info")
async def mobile_info(request):
    listen, port = _server_config()
    return web.json_response(
        {
            "listen": listen,
            "port": port,
            "loopback_only": _loopback_only(listen),
            "phone_urls": _phone_urls(),
        }
    )


@routes.get(ROUTE + "/{path:.*}")
async def mobile_static(request):
    rel = request.match_info["path"] or "index.html"
    full = os.path.abspath(os.path.join(APP_DIR, rel))
    if os.path.commonpath((APP_DIR, full)) != APP_DIR or not os.path.isfile(full):
        raise web.HTTPNotFound()
    ext = os.path.splitext(full)[1].lower()
    headers = {"Cache-Control": "no-cache"}
    if ext in CONTENT_TYPES:
        headers["Content-Type"] = CONTENT_TYPES[ext]
    return web.FileResponse(full, headers=headers)


def _announce():
    listen, port = _server_config()
    if _loopback_only(listen):
        logging.warning(
            "[ComfyUI Mobile] ComfyUI hört nur auf %s — das Handy kann sich so nicht verbinden. "
            "ComfyUI Desktop: Einstellungen → Server-Config → Host auf 0.0.0.0 stellen und neu starten. "
            "Am PC selbst: http://127.0.0.1:%s%s/",
            listen,
            port,
            ROUTE,
        )
        return
    for url in _phone_urls():
        logging.info("[ComfyUI Mobile] Auf dem Handy öffnen: %s", url)


_announce()
