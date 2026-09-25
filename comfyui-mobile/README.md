# ComfyUI Mobile

Eine Handy-Oberfläche für **ComfyUI Desktop**: Workflows vom iPhone aus
starten, Prompt, Seed, Größe und Modelle bequem ändern, Fortschritt live
verfolgen und Ergebnisse ansehen. Die Knoten-Ansicht von ComfyUI bleibt am PC,
auf dem Handy siehst du nur die Einstellungen, die du wirklich brauchst.

Die App ist eine Web-App (PWA). ComfyUI liefert sie selbst aus, du musst also
kein zusätzliches Programm starten und brauchst weder Mac noch App Store. Auf
dem iPhone legst du sie einmal auf den Home-Bildschirm, danach startet sie im
Vollbild wie eine normale App.

## Was sie kann

- **Workflows öffnen** – deine in ComfyUI gespeicherten Workflows, einen
  früheren Lauf aus dem Verlauf oder eine Datei (`.json` oder ein mit ComfyUI
  erzeugtes PNG).
- **Schnellzugriff** – Prompt, Negativ-Prompt, Seed, Schritte, CFG,
  Sampler, Größe, Checkpoint/LoRA und Eingabebilder werden automatisch
  erkannt. Über den Stern bei „Alle Parameter“ holst du dir jedes andere
  Feld dazu (wird pro Workflow gemerkt). Bei Workflows mit Subgraphs werden
  die Eingänge übernommen, die der Autor am Subgraph freigegeben hat.
- **Große Bedienelemente** – −/+ und Schieberegler für Zahlen, Würfel und
  Modus (Zufall / Fest / +1 / −1) für Seeds, Seitenverhältnis-Buttons für die
  Bildgröße, durchsuchbare Listen für lange Modelllisten.
- **Eingabebilder** direkt aus der Kamera oder den Fotos hochladen (werden
  auf Wunsch vorher verkleinert) oder ein Ergebnis aus der Galerie mit einem
  Tipp als Eingabe verwenden.
- **Generieren ×1/×2/×4/×8** mit Live-Fortschritt und Live-Vorschau des
  entstehenden Bildes.
- **Galerie** mit allen Ergebnissen (auch vom PC gestartete), Vollbild mit
  Wischen, Details (Prompt, Seed, Modell …) und den Aktionen *Übernehmen*,
  *Nochmal*, *Als Eingabe*, *Original* und *Entfernen*. Zum Speichern in die
  Fotos: Bild im Vollbild lange drücken.
- **Warteschlange** ansehen, laufenden Job abbrechen, wartende entfernen.
- **System**: GPU-/RAM-Auslastung, „VRAM freigeben“, Einstellungen.
- Änderungen lassen sich als Workflow zurück in ComfyUI **speichern**, und die
  Bilder enthalten den Workflow mit genau den Werten vom Handy. Am PC kannst du
  so nahtlos weitermachen.

## Installation (Windows, ComfyUI Desktop)

1. **Dateien kopieren:** Doppelklick auf `install.bat` in diesem Ordner. Das
   Skript findet den ComfyUI-Ordner selbst und kopiert alles nach
   `custom_nodes\comfyui-mobile`.
   *Von Hand:* den ganzen Ordner `comfyui-mobile` nach
   `…\ComfyUI\custom_nodes\` kopieren. Das ist der Basisordner, den du bei der
   Installation von ComfyUI Desktop gewählt hast, standardmäßig
   `Dokumente\ComfyUI`.
2. **Zugriff aus dem WLAN erlauben:** In ComfyUI Desktop die Einstellungen
   öffnen (Zahnrad) → **Server-Config** → **Host** auf `0.0.0.0` stellen.
   Den Port lässt du, wie er ist (bei ComfyUI Desktop meist `8000`).
3. **ComfyUI Desktop neu starten.** Fragt die Windows-Firewall nach, den
   Zugriff für **private Netzwerke** erlauben.
4. Im ComfyUI-Log steht jetzt eine Zeile wie
   `[ComfyUI Mobile] Auf dem Handy öffnen: http://192.168.178.23:8000/mobile/`.
   Die Adresse findest du auch, wenn du am PC im Browser
   `http://127.0.0.1:8000/mobile/` öffnest, im Tab *System*.

Für ein Update einfach `install.bat` noch einmal ausführen und ComfyUI neu
starten.

## Auf dem iPhone einrichten

1. iPhone ins **gleiche WLAN** wie den PC.
2. In **Safari** die Adresse von oben öffnen, z.B.
   `http://192.168.178.23:8000/mobile/`.
3. Unten auf **Teilen** → **Zum Home-Bildschirm**. Ab jetzt startest du
   „ComfyUI“ wie jede andere App.

Tipp: Damit sich die IP-Adresse des PCs nicht ändert, im Router (z.B.
FRITZ!Box: *Heimnetz → Netzwerk → Gerät bearbeiten*) „Diesem Gerät immer die
gleiche IPv4-Adresse zuweisen“ aktivieren.

## Benutzung

- **Erstellen:** Oben den Workflow antippen, um einen anderen zu öffnen. Im
  Schnellzugriff die Werte ändern, unten auf **Generieren** tippen. Die Karte
  über dem Button zeigt Fortschritt und Vorschau; ist der Lauf fertig, öffnet
  ein Tipp darauf das Ergebnis.
- **Komplexe Workflows** (viele Custom Nodes, spezielle Widgets): einmal am PC
  ausführen und dann auf dem Handy über *Workflow öffnen → Verlauf* oder in
  der Galerie mit **Übernehmen** laden. Das übernimmt exakt die Einstellungen
  dieses Laufs und funktioniert mit jedem Workflow.
- **Seed-Modus:** *Zufall* erzeugt vor jedem Lauf einen neuen Seed und zeigt
  ihn an, *Fest* behält ihn, *+1/−1* zählt weiter.
- **Menü (⋯):** Als Workflow in ComfyUI speichern, auf den gespeicherten
  Stand zurücksetzen, Schnellzugriff zurücksetzen, Modelllisten neu laden
  (nach dem Herunterladen neuer Modelle).
- **Live-Vorschau** lässt sich unter *System* einstellen („Automatisch“
  nutzt TAESD, wenn vorhanden, sonst eine schnelle Näherung).

## Sicherheit

Mit Host `0.0.0.0` ist ComfyUI für alle Geräte in deinem Heimnetz erreichbar,
ohne Passwort. Im eigenen WLAN ist das üblich. Den Port aber **nicht** im
Router ins Internet freigeben. Für unterwegs nimmst du besser ein VPN wie
Tailscale oder WireGuard (FRITZ!Box) und öffnest dann die VPN-Adresse des PCs.

## Wie es funktioniert

- `__init__.py` ist eine ComfyUI-Erweiterung ohne eigene Nodes. Sie liefert
  den Ordner `app/` unter `/mobile/` aus. Weil die App so von ComfyUI selbst
  kommt, spricht sie direkt mit dessen API und WebSocket, ganz ohne
  CORS-Einstellungen.
- `app/js/converter.js` wandelt gespeicherte Workflows (UI-Format) in das
  API-Format um, das ComfyUI zum Ausführen braucht. Es bildet die Logik des
  offiziellen Frontends nach: Subgraphs (auch verschachtelt),
  Reroutes, Primitive-Nodes, stummgeschaltete und überbrückte Nodes sowie
  dynamische Auswahlfelder. Getestet wurde gegen die 571 offiziellen
  ComfyUI-Vorlagen: 507 davon ergeben exakt dasselbe wie das echte Frontend.
  Die übrigen weichen nur bei Spezial-Widgets ab (3D-Vorschau,
  Bildvergleich u.ä.).
- Die App merkt sich den zuletzt geöffneten Workflow samt Änderungen im
  Browser. Nach einem Neustart geht es genau dort weiter.
- Tests: `npm test` (bzw. `node --test tests/*.test.mjs`) in diesem Ordner.

## Bekannte Grenzen

- iOS beendet die Verbindung, sobald die App im Hintergrund ist. Beim
  Zurückkehren holt sie den aktuellen Stand nach. Push-Benachrichtigungen
  „Bild fertig“ gibt es nicht, weil iOS sie für eine unverschlüsselte
  Adresse im Heimnetz nicht zulässt.
- Kein Masken-Editor und keine 3D-Widgets. Für solche Workflows den Umweg
  über den Verlauf nehmen (siehe oben).
- Fortschritt und Vorschau schickt ComfyUI nur an das Gerät, das den Lauf
  gestartet hat. Am PC gestartete Läufe erscheinen deshalb in Warteschlange
  und Galerie, aber ohne Live-Vorschau.
