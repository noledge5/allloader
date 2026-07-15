"""Cove FastAPI application: mounts the JSON + WebSocket API and, when built,
serves the React bundle from web/dist. Run with:  python -m cove
"""

import asyncio
import os

from fastapi import FastAPI
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from . import config, db
from .api.routes import router
from .engine.manager import manager

app = FastAPI(title="Cove", version="0.1.0")
app.include_router(router)


@app.on_event("startup")
async def _startup():
    db.connect()
    manager.start(asyncio.get_running_loop())


@app.on_event("shutdown")
async def _shutdown():
    manager.stop()


@app.get("/api/health")
def health():
    return {
        "ok": True,
        "nas_base": str(config.NAS_BASE),
        "web_built": config.WEB_DIST.exists(),
    }


# Serve the compiled frontend when present (Phase 4). Until then, a helpful stub.
if config.WEB_DIST.exists():
    app.mount("/assets", StaticFiles(directory=str(config.WEB_DIST / "assets")), name="assets")

    @app.get("/{full_path:path}")
    def spa(full_path: str):
        candidate = config.WEB_DIST / full_path
        if full_path and candidate.is_file():
            return FileResponse(str(candidate))
        return FileResponse(str(config.WEB_DIST / "index.html"))
else:
    @app.get("/")
    def root():
        return JSONResponse({
            "app": "Cove",
            "status": "backend running; frontend not built yet",
            "api": "/api/health",
        })


def run():
    import uvicorn
    uvicorn.run("cove.main:app", host=config.HOST, port=config.PORT, reload=config.DEBUG)


if __name__ == "__main__":
    run()
