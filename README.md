# Cove

A self-hosted **media-acquisition** tool for your NAS. Cove downloads files and
videos — resumable, scheduled, and queued — and drops them into a Plex/Jellyfin
folder layout. Those apps do the playback; Cove does the getting. It runs as a
single Docker container on a Synology (or any Docker host) and is reachable from
any device on your LAN.

> Scope, in one line: **Cove = acquisition. Plex/Jellyfin = playback.** See
> `docs/adr/0007-acquisition-tool-on-synology.md` for why.

## Features

- **Resumable downloads** — large files (20 GB+ models, ISOs) resume after a
  pause or a dropped connection via HTTP Range requests; nothing re-downloads.
- **Video & audio** — yt-dlp behind the scenes, with a quality cap (best/4K/1080/720)
  and mp4 preference for direct play. Bundled ffmpeg, no separate install.
- **Sources** — save an origin (RSS feed, YouTube channel, watch folder,
  aniworld series, direct link) and re-scan it on demand for new items.
- **Streamhoster support** — enumerates aniworld-style episode pages and their
  hosters (VOE, Doodstream, Filemoon…). Actual stream extraction goes through
  pluggable **resolvers** plus a generic headless-browser fallback; Cove ships
  **no per-host circumvention** (`docs/adr/0001-streamhoster-resolution.md`).
- **Planner** — off-peak schedule grid and batch jobs so big pulls run overnight.
- **Live progress** — a WebSocket pushes progress to every open device at once.
- **Claude assistant** (optional) — natural-language intake ("grab this playlist
  as audio"), a chat panel that drives the queue, failure triage, and title
  cleanup. Tiered models (Haiku/Sonnet/Opus). Powered by **either your Claude
  subscription** (via the Claude Code CLI, no per-token bill) **or an Anthropic
  API key** (`docs/adr/0002-claude-integration.md`, `docs/adr/0008-…`). Everything
  works without it.

## Run it on Synology (Docker)

The image is built by CI and published to GHCR, so the NAS just pulls it — no
building on the Synology.

1. Put `docker-compose.yml` and `.env.example` on the NAS. `cp .env.example .env`
   and edit:
   - `COVE_NAS_PATH` → the share where downloads should land (e.g.
     `/volume1/media`), the *same* folder Plex/Jellyfin already watch.
   - Claude (optional) — pick one:
     - **Subscription:** on any machine you're logged into Claude Code with, run
       `claude setup-token` and paste the token into `CLAUDE_CODE_OAUTH_TOKEN`.
     - **API key:** set `ANTHROPIC_API_KEY` instead (it wins if both are set).
2. Pull and start:
   ```sh
   docker compose pull && docker compose up -d
   ```
   (First run: make the GHCR package public, or `docker login ghcr.io` with a
   read token, so the NAS can pull it. To build locally instead of pulling:
   `docker compose up -d --build`.)
3. Open `http://<nas-ip>:5100`.

State (the download queue and the Claude CLI config) lives in the `/config`
volume and survives container recreation. There is no login — Cove is meant for
your LAN only (`docs/adr/0003-lan-no-auth.md`).

## Run it for development

Backend (Python 3.12):
```sh
pip install -r requirements.txt
python -m playwright install chromium      # only needed for the headless resolver
python -m cove                             # serves API on :5100
```

Frontend (Node, dev-only — the container serves a prebuilt bundle):
```sh
cd web
npm install
npm run dev        # Vite dev server on :5173, proxies /api to :5100
```
To produce the bundle the backend serves: `npm run build` → `web/dist`.

Useful env vars (all optional; see `cove/config.py`): `COVE_NAS_BASE`,
`COVE_DB`, `COVE_PORT`, `COVE_MAX_CONCURRENT`, `COVE_AI_PROVIDER`
(`auto`/`cli`/`api`), `CLAUDE_CODE_OAUTH_TOKEN` or `ANTHROPIC_API_KEY`,
`COVE_MODEL_CHEAP` / `COVE_MODEL_SMART` / `COVE_MODEL_MAX`.

## Streamhosters & resolvers

Cove enumerates episodes and hosters but does not include per-host stream
extraction. To resolve a given hoster to a playable URL, drop a resolver plugin
into `cove/resolvers/plugins/` (or a folder named in `$COVE_RESOLVER_PLUGINS`) —
see `cove/resolvers/plugins/README.md`. If no plugin matches, a headless Chromium
sniffs the page's network traffic for a stream URL as a best-effort fallback.

## Layout

```
cove/            FastAPI backend
  engine/        download manager, resumable HTTP, yt-dlp video
  adapters/      direct / youtube / rss / watchfolder / aniworld
  resolvers/     streamhoster resolver plugin slot + headless fallback
  ai/            Claude workflow layer (intake, chat, triage, naming)
  api/routes.py  REST + WebSocket
web/             React + Vite frontend (built into web/dist)
docs/adr/        architecture decisions
CONTEXT.md       domain glossary
Dockerfile       multi-stage: build web bundle, then Python runtime
docker-compose.yml
```

## Architecture decisions

The `docs/adr/` folder records the significant calls: streamhoster handling
(0001), Claude tiers (0002), LAN/no-auth (0003), design reconciliation (0004),
the stack (0005), the media-center pivot and its reversal (0006 → superseded by
0007, the acquisition-on-Synology scope), and the subscription-CLI Claude
provider + CI-published images (0008).
