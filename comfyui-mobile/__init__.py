"""ComfyUI Mobile — a touch-friendly phone UI served by ComfyUI itself.

Drop this folder into ComfyUI's ``custom_nodes`` directory. It adds no nodes;
it only registers a route that serves the web app in ``app/`` under
``/mobile``. Because the app is served from the same origin as ComfyUI, it can
talk to the normal ComfyUI API and websocket without any CORS setup.
"""

import asyncio
import json
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


# --- autoprompter ----------------------------------------------------------------
#
# The phone never sees the API key: settings live on this PC and the request
# to the language model is made from here. Any OpenAI-compatible endpoint
# works (OpenAI, OpenRouter, or a local LM Studio / Ollama server).

PROVIDERS = {
    "openrouter": "https://openrouter.ai/api/v1",
    "openai": "https://api.openai.com/v1",
}
ENV_KEYS = {"openrouter": "OPENROUTER_API_KEY", "openai": "OPENAI_API_KEY"}
DEFAULT_SETTINGS = {
    "provider": "openrouter",
    "base_url": "",
    # One key per provider, so a key can only ever go to the service it was
    # entered for (the "custom" key is dropped whenever the address changes).
    "api_keys": {},
    "model": "",
    "prompt_style": "natural",
    "instructions": "",
}


def _settings_path():
    import folder_paths

    # System user directories ("__name") are never served over HTTP.
    try:
        base = folder_paths.get_system_user_directory("comfyui_mobile")
    except Exception:
        base = os.path.join(folder_paths.get_user_directory(), "__comfyui_mobile")
    return os.path.join(base, "settings.json")


def _load_settings():
    settings = dict(DEFAULT_SETTINGS, api_keys={})
    try:
        with open(_settings_path(), encoding="utf-8") as f:
            settings.update({k: v for k, v in json.load(f).items() if k in DEFAULT_SETTINGS})
    except (OSError, ValueError):
        pass
    if not isinstance(settings["api_keys"], dict):
        settings["api_keys"] = {}
    return settings


def _save_settings(settings):
    path = _settings_path()
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(settings, f, indent=2)
    os.replace(tmp, path)


def _base_url(settings):
    if settings["provider"] == "custom":
        return settings["base_url"].strip().rstrip("/")
    return PROVIDERS.get(settings["provider"], PROVIDERS["openrouter"])


def _stored_key(settings):
    return settings["api_keys"].get(settings["provider"], "")


def _api_key(settings):
    env = ENV_KEYS.get(settings["provider"])
    return _stored_key(settings) or (os.environ.get(env, "") if env else "")


def _public_settings(settings):
    key = _api_key(settings)
    out = {k: v for k, v in settings.items() if k != "api_keys"}
    out["has_key"] = bool(key)
    out["key_hint"] = key[-4:] if len(key) >= 8 else ""
    out["key_from_env"] = bool(key) and not _stored_key(settings)
    out["configured"] = bool(settings["model"]) and (bool(key) or settings["provider"] == "custom")
    return out


def _headers(settings):
    headers = {"Content-Type": "application/json"}
    key = _api_key(settings)
    if key:
        headers["Authorization"] = f"Bearer {key}"
    if settings["provider"] == "openrouter":
        headers["X-Title"] = "ComfyUI Mobile"
    return headers


STYLE_HINTS = {
    "photo": "photorealistic photograph, natural light, realistic detail",
    "cinematic": "cinematic film still, dramatic lighting, shallow depth of field",
    "anime": "anime style illustration",
    "illustration": "digital illustration",
    "3d": "3D render",
    "painting": "oil painting",
    "watercolor": "watercolor painting",
    "pixel": "pixel art",
}

MODE_TASKS = {
    "expand": "Turn the user's idea into one detailed prompt for a text-to-image model. "
    "Describe subject, setting, composition, lighting, colors and mood concretely.",
    "improve": "Improve the given prompt for a text-to-image model: keep its subject and intent, "
    "make it clearer and more concrete, fix grammar.",
    "variation": "Write a variation of the given prompt for a text-to-image model: keep the core subject, "
    "but change details such as setting, composition, lighting or mood.",
    "negative": "Write a negative prompt for the given image prompt: things that should not appear "
    "and typical image defects to avoid.",
}


def _system_prompt(settings, mode, style):
    parts = [
        "You write prompts for AI image generation.",
        MODE_TASKS[mode],
        "The input may be in any language; always answer in English.",
    ]
    if mode == "negative":
        parts.append("Answer as a comma-separated list of short terms.")
    elif settings["prompt_style"] == "tags":
        parts.append("Answer as comma-separated booru-style tags, most important first.")
    else:
        parts.append("Answer in natural language, about 40 to 90 words.")
    if style in STYLE_HINTS and mode != "negative":
        parts.append(f"The image style must be: {STYLE_HINTS[style]}.")
    if settings["instructions"].strip():
        parts.append("Additional instructions from the user: " + settings["instructions"].strip())
    parts.append("Reply with the prompt only: no introduction, no quotes, no markdown.")
    return " ".join(parts)


def _clean_reply(text):
    text = text.strip()
    for prefix in ("Prompt:", "prompt:", "Negative prompt:", "Negative Prompt:"):
        if text.startswith(prefix):
            text = text[len(prefix):].strip()
    if len(text) >= 2 and text[0] == text[-1] and text[0] in "\"'`":
        text = text[1:-1].strip()
    return text.strip("`").strip()


def _message_text(content):
    if isinstance(content, list):
        return "".join(p.get("text", "") for p in content if isinstance(p, dict))
    return content or ""


async def _llm_request(settings, method, path, payload=None, timeout=90):
    import aiohttp

    base = _base_url(settings)
    if not base:
        raise web.HTTPBadRequest(text="Keine Adresse für den Autoprompter eingestellt.")
    try:
        async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=timeout)) as session:
            async with session.request(method, base + path, headers=_headers(settings), json=payload) as resp:
                try:
                    data = await resp.json(content_type=None)
                except ValueError:
                    data = {}
                if resp.status >= 400:
                    err = data.get("error") if isinstance(data, dict) else None
                    msg = err.get("message") if isinstance(err, dict) else err
                    raise web.HTTPBadGateway(text=f"{resp.status}: {msg or resp.reason}")
                return data
    except aiohttp.ClientError as e:
        raise web.HTTPBadGateway(text=f"Keine Verbindung zu {base}: {e}")
    except (TimeoutError, asyncio.TimeoutError):
        raise web.HTTPGatewayTimeout(text="Das Sprachmodell hat nicht rechtzeitig geantwortet.")


@routes.get(ROUTE + "/api/autoprompt/settings")
async def autoprompt_get_settings(request):
    return web.json_response(_public_settings(_load_settings()))


@routes.post(ROUTE + "/api/autoprompt/settings")
async def autoprompt_set_settings(request):
    data = await request.json()
    settings = _load_settings()
    old_base = settings["base_url"]
    for key in ("provider", "base_url", "model", "prompt_style", "instructions"):
        if isinstance(data.get(key), str):
            settings[key] = data[key].strip() if key != "instructions" else data[key]
    if settings["provider"] not in (*PROVIDERS, "custom"):
        settings["provider"] = "openrouter"
    if settings["prompt_style"] not in ("natural", "tags"):
        settings["prompt_style"] = "natural"
    if settings["base_url"] != old_base:
        settings["api_keys"].pop("custom", None)
    if isinstance(data.get("api_key"), str) and data["api_key"].strip():
        settings["api_keys"][settings["provider"]] = data["api_key"].strip()
    if data.get("clear_key"):
        settings["api_keys"].pop(settings["provider"], None)
    _save_settings(settings)
    return web.json_response(_public_settings(settings))


@routes.get(ROUTE + "/api/autoprompt/models")
async def autoprompt_models(request):
    settings = _load_settings()
    data = await _llm_request(settings, "GET", "/models", timeout=30)
    models = data.get("data", data.get("models", [])) if isinstance(data, dict) else []
    out = []
    for m in models:
        if isinstance(m, dict) and m.get("id"):
            out.append({"id": m["id"], "name": m.get("name") or m["id"]})
    out.sort(key=lambda m: m["id"].lower())
    return web.json_response(out)


@routes.post(ROUTE + "/api/autoprompt/run")
async def autoprompt_run(request):
    data = await request.json()
    settings = _load_settings()
    if not settings["model"]:
        raise web.HTTPBadRequest(text="Im Tab System ist noch kein Modell für den Autoprompter gewählt.")
    mode = data.get("mode") if data.get("mode") in MODE_TASKS else "expand"
    text = str(data.get("text") or "").strip()
    wish = str(data.get("wish") or "").strip()
    positive = str(data.get("positive") or "").strip() if mode == "negative" else ""
    if not text and not wish and not positive:
        raise web.HTTPBadRequest(text="Schreib zuerst eine Idee ins Prompt-Feld.")
    user = text or wish
    if text and wish:
        user = f"{text}\n\nExtra wishes: {wish}"
    if positive:
        user = f"Image prompt: {positive}\n\nCurrent negative prompt: {text or '(empty)'}"
    payload = {
        "model": settings["model"],
        "messages": [
            {"role": "system", "content": _system_prompt(settings, mode, data.get("style"))},
            {"role": "user", "content": user},
        ],
    }
    reply = await _llm_request(settings, "POST", "/chat/completions", payload)
    try:
        content = _message_text(reply["choices"][0]["message"]["content"])
    except (KeyError, IndexError, TypeError):
        raise web.HTTPBadGateway(text="Unerwartete Antwort vom Sprachmodell.")
    result = _clean_reply(content)
    if not result:
        raise web.HTTPBadGateway(text="Das Sprachmodell hat eine leere Antwort geschickt.")
    return web.json_response({"text": result, "model": reply.get("model", settings["model"])})


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
