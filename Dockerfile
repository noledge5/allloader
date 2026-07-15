# Cove — multi-stage image for Synology Container Manager (ADR 0007).
# Stage 1 builds the React bundle with Node; the runtime image is Python-only.

# ---- stage 1: build the web bundle ----------------------------------------
FROM node:20-slim AS web
WORKDIR /web
COPY web/package.json web/package-lock.json* ./
RUN npm install --no-audit --no-fund
COPY web/ ./
RUN npm run build          # -> /web/dist

# ---- stage 2: python runtime ----------------------------------------------
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
    COVE_WEB_DIST=/app/web/dist

WORKDIR /app

COPY requirements.txt ./
RUN pip install -r requirements.txt \
    && python -m playwright install --with-deps chromium

COPY cove/ ./cove/
COPY --from=web /web/dist ./web/dist

# /config holds the SQLite state file; /nas is the mounted NAS share.
VOLUME ["/config", "/nas"]
EXPOSE 5100

CMD ["python", "-m", "cove"]
