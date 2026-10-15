---
name: werkzeugbau
description: Baue aus einem wiederkehrenden oder regelbasierten Ablauf ein getestetes Werkzeug (Skript oder kleine HTML-App) statt ihn immer wieder neu zu prompten. Nutze diesen Skill, sobald du eine Wiederholung erkennst (Ablauf zum zweiten Mal ähnlich gemacht oder voraussichtlich wiederkehrend), sobald ein Prompt eine regelbasierte Transformation beschreibt (umbenennen, umwandeln, prüfen, auswerten nach festen Regeln) und wenn die Frage „Wiederholt sich das?“ nach einem Arbeitspaket mit ja oder vermutet beantwortet wird. Der Skill führt durch Registerprüfung, Abwägung von Aufwand und Nutzen, Bau mit neues-werkzeug, Registereintrag und Kandidatenliste. Nicht für Einmalaufgaben.
---

# Werkzeugbau

Ein Ablauf, der sich wiederholt und sich in Regeln fassen lässt, gehört in ein getestetes Werkzeug und nicht in einen immer neuen Prompt. Ein Werkzeug ist schneller, billiger, reproduzierbar und prüfbar.

## Auslöser

- Ein Ablauf wurde **mindestens zweimal ähnlich** gemacht (belegt).
- Ein Ablauf wird **voraussichtlich wiederkehren** (vermutet, so kennzeichnen).
- Ein Prompt beschreibt eine **regelbasierte Transformation**.

Einmalaufgaben nicht automatisieren: ein direkter Befehl genügt.

## Aufruf

Im Projekt: `node .hierarchie/werkzeuge/hierarchie.mjs <befehl>`. Im hierarchie-Repo selbst: `node werkzeuge/hierarchie.mjs <befehl>`. Die Beispiele unten nutzen die Projektform.

## Ablauf

1. **Register prüfen.** `node .hierarchie/werkzeuge/hierarchie.mjs register` zeigt alle Werkzeuge (Name, Befehl, Teststatus, Modellbedarf) und die offenen Kandidaten. Gibt es schon etwas Passendes, **erweitere** es, statt ein neues zu bauen.
2. **Zerlegen.** Trenne die deterministischen Schritte von den Schritten mit Interpretation.
3. **Abwägen.** Häufigkeit × Aufwand je Durchlauf × Fehlerkosten gegen Bau und Wartung. Lohnt es sich nicht, trage den Ablauf als Kandidat ein (siehe unten) oder lass es.
4. **Bauen.** `node .hierarchie/werkzeuge/hierarchie.mjs neues-werkzeug <name> [--app] [--zweck "…"]` legt das Gerüst an: Skript (oder mit `--app` eine HTML-App), Test und Registereintrag. Der Gerüst-Test ist ein bewusst offener todo-Test; ersetze ihn durch echte Tests.
5. **Absichern.** Eingaben validieren, verständliche Fehlermeldungen, Exit-Codes 0 (ok) · 1 (Befund oder Fehler im Inhalt) · 2 (Bedienfehler), `--hilfe`, knappe Ausgabe (Claude liest sie), `--json` wo sinnvoll. Schreiben nur mit ausdrücklicher Option, es sei denn, Schreiben ist der Zweck (dann in der Hilfe nennen). Keine Geheimnisse, Personendaten oder Protokollinhalte in Ausgaben und Dateien. Alle Prüfungen als Tests in der UTS.
6. **Registereintrag vervollständigen** (Felder unten). Den Teststatus **nie von Hand** setzen: erst `node .hierarchie/werkzeuge/uts.mjs --kurz` im Vollauf, dann `node .hierarchie/werkzeuge/hierarchie.mjs register aktualisieren`, anschließend `node .hierarchie/werkzeuge/hierarchie.mjs register pruefen` (Exit 0).
7. **Künftig aufrufen.** Bei der nächsten Wiederholung das Werkzeug ausführen, nicht den Ablauf neu prompten.

## Hybride Abläufe

Den deterministischen Teil als Werkzeug bauen. Für den Rest das kleinste ausreichende Modell einsetzen (Skill `intelligent-routing`) und sein Ergebnis nach Möglichkeit vom Werkzeug validieren lassen.

## Wohin gehört das Werkzeug?

- **Projektübergreifend nützlich:** im hierarchie-Repo bauen (`werkzeuge/<name>.mjs`, Test in `tests/<name>.test.mjs`, Register `register.json`).
- **Nur projektbezogen:** im Projekt bauen (`automatisierung/werkzeuge/<name>.mjs` mit Nachbartest `<name>.test.mjs`, Apps in `automatisierung/apps/`, Register `automatisierung/register.json`). `neues-werkzeug` wählt den Ort selbst: aus der Projektkopie `.hierarchie/` heraus gilt die Projektform.
- Projekteigene Befehle erscheinen in `hilfe` gesondert.

## Registereintrag

Pflichtfelder: `name`, `cli` (nur bei Befehlen), `modul`, `zweck`, `eingabe`, `ausgabe`, `befehl`, `dateien[]`, `voraussetzungen[]`, `tests[]`, `teststatus` (`gruen|rot|ungetestet`, nur aus dem UTS-Lauf), `grenzen[]`, `modell_noetig` (`nein|teilweise|ja`), `haeufigkeit` (`{wert, belegt, quelle}`), `zeitersparnis` (`{schaetzung, einheit}` oder `null`).

**Keine erfundenen Zahlen.** Ohne Daten gilt `haeufigkeit: {"wert": "vermutet", "belegt": false, "quelle": null}` und `zeitersparnis: null`. Eine Häufigkeit ist nur dann `belegt: true`, wenn die `quelle` (Commits, Protokoll, Sitzungsverlauf) genannt ist. `grenzen` nennt ehrlich, was nicht getestet oder nicht abgedeckt ist (zum Beispiel eine nicht geprüfte Plattform).

## Kandidaten

Wiederholung erkannt, Bau lohnt sich aber noch nicht oder später? Als Kandidat festhalten:

- `node .hierarchie/werkzeuge/hierarchie.mjs register kandidat <name> --ablauf "…"` (vermutet) bzw. mit `--belegt --quelle "…"` (belegt).
- Entscheidung: `node .hierarchie/werkzeuge/hierarchie.mjs register entscheide <name> bauen|verworfen --begruendung "…"`. Danach bauen oder lassen.

## Prüfregel

UTS ist die einzige Prüfinstanz. „Fertig“ gilt erst mit dem Namen der Testdatei und der Zeile aus `uts --kurz` eines **Vollaufs** (Exit 0) und einem `register pruefen` ohne Befund. Optik einer App lässt sich nicht automatisch prüfen; sie wird als „nicht geprüft“ benannt.
