#!/bin/sh
# YouTube & Co. ändern ständig etwas, also yt-dlp bei jedem Start aktualisieren
# (abschaltbar mit YTDLP_AUTO_UPDATE=0). Klappt das nicht, geht es mit der
# installierten Version weiter.
if [ "${YTDLP_AUTO_UPDATE:-1}" != "0" ]; then
  echo "Aktualisiere yt-dlp ..."
  timeout 120 pip install --no-cache-dir --disable-pip-version-check -q -U "yt-dlp[default,deno]" \
    || echo "yt-dlp-Update fehlgeschlagen, nutze installierte Version."
fi
exec python /app/app.py
