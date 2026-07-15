# Claude via subscription CLI (not just the API), and CI-published images

**Extends ADR 0002** (Claude integration + tiered models) with a second provider
backend, and **extends ADR 0007** (Docker on Synology) with how the image reaches
the NAS.

**Context.** ADR 0002 assumed the metered Anthropic **API** (a key, pay-per-token).
The user already pays for a Claude **subscription** and would rather spend that than
add a second bill. The subscription can be driven programmatically through the
**Claude Code CLI** (`claude -p`), authenticated headlessly with a token from
`claude setup-token` (`CLAUDE_CODE_OAUTH_TOKEN`). Separately, building the image on
a Synology is painful (weak CPU, no Node); CI should build it and the NAS should
just pull.

**Decision.**
- **Two AI backends behind one interface** (`cove/ai/provider.py`), selected by
  `COVE_AI_PROVIDER`:
  - `cli` — shell out to the Claude Code CLI; uses the subscription, no per-token bill.
  - `api` — the Anthropic SDK with a key (the ADR 0002 path).
  - `auto` (default) — API key if one is set, otherwise the CLI.
  Features ask for a **tier** (`cheap`/`smart`/`max`), which each backend maps to a
  model (API: pinned ids; CLI: `haiku`/`sonnet`/`opus` aliases, whatever the plan grants).
- **Structured output is prompt-driven JSON, not API tool-forcing.** The CLI can't pin
  `tool_choice`, so intake/naming/chat ask for a JSON object and parse it — one code
  path that works on both backends. Chat becomes a single-shot "reply + actions" call
  (the queue is handed to the model as context) instead of an API-only live tool-loop.
- **The runtime image bundles the Claude Code CLI** (Node + the global package copied
  from a `node:22` stage). Auth is runtime-only via `CLAUDE_CODE_OAUTH_TOKEN`; the CLI's
  config lives on the `/config` volume.
- **A GitHub Action publishes the image to GHCR** on push; the NAS runs
  `docker compose pull && docker compose up -d`. Compose keeps `build: .` as a local
  fallback.

**Consequences.**
- No API key is required to use the Claude features — a subscription token is enough.
  Everything still degrades cleanly to "AI unavailable" when neither is set (ADR 0002).
- Using a personal subscription as an always-on service backend is a **gray area** in
  Anthropic's terms; this is a deliberate user choice for personal, single-tenant use,
  not a recommendation for shared/production deployments.
- The image is larger (it carries Node + the CLI). Acceptable for a NAS appliance.
- The published GHCR package must be made public, or the NAS must `docker login ghcr.io`
  with a read token, to pull it.
