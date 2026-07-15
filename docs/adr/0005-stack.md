# Stack: FastAPI + WebSocket backend, React static-bundle frontend

**Decision.**
- **Backend:** FastAPI with a WebSocket channel for live download progress, so
  couch/phone/TV clients on the LAN see real-time updates (not polling). Pydantic
  models double as the schema for Claude structured outputs. The allloader download
  engine (resumable HTTP + yt-dlp video) is carried over.
- **Frontend:** the design is built as a React/Vite app and compiled to a static
  bundle that FastAPI serves. **Runtime is Python-only** — the user never needs Node to
  *run* Cove; Node is a dev/build-time dependency only.
- **Persistence:** a single SQLite file on the PC (sources, downloads, batches,
  schedule windows, settings; the Catalog is derived from completed downloads).

**Why it's recorded.** Framework and runtime choices carry lock-in and set the whole
project's shape. The non-obvious part is the frontend split: shipping a *compiled*
bundle keeps the double-click, Python-only runtime of the allloader app while still
honoring a React design — a future reader will otherwise wonder why there's a build
step for the UI but no Node requirement to run the app.

**Consequences.** Editing the UI requires `npm`/Vite; a build produces `web/dist/`,
which the backend mounts as static files. `start.bat` runs uvicorn bound to `0.0.0.0`
(LAN, per ADR 0003). The engine code moves from the flat allloader scripts into a
`cove/` package.
