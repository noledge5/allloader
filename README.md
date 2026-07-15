# Resume Download Manager

Lokale Web-App zum Herunterladen großer Dateien (z.B. 20+ GB Transformer-Modelle)
mit Pause/Fortsetzen — läuft im Browser, kein Terminal nötig für die Bedienung.
Zweiter Tab "Video" lädt Videos/Audio von YouTube, Vimeo, TikTok und hunderten
weiteren Seiten (per yt-dlp).

## Installation (Windows)

1. Python installieren: https://python.org/downloads — beim Installer unbedingt
   **"Add python.exe to PATH"** anhaken.
2. Diesen Ordner irgendwohin entpacken/kopieren.
3. Doppelklick auf `start.bat`.
4. Es öffnet sich automatisch ein Browser-Tab unter `http://127.0.0.1:5000`.

Beim ersten Start installiert `start.bat` automatisch die einzige Abhängigkeit
(Flask). Danach reicht ein Doppelklick auf `start.bat` zum Starten.

Zum Beenden das schwarze Konsolenfenster schließen (oder Strg+C dort drücken).

## Benutzung

1. Download-Link in das obere Feld einfügen (bei Hugging Face: Rechtsklick auf
   den Download-Button → "Link-Adresse kopieren", nicht direkt anklicken).
2. Optional Zielordner und Dateinamen anpassen.
3. Bei geschützten Downloads (z.B. gated Hugging-Face-Modelle) im Feld
   "Header" z.B. `Authorization: Bearer hf_xxx` eintragen.
4. "Download starten" klicken.
5. Fortschritt, Geschwindigkeit und ETA werden live angezeigt.
6. Jederzeit **Pause** klicken — die Teildatei bleibt liegen.
7. **Fortsetzen** klickt genau da weiter, wo pausiert wurde (per HTTP-Range-
   Request, es wird nichts neu heruntergeladen).
8. Die Liste der Downloads wird automatisch gespeichert (`tasks_state.json`
   neben `app.py`). Programm schließen, PC neu starten, `start.bat` erneut
   starten: alle Downloads erscheinen wieder — Downloads, die gerade liefen,
   werden **automatisch fortgesetzt**; pausierte bleiben pausiert, bis du
   selbst auf Fortsetzen klickst.

## Videos herunterladen

Im Tab "Video" oben:

1. Link zu einem Video einfügen (Videoseite, nicht der rohe Dateilink) —
   funktioniert mit YouTube, Vimeo, TikTok, X/Twitter, Reddit, SoundCloud,
   Twitch-Clips und hunderten weiteren Seiten, die
   [yt-dlp](https://github.com/yt-dlp/yt-dlp) unterstützt.
2. Optional Zielordner anpassen, "Nur Audio extrahieren (MP3)" für reine
   Tonspuren aktivieren.
3. "Video herunterladen" klicken. Standardmäßig wird die beste verfügbare
   Video- + Audioqualität geladen und automatisch zusammengeführt (das dafür
   nötige ffmpeg ist mitgeliefert, keine separate Installation nötig).
4. Pause/Fortsetzen/Abbrechen funktionieren wie bei normalen Downloads:
   Pause beendet den laufenden Vorgang, Fortsetzen setzt am selben Punkt
   wieder an (yt-dlp erkennt die bereits geladenen Teile selbst).

Bitte nur Inhalte herunterladen, an denen du die Rechte hast oder die die
Nutzungsbedingungen der jeweiligen Seite erlauben (eigene Uploads, gemeinfreie
oder frei lizenzierte Inhalte, etc.) — das liegt in deiner Verantwortung.

## Wie es funktioniert

- `app.py` — Flask-Server, stellt die Web-Oberfläche und eine kleine JSON-API bereit.
- `downloader.py` — der eigentliche Download-Engine: ein Python-Thread pro
  Download, schreibt in `<datei>.part`, prüft bei jedem Chunk ob pausiert/
  abgebrochen wurde, öffnet bei Fortsetzen die Verbindung per `Range`-Header
  neu an exakt der Byte-Position der Teildatei.
- Bricht die Verbindung selbst ab (Netzwerkfehler, Server-Timeout), versucht
  der Download automatisch mit steigender Wartezeit erneut weiterzumachen —
  ganz ohne dass du eingreifen musst.

## Persistenz

- `tasks_state.json` (im selben Ordner wie `app.py`) speichert URL, Zielordner,
  Dateiname, Header und Status jedes Downloads. Wird bei jeder Statusänderung
  und alle paar Sekunden während des Ladens aktualisiert.
- Beim Start liest die App diese Datei: Downloads mit Status "lädt" werden
  automatisch fortgesetzt (die Bytes stehen ja schon in der `.part`-Datei),
  "pausiert"/"Fehler" bleiben so liegen, "fertig" bleibt als Verlauf stehen,
  "abgebrochen" wird nicht mehr gespeichert.
- **Achtung:** Wenn du einen Auth-Header (z.B. `Authorization: Bearer ...`)
  eingibst, landet der im Klartext in `tasks_state.json`. Für die eigene
  Maschine unbedenklich, aber die Datei nicht weitergeben/hochladen.

## Bekannte Grenzen

- Braucht einen Server, der `Range`-Requests unterstützt (praktisch jeder
  CDN/Hugging Face/GitHub Releases tut das).
