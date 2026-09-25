# Resume Download Manager

> **Neu im Repo:** [`comfyui-mobile/`](comfyui-mobile/README.md) – eine
> Handy-Oberfläche (Web-App fürs iPhone) für ComfyUI Desktop.

Web-App zum Herunterladen großer Dateien (z.B. 20+ GB Transformer-Modelle)
mit Pause/Fortsetzen. Die Bedienung läuft im Browser, du brauchst kein Terminal.
Videos und Audio von YouTube, Vimeo, TikTok und hunderten weiteren Seiten
lädt sie per yt-dlp.

Es gibt zwei Betriebsarten:

- **Lokal unter Windows:** `start.bat`, Bedienung im Browser am PC (siehe
  [Installation (Windows)](#installation-windows)).
- **Auf der Synology als Container:** Die Downloads laufen direkt auf der NAS,
  gesteuert vom iPhone. Die Oberfläche ist fürs Handy gemacht und lässt sich
  als App auf den Home-Bildschirm legen (siehe
  [Auf der Synology](#auf-der-synology-container-manager)).

## Installation (Windows)

1. Python installieren: https://python.org/downloads — beim Installer unbedingt
   **"Add python.exe to PATH"** anhaken.
2. Diesen Ordner irgendwohin entpacken/kopieren.
3. Doppelklick auf `start.bat`.
4. Es öffnet sich automatisch ein Browser-Tab unter `http://127.0.0.1:5000`.

Beim ersten Start installiert `start.bat` automatisch die einzige Abhängigkeit
(Flask). Danach reicht ein Doppelklick auf `start.bat` zum Starten.

Zum Beenden das schwarze Konsolenfenster schließen (oder Strg+C dort drücken).

## Auf der Synology (Container Manager)

Voraussetzung: DSM 7.2 oder neuer mit dem Paket **Container Manager** (aus dem
Paketzentrum).

1. **Ordner für die Downloads:** In der Systemsteuerung → Freigegebener Ordner
   einen Ordner anlegen, z.B. `downloads`. Er liegt dann unter
   `/volume1/downloads`.
2. **Dateien auf die NAS:** In der File Station im Ordner `docker` einen
   Ordner `allloader` anlegen und alle Dateien aus diesem Repo hineinladen
   (GitHub → *Code → Download ZIP*, am PC entpacken, dann hochladen).
3. **Anpassen:** In `docker-compose.yml` bei `volumes` die Ordner auf der
   Synology eintragen, bei `DOWNLOAD_ROOTS` ihre Namen für die App. Mehrere
   Ziele gehen auch, z.B. Downloads, KI-Modelle, Videos. Optional
   `ALLLOADER_PASSWORD` setzen (empfohlen, falls die NAS aus dem Internet
   erreichbar ist).
4. **Projekt anlegen:** Container Manager → **Projekt** → **Erstellen**.
   Name `allloader`, Pfad `/docker/allloader`, Quelle *„Vorhandene
   docker-compose.yml verwenden“*. Dann *Weiter* bis *Fertig*. Das Image wird
   gebaut und gestartet, beim ersten Mal dauert das ein paar Minuten.
5. **Aufs iPhone:** In Safari `http://IP-DER-SYNOLOGY:8765` öffnen, dann
   **Teilen → Zum Home-Bildschirm**.

**Update:** Neue Dateien in `/docker/allloader` hochladen, dann im Container
Manager beim Projekt *Aktion → Erstellen*. yt-dlp aktualisiert sich bei
jedem Start des Containers von selbst, weil YouTube & Co. oft etwas ändern.

**Hinweise**

- Die App kann nur in die freigegebenen Zielordner schreiben, auch nicht per
  API. Unterordner wählst du in der App oder legst sie dort neu an.
- Die Download-Liste liegt in `/docker/allloader/config` und übersteht
  Neustarts. Laufende Downloads werden nach einem Neustart fortgesetzt.
- Ist die DSM-Firewall aktiv, Port `8765` für das Heimnetz freigeben.
- Dateien legt der Container als `root` an. Soll stattdessen dein Benutzer
  Besitzer sein, in `docker-compose.yml` die Zeile `user:` aktivieren.

| Variable | Bedeutung |
|---|---|
| `DOWNLOAD_ROOTS` | Erlaubte Zielordner, `Name=/pfad` durch Komma getrennt |
| `DOWNLOAD_DIR` | Vorauswahl (Standard: der erste Zielordner) |
| `ALLLOADER_PASSWORD` | Passwort für App und API (leer = kein Passwort) |
| `YTDLP_AUTO_UPDATE` | `0` schaltet das yt-dlp-Update beim Start ab |
| `HOST`, `PORT` | Adresse im Container (Standard `0.0.0.0:8080`) |

## Links vom iPhone schicken (Kurzbefehl)

Mit einem Kurzbefehl schickst du einen Link direkt aus dem Teilen-Menü
(Safari, YouTube-App, …) an die Synology, ohne die App zu öffnen:

1. App **Kurzbefehle** → **+** → oben auf den Namen tippen, z.B. „Auf die
   Synology laden“ → **Details** → **Im Teilen-Menü anzeigen** einschalten.
   Eingabe auf **URLs** beschränken.
2. Aktion **„Inhalte von URL abrufen“** hinzufügen, URL
   `http://IP-DER-SYNOLOGY:8765/api/tasks`.
3. In der Aktion aufklappen: **Methode POST**, **Anforderungstext JSON** und
   zwei Felder: `url` = *Kurzbefehleingabe*, `kind` = `auto` (für nur Ton:
   `audio`).
4. Mit Passwort zusätzlich bei **Header**: `Authorization` =
   `Bearer DEIN-PASSWORT`.
5. Optional **„Mitteilung zeigen“** mit „Download gestartet“ anhängen.

Die Anleitung mit deiner echten Adresse steht auch in der App unter dem
**?** oben rechts. Ein anderes Ziel als den Standardordner gibst du mit dem
Feld `output_dir` an (z.B. `/models`).

## Benutzung

1. Link in das obere Feld einfügen. Bei Hugging Face lange auf den
   Download-Button drücken bzw. Rechtsklick → „Link kopieren“, nicht direkt
   antippen.
2. Art wählen: **Automatisch** erkennt Videoseiten (YouTube, Vimeo, TikTok, …)
   und lädt alles andere als Datei. Du kannst aber auch fest **Datei**,
   **Video** oder **Audio** (nur Ton als MP3) wählen.
3. Zielordner wählen: auf der Synology über **Speichern in**, lokal als Pfad.
4. Unter **Mehr Optionen**: Dateiname, Header für geschützte Downloads
   (z.B. `Authorization: Bearer hf_xxx` für gated Hugging-Face-Modelle) und
   die Videoqualität.
5. **Herunterladen** antippen. Fortschritt, Geschwindigkeit und Restzeit
   werden live angezeigt.
6. Jederzeit **Pause**: Die Teildatei bleibt liegen. **Fortsetzen** macht
   genau dort weiter (per HTTP-Range-Request, es wird nichts neu geladen).
   Bei Videos erkennt yt-dlp die bereits geladenen Teile selbst.
7. Die Liste wird automatisch gespeichert. Nach einem Neustart erscheinen
   alle Downloads wieder. Was gerade lief, wird **automatisch fortgesetzt**,
   pausierte Downloads bleiben pausiert.

Videos werden in der besten verfügbaren Qualität geladen und Bild und Ton
automatisch zusammengeführt. Das nötige ffmpeg ist unter Windows mitgeliefert
und im Container eingebaut.

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

- `tasks_state.json` (im selben Ordner wie `app.py`, im Container unter
  `/config`) speichert URL, Zielordner,
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
