# allloader als Container, z.B. für den Container Manager auf einer Synology.
FROM python:3.12-slim

# ffmpeg zum Zusammenführen von Video+Ton und für MP3-Export.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# yt-dlp[default,deno]: Deno ist die JavaScript-Laufzeit, die yt-dlp für
# YouTube braucht.
RUN pip install --no-cache-dir "flask>=3.0" "yt-dlp[default,deno]"

COPY app.py downloader.py video_task.py ./
COPY static ./static
COPY templates ./templates
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

ENV HOST=0.0.0.0 \
    PORT=8080 \
    OPEN_BROWSER=0 \
    ALLLOADER_STATE_DIR=/config \
    DOWNLOAD_ROOTS=/downloads \
    PYTHONUNBUFFERED=1

VOLUME ["/config"]
EXPOSE 8080
ENTRYPOINT ["docker-entrypoint.sh"]
