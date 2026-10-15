# Stand: allloader
Zuletzt aktualisiert: 2026-10-15
HTML-Seite: keine

## Ziel
Lokale Web-App für Windows (Start per `start.bat`): große Dateien wie KI-Modelle mit Pause und Fortsetzen herunterladen,
dazu Videos und Audio über yt-dlp. Bedienung im Browser, ohne Terminal.

## Aktueller Stand
- Datei-Downloads mit Pause/Fortsetzen (HTTP-Range), Liste bleibt über Neustarts erhalten (`tasks_state.json`).
- Tab „Video“ für YouTube, Vimeo, TikTok u. a. (yt-dlp, ffmpeg über imageio-ffmpeg).
- 2026-10-15: hierarchie eingerichtet (Skills, Worker, UTS, diese Datei). Eigene Tests gibt es noch keine.

## Offene Punkte
- keine bekannt

## Entscheidungen
- Einzige feste Abhängigkeit ist Flask; `start.bat` installiert sie beim ersten Start (README).

## Nächste Schritte
1. Bei der nächsten Änderung Tests für `downloader.py` anlegen (Fortsetzen, Neustart).

## Befunde
- Ein Auth-Header (z. B. Hugging-Face-Token) landet laut README im Klartext in `tasks_state.json`.
