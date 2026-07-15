# Cove — multi-stage image for Synology Container Manager (ADR 0007, 0008).
# Stage 1 builds the React bundle, stage 2 installs the Claude Code CLI, and the
# Python runtime pulls both in — no Node needed at runtime except to run the CLI.

# ---- stage 1: build the web bundle ----------------------------------------
FROM node:22-slim AS web
WORKDIR /web
COPY web/package.json web/package-lock.json* ./
RUN npm install --no-audit --no-fund
COPY web/ ./
RUN npm run build          # -> /web/dist

# ---- stage 2: the Claude Code CLI (subscription provider, ADR 0008) --------
FROM node:22-slim AS clitools
RUN npm install -g @anthropic-ai/claude-code

# ---- stage 3: python runtime ----------------------------------------------
FROM python:3.12-slim AS runtime

# Playwright needs a writable, predictable browser location; the headless
# resolver (ADR 0001) reads PLAYWRIGHT_BROWSERS_PATH.
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    COVE_HOST=0.0.0.0 \
    COVE_PORT=5100 \
    COVE_NAS_BASE=/nas \
    COVE_DB=/config/cove_state.sqlite3 \
    COVE_WEB_DIST=/app/web/dist \
    # AI provider: "auto" uses an API key if set, else the subscription CLI.
    COVE_CLAUDE_BIN=/usr/local/bin/claude \
    CLAUDE_CONFIG_DIR=/config/.claude

WORKDIR /app

COPY requirements.txt ./
RUN pip install -r requirements.txt \
    && python -m playwright install --with-deps chromium

# Node + the globally-installed Claude Code CLI (authenticates at runtime via
# CLAUDE_CODE_OAUTH_TOKEN — the user's subscription). node:22 and python:3.12
# share a Debian base, so the copied node binary runs as-is.
COPY --from=clitools /usr/local/bin/node /usr/local/bin/node
COPY --from=clitools /usr/local/lib/node_modules /usr/local/lib/node_modules
COPY --from=clitools /usr/local/bin/claude /usr/local/bin/claude

COPY cove/ ./cove/
COPY --from=web /web/dist ./web/dist

# /config holds the SQLite state + Claude CLI config; /nas is the NAS share.
VOLUME ["/config", "/nas"]
EXPOSE 5100

CMD ["python", "-m", "cove"]
